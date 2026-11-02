// TypeR UXP plugin entry. The panel is the regular TypeR application,
// rendered in a WebView (uxp/web, built from app_src); this script is its host:
// it answers the panel's evalScript calls with the UXP port of host.js,
// persists its files, forwards Photoshop events, the theme and the keyboard.
const ps = require("photoshop");
const uxp = require("uxp");
const os = require("os");
// Crash trace builds only: installed before photoshop.js keeps its own
// reference to batchPlay (see crashTrace.js)
const crashTrace = typeof TYPER_TRACE !== "undefined" && TYPER_TRACE ? require("./crashTrace") : null;
if (crashTrace) crashTrace.install();
const photoshop = require("./photoshop");
const smartPaste = require("./smartPaste");
const files = require("./files");
const keyboard = require("./keyboard");
const keysHelper = require("./keysHelper");
const services = require("./services");
const { runJsx, systemCall } = require("./jsx");
const { parseCall, callTimeout, createCallQueue } = require("./evalScript");
const { createPanelStartup } = require("./panelStartup");
const panelStart = require("./panelStart");
const panelProbe = crashTrace ? require("./panelProbe") : null;
const diagnostic = typeof TYPER_DIAGNOSTIC !== 'undefined' && TYPER_DIAGNOSTIC ? require('./diagnostics') : null;
const debugNote = (stage, detail) => { if (diagnostic) diagnostic.note(stage, detail); };

if (crashTrace) {
  files.resolveFolders()
    .then(() => services.requests.pluginVersion())
    .then((version) => crashTrace.open(files.getStorageRoot(), { typer: version, build: "crash trace" }))
    .catch((error) => console.error("TypeR: crash trace file", error));
}

const EXTENSION_ID = "typer";
const PANEL_URL = "plugin:/web/index.html";
// The panel's DOM only exists once Photoshop creates the panel: the WebView
// is looked up then, and starts loading after its listeners are in place
let view = null;
let statusElement = null;
let viewGeneration = 0;
let windowMessageListener = null;
const recentRequestIds = new Set();

function detachWindowMessages() {
  if (windowMessageListener) window.removeEventListener('message', windowMessageListener);
  windowMessageListener = null;
}

// Known once files.resolveFolders() has run (init)
let storageRoot = null;
const mirror = files.createMirrorWriter(() => storageRoot);
let mirrorFiles = null;
let panelVisible = false;
let webviewReady = false;
const loadEvents = [];
let stopProbes = null;
let startupViewSize = 'unknown';

function clearProbes() {
  if (stopProbes) stopProbes();
  stopProbes = null;
}

function noteLoadEvent(text) {
  if (crashTrace) crashTrace.note('webview', text);
  debugNote('webview.event', text);
  loadEvents.push(text);
  if (loadEvents.length > 8) loadEvents.shift();
}

function viewSize() {
  try {
    const box = view.getBoundingClientRect();
    return Math.round(box.width) + 'x' + Math.round(box.height);
  } catch (error) { return 'unknown'; }
}

async function reportPanelStartFailure(baseText) {
  const generation = viewGeneration;
  const size = startupViewSize;
  const events = loadEvents.slice();
  const webViewFolders = os.platform() === 'win32'
    ? await panelStart.readWebViewFolders(folder => require('fs').readdir(files.toUrl(folder))) : [];
  // A report from a closed/reloaded panel must never cover its replacement.
  if (generation !== viewGeneration || webviewReady || !panelVisible || panelStartup.getState() !== 'failed') return;
  const text = baseText + '\n' + panelStart.panelStartFailureText({
    versions: ['Photoshop ' + uxp.host.version, 'UXP ' + (uxp.versions && uxp.versions.uxp), os.platform() + ' ' + os.release()].join(', '),
    webViewFolders, loadEvents: events, viewSize: size,
  });
  console.error('TypeR:', text);
  debugNote('startup.report', text);
  showStatus(text);
  if (panelProbe) {
    clearProbes();
    stopProbes = panelProbe.run({
      mainView: view,
      note: line => crashTrace.note('probe', line),
      report: line => showStatus(text + '\n' + line + '\nLog: ' + crashTrace.getPath()),
    });
  }
}

