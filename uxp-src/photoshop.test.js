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

// Photoshop is faked down to the marquee itself: the wand must recreate it,
// and contracting and expanding must move it, for the opening tests to mean
// anything. `collapse` makes a contraction of that radius and above destroy the
// marquee, the case the retry exists for.
function marquee(native, rect, options = {}) {
  // `empty` starts with no marquee at all: the wand is then the only thing that
  // can produce one, which is the case the retry has to be able to come back to.
  let live = options.empty ? null : {...rect};
  let wands = 0;
  const modify = (descriptor, sign) => {
    const amount = descriptor.by._value * sign;
    if (sign > 0 && options.collapse && amount >= options.collapse) { live = null; return; }
    live = live && {left: live.left + amount, top: live.top + amount, right: live.right - amount, bottom: live.bottom - amount};
  };
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => {
      if (descriptor._obj === 'get' && descriptor._target?.[0]?._property === 'selection') return {selection: live || undefined};
      if (descriptor._obj === 'get') return {
        textKey: {
          textKey: 'hello',
          textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}],
          textShape: [{textType: {_value: 'box'}}],
        },
        boundsNoEffects: rect,
        bounds: rect,
      };
      if (descriptor._obj === 'set' && descriptor._target?.[0]?._property === 'selection' && descriptor.to?._enum) live = null;
      // The wand replaces the marquee outright: that is what a retry re-arms
      // from, and the only way back to it once a contraction has emptied it.
      if (descriptor._obj === 'set' && descriptor.to?._obj === 'paint') { live = {...rect}; wands++; }
      if (descriptor._obj === 'contract') modify(descriptor, 1);
      if (descriptor._obj === 'expand') modify(descriptor, -1);
      return {};
    });
  };
  return {live: () => live, wands: () => wands};
}

// No command may write the user's document out as a file, and no command may
// touch a channel: the bare `save` the opening used to fall back on is Save As,
// and the two commands before it were not Photoshop commands at all.
function documentWrites(native) {
  return native.operations.filter(op => op._obj === 'store' || op._obj === 'save' || op._obj === 'delete');
}

test('insert opens the marquee without touching any channel', async () => {
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
  // 390px shortest side: a 39px opening, and the marquee is back where it
  // started once the expansion has run.
  const verbs = native.operations.map(op => op._obj);
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [39]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand').map(op => op.by._value), [39]);
  assert.equal(verbs.indexOf('contract') < verbs.indexOf('expand'), true);
  assert.deepEqual(documentWrites(native), []);
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

test('centering opens the marquee on the bubble without touching any channel', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => { native.doc.selection.bounds = null; }};
  marquee(native, rect);
  await native.methods.alignTextLayerToSelection({});
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [30]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand').map(op => op.by._value), [30]);
  assert.deepEqual(documentWrites(native), []);
});

test('a selection below the minimum area opens nothing and reports the bubble', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 110, bottom: 110};
  native.doc.resolution = 72;
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  marquee(native, rect);
  await assert.rejects(native.methods.alignTextLayerToSelection({}), /détecter la bulle/);
  assert.equal(native.operations.some(op => op._obj === 'contract'), false);
  assert.deepEqual(documentWrites(native), []);
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

test('an opening that collapses re-runs the wand and retries with half the radius', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.width = 1000;
  native.doc.height = 1500;
  native.doc.resolution = 72;
  native.doc.selection = {bounds: null, deselect: async () => {}};
  // The 30px opening empties the marquee; the retry has to put it back before
  // it can be contracted again, and only the wand that produced it can do that.
  const fake = marquee(native, rect, {collapse: 30, empty: true});
  await native.methods.alignTextLayerToSelection({});
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [30, 15]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand').map(op => op.by._value), [15]);
  assert.equal(fake.wands(), 2);
  assert.deepEqual(documentWrites(native), []);
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
});

