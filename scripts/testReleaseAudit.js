const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const createLoader = require('./helpers/loadAppModule');
const load = createLoader();
const { getImagePageNumber } = load('app_src/pageImageMapping.js');
assert.strictEqual(getImagePageNumber({ baseName: 'chapter.002', name: 'chapter.002.psd' }), 2);
assert.strictEqual(getImagePageNumber({ baseName: 'chapter.024.final' }), 24);

const { migrateTabStorage } = load('app_src/tabStorage.js');
const recovered = migrateTabStorage({ tabs: [null, { id: 'a', text: 'Keep me' }, { id: 'a', text: 'Me too', images: {}, currentLineIndex: -1 }] }, 'Tab', () => 'a');
assert.strictEqual(recovered.tabs.length, 2);
assert.strictEqual(new Set(recovered.tabs.map(tab => tab.id)).size, 2);
assert.deepStrictEqual(recovered.tabs.map(tab => tab.text), ['Keep me', 'Me too']);
assert.deepStrictEqual(recovered.tabs[1].images, []);
assert.strictEqual(recovered.tabs[1].currentLineIndex, 0);
assert.strictEqual(migrateTabStorage({ tabs: [null], text: 'Legacy recovery' }, 'Tab').tabs[0].text, 'Legacy recovery');

const { reducer, initial } = require('./helpers/loadContext')({ text: 'Local script' });
const incoming = { tabs: [{ id: 'backup', name: 'Backup', text: 'Saved line one\nSaved line two', currentLineIndex: 1, images: [{ path: 'backup.psd' }] }, { id: 'other', name: 'Other', text: 'Other script' }], currentTabId: 'backup' };
const imported = reducer({ ...initial, storedSelections: [{ left: 1 }] }, { type: 'import', data: incoming });
assert.strictEqual(imported.text, incoming.tabs[0].text);
assert.strictEqual(imported.currentLineIndex, 1);
assert.strictEqual(imported.currentLine.text, 'Saved line two');
assert.deepStrictEqual(imported.tabs.map(tab => tab.text), incoming.tabs.map(tab => tab.text));
assert.deepStrictEqual(imported.storedSelections, []);
assert.strictEqual(reducer(initial, { type: 'import', data: { ...incoming, currentTabId: 'missing' } }).currentTabId, 'backup');
assert.strictEqual(reducer(initial, { type: 'import', data: { ...incoming, text: 'Legacy wins' } }).text, 'Legacy wins');
assert.strictEqual(reducer(initial, { type: 'import', data: { language: 'fr_FR' } }).text, 'Local script');
const { normalizeUiLayout } = createLoader({ './utils': { locale: {}, readStorage: () => ({ data: {} }), writeToStorage() {} }, './lib/themeManager': { applyThemeState() {} }, './backgroundImage': { normalizeBackgroundImage: x => x }, './themePresets': { normalizeCustomThemes: x => x || [], normalizeEditorTheme: x => x, normalizePageLineColor: x => x, setCustomEditorThemes: x => x } })('app_src/context.jsx');
assert.deepStrictEqual(normalizeUiLayout({ order: ['text', 'text', 'styles', 'unknown'] }).order, ['text', 'styles', 'preview']);

const { hasStyleImportConflicts, mergeImportedStyles } = load('app_src/librarySerialization.js');
const current = [{ id: 'a', name: 'Local', edited: 200 }, { id: 'b', name: 'Only local' }];
const styles = [{ id: 'a', name: 'Older', edited: 100 }, { id: 'c', name: 'Imported' }];
assert(hasStyleImportConflicts(current, styles));
assert.deepStrictEqual(mergeImportedStyles(current, styles, true), [...current, styles[1]]);
assert.deepStrictEqual(mergeImportedStyles(current, styles, false), styles);
assert.deepStrictEqual(mergeImportedStyles(current, [{ id: 'a', name: 'Newer', edited: 300 }], true).map(style => style.name), ['Only local', 'Newer']);
assert.strictEqual(hasStyleImportConflicts(current, current), false);

// Execute the actual bridge callback against all common host failure values.
const source = fs.readFileSync(require.resolve('../app_src/utils.js'), 'utf8');
let hostResult;
const scope = { csInterface: { evalScript: (_, callback) => callback(hostResult) }, JSON };
vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('const nativeConfirm ='), source.indexOf('let userFonts =')) + '\nthis.confirm = nativeConfirm;', scope);
for (const result of ['', null, undefined, 'EvalScript error.', 'false', '0', '1']) {
  hostResult = result;
  scope.confirm('Delete?', 'TypeR', confirmed => assert.strictEqual(confirmed, result === '1'));
}

(async () => {
  let flushed = 0;
  let reloaded = 0;
  let resolveDisk;
  let failed = false;
  const disk = new Promise(resolve => { resolveDisk = resolve; });
  const reloadScope = {
    flushStorageWrite: () => { flushed++; return !failed; },
    uxpHost: { flushStorage: () => disk },
    reportStorageIssue() {}, storagePath: 'storage', locale: {}, nativeAlert() {},
    window: { location: { reload: () => { reloaded++; } } },
  };
  vm.createContext(reloadScope);
  vm.runInContext(source.slice(source.indexOf('const flushStorageForReload ='), source.indexOf('const backupStorage =')) + '\nthis.reload = reloadApp;', reloadScope);
  const reload = reloadScope.reload();
  assert.strictEqual(flushed, 1);
  assert.strictEqual(reloaded, 0, 'Reload waits for disk acknowledgement');
  resolveDisk();
  assert.strictEqual(await reload, true);
  assert.strictEqual(reloaded, 1);
  reloadScope.uxpHost.flushStorage = async () => { throw new Error('disk full'); };
  assert.strictEqual(await reloadScope.reload(), false);
  assert.strictEqual(reloaded, 1, 'Failed disk writes prevent reload');
  failed = true;
  assert.strictEqual(await reloadScope.reload(), false);
  assert.strictEqual(reloaded, 1);
  const entrySource = fs.readFileSync('app_src/index.jsx', 'utf8');
  const lazyModalStyles = fs.readFileSync('app_src/components/modal/modal.scss', 'utf8');
  assert.ok(entrySource.includes("import './components/modal/confirmDialog.scss';"), 'The tab bar confirmation is styled before any modal opens');
  assert.ok(!lazyModalStyles.includes('.settings-confirm-overlay'), 'Confirmation styles stay out of the lazy modal stylesheet');
  console.log('Release audit regressions passed (tabs, page mapping, imports, layout, confirmations, reload)');
})().catch(error => { console.error(error); process.exitCode = 1; });
