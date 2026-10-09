// TypeR UXP plugin entry. The panel is the regular TypeR application,
// rendered in a WebView (uxp/web, built from app_src); this script is its host:
// it answers the panel's evalScript calls with the UXP port of host.js,
// persists its files, forwards Photoshop events, the theme and the keyboard.
const ps = require("photoshop");
const uxp = require("uxp");
const os = require("os");
const photoshop = require("./photoshop");
const files = require("./files");
const keyboard = require("./keyboard");
const keysHelper = require("./keysHelper");
const services = require("./services");
const { runJsx } = require("./jsx");
const { parseCall } = require("./evalScript");

const EXTENSION_ID = "typer";
const PANEL_URL = "plugin:/web/index.html";
// The panel's DOM only exists once Photoshop creates the panel: the WebView
// is looked up then, and starts loading after its listeners are in place
let view = null;
let statusElement = null;

const storageRoot = files.getStorageRoot();
const mirror = files.createMirrorWriter(storageRoot);
let mirrorFiles = null;
let panelVisible = true;
let webviewReady = false;

function log(...args) {
  console.log("TypeR:", ...args);
}

function showStatus(text) {
  if (!statusElement) statusElement = document.getElementById("typer-status");
  if (!statusElement) return;
  statusElement.textContent = text || "";
  statusElement.style.display = text ? "block" : "none";
}

/* ======================= panel messages ======================= */

function post(message) {
  if (!view || !webviewReady) return;
  try {
    view.postMessage(JSON.stringify(message));
  } catch (error) {
    console.error("TypeR: message to panel failed", error);
  }
}

/* ===================== evalScript surface ===================== */

const UNIT_THEMES = {
  darkest: { red: 50, green: 50, blue: 50 },
  dark: { red: 83, green: 83, blue: 83 },
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
  return ps.app.showAlert(String(data.text || "")).then(() => "");
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

// ExtendScript ran one script at a time: so do the host calls, otherwise two
// calls could interleave their Photoshop commands
let hostQueue = Promise.resolve();
function enqueue(task) {
  const run = hostQueue.then(task, task);
  hostQueue = run.catch(() => {});
  return run;
}

async function evalScript(script) {
  const call = parseCall(script);
  const method = call && Object.prototype.hasOwnProperty.call(methods, call.name) ? methods[call.name] : null;
  if (!method) {
    console.error("TypeR: unknown host call", String(script).slice(0, 120));
    return "EvalScript error.";
  }
  try {
    const result = await method(...call.args);
    return result === undefined || result === null ? "" : String(result);
  } catch (error) {
    console.error("TypeR:", call.name, (error && error.stack) || error);
    return "EvalScript error.";
  }
}

/* ========================= requests ========================== */

async function init() {
  if (!mirrorFiles) {
    await files.ensureFolder(storageRoot);
    const imported = await files.importCepStorage(storageRoot).catch((error) => {
      console.error("TypeR: CEP storage import failed", error);
      return false;
    });
    if (imported) log("storage imported from", imported);
    mirrorFiles = { files: await files.loadMirror(storageRoot), locales: await files.loadLocales() };
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
  evalScript: (script) => enqueue(() => evalScript(script)),
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
  log: (...args) => log("panel:", ...args),
};
Object.assign(requests, services.requests);

async function handleRequest(message) {
  const handler = Object.prototype.hasOwnProperty.call(requests, message.method) ? requests[message.method] : null;
  if (!handler) {
    post({ type: "reply", id: message.id, error: "Unknown request " + message.method });
    return;
  }
  try {
    const result = await handler(...(Array.isArray(message.args) ? message.args : []));
    post({ type: "reply", id: message.id, result: result === undefined ? null : result });
  } catch (error) {
    post({ type: "reply", id: message.id, error: String((error && error.message) || error) });
  }
}

function attachView() {
  if (view) return view;
  view = document.getElementById("typer-view");
  if (!view) {
    view = document.createElement("webview");
    view.id = "typer-view";
    view.setAttribute("width", "100%");
    view.setAttribute("height", "100%");
    document.body.appendChild(view);
  }
  view.addEventListener("message", (event) => {
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
    webviewReady = true;
    if (message.type === "ready") {
      showStatus("");
      return;
    }
    if (message.type === "request") handleRequest(message);
    else if (message.type === "devResult") devResultListeners.forEach((listener) => listener(message));
    else if (message.type === "panelError") {
      console.error("TypeR panel:", message.text);
      showStatus(message.text);
    }
  });
  view.addEventListener("loaderror", (event) => showStatus("TypeR: " + (event.message || "load error")));
  view.src = PANEL_URL;
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

/* ======================== keyboard ======================== */

keyboard.onChange((state) => post({ type: "keys", state }));

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
    document.theme.onUpdated.addListener(onThemeChanged);
  } catch (error) {}
  keysHelper.start((line) => post({ type: "watcherLine", line })).catch((error) => console.error("TypeR keys", error));
}

const devResultListeners = [];
if (typeof TYPER_DEV !== "undefined" && TYPER_DEV) {
  require("./devChannel").start(post, (listener) => devResultListeners.push(listener));
  globalThis.__typer = { photoshop, files, keyboard, services, methods, requests, post, mirror, getMirror: () => mirrorFiles };
}


uxp.entrypoints.setup({
  plugin: {
    create() {
      startOnce();
    },
    destroy() {
      keysHelper.stop();
      return mirror.flush();
    },
  },
  panels: {
    typer: {
      create() {
        attachView();
        startOnce();
      },
      show() {
        attachView();
        panelVisible = true;
        post({ type: "visibility", hidden: false });
      },
      hide() {
        panelVisible = false;
        post({ type: "visibility", hidden: true });
      },
      destroy() {
        return mirror.flush();
      },
    },
  },
});

module.exports = { evalScript };
