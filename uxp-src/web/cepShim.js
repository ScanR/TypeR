// The CEP environment the TypeR application expects (CSInterface, cep.fs,
// cep.util, __adobe_cep__), rebuilt on top of the UXP host. The application
// code is shared with the CEP extension and stays unaware of the difference,
// except where a CEP call was synchronous and a UXP one cannot be: file
// dialogs and files outside TypeR's own storage return promises, and their
// call sites await them (an await on CEP's plain result changes nothing).
import { request, notify, on } from "./bridge";

const EXTENSION_ROOT = "/typer";
const MIRRORED_FILE = /^(storage[A-Za-z0-9._-]*|\.typer-update-test\.json)$/;
const THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

const FS = {
  NO_ERROR: 0,
  ERR_UNKNOWN: 1,
  ERR_INVALID_PARAMS: 2,
  ERR_NOT_FOUND: 3,
  ERR_CANT_READ: 4,
  ERR_UNSUPPORTED_ENCODING: 5,
  ERR_CANT_WRITE: 6,
  ERR_OUT_OF_SPACE: 7,
  ERR_NOT_FILE: 8,
  ERR_NOT_DIRECTORY: 9,
  ERR_FILE_EXISTS: 10,
};

const ENCODING = { UTF8: "UTF-8", Base64: "Base64" };

function parseProperties(text) {
  const result = {};
  if (!text) return result;
  const lines = String(text).replace(/\r/g, "").split("\n");
  let key = null;
  let value = "";
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (key) {
      value += line;
      if (value.endsWith("\\")) {
        value = value.slice(0, -1) + "\n";
        continue;
      }
      result[key] = value;
      key = null;
      value = "";
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) continue;
    key = line.slice(0, index).trim();
    value = line.slice(index + 1);
    if (value.endsWith("\\")) {
      value = value.slice(0, -1) + "\n";
      continue;
    }
    result[key] = value;
    key = null;
    value = "";
  }
  return result;
}