test('a marquee nothing can restore is opened once, then falls back to its bounds', async () => {
  const native = host();
  const rect = {top: 100, left: 100, right: 400, bottom: 400};
  native.doc.resolution = 72;
  // A selection the user drew: no wand ran, so there is no rearm to retry on.
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  marquee(native, rect, {collapse: 30});
  await native.methods.alignTextLayerToSelection({});
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [30]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand'), []);
  // The text still lands, centred on the marquee the opening could not improve.
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
  assert.deepEqual(documentWrites(native), []);
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
      if (descriptor._obj === 'set' && descriptor._target?.[0]?._property === 'selection' && descriptor.to?._obj === 'paint') wand = true;
      if (descriptor._obj === 'get' && descriptor._target?.[0]?._property === 'selection' && !wand) return {};
      return result;
    });
  };
  await native.methods.alignTextLayerToSelection({});
  assert.equal(wand, true);
  assert.equal(native.doc.selection.bounds, null);
  assert.equal(native.operations.some(op => op._obj === 'move'), true);
  assert.equal(native.operations.some(op => op._obj === 'contract'), true);
  assert.deepEqual(documentWrites(native), []);
});

// A fake that answers the layer read with a given textKey and records every
// size write, so the arithmetic of an increment can be checked end to end.
function sizeHost(textKey, options = {}) {
  const native = host();
  native.doc.resolution = 72;
  native.doc.activeLayers = [{id: 7, kind: 'text'}];
  let current = JSON.parse(JSON.stringify(textKey));
  const rect = {top: 100, left: 100, right: 300, bottom: 200};
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => {
      if (descriptor._obj === 'get') return {textKey: current, boundsNoEffects: rect, bounds: rect};
      if (descriptor._obj === 'set' && descriptor._target?.[0]?._property === 'textStyle') {
        if (options.refuseFast) return {_obj: 'error', result: -25920, message: 'refused'};
        for (const range of current.textStyleRange) range.textStyle.size = {...descriptor.to.size};
      }
      return {};
    });
  };
  return native;
}

const sizeWrites = native => native.operations.filter(op => op._obj === 'set' && op._target?.[0]?._property === 'textStyle').map(op => op.to.size);

test('size increments follow the displayed size of a scaled layer', async () => {
  // Stored 80px under a 0.25 transform: Photoshop shows 20px. +1 means 21px
  // shown, so 84px stored — the old code wrote 81px (20.25px shown).
  const native = sizeHost({
    textStyleRange: [{from: 0, to: 5, textStyle: {size: {_unit: 'pixelsUnit', _value: 80}}}],
    transform: {_obj: 'transform', xx: 0.25, xy: 0, yx: 0, yy: 0.25, tx: 0, ty: 0},
    textShape: [{textType: {_value: 'point'}}],
  });
  await native.methods.changeActiveLayerTextSize(1);
  const [write] = sizeWrites(native);
  assert.equal(write._unit, 'pixelsUnit');
  assert.equal(write._value, 84);
  assert.equal(native.operations.at(-1).success, true);
});

test('a decrement never drives the size to the floor in one step', async () => {
  const native = sizeHost({
    textStyleRange: [{from: 0, to: 5, textStyle: {size: {_unit: 'pointsUnit', _value: 4}}}],
    transform: {_obj: 'transform', xx: 5, xy: 0, yx: 0, yy: 5, tx: 0, ty: 0},
    textShape: [{textType: {_value: 'point'}}],
  });
  // 20pt shown: -1 gives 19pt shown, i.e. 3.8pt stored, not 3pt (15pt shown).
  await native.methods.changeActiveLayerTextSize(-1);
  assert.ok(Math.abs(sizeWrites(native)[0]._value - 3.8) < 1e-9);
});

test('box text frames grow with the text so it is not clipped', async () => {
  const native = sizeHost({
    textStyleRange: [{from: 0, to: 5, textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}],
    textShape: [{_obj: 'textShape', textType: {_enum: 'textType', _value: 'box'}, bounds: {_obj: 'rectangle', top: 0, left: 0, right: 100, bottom: 50}}],
  });
  await native.methods.changeActiveLayerTextSize(2);
  const frame = native.operations.find(op => op._obj === 'set' && op.to?.textShape)?.to.textShape[0].bounds;
  // 20px -> 22px at 72 dpi (22pt): the frame scales by 1.1 (110 x 55), then
  // gets 30% of the size as horizontal slack and 1.2 sizes of spare height.
  assert.ok(Math.abs(frame.right - (110 + 6.6)) < 1e-9);
  assert.ok(Math.abs(frame.bottom - (55 + 26.4)) < 1e-9);
  // The frame is written after the size, so it matches the final size.
  const sizeAt = native.operations.findIndex(op => op._obj === 'set' && op._target?.[0]?._property === 'textStyle');
  const frameAt = native.operations.findIndex(op => op._obj === 'set' && op.to?.textShape);
  assert.ok(sizeAt >= 0 && frameAt > sizeAt);
});

