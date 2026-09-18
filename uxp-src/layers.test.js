const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const styles = require('./text-style');

const TEXT = 'text';
const GROUP = 'group';

function layer(id, options = {}) {
  return {id, name: options.name || `calque ${id}`, kind: options.kind || 'normal', visible: options.visible !== false, adjustment: !!options.adjustment, allLocked: !!options.allLocked, layers: options.layers};
}

// Descriptors built inside the module's realm carry its Array and Object
// prototypes, which strict deep comparison rejects.
const plain = (value) => JSON.parse(JSON.stringify(value));

const STYLE = {textProps: {typeUnit: 'pixelsUnit', layerText: {textKey: '', textStyleRange: [{from: 0, to: 1, textStyle: {fontPostScriptName: 'ArialMT', size: 24}}], paragraphStyleRange: [{from: 0, to: 1, paragraphStyle: {alignment: 'center'}}]}}};

function host(tree) {
  const operations = [];
  const applied = [];
  const registry = new Map();
  const register = (layers = []) => layers.forEach(item => {registry.set(item.id, item); register(item.layers);});
  register(tree);
  const doc = {
    id: 1, resolution: 72, layers: tree, activeLayers: [],
    selection: {bounds: null, deselect: async () => {doc.selection.bounds = null; operations.push({deselected: true});}},
    get activeLayer() {return doc.activeLayers[0];},
  };
  const describe = (item) => ({
    textKey: item.kind === TEXT ? {textKey: item.name, textStyleRange: [{from: 0, to: 0, textStyle: {size: {_unit: 'pointsUnit', _value: 20}}}], textShape: [{textType: {_value: 'box'}}], paragraphStyleRange: [{from: 0, to: 0, paragraphStyle: {alignment: 'center'}}]} : undefined,
    boundsNoEffects: {top: 10, left: 10, right: 110, bottom: 60},
    adjustmentLayer: item.adjustment ? {_obj: 'adjustmentLayer'} : undefined,
  });
  const ps = {
    app: {documents: [doc], activeDocument: doc},
    constants: {LayerKind: {TEXT, GROUP}},
    action: {batchPlay: async descriptors => descriptors.map(descriptor => {
      operations.push(descriptor);
      const target = descriptor._target?.[0];
      if (descriptor._obj === 'select' && target?._ref === 'layer') {
        const item = registry.get(target._id);
        doc.activeLayers = descriptor.selectionModifier ? [...doc.activeLayers, item] : [item];
        return {};
      }
      if (descriptor._obj === 'get' && target?._ref === 'layer') {
        const item = target._id == null ? doc.activeLayers[0] : registry.get(target._id);
        return item ? describe(item) : {_obj: 'error', result: -25922, message: 'Calque introuvable'};
      }
      if (descriptor._obj === 'set' && target?._ref === 'textLayer') applied.push({layerId: doc.activeLayers[0].id, to: descriptor.to});
      return {};
    })},
    core: {executeAsModal: async callback => callback({hostControl: {
      suspendHistory: async () => 17,
      resumeHistory: async (id, success) => operations.push({resume: id, success}),
    }})},
  };
  return {ps, doc, operations, applied};
}

function setup(tree = []) {
  const native = host(tree);
  const modules = {};
  const evaluate = (file, key) => {
    const module = {exports: {}};
    const require = name => name === 'photoshop' ? native.ps : name === './text-style' ? styles : modules[name];
    vm.runInNewContext(fs.readFileSync(`${__dirname}/${file}`, 'utf8'), {require, module, console});
    modules[key] = module.exports;
    return module.exports;
  };
  evaluate('photoshop.js', './photoshop');
  return {...native, methods: evaluate('layers.js', './layers').methods};
}

test('with no document open every method reports the host shape', async () => {
  const native = setup();
  native.ps.app.documents = [];
  assert.deepEqual(JSON.parse(await native.methods.getSelectedTextLayers()), {error: 'doc'});
  assert.deepEqual(JSON.parse(await native.methods.getTypeRSelectionSnapshot()), {selection: null, layers: []});
  assert.equal(await native.methods.deselectDocumentSelection(), 'doc');
  assert.equal(await native.methods.undoLastTyperChange(), 'doc');
  assert.equal(await native.methods.toggleCleaningLayers(), 'doc');
  await assert.rejects(native.methods.setSelectedTextLayers({items: [{layerId: 7}, {layerId: 5}]}), /document/);
});

test('only text layers of the current selection are reported, by id', async () => {
  const native = setup();
  native.doc.activeLayers = [layer(4, {kind: TEXT}), layer(5)];
  assert.equal(await native.methods.getSelectedTextLayers(), JSON.stringify({layers: [{id: 4}]}));
  assert.equal(await native.methods.getTypeRSelectionSnapshot(), JSON.stringify({selection: null, layers: [{id: 4}]}));
  native.doc.activeLayers = [layer(5)];
  assert.deepEqual(JSON.parse(await native.methods.getSelectedTextLayers()), {layers: []});
});

test('the snapshot carries the live marquee next to the layers', async () => {
  const native = setup();
  native.doc.activeLayers = [layer(4, {kind: TEXT}), layer(9, {kind: TEXT})];
  native.doc.selection.bounds = {top: 10, left: 20, right: 220, bottom: 210};
  const snapshot = JSON.parse(await native.methods.getTypeRSelectionSnapshot());
  assert.equal(snapshot.selection.left, 20);
  assert.equal(snapshot.selection.width, 200);
  assert.equal(snapshot.selection.documentId, 1);
  assert.deepEqual(snapshot.layers, [{id: 4}, {id: 9}]);
});