function log(...args) {
  console.log("TypeR:", ...args);
}

function showStatus(text) {
  if (!statusElement) statusElement = document.getElementById("typer-status");
  if (!statusElement) return;
  statusElement.textContent = text || "";
  statusElement.style.display = text ? "block" : "none";
}

const panelStartup = createPanelStartup({
  initiallyVisible: false,
  environment: () => ({ photoshop: String(uxp.host.version || 'unknown'), uxp: String(uxp.versions && uxp.versions.uxp || 'unknown'), platform: os.platform(), locale: uxp.host.uiLocale }),
  retry() {
    noteLoadEvent('retry');
    loadingPanel = true;
    view.src = PANEL_URL;
  },
  onFailure(text, { bridge }) {
    if (!bridge) reportPanelStartFailure(text).catch(error => console.error('TypeR: startup report', error));
  },
  show(text, failed) {
    if (!failed) clearProbes();
    // Read before hiding the view, otherwise every failure would report 0x0.
    if (failed) startupViewSize = viewSize();
    debugNote('startup.status', String(failed) + ': ' + text);
    showStatus(text);
    const recovery = document.getElementById('typer-recovery');
    if (recovery) recovery.style.display = failed ? 'block' : 'none';
    // The notice sits above the view, which stays in place even after the
    // deadline: a hidden WebView never loads (docs/uxp-startup-reproduction.md)
    // while Photoshop 27.7 can take long to start one, and a late start must
    // still open the panel. The status block keeps its room (index.html).
    if (view) view.style.display = 'block';
  }
});

/* ======================= panel messages ======================= */

function post(message) {
  if (!view || !webviewReady) return;
  try {
    view.postMessage(JSON.stringify(message));
  } catch (error) {
    debugNote('bridge.post.error', error.message || error);
    console.error("TypeR: message to panel failed", error);
  }
}

/* ===================== evalScript surface ===================== */

// Photoshop's four interface brightness levels, as CEP reported them
const UNIT_THEMES = {
  darkest: { red: 50, green: 50, blue: 50 },
  dark: { red: 83, green: 83, blue: 83 },
  medium: { red: 184, green: 184, blue: 184 },
  light: { red: 184, green: 184, blue: 184 },
  lightest: { red: 240, green: 240, blue: 240 },
};

function currentTheme() {
  try {
    return document.theme.getCurrent();
  } catch (error) {
    return "darkest";
  }
}

// CEP's appSkinInfo, as Photoshop reports it to a CEP panel
function getHostEnvironment() {
  const color = UNIT_THEMES[currentTheme()] || UNIT_THEMES.darkest;
  const isWindows = os.platform() === "win32";
  const skinColor = () => ({ antialiasLevel: 0, type: 1, color: Object.assign({ alpha: 255 }, color) });
  return {
    appName: "PHXS",
    appId: "PHXS",
    appVersion: String(uxp.host.version || ""),
    appLocale: uxp.host.uiLocale || "en_US",
    appUILocale: uxp.host.uiLocale || "en_US",
    isAppOnline: true,
    // Photoshop's values for a CEP panel (27.7, macOS): .AppleSystemUIFont is
    // not a valid CSS family name, so both engines drop the rule and keep topcoat's
    appSkinInfo: {
      baseFontFamily: isWindows ? "Tahoma" : ".AppleSystemUIFont",
      baseFontSize: 10,
      systemHighlightColor: { alpha: 255, red: 48, green: 79, blue: 120 },
      appBarBackgroundColor: skinColor(),
      appBarBackgroundColorSRGB: skinColor(),
      panelBackgroundColor: skinColor(),
      panelBackgroundColorSRGB: skinColor(),
    },
  };
}