test('mixed sizes scale together when the fast path is refused', async () => {
  const native = sizeHost({
    textStyleRange: [
      {from: 0, to: 2, textStyle: {size: {_unit: 'pixelsUnit', _value: 20}, impliedFontSize: {_unit: 'pixelsUnit', _value: 20}}},
      {from: 2, to: 5, textStyle: {size: {_unit: 'pixelsUnit', _value: 40}}},
    ],
    textShape: [{textType: {_value: 'point'}}],
  });
  await native.methods.changeActiveLayerTextSize(2);
  const full = native.operations.find(op => op._obj === 'set' && op.to?.textStyleRange);
  assert.deepEqual(full.to.textStyleRange.map(range => range.textStyle.size._value), [22, 44]);
  assert.equal(full.to.textStyleRange[0].textStyle.impliedFontSize, undefined);
});

test('a bubble candidate must hold the text and not a neighbour', () => {
  const native = host();
  native.doc.width = 2000;
  native.doc.height = 3000;
  const box = {top: 100, left: 100, right: 200, bottom: 140, width: 100, height: 40, xMid: 150, yMid: 120};
  const bubble = {top: 60, left: 60, right: 260, bottom: 200, width: 200, height: 140};
  assert.equal(native.bubbleCandidateValid(bubble, box, native.doc), true);
  // The neighbour to the right of the text: the probe leaked through a gap.
  assert.equal(native.bubbleCandidateValid({top: 60, left: 205, right: 400, bottom: 200, width: 195, height: 140}, box, native.doc), false);
  // The background around every bubble on the page.
  assert.equal(native.bubbleCandidateValid({top: 0, left: 0, right: 1300, bottom: 1000, width: 1300, height: 1000}, box, native.doc), false);
  // A merged double bubble is refused once the other text is excluded.
  const other = {xMid: 230, yMid: 120};
  assert.equal(native.bubbleCandidateValid(bubble, box, native.doc, [other]), false);
});

test('a double bubble is cut between the two texts', () => {
  const native = host();
  const merged = {top: 0, left: 0, right: 400, bottom: 200};
  const left = {top: 50, left: 40, right: 140, bottom: 150, xMid: 90, yMid: 100};
  const right = {top: 60, left: 260, right: 360, bottom: 140, xMid: 310, yMid: 100};
  const [a, b] = native.splitBubble(merged, [left, right]);
  assert.equal(a.right, 200);
  assert.equal(b.left, 200);
  assert.equal(a.top, 0);
  assert.equal(b.bottom, 200);
  // Stacked vertically: the cut is horizontal.
  const top = {top: 20, left: 100, right: 300, bottom: 80, xMid: 200, yMid: 50};
  const bottom = {top: 120, left: 120, right: 280, bottom: 180, xMid: 200, yMid: 150};
  const [c, d] = native.splitBubble(merged, [bottom, top]);
  assert.equal(d.bottom, 100);
  assert.equal(c.top, 100);
  assert.equal(c.left, 0);
});

test('double bubble centring needs at least two text layers', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 1, kind: 'text'}];
  await assert.rejects(native.methods.alignTextLayersToDoubleBubble({}), /au moins 2/);
});

