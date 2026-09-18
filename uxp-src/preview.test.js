const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const RECT = {top: 100, left: 100, right: 300, bottom: 260};
const TEXT_LAYER = {
  textKey: {
    textKey: 'hello',
    textStyleRange: [{from: 0, to: 6, textStyle: {fontPostScriptName: 'ArialMT', size: {_unit: 'pointsUnit', _value: 20}}}],
    paragraphStyleRange: [{from: 0, to: 6, paragraphStyle: {alignment: 'center'}}],
    textShape: [{textType: {_enum: 'textType', _value: 'box'}}],
  },
  boundsNoEffects: RECT,
  bounds: RECT,
  layerEffects: {frameFX: {enabled: true, size: {_unit: 'pixelsUnit', _value: 3}, opacity: {_unit: 'percentUnit', _value: 100}, color: {_obj: 'RGBColor', red: 0, grain: 0, blue: 0}}},
};
const textLayer = textType => ({...TEXT_LAYER, textKey: {...TEXT_LAYER.textKey, textShape: [{textType: {_enum: 'textType', _value: textType}}]}});
const unit = value => ({_unit: 'pixelsUnit', _value: value});
const point = (x, y) => ({anchor: {horizontal: unit(x), vertical: unit(y)}, forward: {horizontal: unit(x), vertical: unit(y)}, backward: {horizontal: unit(x), vertical: unit(y)}, smooth: false, linked: false});
const pathFor = rect => [point(rect.left, rect.top), point(rect.right, rect.top), point(rect.right, rect.bottom), point(rect.left, rect.bottom)];
const grow = (rect, amount) => ({top: rect.top - amount, left: rect.left - amount, right: rect.right + amount, bottom: rect.bottom + amount});

function host() {
  const operations = [];
  const modals = [];
  const state = {layerId: 42, itemIndex: 7, textBounds: {...RECT}, selection: null, wand: null, path: null, pathError: null, wandError: null, layer: 'text', textType: 'box'};
  const doc = {id: 1, activeLayers: [], selection: {bounds: null}};
  const ps = {
    app: {documents: [doc], activeDocument: doc},
    constants: {LayerKind: {TEXT: 'text'}},
    core: {executeAsModal: (callback, options) => {
      modals.push(options.commandName);
      // suspendHistory opens a transaction, resumeHistory(id, false) rolls the
      // document back: the fake restores the marquee and drops the work path,
      // which is what makes a scan leave no trace.
      return callback({hostControl: {
        suspendHistory: async () => {const snapshot = {selection: state.selection, path: state.path}; return () => {state.selection = snapshot.selection; state.path = snapshot.path;};},
        resumeHistory: async (rollback, success) => {if (!success) rollback(); operations.push({resume: 17, success});},
      }});
    }},
  };
  ps.action = {batchPlay: async descriptors => {
    operations.push(...descriptors);
    return descriptors.map(descriptor => {
      const first = (descriptor._target || [])[0] || {};
      if (descriptor._obj === 'get') {
        if (first._property === 'layerID') return {layerID: state.layerId};
        if (first._property === 'bounds') return {bounds: state.textBounds};
        if (first._property === 'selection') return state.selection ? {selection: state.selection} : {};
        if (first._ref === 'historyState') return {itemIndex: state.itemIndex};
        if (first._ref === 'path') return state.path ? {pathContents: {pathComponents: [{subpathListKey: [{points: state.path}]}]}} : {};
        return state.layer === 'text' ? textLayer(state.textType) : {...TEXT_LAYER, textKey: undefined};
      }
      if (descriptor._obj === 'make') {
        if (state.pathError) return {_obj: 'error', message: state.pathError};
        state.path = pathFor(state.selection || state.textBounds);
        return {};
      }
      if (descriptor._obj === 'set' && first._ref === 'channel') {
        if (state.wandError === 'all' || (state.wandError === 'frameSelect' && first._property === 'frameSelect')) return {_obj: 'error', message: 'unsupported'};
        state.selection = state.wand || state.textBounds;
        return {};
      }
      if (descriptor._obj === 'expand' || descriptor._obj === 'contract') {
        state.selection = grow(state.selection, descriptor.by._value * (descriptor._obj === 'expand' ? 1 : -1));
        return {};
      }
      return {};
    });
  }};
  const modules = new Map();
  const loadModule = name => {
    if (modules.has(name)) return modules.get(name).exports;
    const module = {exports: {}};
    modules.set(name, module);
    vm.runInNewContext(fs.readFileSync(`${__dirname}/${name}.js`, 'utf8'), {
      require: request => (request === 'photoshop' ? ps : loadModule(request.replace('./', ''))),
      module, console,
    });
    return module.exports;
  };
  const descriptors = () => operations.filter(op => op._obj === 'get' && op._target[0]._ref === 'layer' && op._target[0]._property === undefined);
  return {methods: loadModule('preview').methods, ps, doc, state, operations, modals, descriptors};
}