function readLocaleStrings() {
  // Yes / No labels of the confirm dialog, in the language the panel shows
  const parse = (text) => {
    const result = {};
    String(text || "").replace(/\r/g, "").split("\n").forEach((line) => {
      const index = line.indexOf("=");
      if (index > 0 && line.charAt(0) !== "#") result[line.slice(0, index).trim()] = line.slice(index + 1);
    });
    return result;
  };
  const locales = mirrorFiles ? mirrorFiles.locales : {};
  let language = "auto";
  try {
    language = JSON.parse(mirrorFiles.files.storage || "{}").language || "auto";
  } catch (error) {}
  if (language === "auto") language = uxp.host.uiLocale || "en_US";
  const strings = parse(locales["locale/messages.properties"]);
  Object.assign(strings, parse(locales["locale/" + language + "/messages.properties"]));
  return strings;
}

function nativeAlert(data) {
  if (!data) return "";
  if (data.isError) return ps.app.showAlert(String(data.text || "")).then(() => "");
  // Photoshop's showAlert uses its warning icon even for successful updates.
  // Keep informational messages in a UXP dialog with their own title and icon.
  const strings = readLocaleStrings();
  const dialog = document.createElement("dialog");
  const form = document.createElement("form");
  form.method = "dialog";
  const content = document.createElement("div");
  content.style.display = "flex";
  content.style.alignItems = "flex-start";
  const icon = document.createElement("sp-icon");
  const success = !!strings.successTitle && data.title === strings.successTitle;
  icon.setAttribute("name", success ? "ui:SuccessMedium" : "ui:InfoMedium");
  icon.setAttribute("size", "l");
  icon.style.marginRight = "12px";
  icon.style.flexShrink = "0";
  const body = document.createElement("sp-body");
  body.textContent = String(data.text || "");
  body.style.whiteSpace = "pre-wrap";
  content.appendChild(icon);
  content.appendChild(body);
  const footer = document.createElement("footer");
  const accept = document.createElement("sp-button");
  accept.setAttribute("variant", "cta");
  accept.textContent = strings.ok || "OK";
  accept.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter") dialog.close();
  });
  footer.appendChild(accept);
  form.appendChild(content);
  form.appendChild(footer);
  dialog.appendChild(form);
  document.body.appendChild(dialog);
  return dialog
    .uxpShowModal({ title: data.title || "TypeR", resize: "none", size: { width: 480, height: 240 } })
    .then(() => "", () => "")
    .finally(() => dialog.remove());
}

function nativeConfirm(data) {
  if (!data) return "";
  const strings = readLocaleStrings();
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    const form = document.createElement("form");
    form.method = "dialog";
    const body = document.createElement("sp-body");
    body.textContent = String(data.text || "");
    const footer = document.createElement("footer");
    const cancel = document.createElement("sp-button");
    cancel.setAttribute("variant", "secondary");
    cancel.setAttribute("quiet", "");
    cancel.textContent = strings.no || "No";
    const accept = document.createElement("sp-button");
    accept.setAttribute("variant", "cta");
    accept.textContent = strings.yes || "Yes";
    cancel.addEventListener("click", () => dialog.close("no"));
    accept.addEventListener("click", () => dialog.close("yes"));
    footer.appendChild(cancel);
    footer.appendChild(accept);
    // Enter confirms and Escape declines, like the system dialog it replaces
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Enter") dialog.close("yes");
    });
    form.appendChild(body);
    form.appendChild(footer);
    dialog.appendChild(form);
    document.body.appendChild(dialog);
    dialog
      .uxpShowModal({ title: data.title || "TypeR", resize: "none", size: { width: 440, height: 200 } })
      .then((result) => resolve(result === "yes" ? "1" : ""), () => resolve(""))
      .finally(() => dialog.remove());
  });
}

async function reloadUserFonts() {
  // app.fonts is built once at startup; refreshFonts() rescans the system so
  // freshly installed fonts appear without a restart
  try {
    await runJsx("app.refreshFonts(); 'ok';");
  } catch (error) {}
  photoshop.invalidateFontList();
  return photoshop.methods.getUserFonts();
}