test('a batch pastes one line per item, in the caller order', async () => {
  const native = setup([layer(7, {kind: TEXT}), layer(5, {kind: TEXT})]);
  const result = await native.methods.setSelectedTextLayers({
    items: [{layerId: 7, text: 'first', style: STYLE}, {layerId: 5, text: 'second', style: STYLE}],
    restoreLayerIds: [5, 7],
  });
  assert.equal(result, '');
  assert.deepEqual(native.applied.map(entry => [entry.layerId, entry.to.textKey]), [[7, 'first'], [5, 'second']]);
  assert.equal(native.applied[0].to.textStyleRange[0].textStyle.size._value, 24);
  assert.equal(native.applied[0].to.textStyleRange[0].textStyle.size._unit, 'pixelsUnit');
  assert.deepEqual(native.operations.filter(op => op._obj === 'select').map(op => op._target[0]._id), [7, 5, 7, 5, 5, 7]);
  assert.equal(native.operations.at(-1).success, true);
});

test('a non-text target aborts the batch before any layer is written', async () => {
  const native = setup([layer(7, {kind: TEXT}), layer(5)]);
  await assert.rejects(native.methods.setSelectedTextLayers({items: [{layerId: 7, text: 'a'}, {layerId: 5, text: 'b'}]}), /calque de texte/);
  assert.equal(native.applied.length, 0);
  assert.equal(native.operations.at(-1).success, false);
});

test('a locked target is refused', async () => {
  const native = setup([layer(7, {kind: TEXT}), layer(5, {kind: TEXT, allLocked: true})]);
  await assert.rejects(native.methods.setSelectedTextLayers({items: [{layerId: 7, text: 'a'}, {layerId: 5, text: 'b'}]}), /verrouillé/);
  assert.equal(native.applied.length, 0);
});

test('a single target is refused', async () => {
  const native = setup([layer(7, {kind: TEXT})]);
  await assert.rejects(native.methods.setSelectedTextLayers({items: [{layerId: 7, text: 'a'}]}), /deux calques/);
  assert.equal(native.operations.filter(op => op._obj).length, 0);
  assert.equal(native.operations.at(-1).success, false);
});

test('a Photoshop error mid-batch rolls the partial paste back and is surfaced', async () => {
  const native = setup([layer(7, {kind: TEXT}), layer(5, {kind: TEXT})]);
  const batchPlay = native.ps.action.batchPlay;
  native.ps.action.batchPlay = async descriptors => descriptors[0]._obj === 'set' && descriptors[0].to.textKey === 'second'
    ? [{_obj: 'error', result: -25922, message: 'Command unavailable'}]
    : batchPlay(descriptors);
  await assert.rejects(
    native.methods.setSelectedTextLayers({items: [{layerId: 7, text: 'first', style: STYLE}, {layerId: 5, text: 'second', style: STYLE}]}),
    /Command unavailable/,
  );
  assert.deepEqual(native.applied.map(entry => entry.layerId), [7]);
  assert.equal(native.operations.at(-1).success, false);
});

test('deselect clears the marquee and swallows a host refusal', async () => {
  const native = setup();
  assert.equal(await native.methods.deselectDocumentSelection(), '');
  assert.equal(native.operations.filter(op => op.deselected).length, 1);
  native.doc.selection = {deselect: async () => {throw new Error('aucune sélection');}};
  assert.equal(await native.methods.deselectDocumentSelection(), '');
});

test('undo commits one history step', async () => {
  const native = setup();
  assert.equal(await native.methods.undoLastTyperChange(), '');
  assert.equal(native.operations.some(op => op._obj === 'undo'), true);
  assert.equal(native.operations.at(-1).success, true);
});

test('an undo Photoshop refuses reports none instead of raising', async () => {
  const native = setup();
  native.ps.action.batchPlay = async () => [{_obj: 'error', result: -25922, message: 'Nothing to undo'}];
  assert.equal(await native.methods.undoLastTyperChange(), 'none');
  assert.equal(native.operations.at(-1).success, false);
});

test('cleaning layers hide in one action and come back', async () => {
  const native = setup([
    layer(7, {kind: TEXT}),
    layer(2, {visible: false}),
    layer(3, {adjustment: true}),
    layer(4),
    layer(1),
  ]);
  assert.equal(await native.methods.toggleCleaningLayers(), 'hidden:1');
  assert.deepEqual(plain(native.operations.find(op => op._obj === 'hide').null), [{_ref: 'layer', _id: 4}]);
  assert.equal(await native.methods.toggleCleaningLayers(), 'shown:1');
  assert.deepEqual(plain(native.operations.find(op => op._obj === 'show').null), [{_ref: 'layer', _id: 4}]);
});

test('layers under a hidden group and deleted layers stay untouched', async () => {
  const native = setup([layer(6, {kind: GROUP, visible: false, layers: [layer(7)]}), layer(4), layer(1)]);
  assert.equal(await native.methods.toggleCleaningLayers(), 'hidden:1');
  assert.deepEqual(plain(native.operations.find(op => op._obj === 'hide').null), [{_ref: 'layer', _id: 4}]);
  native.doc.layers = [layer(1)];
  assert.equal(await native.methods.toggleCleaningLayers(), 'shown:1');
  assert.equal(native.operations.some(op => op._obj === 'show'), false);
});

test('each document keeps its own hidden cleaning layers', async () => {
  const native = setup([layer(4), layer(1)]);
  assert.equal(await native.methods.toggleCleaningLayers(), 'hidden:1');
  native.doc.id = 2;
  assert.equal(await native.methods.toggleCleaningLayers(), 'hidden:1');
  native.doc.id = 1;
  assert.equal(await native.methods.toggleCleaningLayers(), 'shown:1');
});
