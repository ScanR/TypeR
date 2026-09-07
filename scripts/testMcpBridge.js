const assert = require('assert');
const vm = require('vm');
const contract = require('../plugins/typer/mcp/contract.mjs').default;
global.window = {};
const defaultProps = () => ({ layerText: { textStyleRange: [{ textStyle: { size: 20, fontPostScriptName: 'TestFont' } }], paragraphStyleRange: [{ paragraphStyle: { alignment: 'center' } }] } });
let documentId = 1, layerCount = 0, failPaste = false;
let checkpoints = {};
const info = () => ({ id: documentId, documentKey: 'session:' + documentId, width: 1000, height: 1000, path: '/page.psd', activeLayer: { id: layerCount } });
const host = {
  getTypeRMcpDocumentInfo: () => JSON.stringify(info()),
  typeRMcpCheckpoint(data) {
    if (data.action === 'begin') checkpoints[data.id] = layerCount;
    if (['rollback', 'undo'].includes(data.action)) layerCount = checkpoints[data.id];
    return JSON.stringify({ ok: true });
  },
  createTextLayersInStoredSelections(data) {
    assert(data.selections.every(selection => selection.documentKey === 'session:' + documentId));
    if (failPaste) { layerCount++; return 'scriptError: injected failure'; }
    return JSON.stringify({ documentId, layers: data.texts.map(text => ({ text, layerId: ++layerCount, bounds: { left: 10, top: 10, right: 80, bottom: 60 } })) });
  },
};
host.evalTypeRMcpHost = (expression, expected) => expected != null && expected !== documentId ? 'wrongDocument' : vm.runInNewContext(expression, host);
const utils = {
  csInterface: { evalScript(expression, callback) { try { callback(vm.runInNewContext(expression, host)); } catch (e) { callback('scriptError: ' + e.message); } } },
  trackHostAction: callback => callback,
  buildRichTextPayload: text => ({ text, richTextRuns: [] }),
  deselectDocument() {}, getDefaultStyle: defaultProps, getDefaultStroke: () => ({ enabled: false }),
  getUserFonts: () => [{ postScriptName: 'TestFont' }], rgbToHex: () => '#000000', readStorage: () => null,
};
const load = require('./helpers/loadAppModule')({ './utils': utils, './context': {} });
const { runCommand, publicSpecs } = load('app_src/mcpBridge.jsx', '\nexport { runCommand, publicSpecs };');
const { createOperationStore } = load('app_src/mcpLogic.js');
const style = { id: 's', name: 'Dialogue', textProps: defaultProps(), stroke: { enabled: false } };
const state = { currentTabId: 'tab', text: 'Page 1\nBonjour\nPage 2\nSalut', currentLineIndex: 1, currentStyle: style, styles: [style], usedLineStyles: {}, mcpProgress: [], lines: [
  { rawText: 'Page 1', rawIndex: 0, ignore: true }, { rawText: 'Bonjour', text: 'Bonjour', rawIndex: 1 },
  { rawText: 'Page 2', rawIndex: 2, ignore: true }, { rawText: 'Salut', text: 'Salut', rawIndex: 3 },
] };
const ctx = { getState: () => state, operations: createOperationStore(), dispatch(action) {
  if (action.type === 'setMcpProgress') state.mcpProgress = action.links;
  if (action.type === 'commitLineBatch') state.currentLineIndex = action.nextLineIndex;
  if (action.type === 'restoreMcpPanel') Object.assign(state, { currentLineIndex: action.currentLineIndex, usedLineStyles: action.usedLineStyles, mcpProgress: action.mcpProgress });
} };
const bounds = { left: 0, top: 0, right: 100, bottom: 100 };
const request = id => ({ requestId: id, documentId: 1, entries: [{ bounds, autoShape: false }] });
(async () => {
  assert.strictEqual(publicSpecs.size, contract.tools.length);
  await assert.rejects(runCommand(ctx, 'batch_paste', { ...request('cross-page'), entries: [{ bounds, autoShape: false }, { bounds, autoShape: false }] }), /no script line/);
  assert.strictEqual(layerCount, 0);
  const first = await runCommand(ctx, 'batch_paste', request('one'));
  assert.strictEqual(first.placements[0].layerId, 1);
  assert.strictEqual(state.mcpProgress[0].sourceText, 'Bonjour');
  assert.strictEqual((await runCommand(ctx, 'batch_paste', request('one'))).operationId, 'one');
  assert.strictEqual(layerCount, 1, 'Retrying a completed request must not create another layer');
  await assert.rejects(runCommand(ctx, 'batch_paste', { ...request('one'), autoShape: true }), /conflict/);
  failPaste = true;
  await assert.rejects(runCommand(ctx, 'batch_paste', request('failing')), /injected failure/);
  assert.strictEqual(layerCount, 1, 'A failed host operation must return to its checkpoint');
  assert.strictEqual(ctx.operations.get('failing').status, 'failed');
  documentId = 2;
  await assert.rejects(runCommand(ctx, 'batch_paste', request('wrong-document')), /wrongDocument/);
  assert.strictEqual(layerCount, 1);
  documentId = 1;
  const recovered = await runCommand(ctx, 'get_operation', { operationId: 'one' });
  assert.strictEqual(recovered.result.placements[0].layerId, 1);
  assert(!('fingerprint' in recovered));
  await runCommand(ctx, 'undo', { requestId: 'undo-one', operationId: 'one', documentId: 1 });
  assert.strictEqual(layerCount, 0);
  assert.deepStrictEqual(state.mcpProgress, []);
  assert.strictEqual(ctx.operations.get('one').status, 'undone');
  console.log('MCP bridge tests passed: real handlers, document checks, returned layer IDs, rollback, replay and panel undo');
})().catch(error => { console.error(error); process.exitCode = 1; });