const methods = Object.assign({}, photoshop.methods, {
  // smart paste (uxp-src/host/smartPaste.js)
  smartPaste: smartPaste.methods.smartPaste,
  smartPasteCapture: smartPaste.methods.smartPasteCapture,
  smartPasteMeasure: smartPaste.methods.smartPasteMeasure,
  smartPasteCommit: smartPaste.methods.smartPasteCommit,
  getHistorySnapshot: smartPaste.methods.getHistorySnapshot,
  restoreHistoryState: smartPaste.methods.restoreHistoryState,
  replaySelectionTrigger: smartPaste.methods.replaySelectionTrigger,
  ensureWandSampleAll: smartPaste.methods.ensureWandSampleAll,
  smartPasteSelectionProbe: smartPaste.methods.smartPasteSelectionProbe,
  nativeAlert,
  nativeConfirm,
  reloadUserFonts,
  getHotkeyPressed: () => keyboard.getState(),
  isHostAppFrontmost: () => true,
  deleteFolder: (path) => files.removeTree(path).then(() => "OK", (error) => "ERROR: " + error.message),
  openFolder: (path) => uxp.shell.openPath(path).then(() => "OK", (error) => "ERROR: " + error.message),
  makeExecutable: () => "OK",
  launchInstaller: (path) => uxp.shell.openPath(path).then(() => "OK", (error) => "ERROR: " + error.message),
});

// One host call at a time, each with a time limit (see evalScript.js)
const enqueue = createCallQueue();

// Photoshop notified a CEP panel of the commands its own scripts played too
// (the panel relies on it: "the debounced Photoshop event refresh will
// confirm"); UXP does not report a plugin's own commands to it. After a call
// that changes the document, the panel gets the event CEP sent.
const DOCUMENT_CHANGING_CALLS = {
  setActiveLayerText: "set",
  setSelectedTextLayers: "set",
  setTextShapeRLayerText: "set",
  createTextLayerInSelection: "set",
  createTextLayersInStoredSelections: "set",
  smartPaste: "set",
  smartPasteCommit: "set",
  alignTextLayerToSelection: "set",
  alignTextLayersToDoubleBubble: "set",
  changeActiveLayerTextSize: "set",
  toggleCleaningLayers: "set",
  undoLastTyperChange: "set",
  openFile: "set",
  deselectDocumentSelection: "set",
  selectLayerById: "select",
};

// Answered without Photoshop: kept out of the crash trace
const UNTRACED_CALLS = { getHotkeyPressed: true, isHostAppFrontmost: true };
let traceCallCount = 0;

async function evalScript(script) {
  const call = parseCall(script);
  const method = call && Object.prototype.hasOwnProperty.call(methods, call.name) ? methods[call.name] : null;
  if (!method) {
    console.error("TypeR: unknown host call", String(script).slice(0, 120));
    return "EvalScript error.";
  }
  const traceTag = crashTrace && !UNTRACED_CALLS[call.name] ? "call#" + ++traceCallCount : null;
  const traceStarted = Date.now();
  if (traceTag) crashTrace.note(traceTag, call.name + "(" + crashTrace.json(call.args, 500).slice(1, -1) + ")");
  try {
    const result = await method(...call.args);
    const text = result === undefined || result === null ? "" : String(result);
    if (traceTag) crashTrace.note(traceTag, call.name + " -> " + (Date.now() - traceStarted) + " ms: " + crashTrace.clip(text, 300));
    return text;
  } catch (error) {
    if (traceTag) crashTrace.note(traceTag, call.name + " threw after " + (Date.now() - traceStarted) + " ms: " + crashTrace.errorText(error));
    console.error("TypeR:", call.name, (error && error.stack) || error);
    return "EvalScript error.";
  } finally {
    if (Object.prototype.hasOwnProperty.call(DOCUMENT_CHANGING_CALLS, call.name)) {
      onPhotoshopEvent(DOCUMENT_CHANGING_CALLS[call.name], { _isCommand: true });
    }
  }
}

