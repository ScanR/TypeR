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
function hostHarness({ readWebViewFolders } = {}) {
  const nodes = {};
  const timers = new Map();
  let nextTimer = 1;
  let lifecycle;
  let flushes = 0;
  let finishOldRequest;
  let calls = 0;
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
    uxp: { host: { version: '27.0', uiLocale: 'fr_FR' }, versions: { uxp: '8.0' }, entrypoints: { setup: value => { lifecycle = value; } }, shell: {} },
    os: { platform: () => 'win32', release: () => '10.0' },
    './panelStart': Object.assign({}, require('../uxp-src/host/panelStart'), readWebViewFolders ? { readWebViewFolders } : {}),
    fs: { readdir: async () => [] },
    './photoshop': { methods: {} }, './smartPaste': { methods: {} },
    './files': { toUrl: path => path, createMirrorWriter: () => ({ flush: async () => { flushes++; } }) },
    './keyboard': { onChange() {} }, './keysHelper': {},
    './services': { requests: { count: () => ++calls, delayed: () => new Promise(resolve => { finishOldRequest = resolve; }) } }, './jsx': {},
    './evalScript': { createCallQueue: () => () => {} },
    './panelStartup': { createPanelStartup: options => createPanelStartup(Object.assign({}, options, {
      setTimer: fn => { const id = nextTimer++; timers.set(id, fn); return id; },
      clearTimer: id => timers.delete(id)
    })) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../uxp-src/host/main.js'), 'utf8'), {
    require: name => { assert(Object.hasOwn(stubs, name), name); return stubs[name]; },
    module: { exports: {} }, console: { ...console, error() {} }, window: nativeWindow,
    document: { getElementById: id => nodes[id] || null, createElement: () => element(''), body: { appendChild: node => { nodes[node.id] = node; } } }
  });
  return { nodes, timers, resetDom, nativeWindow, panel: lifecycle.panels.typer, get calls() { return calls; }, get flushes() { return flushes; }, finishOldRequest: () => finishOldRequest('old result') };
}

(async () => {
  let finishReport;
  const silent = hostHarness({ readWebViewFolders: () => new Promise(resolve => { finishReport = resolve; }) });
  silent.panel.show();
  silent.panel.hide();
  assert.strictEqual(silent.timers.size, 0, 'hiding a panel suspends native startup timers');
  silent.panel.show();
  assert.strictEqual(silent.timers.size, 2);
  for (const tick of [...silent.timers.values()]) tick();
  finishReport(['Adobe runtime: 140.0']);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.match(silent.nodes['typer-status'].textContent, /View: 600x400/, 'the diagnostic measures the view before hiding it');
  assert.match(silent.nodes['typer-status'].textContent, /Loads: retry/);
  assert.match(silent.nodes['typer-status'].textContent, /Adobe runtime: 140.0/);
  await silent.nodes['typer-retry'].onclick();
  for (const tick of [...silent.timers.values()]) tick();
  const completeStaleReport = finishReport;
  await silent.nodes['typer-retry'].onclick();
  silent.nodes['typer-view'].emit('message', { data: JSON.stringify({ type: 'appReady' }) });
  completeStaleReport(['stale runtime report']);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.strictEqual(silent.nodes['typer-status'].style.display, 'none', 'a delayed diagnostic must not cover a recovered replacement view');
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
  console.log('UXP startup, missing renderer, recovery and panel lifecycle tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
