const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { createDiagnosticLog } = require('../uxp-src/host/diagnosticLog');
const root = path.resolve(__dirname, '..');
const log = createDiagnosticLog({ photoshop: '27.7' }, ['C:\\Users\\Alice']);
log.note('error', 'C:\\Users\\Alice\\x and C:/Users/Alice/y');
assert(!log.snapshot().includes('Alice'));
log.note('error', 'C:/USERS/ALICE/x https://example.test/?token=SECRET');
assert(!log.snapshot().includes('ALICE') && !log.snapshot().includes('SECRET'));
log.note('huge', 'x'.repeat(10000));
assert.strictEqual(JSON.parse(log.snapshot()).events[2].detail.length, 1800);
for (let i = 0; i < 1100; i++) log.note('test', i);
assert.strictEqual(JSON.parse(log.snapshot()).events.length, 1000);
assert.strictEqual(JSON.parse(log.snapshot()).dropped, 103);

// The inline diagnostic must parse even if the main bundle does not.
const inline = fs.readFileSync(path.join(root, 'uxp-src/web/diagnosticBoot.js'), 'utf8');
require('acorn').parse(inline, { ecmaVersion: 5 });
const sent = [];
const handlers = {};
const webWindow = { uxpHost: { postMessage: message => sent.push(JSON.parse(message)) }, addEventListener: (name, fn) => { handlers[name] = fn; } };
vm.runInNewContext(inline, { window: webWindow, navigator: { userAgent: 'WebView2 test' }, document: { addEventListener: (name, fn) => { handlers[name] = fn; } } });
assert.strictEqual(sent[0].stage, 'html.script');
handlers.error({ target: { src: 'index.js' } });
assert.match(sent[1].detail, /index.js/);
handlers.unhandledrejection({ reason: new Error('parse failure') });
assert.strictEqual(sent[2].detail, 'parse failure');
handlers.DOMContentLoaded();
assert.strictEqual(sent[3].stage, 'html.dom-ready');

async function testNative() {
  const nodes = {};
  for (const name of ['typer-debug', 'typer-debug-export', 'typer-debug-status', 'typer-status']) nodes[name] = { style: {} };
  const writes = [];
  let saved = null;
  let failSave = false;
  let failAutoWrite = false;
  const file = { nativePath: 'C:\\Users\\Alice\\diagnostics\\log.json', write: async text => { if (failAutoWrite) throw new Error('automatic write denied'); writes.push(JSON.parse(text)); } };
  const uxp = { host: { version: '27.7', uiLocale: 'en_US' }, versions: { uxp: '9.3' }, storage: { formats: { utf8: 'utf8' }, localFileSystem: {
    getDataFolder: async () => ({ getEntry: async () => ({ createFile: async () => file }) }),
    getPluginFolder: async () => ({ getEntry: async () => ({ read: async () => '{"build":"test"}' }) }),
    getFileForSaving: async () => ({ nativePath: 'report.json', write: async text => { if (failSave) throw new Error('denied'); saved = JSON.parse(text); } })
  } } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'uxp-src/host/diagnostics.js'), 'utf8'), {
    module, require: name => ({ uxp, os: { platform: () => 'win32', homedir: () => 'C:\\Users\\Alice' }, './diagnosticLog': { createDiagnosticLog } })[name],
    document: { getElementById: id => nodes[id] }, window: { addEventListener() {} }, setTimeout: () => 1, Date
  });
  const diagnostic = module.exports;
  diagnostic.start();
  for (let i = 0; i < 15; i++) await Promise.resolve();
  diagnostic.note('webview.loaderror', 'runtime unavailable');
  await diagnostic.flush();
  assert(writes.length);
  assert(writes[writes.length - 1].events.some(event => event.stage === 'webview.loaderror'));
  assert(!JSON.stringify(writes).includes('Alice'));
  failAutoWrite = true;
  diagnostic.note('test.disk.failure', 'simulated');
  await diagnostic.flush();
  assert.match(nodes['typer-debug-status'].textContent, /Use Export diagnostic/);
  await nodes['typer-debug-export'].onclick();
  assert(saved.events.some(event => event.stage === 'report.export'));
  assert(saved.events.some(event => event.stage === 'journal.write.error'), 'export still works when automatic logging fails');
  assert.strictEqual(nodes['typer-debug-export'].disabled, false);
  failSave = true;
  await nodes['typer-debug-export'].onclick();
  assert.match(nodes['typer-debug-status'].textContent, /denied/);
  assert.strictEqual(nodes['typer-debug-export'].disabled, false);
  diagnostic.fatal(new Error('module initialization failed'));
  assert.match(nodes['typer-status'].textContent, /module initialization failed/);
}