/* ========================= requests ========================== */

async function init() {
  if (!mirrorFiles) {
    await files.resolveFolders();
    storageRoot = files.getStorageRoot();
    await files.ensureFolder(storageRoot);
    await files.recoverInterruptedWrites(storageRoot);
    const imported = await files.importCepStorage(storageRoot).catch((error) => {
      console.error("TypeR: CEP storage import failed", error);
      return false;
    });
    if (imported) log("storage imported from", imported);
    const [storedFiles, locales] = await Promise.all([files.loadMirror(storageRoot), files.loadLocales()]);
    mirrorFiles = { files: storedFiles, locales };
  }
  return {
    extensionId: EXTENSION_ID,
    extensionRoot: "/typer",
    storageRoot,
    files: mirrorFiles.files,
    locales: mirrorFiles.locales,
    hostEnvironment: getHostEnvironment(),
    platform: os.platform(),
    keys: keyboard.getState(),
    hidden: !panelVisible,
    version: services.pluginVersion(),
  };
}

const requests = {
  init,
  // A call past its time limit answers like a call that threw, as CEP did.
  // The smart paste answers "timeout" instead: the panel must not paste the
  // classic way while Photoshop may still finish the smart paste.
  evalScript: (script) => {
    const timeout = callTimeout(script);
    return enqueue(() => evalScript(script), timeout, (started) => {
      const call = String(script).slice(0, 120);
      if (started) console.error("TypeR: host call still running after " + timeout / 1000 + " s, next calls wait for it", call);
      else console.error("TypeR: host call dropped, Photoshop is still busy with a late call", call);
      return /^\s*smartPaste\s*\(/.test(String(script)) ? JSON.stringify({ ok: false, code: "timeout" }) : "EvalScript error.";
    });
  },
  writeMirror: (name, text) => {
    if (mirrorFiles) mirrorFiles.files[name] = String(text);
    return mirror.write(name, text);
  },
  deleteMirror: (name) => {
    if (mirrorFiles) delete mirrorFiles.files[name];
    return mirror.remove(name);
  },
  flushMirror: () => mirror.flush(),
  openUrl: (url) => uxp.shell.openExternal(String(url)),
  keyboardAccess: () => keysHelper.access(),
  // A development build must not replace itself with the release package
  needsPlatformPackage: () => !(typeof TYPER_DEV !== "undefined" && TYPER_DEV) && keysHelper.needsPlatformPackage(),
  keyboardDebug: () => Object.assign(typeof keysHelper.diagnostics === "function" ? keysHelper.diagnostics() : {
    source: "helper", running: null, foreground: null, error: "",
    state: keyboard.getState(), sampledAt: keyboard.lastUpdate(),
  }, { focusRestores }),
  openKeyboardAccess: () => systemCall('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"'),
  log: (...args) => log("panel:", ...args),
};
Object.assign(requests, services.requests);

// Panel requests in the crash trace: evalScript has its own lines, and the
// storage writes and log lines say nothing about Photoshop
const UNTRACED_REQUESTS = { evalScript: true, writeMirror: true, deleteMirror: true, flushMirror: true, log: true, keyboardDebug: true };

async function handleRequest(message, generation) {
  if (message.method === 'init') debugNote('init.request', message.id);
  // Request ids restart in a new WebView. Never deliver a late reply from the
  // destroyed page to an unrelated request in its replacement.
  const reply = (response) => { if (generation === viewGeneration) post(response); };
  if (crashTrace && !UNTRACED_REQUESTS[message.method]) crashTrace.note("request", String(message.method));
  const handler = Object.prototype.hasOwnProperty.call(requests, message.method) ? requests[message.method] : null;
  if (!handler) {
    reply({ type: "reply", id: message.id, error: "Unknown request " + message.method });
    return;
  }
  try {
    const result = await handler(...(Array.isArray(message.args) ? message.args : []));
    if (message.method === 'init') debugNote('init.reply', message.id);
    reply({ type: "reply", id: message.id, result: result === undefined ? null : result });
  } catch (error) {
    debugNote('request.error', String(message.method) + ': ' + (error.message || error));
    reply({ type: "reply", id: message.id, error: String((error && error.message) || error) });
  }
}

let viewOnPanel = true;
let loadingPanel = false;
let panelAddress = PANEL_URL;

function showPanelPage() {
  clearProbes();
  loadEvents.length = 0;
  debugNote('webview.navigate', PANEL_URL);
  loadingPanel = true;
  webviewReady = false;
  recentRequestIds.clear();
  panelStartup.begin();
  try { view.src = PANEL_URL; }
  catch (error) { panelStartup.fail(String(error && error.message || error)); }
}

function attachView() {
  if (diagnostic) diagnostic.attachUI();
  // Photoshop may recreate the panel DOM after closing it. A cached detached
  // WebView cannot render or receive replies in the newly created panel.
  if (view && document.getElementById("typer-view") === view) return view;
  detachWindowMessages();
  clearProbes();
  panelStartup.dispose();
  statusElement = null;
  viewOnPanel = true;
  const generation = ++viewGeneration;
  view = document.getElementById("typer-view");
  if (!view) {
    view = document.createElement("webview");
    view.id = "typer-view";
    view.setAttribute("width", "100%");
    view.setAttribute("height", "100%");
    document.body.appendChild(view);
  }
  const attachedView = view;
  let messageSamples = 0;
  const onPanelMessage = (event, channel) => {
    if (messageSamples++ < 30) debugNote('bridge.receive', channel + '; data=' + typeof event.data + '; message=' + typeof event.message + '; current=' + (generation === viewGeneration));
    // The bridge is open to remote pages too (see the loadstart listener)
    if (generation !== viewGeneration || view !== attachedView || !viewOnPanel) return;
    let message = event.message !== undefined ? event.message : event.data;
    // The WebView delivers the panel's string JSON-encoded once more
    for (let depth = 0; typeof message === "string" && depth < 2; depth++) {
      try {
        message = JSON.parse(message);
      } catch (error) {
        return;
      }
    }
    if (!message || typeof message !== "object") return;
    if (message.type === 'diagnostic' && diagnostic) {
      panelStartup.bridgeReady();
      diagnostic.note('web.' + String(message.stage).slice(0, 60), message.detail);
      return;
    }
    if (!['ready', 'appReady', 'request', 'devResult', 'panelError'].includes(message.type)) return;
    if (crashTrace && !webviewReady) crashTrace.note('webview', 'panel answered, view ' + viewSize());
    webviewReady = true;
    panelStartup.bridgeReady();
    if (message.type === "ready") {
      debugNote('bridge.ready', channel);
      panelStartup.bridgeReady();
      return;
    }
    if (message.type === "appReady") {
      debugNote('app.ready', channel);
      panelStartup.appReady();
      return;
    }
    if (message.type === "request") {
      // Some hosts deliver the same message to both the element and window.
      // Never run a paste (or any other request) twice. Keep a bounded recent
      // history; ids are monotonic within a page and restart on navigation.
      if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id) || message.id < 1) return;
      if (recentRequestIds.has(message.id)) return;
      recentRequestIds.add(message.id);
      if (recentRequestIds.size > 512) recentRequestIds.delete(recentRequestIds.values().next().value);
      handleRequest(message, generation);
    }
    else if (message.type === "devResult") devResultListeners.forEach((listener) => listener(message));
    else if (message.type === "panelError") {
      console.error("TypeR panel:", message.text);
      // Runtime errors keep the working panel accessible. Only startup
      // failures replace the view with the native recovery controls.
      if (panelStartup.getState() === 'ready') showStatus(message.text);
      else panelStartup.fail(message.text);
    }
  };
  view.addEventListener("message", event => onPanelMessage(event, 'element'));
  // Adobe documents window as the receiver of WebView postMessage events.
  // Keep the element listener for hosts that dispatch there, but only accept
  // global messages whose source is this panel's current WebView.
  windowMessageListener = (event) => {
    if (messageSamples < 30) debugNote('bridge.window', 'sourceMatch=' + (event.source === attachedView) + '; sourceType=' + typeof event.source + '; origin=' + String(event.origin || ''));
    if (event.source === attachedView) onPanelMessage(event, 'window');
  };
  window.addEventListener('message', windowMessageListener);
  // The message bridge is "localAndRemote": "localOnly" stops the host's
  // messages from reaching the panel in Photoshop 26.6. A page that is not
  // the panel never gets to talk to the host: the WebView goes back to the
  // panel, and a web link opens in the browser. The panel's address is the
  // one reported by the load that follows setting src, as the platforms may
  // not report it the same way.
  view.addEventListener("loadstart", (event) => {
    if (generation !== viewGeneration || view !== attachedView) return;
    debugNote('webview.loadstart', event.url);
    const url = String(event.url || "").split("#")[0];
    noteLoadEvent('start ' + url);
    if (loadingPanel) {
      loadingPanel = false;
      panelAddress = url;
    }
    viewOnPanel = url === panelAddress || url.indexOf("plugin:/") === 0;
    if (viewOnPanel) { panelStartup.loadStarted(); return; }
    showPanelPage();
    if (/^https?:\/\//i.test(url)) uxp.shell.openExternal(url).catch(() => {});
  });
  view.addEventListener("loaderror", (event) => {
    if (generation !== viewGeneration || view !== attachedView) return;
    debugNote('webview.loaderror', 'code=' + event.code + '; ' + event.message + '; ' + event.url);
    noteLoadEvent('error ' + (event.message || ''));
    panelStartup.loadError(event);
  });
  view.addEventListener('loadstop', () => {
    if (generation !== viewGeneration || view !== attachedView || !viewOnPanel) return;
    debugNote('webview.loadstop', 'current=' + (generation === viewGeneration));
    noteLoadEvent('stop');
    panelStartup.loadStopped();
  });
  const retry = document.getElementById('typer-retry');
  if (retry) {
    retry.textContent = /^fr/i.test(uxp.host.uiLocale || '') ? 'Recharger TypeR' : 'Reload TypeR';
    retry.onclick = async () => {
      debugNote('user.reload', 'requested');
      retry.disabled = true;
      try {
        await mirror.flush();
        if (generation !== viewGeneration) return;
        panelStartup.dispose();
        const previous = view;
        view = null;
        webviewReady = false;
        if (previous) previous.remove();
        attachView();
      } catch (error) { panelStartup.fail(String(error && error.message || error)); }
      finally { retry.disabled = false; }
    };
  }
  const help = document.getElementById('typer-webview-help');
  if (help) help.onclick = () => uxp.shell.openExternal('https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/uxp-webview.html').catch((error) => showStatus(String(error.message || error)));
  showPanelPage();
  return view;
}