export function installCepEnvironment(init) {
  const files = Object.assign({}, init.files || {});
  const locales = init.locales || {};
  let hostEnvironment = init.hostEnvironment;
  let keyboardState = init.keys || "a";
  let hidden = !!init.hidden;
  const listeners = {};
  const watcherListeners = new Set();

  const dispatch = (type, data) => {
    (listeners[type] || []).slice().forEach((entry) => {
      try {
        entry.listener.call(entry.obj || null, { type, data, scope: "APPLICATION", appId: "PHXS", extensionId: init.extensionId });
      } catch (error) {
        console.error("TypeR: event listener", error);
      }
    });
  };

  /* --------------------------- files --------------------------- */

  const relativeName = (path) => {
    const value = String(path || "").replace(/\\/g, "/");
    if (value.indexOf(EXTENSION_ROOT + "/") !== 0) return null;
    return value.slice(EXTENSION_ROOT.length + 1);
  };

  const userFile = (task) => task.then(
    (data) => ({ err: FS.NO_ERROR, data }),
    (error) => ({ err: /no such file|could not find/i.test(String(error && error.message)) ? FS.ERR_NOT_FOUND : FS.ERR_UNKNOWN, data: "" })
  );

  const fs = Object.assign({}, FS, {
    readFile(path, encoding) {
      const name = relativeName(path);
      if (name !== null) {
        if (name.indexOf("locale/") === 0) {
          return Object.prototype.hasOwnProperty.call(locales, name) ? { err: FS.NO_ERROR, data: locales[name] } : { err: FS.ERR_NOT_FOUND };
        }
        if (!MIRRORED_FILE.test(name)) return { err: FS.ERR_NOT_FOUND };
        return Object.prototype.hasOwnProperty.call(files, name) ? { err: FS.NO_ERROR, data: files[name] } : { err: FS.ERR_NOT_FOUND };
      }
      return userFile(request("readUserFile", String(path), encoding === ENCODING.Base64 ? "Base64" : "UTF-8"));
    },
    writeFile(path, data, encoding) {
      const name = relativeName(path);
      if (name !== null) {
        if (!MIRRORED_FILE.test(name)) return { err: FS.ERR_CANT_WRITE };
        files[name] = String(data);
        // Persisted in the background; the panel reads its own writes back
        // from the mirror (storageIO verifies every write that way)
        request("writeMirror", name, files[name]).catch((error) => {
          console.error("TypeR: storage write failed", error);
          notify("panelError", { text: "TypeR: " + ((error && error.message) || error) });
        });
        return { err: FS.NO_ERROR };
      }
      return userFile(request("writeUserFile", String(path), String(data), encoding === ENCODING.Base64 ? "Base64" : "UTF-8"));
    },
    deleteFile(path) {
      const name = relativeName(path);
      if (name !== null) {
        if (!MIRRORED_FILE.test(name)) return { err: FS.ERR_NOT_FOUND };
        const existed = Object.prototype.hasOwnProperty.call(files, name);
        delete files[name];
        if (existed) request("deleteMirror", name).catch(() => {});
        return { err: existed ? FS.NO_ERROR : FS.ERR_NOT_FOUND };
      }
      return userFile(request("deleteUserFile", String(path)));
    },
    showOpenDialogEx(allowMultiple, chooseDirectory, title, initialPath, fileTypes) {
      return request("showOpenDialog", { multiple: !!allowMultiple, directory: !!chooseDirectory, title, types: fileTypes || [] }).then(
        (paths) => ({ err: FS.NO_ERROR, data: paths || [] }),
        () => ({ err: FS.ERR_UNKNOWN, data: [] })
      );
    },
    showSaveDialogEx(title, initialPath, fileTypes, defaultName) {
      return request("showSaveDialog", { title, types: fileTypes || [], defaultName }).then(
        (path) => ({ err: FS.NO_ERROR, data: path || "" }),
        () => ({ err: FS.ERR_UNKNOWN, data: "" })
      );
    },
  });
  fs.showOpenDialog = fs.showOpenDialogEx;
  fs.showSaveDialog = fs.showSaveDialogEx;

  window.cep = {
    fs,
    encoding: ENCODING,
    util: {
      openURLInDefaultBrowser(url) {
        request("openUrl", String(url)).catch(() => {});
        return { err: FS.NO_ERROR };
      },
      registerExtensionUnloadCallback() {},
    },
  };

  /* ------------------------ CSInterface ------------------------ */

  const getUiLocaleBundle = () => {
    const appLocale = hostEnvironment.appUILocale || hostEnvironment.appLocale || "en_US";
    return Object.assign(
      {},
      parseProperties(locales["locale/messages.properties"]),
      parseProperties(locales["locale/" + appLocale + "/messages.properties"])
    );
  };

  class CSEvent {
    constructor(type, scope, appId, extensionId) {
      this.type = type;
      this.scope = scope;
      this.appId = appId;
      this.extensionId = extensionId;
      this.data = "";
    }
  }

  class CSInterface {
    constructor() {
      this.hostEnvironment = JSON.parse(JSON.stringify(hostEnvironment));
    }
    getHostEnvironment() {
      this.hostEnvironment = JSON.parse(JSON.stringify(hostEnvironment));
      return this.hostEnvironment;
    }
    getSystemPath() {
      return EXTENSION_ROOT;
    }
    getExtensionID() {
      return init.extensionId;
    }
    getOSInformation() {
      return init.platform === "win32" ? "Windows 10 64-bit" : "Mac OS X 10.15.7";
    }
    getApplicationID() {
      return "PHXS";
    }
    getCurrentApiVersion() {
      return { major: 11, minor: 0, micro: 0 };
    }
    getScaleFactor() {
      return window.devicePixelRatio || 1;
    }
    initResourceBundle() {
      return getUiLocaleBundle();
    }
    evalScript(script, callback) {
      const done = typeof callback === "function" ? callback : null;
      // ScriptUI's keyboard state, kept current by the host's keyboard reader
      if (/^\s*getHotkeyPressed\s*\(\s*\)\s*;?\s*$/.test(String(script))) {
        if (done) Promise.resolve().then(() => done(keyboardState));
        return;
      }
      request("evalScript", String(script)).then(
        (result) => done && done(result),
        (error) => {
          console.error("TypeR: evalScript", error);
          if (done) done("EvalScript error.");
        }
      );
    }
    addEventListener(type, listener, obj) {
      (listeners[type] = listeners[type] || []).push({ listener, obj });
    }
    removeEventListener(type, listener) {
      if (listeners[type]) listeners[type] = listeners[type].filter((entry) => entry.listener !== listener);
    }
    // Registering Photoshop events: the host forwards select, set and move,
    // the three events the panel registers
    dispatchEvent() {}
    registerKeyEventsInterest() {}
    requestOpenExtension() {}
    closeExtension() {}
    resizeContent() {}
    openURLInDefaultBrowser(url) {
      return window.cep.util.openURLInDefaultBrowser(url);
    }
  }
  CSInterface.THEME_COLOR_CHANGED_EVENT = THEME_COLOR_CHANGED_EVENT;

  window.CSInterface = CSInterface;
  window.CSEvent = CSEvent;
  window.SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication",
  };
  window.__adobe_cep__ = {
    getHostEnvironment: () => JSON.stringify(hostEnvironment),
    getExtensionId: () => init.extensionId,
    getCurrentApiVersion: () => JSON.stringify({ major: 11, minor: 0, micro: 0 }),
  };

  /* ---------------------- host notifications ---------------------- */

  on("psEvent", (message) => dispatch("com.adobe.PhotoshopJSONCallback" + init.extensionId, message.data));
  on("keys", (message) => {
    keyboardState = typeof message.state === "string" ? message.state : "a";
  });
  on("theme", (message) => {
    hostEnvironment = message.hostEnvironment || hostEnvironment;
    dispatch(THEME_COLOR_CHANGED_EVENT, "");
  });
  on("visibility", (message) => {
    if (hidden === !!message.hidden) return;
    hidden = !!message.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  on("watcherLine", (message) => watcherListeners.forEach((listener) => listener(message.line)));

  // A docked panel that is collapsed keeps its WebView alive: document.hidden
  // is what the panel's pollers check before calling Photoshop
  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  } catch (error) {}

  window.typerUXP = {
    request,
    platform: init.platform,
    storageRoot: init.storageRoot,
    version: init.version,
    flushStorage: () => request("flushMirror"),
    onWatcherLine(listener) {
      watcherListeners.add(listener);
      return () => watcherListeners.delete(listener);
    },
  };
}