function testCollector() {
  if (process.platform !== 'win32') return;
  fs.mkdirSync(path.join(root, '.update-test'), { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, '.update-test', 'diagnostic-'));
  const appdata = path.join(fixture, 'private-appdata');
  const runtime = path.join(fixture, 'runtime', '123');
  const logs = path.join(appdata, 'Adobe/UXP/PluginsStorage/PHSP/27/External/com.scanr.typer/PluginData/diagnostics');
  const adobeLogs = path.join(appdata, 'Adobe/Adobe Photoshop 2026/Logs');
  [runtime, logs, adobeLogs].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  fs.writeFileSync(path.join(runtime, 'msedgewebview2.exe'), 'fixture');
  fs.writeFileSync(path.join(logs, 'typer-startup-1.json'), createDiagnosticLog({ version: 'test' }).snapshot());
  fs.writeFileSync(path.join(logs, 'typer-startup-2.json'), '{interrupted');
  fs.writeFileSync(path.join(logs, 'storage.json'), '{"privateDocument":"DO NOT COLLECT"}');
  fs.writeFileSync(path.join(adobeLogs, 'UXPLogs_test.log'), 'unrelated secret\nWebView failed loading https://example.test/?token=SECRET\n' +
    '[2026-11-03_06-10-45][39072][Info] [general] Instead of the WebView2 runtime in the system, UXP will use the WebView2 runtime in the folder: C:\\Adobe\\EdgeWebView\\\n' +
    '[2026-11-03_06-10-47][39072][Warn] [general] Failed to create WebView for plugin: com.scanr.typer\n' +
    '[2026-11-03_06-10-51][39072][Warn] [general] Failed to create WebView for plugin: com.adobe.ccx.start\n' +
    '[2026-11-03_06-10-52][39072][Default] [console] [HS] webview console line with a private document name\n');
  const output = path.join(fixture, 'report.json');
  const before = fs.readFileSync(path.join(runtime, 'msedgewebview2.exe'));
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installer/diagnose_uxp_win.ps1'), '-SkipSystem', '-AppDataPath', appdata, '-RuntimePaths', path.join(fixture, 'runtime'), '-OutputPath', output], { stdio: 'pipe', timeout: 30000 });
  const text = fs.readFileSync(output, 'utf8');
  const report = JSON.parse(text);
  assert.strictEqual(report.runtimes[0].executables.length, 1);
  assert.strictEqual(report.startupReports.length, 1);
  assert(report.errors.some(error => error.includes('typer-startup-2.json')), 'an interrupted log does not prevent collecting the other reports');
  assert.strictEqual(report.adobeErrors[0].lines.length, 4, 'the WebView lines, without the Home screen console output');
  assert.deepStrictEqual(report.runtimes[0].versionFolders, ['123']);
  assert.strictEqual(report.summary.typerWebViewFailed, true);
  assert.deepStrictEqual(report.pluginStorage.versions.map(v => v.version), ['27']);
  assert.deepStrictEqual(report.pluginStorage.versions[0].folders, ['External']);
  assert.deepStrictEqual(report.pluginStorage.versions[0].webView, []);
  assert.strictEqual(report.summary.webView2Started, null);
  assert.strictEqual(report.summary.runtimeFolder, 'C:\\Adobe\\EdgeWebView\\');
  assert.deepStrictEqual(report.summary.failedPlugins, ['com.scanr.typer', 'com.adobe.ccx.start']);
  assert.match(report.summary.verdict, /could not start any WebView2 runtime/);
  assert.match(report.summary.verdict, /com\.adobe\.ccx\.start/);
  assert.match(report.summary.verdict, /developer\.microsoft\.com\/microsoft-edge\/webview2/);
  assert.match(report.summary.verdict, /Photoshop looks for it in C:\\Adobe\\EdgeWebView/);
  assert(!text.includes('SECRET') && !text.includes('DO NOT COLLECT') && !text.includes('unrelated secret') && !text.includes('private document name'));
  assert(!text.includes('private-appdata'));
  assert(fs.readFileSync(path.join(runtime, 'msedgewebview2.exe')).equals(before));
  // The rescue script reads the same log and names what happened in it
  const rescue = path.join(root, 'installer/webview_rescue_win.ps1');
  const analyze = file => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', rescue, '-Analyze', file], { stdio: 'pipe', timeout: 30000 }).toString());
  const refused = path.join(fixture, 'refused.log');
  fs.writeFileSync(refused, '[2026-11-04_18-37-49][32952][Info] [general] Instead of the WebView2 runtime in the system, UXP will use the WebView2 runtime in the folder: C:\\Adobe\\EdgeWebView\\\n' +
    '[2026-11-04_18-37-53][32952][Warn] [general] WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available\n' +
    '[2026-11-04_18-37-54][32952][Default] [console] createWebView() create new for thirdparty plugin (quoted by the Home screen)\n' +
    '[2026-11-04_18-37-55][32952][Warn] [general] Storage path error: access denied\n');
  // The collector names a refusal apart from a missing runtime
  const refusedReport = path.join(fixture, 'refused-report.json');
  fs.writeFileSync(path.join(adobeLogs, 'UXPLogs_test.log'), '[2026-11-04_19-32-29][12800][Warn] [general] WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available\n[2026-11-04_19-32-26][12800][Info] [general] Plugin com.adobe.ccx.timeline : [v4] Using Default Value for Icon species\n');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installer/diagnose_uxp_win.ps1'), '-SkipSystem', '-AppDataPath', appdata, '-RuntimePaths', path.join(fixture, 'runtime'), '-OutputPath', refusedReport], { stdio: 'pipe', timeout: 30000 });
  const refusedSummary = JSON.parse(fs.readFileSync(refusedReport, 'utf8')).summary;
  assert.strictEqual(refusedSummary.refusal, 'webViewDataStorage_ is not available');
  assert.deepStrictEqual(refusedSummary.adobePlugins, ['com.adobe.ccx.timeline']);
  assert.match(refusedSummary.verdict, /^UXP refused to create any WebView .*webViewDataStorage_ is not available.*Legacy panel/);
  const refusedFacts = analyze(refused);
  assert.strictEqual(refusedFacts.created, 0);
  assert.strictEqual(refusedFacts.failures.length, 1);
  assert.strictEqual(refusedFacts.folder, 'C:\\Adobe\\EdgeWebView\\');
  assert.match(refusedFacts.verdict, /^FAILED: Photoshop refused the WebView 1 time\(s\): .*webViewDataStorage_ is not available/);
  assert.deepStrictEqual(refusedFacts.other, ['[2026-11-04_18-37-55][32952][Warn] [general] Storage path error: access denied']);
  const worked = path.join(fixture, 'worked.log');
  fs.writeFileSync(worked, '[2026-11-04_07-54-24][12540][Info] [general] WebView2BrowserVersion:  156.0.4314.58\n[2026-11-04_07-54-24][12540][Debug] [general] createWebView() create new for thirdparty plugin\n');
  const workedFacts = analyze(worked);
  assert.strictEqual(workedFacts.verdict, 'WORKED: Photoshop created the TypeR WebView');
  assert.strictEqual(workedFacts.runtime, '156.0.4314.58');
  fs.writeFileSync(worked, 'nothing here\n');
  assert.match(analyze(worked).verdict, /^NOTHING/);
}
testNative().then(() => { testCollector(); console.log('UXP diagnostic log, early script, native export and Windows collector tests passed'); }).catch(error => { console.error(error); process.exitCode = 1; });