/* ====================== Photoshop events ====================== */

// CEP's com.adobe.PhotoshopJSONCallback payload: "ver1,{eventID, eventData}"
const EVENT_IDS = { select: 1936483188, set: 1936028772, move: 1836021349 };

function onPhotoshopEvent(name, descriptor) {
  const eventID = EVENT_IDS[name];
  if (!eventID) return;
  let eventData = descriptor || {};
  try {
    eventData = JSON.parse(JSON.stringify(eventData));
  } catch (error) {
    eventData = {};
  }
  post({ type: "psEvent", data: "ver1," + JSON.stringify({ eventID, eventData }) });
}

// History moves (undo, redo, a History panel click) for the smart paste's
// undo sync. CEP has no such event: its panel checks history lazily.
const HISTORY_EVENT_ID = 1215591779;

function onHistoryChanged() {
  let snapshot = null;
  try {
    snapshot = JSON.parse(smartPaste.methods.getHistorySnapshot());
  } catch (error) {
    snapshot = null;
  }
  if (snapshot) post({ type: "psEvent", data: "ver1," + JSON.stringify({ eventID: HISTORY_EVENT_ID, eventData: snapshot }) });
}

/* ======================== keyboard ======================== */

keyboard.onChange((state) => post({ type: "keys", state }));

