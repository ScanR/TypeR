const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const styles = require('./text-style');

function host() {
  const operations = [];
  const doc = {
    id: 1, activeLayers: [], selection: {bounds: null},
    createTextLayer: async options => {
      const layer = {id: 80 + operations.length, kind: 'text'};
      operations.push({_obj: 'createTextLayer', ...options});
      doc.activeLayers = [layer];
      return layer;
    },
  };
  const ps = {
    app: {documents: [doc], activeDocument: doc},
    constants: {LayerKind: {TEXT: 'text'}},
    action: {batchPlay: async descriptors => {operations.push(...descriptors); return descriptors.map(() => ({}));}},
    core: {executeAsModal: async callback => callback({hostControl: {
      suspendHistory: async () => 17,
      resumeHistory: async (id, success) => operations.push({resume: id, success}),
    }})},
  };
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(__dirname + '/photoshop.js', 'utf8'), {require: name => name === 'photoshop' ? ps : styles, module});
  return {...module.exports, ps, doc, operations};
}

test('failure rolls back the history transaction', async () => {
  const native = host();
  await assert.rejects(native.mutate('test', () => {throw new Error('deliberate failure');}), /deliberate/);
  assert.equal(native.operations.at(-1).success, false);
});

test('queued command cannot apply to a document switched before execution', async () => {
  const native = host();
  let called = false;
  const job = native.mutate('test', () => {called = true;});
  native.ps.app.activeDocument = {id: 2};
  await assert.rejects(job, /document actif/);
  assert.equal(called, false);
  assert.equal(native.operations.length, 0);
});

test('stored selections from a different page create no layers', async () => {
  const native = host();
  await assert.rejects(native.methods.createTextLayersInStoredSelections({texts: ['hello'], selections: [{documentId: 2, left: 10, top: 10, right: 200, bottom: 200, width: 190, height: 190}]}), /cette page/);
  assert.equal(native.operations.some(op => op._obj === 'make' || op._obj === 'createTextLayer'), false);
  assert.equal(native.operations.at(-1).success, false);
});

test('insert keeps only stored selections from the active document', async () => {
  const native = host();
  const rect = {top: 10, left: 10, right: 200, bottom: 200};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => descriptor._obj === 'get' ? {
      textKey: {textKey: 'hello', textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}], textShape: [{textType: {_value: 'box'}}]},
      boundsNoEffects: rect,
      bounds: rect,
    } : {});
  };
  await native.methods.createTextLayersInStoredSelections({
    texts: ['old page', 'this page'],
    selections: [
      {documentId: 2, left: 10, top: 10, right: 200, bottom: 200, width: 190, height: 190},
      {documentId: 1, left: 10, top: 10, right: 200, bottom: 200, width: 190, height: 190},
    ],
  }, false);
  assert.equal(native.operations.filter(op => op._obj === 'createTextLayer').length, 1);
});

test('mixed text and image selection is rejected before any layer modification', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 4, kind: 'text'}, {id: 5, kind: 'pixel'}];
  await assert.rejects(native.methods.setActiveLayerText({text: 'hello'}), /uniquement/);
  assert.equal(native.operations.some(op => op._obj === 'set'), false);
});

test('Photoshop actionJSON error result rejects instead of advancing the text queue', async () => {
  const native = host();
  native.ps.action.batchPlay = async () => [{_obj: 'error', result: -25922, message: 'Command unavailable'}];
  await assert.rejects(native.play({_obj: 'make'}), /Command unavailable/);
});

test('selection bounds that throw are treated as no selection', () => {
  const native = host();
  Object.defineProperty(native.doc, 'selection', {get() { throw new Error('no selection'); }});
  assert.equal(native.selection(), null);
});

test('actionJSON selection is used when DOM bounds are empty', async () => {
  const native = host();
  native.doc.selection = {bounds: null};
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => descriptor._obj === 'get' ? {
      selection: {top: 10, left: 20, right: 220, bottom: 210},
    } : {});
  };
  const rect = await native.readSelection();
  assert.equal(rect.left, 20);
  assert.equal(rect.width, 200);
  assert.equal(rect.documentId, 1);
});

test('selection inset shrinks a rectangle without Photoshop commands', () => {
  const native = host();
  const rect = native.inset({top: 10, left: 10, right: 110, bottom: 110, width: 100, height: 100, xMid: 60, yMid: 60}, -5);
  assert.equal(rect.left, 15);
  assert.equal(rect.width, 90);
});

// Photoshop is faked down to the marquee itself: contracting and expanding must
// move the fake selection for the opening tests to mean anything.
function marquee(native, rect, options = {}) {
  let live = {...rect};
  const channels = new Set();
  const modify = (descriptor, sign) => {
    const amount = descriptor.by._value * sign;
    live = {left: live.left + amount, top: live.top + amount, right: live.right - amount, bottom: live.bottom - amount};
  };
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => {
      if (options.refuseChannel && (descriptor._obj === 'store' || descriptor._obj === 'save')) throw new Error('canal refuse');
      if (descriptor._obj === 'get' && descriptor._target?.[0]?._property === 'selection') return {selection: live};
      if (descriptor._obj === 'get') return {
        textKey: {
          textKey: 'hello',
          textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}],
          textShape: [{textType: {_value: 'box'}}],
        },
        boundsNoEffects: rect,
        bounds: rect,
      };
      if (descriptor._obj === 'store' || descriptor._obj === 'save') channels.add(descriptor.name);
      if (descriptor._obj === 'delete' && descriptor._target?.[0]?._ref === 'channel') channels.delete(descriptor._target[0]._name);
      if (descriptor._obj === 'contract') modify(descriptor, 1);
      if (descriptor._obj === 'expand') modify(descriptor, -1);
      return {};
    });
  };
  return {channels, live: () => live};
}

