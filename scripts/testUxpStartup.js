const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createPanelStartup } = require('../uxp-src/host/panelStartup');

function monitor(platform = 'win32') {
  const timers = new Map();
  let nextTimer = 1;
  let retries = 0;
  let shown;
  const startup = createPanelStartup({
    show: (text, failed) => { shown = { text, failed }; },
    environment: () => ({ photoshop: '27.0', uxp: '8.0', platform, locale: 'fr_FR' }),
    retry: () => { retries++; },
    setTimer: (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, ms }); return id; },
    clearTimer: id => timers.delete(id)
  });
  return { startup, timers, tick: ms => {
    const entry = [...timers].find(([, timer]) => timer.ms === (ms || Math.max(...[...timers.values()].map(timer => timer.ms))));
    assert(entry, 'expected a pending startup deadline');
    timers.delete(entry[0]);
    entry[1].callback();
  }, get retries() { return retries; }, get active() { return timers.size > 0; }, get shown() { return shown; } };
}

const absent = monitor();
absent.startup.begin();
assert(absent.active);
absent.tick(5000);
assert.strictEqual(absent.retries, 1, 'a silent WebView gets one address retry');
assert.strictEqual(absent.timers.size, 1, 'retry keeps the original failure deadline');
absent.tick();
assert(absent.shown.failed);
assert.match(absent.shown.text, /No response from the WebView/);
assert.match(absent.shown.text, /WebView2/);
assert.match(absent.shown.text, /Photoshop 27.0/);
assert(!absent.active);
assert.match(absent.shown.text, /15 s/);
assert.match(absent.shown.text, /TypeR \(CEP\)/);

const hidden = monitor();
hidden.startup.begin();
hidden.startup.setVisible(false);
assert(!hidden.active, 'hidden WebViews may not load: suspend the watchdog');
hidden.startup.setVisible(true);
assert(hidden.active);
hidden.startup.loadStarted();
assert.strictEqual(hidden.timers.size, 1, 'a loading WebView must not be navigated again');
hidden.tick(15000);
assert.strictEqual(hidden.retries, 0);
hidden.startup.bridgeReady();
assert.strictEqual(hidden.startup.getState(), 'loading', 'a late bridge restores the page so it can finish initializing');
assert(!hidden.shown.failed);
const initTimers = [...hidden.timers.keys()];
hidden.startup.bridgeReady();
assert.deepStrictEqual([...hidden.timers.keys()], initTimers, 'repeated ready messages cannot postpone failure forever');
hidden.tick(15000);
assert.match(hidden.shown.text, /did not finish initializing/);
hidden.startup.appReady();
assert(!hidden.active);

const bridgeOnly = monitor();
bridgeOnly.startup.begin();
bridgeOnly.startup.bridgeReady();
assert(bridgeOnly.active, 'bridge readiness is not proof that React rendered');
bridgeOnly.tick();
assert.match(bridgeOnly.shown.text, /did not finish initializing/);
assert.doesNotMatch(bridgeOnly.shown.text, /WebView2/, 'do not blame a missing renderer after it answered');
bridgeOnly.startup.appReady();
assert.strictEqual(bridgeOnly.shown.text, '', 'a late successful startup can recover');
assert.strictEqual(bridgeOnly.startup.getState(), 'ready');

const mac = monitor('darwin');
mac.startup.begin();
mac.startup.loadError({ message: 'Cannot load', code: 0, url: 'plugin:/web/index.html' });
assert.match(mac.shown.text, /code 0/);
assert.match(mac.shown.text, /plugin:\/web\/index.html/);
assert.doesNotMatch(mac.shown.text, /WebView2/);
mac.startup.begin();
assert(!mac.shown.failed);
mac.startup.dispose();
assert(!mac.active);

const loaded = monitor();
loaded.startup.begin();
loaded.startup.loadStarted();
loaded.startup.loadStopped();
loaded.tick();
assert.match(loaded.shown.text, /start=true, stop=true, bridge=false/);
assert.doesNotMatch(loaded.shown.text, /WebView2/, 'a loaded page is not evidence of a missing runtime');
loaded.startup.begin();
loaded.tick();
assert.match(loaded.shown.text, /start=false, stop=false, bridge=false/, 'retry resets the load milestones');