test('double bubble centring puts each text in its own bubble', async () => {
  const native = host();
  native.doc.resolution = 72;
  native.doc.width = 2000;
  native.doc.height = 3000;
  native.doc.activeLayers = [{id: 1, kind: 'text'}, {id: 2, kind: 'text'}];
  native.doc.selection = {bounds: null, deselect: async () => {}};
  const texts = {1: {top: 100, left: 100, right: 200, bottom: 140}, 2: {top: 100, left: 400, right: 500, bottom: 140}};
  const bubbles = [{top: 50, left: 50, right: 300, bottom: 200}, {top: 50, left: 330, right: 600, bottom: 200}];
  let active = 1;
  let live = null;
  const moves = [];
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => {
      if (descriptor._obj === 'select') active = descriptor._target[0]._id;
      if (descriptor._obj === 'get' && descriptor._target?.[0]?._property === 'selection') return {selection: live || undefined};
      if (descriptor._obj === 'get') return {textKey: {textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}], textShape: [{textType: {_value: 'point'}}]}, boundsNoEffects: texts[active]};
      if (descriptor._obj === 'set' && descriptor.to?._obj === 'paint') {
        const x = descriptor.to.horizontal._value, y = descriptor.to.vertical._value;
        live = bubbles.find(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) || null;
      }
      if (descriptor._obj === 'contract' || descriptor._obj === 'expand') return {};
      if (descriptor._obj === 'move') moves.push({id: active, dx: descriptor.to.horizontal._value});
      return {};
    });
  };
  await native.methods.alignTextLayersToDoubleBubble({});
  const centre = id => texts[id].left + 50;
  assert.equal(moves.length, 2);
  assert.equal(centre(1) + moves.find(m => m.id === 1).dx, 175);
  assert.equal(centre(2) + moves.find(m => m.id === 2).dx, 465);
  assert.equal(native.operations.at(-1).success, true);
});

function pasteHost() {
  const native = host();
  const rect = {top: 10, left: 10, right: 200, bottom: 200};
  native.doc.resolution = 72;
  native.doc.layers = [];
  native.doc.selection = {bounds: rect, deselect: async () => {}};
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => descriptor._obj === 'get' ? {
      textKey: {textKey: 'hello', textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}], textShape: [{textType: {_value: 'box'}}]},
      boundsNoEffects: rect,
      bounds: rect,
    } : {});
  };
  return native;
}

test('auto-centre off adds nothing to a paste', async () => {
  const plain = pasteHost();
  await plain.methods.createTextLayerInSelection({text: 'hello'}, false);
  const off = pasteHost();
  await off.methods.createTextLayerInSelection({text: 'hello', autoCenter: 'off'}, false);
  assert.equal(off.operations.length, plain.operations.length);
});

test('auto-centre never makes a paste fail', async () => {
  for (const mode of ['single', 'multi']) {
    const native = pasteHost();
    await native.methods.createTextLayerInSelection({text: 'hello', autoCenter: mode}, false);
    assert.equal(native.operations.filter(op => op._obj === 'createTextLayer').length, 1);
    assert.equal(native.operations.at(-1).success, true);
  }
});

const pixelStyle = size => ({textProps: {typeUnit: 'pixelsUnit', layerText: {textKey: '', textStyleRange: [{from: 0, to: 1, textStyle: {fontPostScriptName: 'ArialMT', size}}], paragraphStyleRange: [{from: 0, to: 1, paragraphStyle: {alignment: 'center'}}]}}});
const storedRect = (left, top, right, bottom) => ({documentId: 1, left, top, right, bottom, width: right - left, height: bottom - top});

test('keeping the text size without a text layer to copy it from creates nothing', async () => {
  const native = pasteHost();
  const batchPlay = native.ps.action.batchPlay;
  // The active layer is an image: its read carries no textKey.
  native.ps.action.batchPlay = async descriptors => descriptors[0]._obj === 'get' && descriptors[0]._target?.[0]?._enum === 'ordinal'
    ? (native.operations.push(...descriptors), descriptors.map(() => ({})))
    : batchPlay(descriptors);
  assert.equal(await native.methods.createTextLayerInSelection({text: 'hello', style: pixelStyle(24), preserveActiveTextSize: true}, false), 'sizeSource');
  assert.equal(native.operations.some(op => op._obj === 'createTextLayer' || op._obj === 'make'), false);
  assert.equal(native.operations.at(-1).success, false);
});

test('keeping the text size pastes at the size the active layer displays', async () => {
  const native = pasteHost();
  const rect = {top: 10, left: 10, right: 200, bottom: 200};
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    // 20px stored under a 2x transform: Photoshop shows 40px.
    return descriptors.map(descriptor => descriptor._obj === 'get' ? {
      textKey: {textKey: 'hello', textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}], transform: {xx: 2, xy: 0, yx: 0, yy: 2}, textShape: [{textType: {_value: 'box'}}]},
      boundsNoEffects: rect, bounds: rect,
    } : {});
  };
  assert.equal(await native.methods.createTextLayerInSelection({text: 'hello', style: pixelStyle(24), preserveActiveTextSize: true}, false), '');
  assert.equal(native.operations.find(op => op._obj === 'createTextLayer').fontSize, 40);
});

