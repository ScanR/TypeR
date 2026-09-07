const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let layers = [];
let failOn = 0;
const doc = {
  id: 1,
  get activeHistoryState() { return { count: layers.length }; },
  set activeHistoryState(state) { layers.length = state.count; },
  suspendHistory(name, script) { vm.runInContext(script, box); },
};
const box = vm.createContext({ app: { activeDocument: doc, documents: [doc] }, documents: [doc], jamJSON: JSON });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../app_src/host.js'), 'utf8'), box);
Object.assign(box, {
  _ensureStyle: s => s || {}, _calculateSelectionDimensions: s => s,
  _createAndSetLayerText(data) { layers.push(data.text); if (layers.length === failOn) throw new Error('Injected Photoshop failure'); },
  _getCurrentTextLayerBounds: () => ({}), _resizeTextBoxToContent() {}, _positionLayerWithinSelection() {},
});
const key = box.getTypeRDocumentKey();
const selection = { documentKey: key, width: 100, height: 100 };
const payload = () => ({ texts: ['one', 'two'], styles: [], selections: [selection, selection] });
const invalid = payload(); invalid.selections[1] = { ...selection, width: 0 };
assert.strictEqual(box.createTextLayersInStoredSelections(invalid, false), 'invalidSelection');
assert.strictEqual(layers.length, 0);
failOn = 2;
assert(box.createTextLayersInStoredSelections(payload(), false).startsWith('scriptError'));
assert.strictEqual(layers.length, 0, 'A failed batch must roll back all created layers');
failOn = 0;
assert.strictEqual(box.createTextLayersInStoredSelections(payload(), false), '');
assert.deepStrictEqual(layers, ['one', 'two']);
layers = [];
doc.id = 2;
assert.strictEqual(box.createTextLayersInStoredSelections(payload(), false), 'wrongDocument');
assert.strictEqual(layers.length, 0);
assert.strictEqual(JSON.parse(box.getSelectionChanged()).documentChanged, true);
box._getSelectionChanged = () => JSON.stringify({ width: 10, multiSelection: [{ width: 10 }] });
const capture = JSON.parse(box.getSelectionChanged());
assert.strictEqual(capture.multiSelection[0].documentKey, box.getTypeRDocumentKey());
doc.id = 3;
assert.strictEqual(JSON.parse(box.getSelectionChanged()).documentChanged, true);
const queue = require('./helpers/loadAppModule')()('app_src/latestTaskQueue.js').createLatestTaskQueue;
const running = [], callbacks = [], results = [];
const enqueue = queue((value, done) => { running.push(value); callbacks.push(done); });
enqueue('A', r => results.push(['A', r]));
enqueue('B', r => results.push(['B', r]));
enqueue('C', r => results.push(['C', r]));
assert.deepStrictEqual(running, ['A']);
assert.strictEqual(results[0][0], 'B');
callbacks.shift()({ ok: true });
assert.deepStrictEqual(running, ['A', 'C']);
callbacks.shift()({ ok: false });
assert.strictEqual(results[results.length - 1][1].ok, false);
console.log('Batch document safety, rollback and page queue tests passed');