test('panel snapshot without a document reports an empty page', async () => {
  const native = host();
  native.ps.app.documents = [];
  assert.deepEqual(JSON.parse(await native.methods.getTypeRPanelSnapshot({})), {activeLayer: {error: 'layer', signature: ''}, selection: null, layers: []});
});

test('panel snapshot carries the text payload once and then only its signature', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'text'}];
  const first = JSON.parse(await native.methods.getTypeRPanelSnapshot({}));
  assert.deepEqual(Object.keys(first), ['activeLayer', 'selection', 'layers']);
  assert.deepEqual(first.layers, [{id: 42}]);
  assert.equal(first.selection, null);
  assert.deepEqual(Object.keys(first.activeLayer), ['layerId', 'bounds', 'textType', 'textProps', 'stroke', 'signature']);
  assert.equal(first.activeLayer.layerId, 42);
  assert.equal(first.activeLayer.signature, '42:6');
  assert.equal(first.activeLayer.textType, 'paragraph');
  assert.deepEqual(first.activeLayer.bounds, {top: 100, left: 100, right: 300, bottom: 260, width: 200, height: 160, xMid: 200, yMid: 180});
  assert.equal(first.activeLayer.textProps.typeUnit, 'pointsUnit');
  assert.equal(first.activeLayer.textProps.layerText.textKey, 'hello');
  assert.equal(first.activeLayer.textProps.layerText.textStyleRange[0].textStyle.size, 20);
  assert.deepEqual(first.activeLayer.stroke, {enabled: true, position: 'outer', size: 3, opacity: 100, color: {r: 0, g: 0, b: 0}});
  assert.equal(native.descriptors().length, 1);
  const second = JSON.parse(await native.methods.getTypeRPanelSnapshot({signature: first.activeLayer.signature}));
  assert.deepEqual(second.activeLayer, {unchanged: true, signature: '42:6'});
  // The panel polls on every Photoshop event: a known signature must stop the
  // text descriptor read, which is the expensive half of the snapshot.
  assert.equal(native.descriptors().length, 1);
});

test('panel snapshot drops the text payload for a non-text layer', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'pixel'}];
  assert.deepEqual(JSON.parse(await native.methods.getTypeRPanelSnapshot({})).activeLayer, {error: 'layer', signature: ''});
  assert.equal(native.descriptors().length, 0);
});

test('panel snapshot reports point text and the live marquee', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'text'}];
  native.doc.selection = {bounds: RECT};
  native.state.textType = 'point';
  const snapshot = JSON.parse(await native.methods.getTypeRPanelSnapshot({}));
  assert.equal(snapshot.activeLayer.textType, 'point');
  assert.equal(snapshot.selection.documentId, 1);
  assert.equal(snapshot.selection.width, 200);
  assert.equal(snapshot.selection.xMid, 200);
});

test('text layer geometry returns the id, bounds and history signature', async () => {
  const native = host();
  assert.deepEqual(JSON.parse(await native.methods.getActiveTextLayerGeometry()), {
    layerId: 42,
    bounds: {top: 100, left: 100, right: 300, bottom: 260, width: 200, height: 160, xMid: 200, yMid: 180},
    signature: '42:6',
  });
});