test('stored selections pair one text each, skip empty texts and fall back on the last style', async () => {
  const native = pasteHost();
  await native.methods.createTextLayersInStoredSelections({
    texts: ['un', '  ', 'trois'],
    styles: [pixelStyle(10), pixelStyle(30)],
    pointModes: [false, false, true],
    selections: [storedRect(10, 10, 200, 200), storedRect(300, 10, 500, 200), storedRect(600, 10, 800, 200), storedRect(900, 10, 1100, 200)],
  }, false);
  const created = native.operations.filter(op => op._obj === 'createTextLayer');
  assert.deepEqual(created.map(op => op.contents), ['un', 'trois'], 'the empty text and the selection past the last text get nothing');
  assert.deepEqual(created.map(op => op.fontSize), [10, 30]);
  const pointSets = native.operations.filter(op => op._obj === 'set' && op._target?.[0]?._property === 'textType' && op.to._value === 'point');
  assert.equal(pointSets.length, 1, 'only the layer whose point mode says so becomes point text');
  assert.equal(native.operations.at(-1).success, true);
});

test('an invalid stored selection fails the batch before the first layer', async () => {
  const native = pasteHost();
  await assert.rejects(native.methods.createTextLayersInStoredSelections({
    texts: ['un', 'deux'], styles: [pixelStyle(10)],
    selections: [storedRect(10, 10, 200, 200), storedRect(300, 10, 302, 12)],
  }, false), /trop petite/);
  assert.equal(native.operations.some(op => op._obj === 'createTextLayer'), false);
});

// A page of text layers with bubbles: the wand selects the bubble under the
// point it is clicked at, `intersectWith` clips the marquee, and every move is
// recorded with the layer it moved.
function pageHost({texts, bubbles, failMove}) {
  const native = host();
  native.doc.resolution = 72;
  native.doc.width = 2000;
  native.doc.height = 3000;
  native.doc.layers = [];
  let live = null;
  let active = null;
  let created = 0;
  const moves = [];
  const wands = [];
  native.doc.selection = {bounds: null, deselect: async () => { live = null; }};
  native.doc.createTextLayer = async options => {
    native.operations.push({_obj: 'createTextLayer', ...options});
    const layer = {id: ++created, kind: 'text'};
    native.doc.activeLayers = [layer];
    active = layer.id;
    return layer;
  };
  native.ps.action.batchPlay = async descriptors => {
    native.operations.push(...descriptors);
    return descriptors.map(descriptor => {
      if (descriptor._obj === 'select') active = descriptor._target[0]._id;
      if (descriptor._obj === 'get' && descriptor._target?.[0]?._property === 'selection') return {selection: live || undefined};
      if (descriptor._obj === 'get') return {
        textKey: {textKey: 'x', textStyleRange: [{textStyle: {size: {_unit: 'pixelsUnit', _value: 20}}}], textShape: [{textType: {_value: 'point'}}]},
        boundsNoEffects: texts[active],
      };
      if (descriptor._obj === 'set' && descriptor.to?._obj === 'paint') {
        const x = descriptor.to.horizontal._value, y = descriptor.to.vertical._value;
        wands.push({x, y});
        live = bubbles.find(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) || null;
        live = live && {...live};
      }
      if (descriptor._obj === 'intersectWith' && live) {
        const to = descriptor.to;
        live = {left: Math.max(live.left, to.left._value), top: Math.max(live.top, to.top._value), right: Math.min(live.right, to.right._value), bottom: Math.min(live.bottom, to.bottom._value)};
      }
      if (descriptor._obj === 'move') {
        if (failMove && failMove(active, moves)) return {_obj: 'error', result: -25920, message: 'Calque verrouillé'};
        moves.push({id: active, dx: descriptor.to.horizontal._value, dy: descriptor.to.vertical._value});
      }
      return {};
    });
  };
  const centre = id => (texts[id].left + texts[id].right) / 2;
  // Where the last move of a layer put its centre, the paste's own move to
  // the stored selection being only a step on the way.
  const landed = id => centre(id) + moves.filter(m => m.id === id).at(-1).dx;
  return {native, moves, wands, landed, setLive: rect => { live = rect && {...rect}; }};
}