/* ========================= focus ========================= */

// Photoshop's rich tooltips take the keyboard focus on Windows (keys.h): after
// a paste on click or TextShapeR, the contextual task bar of the new text
// layer sits under the cursor, its tooltip opens, and every shortcut dies
// until the user clicks the document. The addon reports the theft, and the
// focus goes back to the document: bringToFront does that, from the modal
// scope it needs as an action. Photoshop busy (a text being edited, a
// dialog): the user's next click restores it, as before.
let restoringFocus = false;
let focusRestores = 0;

async function restoreFocus() {
  if (restoringFocus) return;
  restoringFocus = true;
  try {
    await photoshop._internals.modal("TypeR", () => ps.app.bringToFront());
    focusRestores++;
  } catch (error) {
    debugNote("focus.restore", String((error && error.message) || error));
  } finally {
    restoringFocus = false;
  }
}

/* ========================= setup ========================= */

function onThemeChanged() {
  post({ type: "theme", hostEnvironment: getHostEnvironment() });
}

let started = false;
async function startOnce() {
  if (started) return;
  started = true;
  try {
    await ps.action.addNotificationListener(Object.keys(EVENT_IDS), onPhotoshopEvent);
  } catch (error) {
    console.error("TypeR: event listener", error);
  }
  try {
    await ps.action.addNotificationListener(["historyStateChanged"], onHistoryChanged);
  } catch (error) {
    console.error("TypeR: history listener", error);
  }
  try {
    document.theme.onUpdated.addListener(onThemeChanged);
  } catch (error) {}
  keysHelper.start((line) => post({ type: "watcherLine", line }), restoreFocus).catch((error) => console.error("TypeR keys", error));
  services.removeStalePluginFolders().catch((error) => console.error("TypeR: plugin cleanup", error));
  services.removeUpdateFolder().catch((error) => console.error("TypeR: update cleanup", error));
  services.renameLegacyPanel().catch((error) => console.error("TypeR: Legacy panel name", error));
}