// Trace probes must release both their native views and delayed report when
// the real page recovers or its panel is closed.
{
  const containers = [];
  const pending = new Map();
  const reports = [];
  const element = () => ({
    style: {}, setAttribute() {}, addEventListener() {}, appendChild() {},
    getBoundingClientRect: () => ({ width: 600, height: 70 }),
    remove() { containers.splice(containers.indexOf(this), 1); }
  });
  const probeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../uxp-src/host/panelProbe.js'), 'utf8'), {
    module: probeModule,
    document: { createElement: element, body: { appendChild: node => containers.push(node) } },
    setTimeout: fn => { pending.set(1, fn); return 1; },
    clearTimeout: id => pending.delete(id),
  });
  const stop = probeModule.exports.run({ mainView: element(), note() {}, report: text => reports.push(text) });
  assert.strictEqual(containers.length, 1);
  assert.strictEqual(pending.size, 1);
  stop();
  assert.strictEqual(containers.length, 0);
  assert.strictEqual(pending.size, 0);
  assert.deepStrictEqual(reports, ['Probes running...'], 'a removed probe cannot later replace the recovered app with its report');
}

// Exercise the actual host entry against a native UXP DOM substitute, including
// destroying/recreating the panel and a WebView that never emits loaderror.
function hostHarness({ readWebViewFolders, uxpLog = '' } = {}) {
  const nodes = {};
  const timers = new Map();
  // main.js's own timers (the readings of Photoshop's log), apart from the startup deadlines
  const hostTimers = new Map();
  let nextTimer = 1;
  // The application in the panel's own DOM (inPanel.js): its starts, the
  // channel the host gave the last one and what the host delivered
  const inPanelStarts = [];
  const repairKinds = [];
  const errors = [];
  const delivered = [];
  let lifecycle;
  let flushes = 0;
  let finishOldRequest;
  let calls = 0;
  const opened = [];
  const appData = 'C:\\Users\\ana\\AppData\\Roaming';
  const logFolders = {
    [appData + '\\Adobe']: [{ name: 'Adobe Photoshop 2026', isFolder: true }],
    [appData + '\\Adobe\\Adobe Photoshop 2026\\Logs']: [{ name: 'UXPLogs_2026-11-03_06-10-45_071210.log', isFolder: false }],
  };
  function element(id) {
    const listeners = {};
    return {
      id, style: {}, listeners,
      getBoundingClientRect() { return this.style.display === 'none' ? { width: 0, height: 0 } : { width: 600, height: 400 }; },
      messages: [], setAttribute() {}, postMessage(message) { this.messages.push(message); },
      addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
      removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(item => item !== fn); },
      emit(name, data) { (listeners[name] || []).forEach(fn => fn(data)); },
      remove() { if (nodes[this.id] === this) delete nodes[this.id]; }
    };
  }
  const resetDom = () => {
    for (const id of ['typer-view', 'typer-status', 'typer-recovery', 'typer-retry', 'typer-webview-help']) nodes[id] = element(id);
  };
  resetDom();
  const nativeWindow = element('window');
  const stubs = {
    photoshop: {},
    uxp: { host: { version: '27.0', uiLocale: 'fr_FR' }, versions: { uxp: '8.0' }, entrypoints: { setup: value => { lifecycle = value; } }, shell: { openExternal: async url => { opened.push(url); } } },
    os: { platform: () => 'win32', release: () => '10.0', homedir: () => 'C:\\Users\\ana' },
    './panelStart': Object.assign({}, require('../uxp-src/host/panelStart'), readWebViewFolders ? { readWebViewFolders } : {}),
    './webViewRepair': { createWebViewRepair: () => ({ start: async kind => { repairKinds.push(kind); return true; } }) },
    fs: { readdir: async () => [] },
    './photoshop': { methods: {} }, './smartPaste': { methods: {} },
    './files': {
      toUrl: path => path, createMirrorWriter: () => ({ flush: async () => { flushes++; } }),
      getRoamingAppData: async () => appData,
      listFolder: async folder => { if (!logFolders[folder]) throw new Error('no such folder ' + folder); return logFolders[folder]; },
      readText: async () => uxpLog,
    },
    './keyboard': { onChange() {} }, './keysHelper': {},
    './services': { requests: { count: () => ++calls, delayed: () => new Promise(resolve => { finishOldRequest = resolve; }) } }, './jsx': {},
    './evalScript': { createCallQueue: () => () => {} },
    './startupFiles': require('../uxp-src/host/startupFiles'),
    './inPanel': { startInPanel: options => { inPanelStarts.push(options); return { deliver: message => delivered.push(message) }; } },
    './panelStartup': { createPanelStartup: options => createPanelStartup(Object.assign({}, options, {
      setTimer: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
      clearTimer: id => timers.delete(id)
    })) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../uxp-src/host/main.js'), 'utf8'), {
    require: name => { assert(Object.hasOwn(stubs, name), name); return stubs[name]; },
    module: { exports: {} }, console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) }, window: nativeWindow,
    setTimeout: (fn) => { const id = nextTimer++; hostTimers.set(id, () => { hostTimers.delete(id); return fn(); }); return id; },
    clearTimeout: id => hostTimers.delete(id),
    document: { getElementById: id => nodes[id] || null, createElement: () => element(''), body: { appendChild: node => { nodes[node.id] = node; } } }
  });
  return { nodes, timers, hostTimers, resetDom, nativeWindow, opened, panel: lifecycle.panels.typer, inPanelStarts, delivered, repairKinds,
    receive: message => inPanelStarts[inPanelStarts.length - 1].receive(message),
    inPanelReason: () => errors.filter(line => line.includes('running in the panel itself')).pop() || '', get calls() { return calls; }, get flushes() { return flushes; }, finishOldRequest: () => finishOldRequest('old result') };
}

