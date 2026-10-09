// Browser features the panel's WebView lacks or restricts.
import { request } from "./bridge";

// localStorage throws "Storage is not supported" in the UXP WebView. The
// panel only keeps view preferences there (font viewer layout, perf debug):
// they are kept in one of TypeR's storage files instead.
export function installLocalStorage(readMirror, writeMirror) {
  let works = false;
  try {
    const probe = "__typer_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    works = true;
  } catch (error) {}
  if (works) return;

  const FILE = "storage-webview";
  let values = {};
  try {
    values = JSON.parse(readMirror(FILE) || "{}") || {};
  } catch (error) {
    values = {};
  }
  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeMirror(FILE, JSON.stringify(values));
    }, 300);
  };
  const storage = {
    get length() {
      return Object.keys(values).length;
    },
    key: (index) => Object.keys(values)[index] || null,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, String(key)) ? values[String(key)] : null),
    setItem: (key, value) => {
      values[String(key)] = String(value);
      save();
    },
    removeItem: (key) => {
      delete values[String(key)];
      save();
    },
    clear: () => {
      values = {};
      save();
    },
  };
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage });
  } catch (error) {
    console.error("TypeR: localStorage replacement failed", error);
  }
}

// <input type="file">: the CEP panel read the native path of the picked files
// (File.path, from CEP's Node integration). The WebView gives neither a usable
// picker nor paths, so file inputs open the host's dialog and receive
// File-like objects carrying the native path.
export function installFileInputs() {
  const nativeClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function click() {
    if (this.type !== "file") return nativeClick.call(this);
    const input = this;
    const types = String(input.accept || "")
      .split(",")
      .map((type) => type.trim().replace(/^\./, ""))
      .filter((type) => type && type.indexOf("/") === -1);
    request("showOpenDialog", { multiple: !!input.multiple, directory: !!input.webkitdirectory, types }).then((paths) => {
      if (!paths || !paths.length) return;
      const picked = paths.map((path) => {
        const name = String(path).split(/[\\/]/).pop();
        return { name, path, size: 0, type: "", lastModified: Date.now() };
      });
      const list = Object.assign(picked.slice(), { item: (index) => picked[index] || null });
      Object.defineProperty(input, "files", { configurable: true, get: () => list });
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      delete input.files;
    }, (error) => console.error("TypeR: file dialog", error));
  };
}

// Forward errors to the host: the WebView console is not part of
// Photoshop's UXP log
export function installErrorReporting(report) {
  window.addEventListener("error", (event) => report("panel error: " + ((event && event.message) || event)));
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event && event.reason;
    report("panel rejection: " + ((reason && (reason.stack || reason.message)) || reason));
  });
}