const devResultListeners = [];
if (typeof TYPER_DEV !== "undefined" && TYPER_DEV) {
  require("./devChannel").start(post, (listener) => devResultListeners.push(listener));
  globalThis.__typer = { photoshop, files, keyboard, services, methods, requests, post, mirror, getMirror: () => mirrorFiles, getHostEnvironment, onThemeChanged };
}


uxp.entrypoints.setup({
  plugin: {
    create() {
      if (crashTrace) crashTrace.note("lifecycle", "plugin create");
      startOnce();
    },
    destroy() {
      if (crashTrace) crashTrace.note("lifecycle", "plugin destroy (Photoshop closed TypeR normally)");
      panelStartup.dispose();
      clearProbes();
      detachWindowMessages();
      viewGeneration++;
      panelVisible = false;
      keysHelper.stop();
      return mirror.flush();
    },
  },
  panels: {
    typer: {
      create() {
        if (crashTrace) crashTrace.note("lifecycle", "panel create");
        attachView();
        startOnce();
      },
      show() {
        if (crashTrace) crashTrace.note("lifecycle", "panel show");
        attachView();
        panelVisible = true;
        panelStartup.setVisible(true);
        post({ type: "visibility", hidden: false });
      },
      hide() {
        if (crashTrace) crashTrace.note("lifecycle", "panel hide");
        panelVisible = false;
        panelStartup.setVisible(false);
        clearProbes();
        post({ type: "visibility", hidden: true });
      },
      destroy() {
        if (crashTrace) crashTrace.note("lifecycle", "panel destroy");
        panelStartup.dispose();
        clearProbes();
        detachWindowMessages();
        panelVisible = false;
        panelStartup.setVisible(false);
        viewGeneration++;
        view = null;
        statusElement = null;
        webviewReady = false;
        return mirror.flush();
      },
    },
  },
});

module.exports = { evalScript };