(async () => {
  // Photoshop's UXP log says it could not create the plugin's WebView (no
  // WebView2 runtime it can start) and the WebView gave no sign of life: the
  // application runs in the panel itself (docs/uxp-webview-refused.md)
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
  const noRuntime = hostHarness({ uxpLog:
    '[2026-11-03_06-10-45][39072][Info] [general] Instead of the WebView2 runtime in the system, UXP will use the WebView2 runtime in the folder: C:\\Program Files\\Common Files\\Adobe\\Microsoft\\EdgeWebView\\\r\n' +
    '[2026-11-03_06-10-47][39072][Warn] [general] Failed to create WebView for plugin: com.scanr.typer\r\n' +
    '[2026-11-03_06-10-51][39072][Warn] [general] Failed to create WebView for plugin: com.adobe.ccx.start\r\n' });
  noRuntime.panel.show();
  // The log's lines are older than this WebView: no early switch
  for (const tick of [...noRuntime.hostTimers.values()]) await tick();
  await settle();
  assert.strictEqual(noRuntime.inPanelStarts.length, 0, 'a refusal written before the WebView was asked for does not count');
  for (const tick of [...noRuntime.timers.values()]) tick();
  await settle();
  assert.strictEqual(noRuntime.inPanelStarts.length, 1, 'no WebView after 15 s: the application runs in the panel');
  assert.deepStrictEqual(noRuntime.repairKinds, [], 'runtime failure or stale refusal must not patch Photoshop');
  assert.match(noRuntime.inPanelReason(), /Failed to create WebView for plugin: com\.scanr\.typer/);
  assert.strictEqual(noRuntime.nodes['typer-view'], undefined, 'the refused WebView is removed');
  assert.notStrictEqual(noRuntime.nodes['typer-recovery'].style.display, 'block', 'no failure notice: TypeR works');
  await noRuntime.panel.destroy();

  // UXP refuses the WebView the moment it is asked for, without WebView
  // storage (no Adobe user, Feature Restricted Licensing): seen in the log
  // within seconds, without waiting for the 15 s deadline
  const stamp = (date) => '[' + date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + '_' +
    [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join('-') + ']';
  const refused = hostHarness({ uxpLog: stamp(new Date()) + '[264][Warn] [general] WebViewManager::createWebView() failed to create WebView because webViewDataStorage_ is not available\r\n' });
  refused.panel.show();
  assert.strictEqual(refused.hostTimers.size, 3, 'the log is read three times in the first seconds');
  for (const tick of [...refused.hostTimers.values()]) await tick();
  await settle();
  assert.strictEqual(refused.inPanelStarts.length, 1, 'the refusal switches to the panel once');
  assert.deepStrictEqual(refused.repairKinds, ['storage'], 'a current native storage refusal starts the common repair');
  assert.match(refused.inPanelReason(), /webViewDataStorage_ is not available/);
  assert.strictEqual(refused.timers.size, 1, 'only the in-panel start deadline is left');
  // The application's messages reach the host's requests, the replies go back
  refused.receive({ type: 'ready' });
  refused.receive({ type: 'request', id: 1, method: 'count' });
  refused.receive({ type: 'request', id: 1, method: 'count' });
  await settle();
  assert.strictEqual(refused.calls, 1, 'a request runs once');
  assert.strictEqual(JSON.stringify(refused.delivered.filter(message => message.type === 'reply')), JSON.stringify([{ type: 'reply', id: 1, result: 1 }]));
  refused.receive({ type: 'appReady' });
  assert.strictEqual(refused.nodes['typer-status'].style.display, 'none');
  assert.strictEqual(refused.timers.size, 0);
  refused.panel.hide();
  refused.panel.show();
  assert.strictEqual(JSON.stringify(refused.delivered.filter(message => message.type === 'visibility').map(message => message.hidden)), '[true,false]', 'visibility reaches the application');
  assert.strictEqual(refused.inPanelStarts.length, 1, 'hide/show keeps the application');
  // Photoshop destroys and recreates the panel: a new application starts in
  // it, without asking for a WebView again; the old one is not heard anymore
  const oldReceive = refused.inPanelStarts[0].receive;
  await refused.panel.destroy();
  refused.resetDom();
  refused.panel.show();
  assert.strictEqual(refused.inPanelStarts.length, 2, 'the recreated panel gets the application again');
  assert.strictEqual(refused.hostTimers.size, 0, 'no new log reading: no WebView was asked for');
  oldReceive({ type: 'request', id: 2, method: 'count' });
  await settle();
  assert.strictEqual(refused.calls, 1, 'the destroyed application is not answered');
  refused.receive({ type: 'request', id: 1, method: 'count' });
  await settle();
  assert.strictEqual(refused.calls, 2, 'the new one is, with its own request ids');
  await refused.panel.destroy();

  // A WebView that loaded something keeps the notice: the panel would not help
  const loaded = hostHarness({ uxpLog: '[2026-11-03_06-12-12][32848][Info] [general] WebView2BrowserVersion:  156.0.4314.58\n' });
  loaded.panel.show();
  loaded.nodes['typer-view'].emit('loadstart', { url: 'plugin:/web/index.html' });
  for (const tick of [...loaded.timers.values()]) tick();
  await settle();
  assert.strictEqual(loaded.inPanelStarts.length, 0);
  assert.strictEqual(loaded.nodes['typer-recovery'].style.display, 'block');
  assert.match(loaded.nodes['typer-status'].textContent, /Loads: start plugin:\/web\/index\.html/);
  assert.match(loaded.nodes['typer-status'].textContent, /WebView2 started in this Photoshop session: 156\.0\.4314\.58/, 'a runtime that started is reported even without a failure line');
  assert.strictEqual(loaded.nodes['typer-webview-help'].textContent, undefined, 'the help button keeps its label');
  await loaded.nodes['typer-webview-help'].onclick();
  assert.match(loaded.opened[0], /helpx\.adobe\.com/);
  await loaded.panel.destroy();

  let finishReport;
  const silent = hostHarness({ readWebViewFolders: () => new Promise(resolve => { finishReport = resolve; }) });
  silent.panel.show();
  silent.panel.hide();
  assert.strictEqual(silent.timers.size, 0, 'hiding a panel suspends native startup timers');
  silent.panel.show();
  assert.strictEqual(silent.timers.size, 2);
  for (const tick of [...silent.timers.values()]) tick();
  // The user reloads while the report still reads the WebView folders, and
  // the new WebView answers: the late report must not switch to the panel
  await silent.nodes['typer-retry'].onclick();
  assert.strictEqual(silent.flushes, 1, 'the reload saves pending writes');
  silent.nodes['typer-view'].emit('message', { data: JSON.stringify({ type: 'appReady' }) });
  finishReport(['stale runtime report']);
  await settle();
  assert.strictEqual(silent.inPanelStarts.length, 0, 'a delayed report must not replace a recovered WebView');
  assert.strictEqual(silent.nodes['typer-status'].style.display, 'none');
  await silent.panel.destroy();

  const globalOnly = hostHarness();
  globalOnly.panel.show();
  const globalView = globalOnly.nodes['typer-view'];
  globalOnly.nativeWindow.emit('message', { source: globalView, data: JSON.stringify({ type: 'ready' }) });
  globalOnly.nativeWindow.emit('message', { source: globalView, data: JSON.stringify({ type: 'appReady' }) });
  assert.strictEqual(globalOnly.nodes['typer-status'].style.display, 'none', 'Adobe window-level WebView messages must start the panel');
  const request = { source: globalView, data: JSON.stringify({ type: 'request', id: 1, method: 'count' }) };
  globalView.emit('message', request);
  globalOnly.nativeWindow.emit('message', { ...request });
  await Promise.resolve();
  assert.strictEqual(globalOnly.calls, 1, 'a request delivered on both channels must execute only once');
  globalOnly.nativeWindow.emit('message', { source: {}, data: JSON.stringify({ type: 'request', id: 2, method: 'count' }) });
  globalOnly.nativeWindow.emit('message', { data: JSON.stringify({ type: 'request', id: 3, method: 'count' }) });
  assert.strictEqual(globalOnly.calls, 1, 'global messages must identify the active WebView');
  await globalOnly.panel.destroy();
  assert.strictEqual(globalOnly.nativeWindow.listeners.message.length, 0, 'destroy removes the global listener');

  const h = hostHarness();
  h.panel.show();
  const first = h.nodes['typer-view'];
  assert.strictEqual(first.src, 'plugin:/web/index.html');
  first.emit('message', { message: JSON.stringify({ type: 'ready' }) });
  assert.notStrictEqual(h.nodes['typer-status'].style.display, 'none');
  assert.strictEqual(h.timers.size, 1);
  first.emit('message', { message: JSON.stringify({ type: 'appReady' }) });
  assert.strictEqual(h.nodes['typer-status'].style.display, 'none');
  assert.strictEqual(h.timers.size, 0);
  h.panel.hide();
  h.panel.show();
  assert.strictEqual(h.nodes['typer-view'], first, 'hide/show preserves the loaded app');
  first.emit('message', { data: JSON.stringify({ type: 'request', id: 1, method: 'delayed' }) });

  await h.panel.destroy();
  h.resetDom();
  h.panel.show();
  const second = h.nodes['typer-view'];
  assert.notStrictEqual(first, second);
  assert.strictEqual(second.src, 'plugin:/web/index.html', 'a recreated panel gets a loaded view');
  second.emit('message', { data: JSON.stringify({ type: 'ready' }) });
  const messagesBefore = second.messages.length;
  h.finishOldRequest();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(second.messages.length, messagesBefore, 'late replies must not reach a replacement page with reused request ids');
  first.emit('message', { message: JSON.stringify({ type: 'appReady' }) });
  first.emit('loaderror', { message: 'old renderer' });
  assert.strictEqual(h.timers.size, 1, 'events from detached views are ignored');
  assert.doesNotMatch(h.nodes['typer-status'].textContent, /old renderer/);
  for (const tick of [...h.timers.values()]) tick();
  assert.match(h.nodes['typer-status'].textContent, /did not finish initializing/);
  assert.strictEqual(h.nodes['typer-recovery'].style.display, 'block');
  assert.strictEqual(second.style.display, 'block', 'the view stays in place after the deadline: a late start must still open the panel');

  await h.nodes['typer-retry'].onclick();
  const third = h.nodes['typer-view'];
  assert.notStrictEqual(third, second, 'retry recreates a failed renderer');
  assert.strictEqual(third.src, 'plugin:/web/index.html');
  assert.strictEqual(h.flushes, 2, 'destroy and retry preserve pending storage writes');
  third.emit('message', { data: JSON.stringify(JSON.stringify({ type: 'appReady' })) });
  assert.strictEqual(h.nodes['typer-status'].style.display, 'none');
  assert.strictEqual(third.style.display, 'block');
  assert.strictEqual(h.timers.size, 0);

  // Some hosts replace the DOM without delivering a destroy callback.
  h.resetDom();
  h.panel.show();
  assert.strictEqual(h.nodes['typer-view'].src, 'plugin:/web/index.html');
  await h.panel.destroy();
  assert.strictEqual(h.timers.size, 0);

  // The page reached the host but got no init answer (seen at Photoshop's
  // cold start, fixed every time by Reload TypeR): the host reloads the view
  // once by itself; a second time, the failure stays on screen
  const noInit = hostHarness();
  noInit.panel.show();
  const stuck = noInit.nodes['typer-view'];
  stuck.emit('message', { data: JSON.stringify({ type: 'ready' }) });
  stuck.emit('message', { data: JSON.stringify({ type: 'panelError', text: 'TypeR could not start: Error: the plugin host does not answer', reason: 'init-timeout' }) });
  await settle();
  const reloaded = noInit.nodes['typer-view'];
  assert.notStrictEqual(reloaded, stuck, 'an init without answer reloads the view once');
  assert.strictEqual(reloaded.src, 'plugin:/web/index.html');
  assert.strictEqual(noInit.flushes, 1, 'pending storage writes are saved before the reload');
  assert.notStrictEqual(noInit.nodes['typer-recovery'].style.display, 'block', 'no failure is shown for the first init timeout');
  reloaded.emit('message', { data: JSON.stringify({ type: 'ready' }) });
  reloaded.emit('message', { data: JSON.stringify({ type: 'panelError', text: 'TypeR could not start: Error: the plugin host does not answer', reason: 'init-timeout' }) });
  await settle();
  assert.strictEqual(noInit.nodes['typer-view'], reloaded, 'a second init timeout is not reloaded again');
  assert.match(noInit.nodes['typer-status'].textContent, /the plugin host does not answer/);
  assert.strictEqual(noInit.nodes['typer-recovery'].style.display, 'block');
  // Once the app is ready, a later start can be reloaded again
  reloaded.emit('message', { data: JSON.stringify({ type: 'appReady' }) });
  await noInit.panel.destroy();

  // Any other startup error of the page fails at once, without a reload
  const broken = hostHarness();
  broken.panel.show();
  const brokenView = broken.nodes['typer-view'];
  brokenView.emit('message', { data: JSON.stringify({ type: 'panelError', text: 'TypeR could not start: TypeError: x is not a function', reason: 'start' }) });
  await settle();
  assert.strictEqual(broken.nodes['typer-view'], brokenView, 'a page error is not a reason to reload');
  assert.strictEqual(broken.flushes, 0);
  assert.match(broken.nodes['typer-status'].textContent, /x is not a function/);
  assert.strictEqual(broken.nodes['typer-recovery'].style.display, 'block');
  await broken.panel.destroy();
  console.log('UXP startup, missing renderer, recovery and panel lifecycle tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