test('a marquee the user drew still serves a later layer once an earlier one was wanded', async () => {
  const page = pageHost({
    texts: {1: {top: 100, left: 100, right: 200, bottom: 140}, 2: {top: 100, left: 1100, right: 1200, bottom: 140}},
    bubbles: [{top: 50, left: 50, right: 300, bottom: 200}],
  });
  page.native.doc.activeLayers = [{id: 1, kind: 'text'}, {id: 2, kind: 'text'}];
  // The user's marquee holds only the second text, off its centre.
  page.setLive({top: 50, left: 1000, right: 1400, bottom: 200});
  await page.native.methods.alignTextLayerToSelection({});
  assert.equal(page.landed(1), 175, 'the first text is centred in the bubble the wand found');
  assert.equal(page.landed(2), 1200, 'the second text is centred in the user marquee, not in the wand one');
  assert.equal(page.wands.some(w => w.x > 900), false, 'the second text is never wanded');
});

test('a bare-number size is written back in points', async () => {
  const native = sizeHost({
    textStyleRange: [{from: 0, to: 5, textStyle: {size: 20}}],
    textShape: [{textType: {_value: 'point'}}],
  });
  await native.methods.changeActiveLayerTextSize(1);
  const [write] = sizeWrites(native);
  assert.deepEqual({...write}, {_unit: 'pointsUnit', _value: 21});
  assert.equal(native.operations.at(-1).success, true);
});

test('multi auto-centre cuts a shared bubble between two pasted texts without probing it again', async () => {
  const page = pageHost({
    texts: {1: {top: 100, left: 100, right: 200, bottom: 140}, 2: {top: 100, left: 400, right: 500, bottom: 140}},
    bubbles: [{top: 50, left: 50, right: 600, bottom: 200}],
  });
  await page.native.methods.createTextLayersInStoredSelections({
    texts: ['un', 'deux'], styles: [pixelStyle(20)], autoCenter: 'multi',
    selections: [storedRect(60, 60, 290, 190), storedRect(310, 60, 590, 190)],
  }, false);
  assert.equal(page.landed(1), 175);
  assert.equal(page.landed(2), 450);
  // Five probes per text, one wand to put the shared bubble back, one per lobe.
  assert.equal(page.wands.length, 5 + 5 + 1 + 2);
  assert.equal(page.native.operations.at(-1).success, true);
});

test('multi auto-centre moves an unlocked neighbour into its lobe but never a locked one', async () => {
  for (const locked of [false, true]) {
    const page = pageHost({
      texts: {1: {top: 100, left: 100, right: 200, bottom: 140}, 9: {top: 100, left: 420, right: 520, bottom: 140}},
      bubbles: [{top: 50, left: 50, right: 600, bottom: 200}],
    });
    page.native.doc.layers = [{id: 9, kind: 'text', visible: true, allLocked: locked, bounds: {top: 100, left: 420, right: 520, bottom: 140}}];
    await page.native.methods.createTextLayersInStoredSelections({
      texts: ['un'], styles: [pixelStyle(20)], autoCenter: 'multi',
      selections: [storedRect(60, 60, 290, 190)],
    }, false);
    assert.equal(page.landed(1), (50 + 310) / 2);
    assert.equal(page.moves.some(m => m.id === 9), !locked);
    assert.equal(page.native.operations.at(-1).success, true);
  }
});

test('one text auto-centring cannot place leaves the others centred and the paste intact', async () => {
  const page = pageHost({
    texts: {1: {top: 100, left: 100, right: 200, bottom: 140}, 2: {top: 100, left: 1100, right: 1200, bottom: 140}},
    bubbles: [{top: 50, left: 50, right: 300, bottom: 200}, {top: 50, left: 1000, right: 1400, bottom: 200}],
    // The paste's own move of layer 1 goes through; the centring one fails.
    failMove: (id, moves) => id === 1 && moves.some(m => m.id === 1),
  });
  assert.equal(await page.native.methods.createTextLayersInStoredSelections({
    texts: ['un', 'deux'], styles: [pixelStyle(20)], autoCenter: 'single',
    selections: [storedRect(60, 60, 290, 190), storedRect(1010, 60, 1390, 190)],
  }, false), '');
  assert.equal(page.landed(2), 1200);
  assert.equal(page.native.operations.filter(op => op._obj === 'createTextLayer').length, 2);
  assert.equal(page.native.operations.at(-1).success, true);
});