test('text layer geometry without a document or bounds reports the layer error', async () => {
  const empty = host();
  empty.ps.app.documents = [];
  assert.deepEqual(JSON.parse(await empty.methods.getActiveTextLayerGeometry()), {error: 'layer', signature: ''});
  const unknown = host();
  unknown.state.layerId = null;
  assert.deepEqual(JSON.parse(await unknown.methods.getActiveTextLayerGeometry()), {error: 'layer', signature: ''});
});

test('selection shape without a document or a marquee reports its own error', async () => {
  const empty = host();
  empty.ps.app.documents = [];
  assert.deepEqual(JSON.parse(await empty.methods.getCurrentSelectionShape({})), {error: 'doc'});
  const none = host();
  assert.deepEqual(JSON.parse(await none.methods.getCurrentSelectionShape({})), {error: 'noSelection'});
});

test('selection shape samples the work path and rolls its history back', async () => {
  const native = host();
  native.doc.selection = {bounds: RECT};
  const shape = JSON.parse(await native.methods.getCurrentSelectionShape({samples: 5}));
  assert.deepEqual(Object.keys(shape), ['scan', 'bounds', 'rows', 'fallback']);
  assert.equal(shape.scan, 'path');
  assert.equal(shape.fallback, false);
  assert.equal(shape.bounds.width, 200);
  assert.equal(shape.bounds.documentId, 1);
  assert.equal(shape.rows.length, 5);
  assert.deepEqual(shape.rows[0], {y: 0, left: 0, right: 1, width: 1});
  assert.deepEqual(shape.rows[4], {y: 1, left: 0, right: 1, width: 1});
  assert.deepEqual(native.modals, ['TypeR : scan de forme']);
  assert.equal(native.operations.some(op => op._obj === 'make'), true);
  // The scan leaves no undo step and no work path behind: mutate() rolls the
  // whole transaction back, which is the only thing that clears the temp path.
  assert.deepEqual(native.operations.at(-1), {resume: 17, success: false});
});

test('selection shape clamps the sample count to the contract range', async () => {
  const native = host();
  native.doc.selection = {bounds: RECT};
  assert.equal(JSON.parse(await native.methods.getCurrentSelectionShape({samples: 99})).rows.length, 31);
  assert.equal(JSON.parse(await native.methods.getCurrentSelectionShape({samples: 2})).rows.length, 5);
  assert.equal(JSON.parse(await native.methods.getCurrentSelectionShape({samples: 'many'})).rows.length, 17);
});

test('selection shape falls back to the full rectangle and reports the scan error', async () => {
  const native = host();
  native.doc.selection = {bounds: RECT};
  native.state.pathError = 'Command unavailable';
  const shape = JSON.parse(await native.methods.getCurrentSelectionShape({samples: 5}));
  assert.deepEqual(Object.keys(shape), ['scan', 'scanError', 'bounds', 'rows', 'fallback']);
  assert.equal(shape.scan, 'legacy');
  assert.match(shape.scanError, /Command unavailable/);
  assert.equal(shape.fallback, true);
  assert.deepEqual(shape.rows[0], {y: 0, left: 0, right: 1, width: 1});
});

test('a scan refused by the modal scope answers historyBusy instead of a rectangle', async () => {
  const native = host();
  native.doc.selection = {bounds: RECT};
  native.ps.core.executeAsModal = async () => {throw new Error('Modal scope is already held by another plugin');};
  assert.deepEqual(JSON.parse(await native.methods.getCurrentSelectionShape({})), {error: 'historyBusy'});
});

test('bubble shape refuses a missing document, a pixel layer, a live marquee and a batch', async () => {
  const empty = host();
  empty.ps.app.documents = [];
  assert.deepEqual(JSON.parse(await empty.methods.getActiveLayerBubbleShape({})), {error: 'doc'});
  const pixel = host();
  pixel.state.layer = 'pixel';
  assert.deepEqual(JSON.parse(await pixel.methods.getActiveLayerBubbleShape({})), {error: 'layer'});
  const selected = host();
  selected.doc.selection = {bounds: RECT};
  assert.deepEqual(JSON.parse(await selected.methods.getActiveLayerBubbleShape({})), {error: 'hasSelection'});
  const batch = host();
  batch.doc.activeLayers = [{id: 42, kind: 'text'}, {id: 43, kind: 'text'}];
  assert.deepEqual(JSON.parse(await batch.methods.getActiveLayerBubbleShape({})), {error: 'multi'});
});

