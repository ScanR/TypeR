const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const load = require('./helpers/loadAppModule')();
const { pageRange, nextPageLine, validateBounds, createOperationStore, scriptRevision, reviewPage, polygonProfile, dialogueMatches } = load('app_src/mcpLogic.js');
const contract = require('../plugins/typer/mcp/contract.mjs').default;

const lines = [
  { rawText: '# Page 1 : début', ignore: true },
  { rawText: 'REG: Bonjour !', text: 'Bonjour !', ignore: false },
  { rawText: 'Page 2', ignore: true },
  { rawText: 'Salut.', text: 'Salut.', ignore: false },
];
assert.deepStrictEqual(pageRange(lines, 1), { start: 0, end: 2, page: 1 });
assert.strictEqual(nextPageLine(lines, 2, pageRange(lines, 1)), null);
assert.strictEqual(nextPageLine(lines, 2), 3);
assert.throws(() => validateBounds({ left: NaN, top: 0, right: 10, bottom: 20 }), /finite/);
assert.throws(() => validateBounds({ left: 0, top: 0, right: 101, bottom: 20 }, { width: 100, height: 100 }), /outside/);
const triangle = polygonProfile([{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], validateBounds({ left: 0, top: 0, right: 100, bottom: 100 }));
assert(triangle.rows[0].width < triangle.rows[20].width);
assert(dialogueMatches('compo-\rsition', 'composition'));
assert(!dialogueMatches('bonsoir', 'bonjour'));

let persisted;
const operations = createOperationStore({}, value => { persisted = JSON.parse(JSON.stringify(value)); });
assert(operations.begin('__proto__', 'paste', { text: 'été' }).fresh);
assert(!operations.begin('__proto__', 'paste', { text: 'été' }).fresh);
assert.throws(() => operations.begin('__proto__', 'paste', { text: 'autre' }), /conflict/);
const reloaded = createOperationStore(persisted);
assert.strictEqual(reloaded.get('__proto__').status, 'interrupted');
operations.finish('__proto__', { status: 'completed', result: { layerId: 7 } });
assert.strictEqual(operations.begin('__proto__', 'paste', { text: 'été' }).record.result.layerId, 7);

const revision = scriptRevision('script');
const link = { layerId: 7, lineIndex: 1, scriptRevision: revision, sourceText: 'Bonjour !', appliedText: 'Bonjour !', bounds: { left: 0, top: 0, right: 100, bottom: 100 } };
const layer = { layerId: 7, text: 'Bonjour\r!', bounds: { left: 10, top: 10, right: 90, bottom: 90 }, visible: true };
assert.strictEqual(reviewPage({ lines, range: pageRange(lines, 1), layers: [layer], links: [link], revision, padding: 5 }).issues.length, 0);
const defects = reviewPage({ lines, range: pageRange(lines, 1), layers: [{ ...layer, text: 'Bye', bounds: { left: -1, top: 10, right: 90, bottom: 90 } }], links: [link, link], revision }).issues;
assert(defects.some(issue => issue.kind === 'text_changed'));
assert(defects.some(issue => issue.kind === 'margin_overflow'));
assert(defects.some(issue => issue.kind === 'duplicate_line'));
assert(reviewPage({ lines, range: pageRange(lines, 1), layers: [], links: [link], revision }).issues.some(issue => issue.kind === 'missing_dialogue'));

for (const tool of contract.tools) {
  assert(tool.inputSchema && tool.inputSchema.additionalProperties === false);
  if (!tool.annotations.readOnlyHint) assert(tool.inputSchema.required.includes('requestId'));
}
const edit = contract.tools.find(tool => tool.name === 'typer_edit_layer').inputSchema;
assert.throws(() => contract.validate(edit, { layerId: 1, documentId: 1, requestId: 'r', typography: { fontSize: 0 } }), /range/);
assert.throws(() => contract.validate(edit, { layerId: 1, requestId: 'r' }), /documentId/);
assert.throws(() => contract.validate(edit, { layerId: 1, documentId: 1, requestId: 'r', arbitraryScript: 'deleteAll()' }), /unknown field/);
assert.strictEqual(contract.tools.length, 47);

let history = { name: 'before' };
const doc = { id: 1, get activeHistoryState() { return history; }, set activeHistoryState(value) { history = value; } };
const box = vm.createContext({ app: { activeDocument: doc }, documents: [doc], jamJSON: JSON });
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../app_src/host.js'), 'utf8'), box);
assert.strictEqual(box.evalTypeRMcpHost('throw new Error("should not execute")', 2, null), 'wrongDocument');
assert(JSON.parse(box.typeRMcpCheckpoint({ action: 'begin', id: 'batch' })).ok);
history = { name: 'batch done' };
assert(JSON.parse(box.typeRMcpCheckpoint({ action: 'commit', id: 'batch' })).ok);
const completed = history;
history = { name: 'manual edit' };
assert.match(JSON.parse(box.typeRMcpCheckpoint({ action: 'undo', id: 'batch' })).error, /history_changed/);
history = completed;
assert(JSON.parse(box.typeRMcpCheckpoint({ action: 'undo', id: 'batch' })).ok);
assert.strictEqual(history.name, 'before');

let measuredLines = [], closed = 0, temporary;
const pixels = value => ({ as: () => value });
doc.width = pixels(800); doc.height = pixels(1000); doc.resolution = 300;
box.NewDocumentMode = { RGB: 'rgb' }; box.DocumentFill = { WHITE: 'white' };
box.DialogModes = { NO: 'no' }; box.SaveOptions = { DONOTSAVECHANGES: 'discard' };
box.app.documents = { add(width, height, resolution, name, mode, fill) {
  assert.strictEqual(resolution, 300, 'Measurements must use the source resolution');
  temporary = { background: fill === 'white', close() { closed++; } };
  box.app.activeDocument = temporary;
  return temporary;
} };
box._createAndSetLayerText = (payload, width, height) => {
  // Simulate Photoshop dropping overset content when a short box is converted.
  measuredLines = payload.text.split('\n').slice(0, Math.floor(height / 50));
  temporary.activeLayer = { textItem: { contents: measuredLines.join('\r'), font: 'TestFont', size: { as: () => 24 } }, remove() { if (!temporary.background) throw new Error('Cannot delete last layer'); } };
};
box._changeToPointText = () => {};
box._getCurrentTextLayerBounds = () => ({ width: 200, height: measuredLines.length * 50 });
const candidate = { text: 'First\nSecond\nThird', bounds: { left: 0, top: 0, right: 400, bottom: 40 }, style: { textProps: { layerText: { textStyleRange: [{ textStyle: { size: 24, fontPostScriptName: 'TestFont' } }] } } } };
const measurement = JSON.parse(box.typeRMcpMeasure({ candidates: [candidate] })).measurements[0];
assert.strictEqual(measurement.contentComplete, true);
assert.strictEqual(measurement.measuredHeight, 150);
assert.strictEqual(measurement.fits, false, 'Clipped text must never be reported as fitting');
assert.strictEqual(box.app.activeDocument, doc);
assert.strictEqual(closed, 1);
box._createAndSetLayerText = () => { throw new Error('Injected render failure'); };
assert.match(JSON.parse(box.typeRMcpMeasure({ candidates: [candidate] })).error, /Injected/);
assert.strictEqual(box.app.activeDocument, doc);
assert.strictEqual(closed, 2, 'Disposable documents must close after measurement failure');
console.log('MCP workflow tests passed: page boundaries, replay recovery, validation, review and precise undo');