test('insert opens the marquee and removes its temporary channel', async () => {
  const native = host();
  const rect = {top: 10, left: 10, right: 400, bottom: 400};
  let deselected = false;
  native.doc.resolution = 72;
  native.doc.selection = {
    bounds: rect,
    deselect: async () => { deselected = true; native.doc.selection.bounds = null; },
  };
  const fake = marquee(native, rect);
  await native.methods.createTextLayerInSelection({text: 'hello', style: {textProps: {typeUnit: 'pixelsUnit', layerText: {textStyleRange: [{from: 0, to: 5, textStyle: {size: 20, fontPostScriptName: 'ArialMT'}}], paragraphStyleRange: [{from: 0, to: 5, paragraphStyle: {alignment: 'center'}}]}}}}, false);
  assert.equal(deselected, true);
  assert.equal(native.operations.some(op => op._obj === 'createTextLayer' || op._obj === 'make'), true);
  assert.equal(native.operations.some(op => op._obj === 'select' && op._target?.[0]?._id), true);
  // 390px shortest side: a 39px opening, restored and cleaned up afterwards.
  const verbs = native.operations.map(op => op._obj);
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [39]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand').map(op => op.by._value), [39]);
  assert.equal(verbs.indexOf('contract') < verbs.indexOf('expand'), true);
  assert.equal(fake.channels.size, 0);
  assert.deepEqual(fake.live(), rect);
});

test('Photoshop batchPlay errors name the command', async () => {
  const native = host();
  native.ps.action.batchPlay = async () => [{_obj: 'error', result: -128}];
  await assert.rejects(native.play({_obj: 'make'}), /make/);
});

test('shortcut context reports a selection versus a text layer', async () => {
  const native = host();
  native.doc.selection = {bounds: {top: 10, left: 10, right: 200, bottom: 200}};
  native.doc.activeLayers = [];
  assert.deepEqual(JSON.parse(await native.methods.getShortcutContext()), {hasSelection: true, hasTextLayer: false});
  native.doc.selection.bounds = null;
  native.doc.activeLayers = [{id: 3, kind: 'text'}];
  assert.deepEqual(JSON.parse(await native.methods.getShortcutContext()), {hasSelection: false, hasTextLayer: true});
});

test('a page-sized selection is ignored so auto-center can wand the bubble', () => {
  const native = host();
  native.doc.width = 1000;
  native.doc.height = 1500;
  const huge = {top: 0, left: 0, right: 1000, bottom: 1500, width: 1000, height: 1500};
  assert.equal(native.usableBubble(huge, native.doc), null);
  const bubble = {top: 100, left: 100, right: 300, bottom: 280, width: 200, height: 180};
  assert.equal(native.usableBubble(bubble, native.doc).width, 200);
});

test('centering opens the marquee on the bubble and cleans up its channel', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => { native.doc.selection.bounds = null; }};
  const fake = marquee(native, rect);
  await native.methods.alignTextLayerToSelection({});
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [30]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand').map(op => op.by._value), [30]);
  assert.equal(fake.channels.size, 0);
});

test('a selection below the minimum area opens nothing and reports the bubble', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 110, bottom: 110};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  const fake = marquee(native, rect);
  await assert.rejects(native.methods.alignTextLayerToSelection({}), /détecter la bulle/);
  assert.equal(native.operations.some(op => op._obj === 'contract'), false);
  assert.equal(fake.channels.size, 0);
});

test('resizing the text box hugs the frame around the rendered text', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  marquee(native, rect);
  await native.methods.alignTextLayerToSelection({resizeTextBox: true});
  const frames = native.operations.filter(op => op._obj === 'set' && op.to?.textShape).map(op => op.to.textShape[0].bounds);
  // 300px marquee: the frame is 90% of its width, and its height is the text
  // Photoshop rendered (the fake reports the marquee) plus one size and 2px.
  assert.equal(frames.length, 2);
  assert.equal(frames[0].right, 270);
  assert.equal(frames[0].bottom, 300);
  assert.equal(frames[1].right, 270);
  assert.equal(frames[1].bottom, 300 + 20 + 2);
});

test('a refused temporary channel leaves the raw marquee alone', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  marquee(native, rect, {refuseChannel: true});
  await native.methods.alignTextLayerToSelection({});
  // No channel means no opening, and the text still lands on the marquee.
  assert.equal(native.operations.some(op => op._obj === 'contract' || op._obj === 'expand'), false);
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
});

test('a wand selection reaches the centring code without a stale DOM read', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.width = 1000;
  native.doc.height = 1500;
  native.doc.resolution = 72;
  native.doc.selection = {bounds: null, deselect: async () => {}};
  const fake = marquee(native, rect);
  // Nothing is selected for the whole session: the wand is the only source of
  // a marquee, and only batchPlay can see what it produced.
  const inner = native.ps.action.batchPlay;
  let wand = false;
  native.ps.action.batchPlay = async descriptors => {
    const results = await inner(descriptors);
    return results.map((result, index) => {
      const descriptor = descriptors[index];
      if (descriptor._obj === 'set' && descriptor._target?.[0]?._property === 'frameSelect') wand = true;
      if (descriptor._obj === 'get' && descriptor._target?.[0]?._property === 'selection' && !wand) return {};
      return result;
    });
  };
  await native.methods.alignTextLayerToSelection({});
  assert.equal(wand, true);
  assert.equal(native.doc.selection.bounds, null);
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
  assert.equal(native.operations.some(op => op._obj === 'contract'), true);
  assert.equal(fake.channels.size, 0);
});