test('bubble shape wands, closes the outline and samples it', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'text'}];
  native.state.wand = {top: 90, left: 90, right: 310, bottom: 270};
  const shape = JSON.parse(await native.methods.getActiveLayerBubbleShape({samples: 21, tolerance: 30}));
  assert.deepEqual(Object.keys(shape), ['scan', 'bounds', 'rows', 'fallback']);
  assert.equal(shape.scan, 'path');
  assert.equal(shape.fallback, false);
  assert.equal(shape.rows.length, 21);
  assert.equal(shape.bounds.left, 90);
  assert.equal(shape.bounds.width, 220);
  const wand = native.operations.find(op => op._obj === 'set');
  assert.equal(wand.tolerance, 30);
  assert.equal(wand._target[0]._property, 'frameSelect');
  assert.equal(wand.to.horizontal._value, 95);
  // 20pt text: a 10px expansion, then the matching contraction.
  assert.deepEqual(native.operations.filter(op => op._obj === 'expand').map(op => op.by._value), [10]);
  assert.deepEqual(native.operations.filter(op => op._obj === 'contract').map(op => op.by._value), [10]);
  assert.deepEqual(native.operations.at(-1), {resume: 17, success: false});
});

test('bubble shape retries the wand on the plain selection channel', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'text'}];
  native.state.wand = {top: 90, left: 90, right: 310, bottom: 270};
  native.state.wandError = 'frameSelect';
  const shape = JSON.parse(await native.methods.getActiveLayerBubbleShape({}));
  assert.equal(shape.scan, 'path');
  assert.deepEqual(native.operations.filter(op => op._obj === 'set').map(op => op._target[0]._property), ['frameSelect', 'selection']);
});

test('bubble shape rejects an empty or page-sized wand result', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'text'}];
  native.state.wand = {top: 100, left: 100, right: 110, bottom: 110};
  assert.deepEqual(JSON.parse(await native.methods.getActiveLayerBubbleShape({})), {error: 'noBubble'});
  native.state.wand = {top: 0, left: 0, right: 1000, bottom: 2000};
  assert.deepEqual(JSON.parse(await native.methods.getActiveLayerBubbleShape({})), {error: 'noBubble'});
  // A rejected bubble is never smoothed or shaped to the page.
  assert.equal(native.operations.some(op => op._obj === 'expand' || op._obj === 'make'), false);
});

test('bubble shape surfaces a wand failure instead of inventing a shape', async () => {
  const native = host();
  native.doc.activeLayers = [{id: 42, kind: 'text'}];
  native.state.wandError = 'all';
  assert.deepEqual(JSON.parse(await native.methods.getActiveLayerBubbleShape({})), {error: 'shape'});
  const busy = host();
  busy.doc.activeLayers = [{id: 42, kind: 'text'}];
  busy.ps.core.executeAsModal = async () => {throw new Error('Modal scope is already held by another plugin');};
  assert.deepEqual(JSON.parse(await busy.methods.getActiveLayerBubbleShape({})), {error: 'historyBusy'});
});

test('select layer selects the id without a history step', async () => {
  const native = host();
  assert.equal(await native.methods.selectLayerById('43'), '');
  assert.equal(native.operations[0]._obj, 'select');
  // The module builds its descriptors in another realm: compare their values.
  assert.deepEqual(JSON.parse(JSON.stringify(native.operations[0]._target)), [{_ref: 'layer', _id: 43}]);
  assert.equal(native.operations[0].makeVisible, false);
  assert.equal(native.operations.some(op => op.resume), false);
  assert.equal(await native.methods.selectLayerById('layer:7'), 'error');
});

test('select layer reports a Photoshop refusal instead of succeeding silently', async () => {
  const native = host();
  native.ps.action.batchPlay = async descriptors => [{_obj: 'error', result: -25922, message: 'Command unavailable'}];
  assert.equal(await native.methods.selectLayerById(43), 'error');
});
