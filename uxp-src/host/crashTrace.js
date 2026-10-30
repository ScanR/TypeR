// Crash trace builds only (npm run package:uxp:trace): a diagnostic build to
// send to a user whose Photoshop crashes. A native crash takes the plugin
// down with it, so nothing kept in memory survives: every command TypeR sends
// to Photoshop is written to disk, synchronously, before it runs, and the
// last lines of the session's file name the command Photoshop died on.
// Never part of a release build.
//
// Files: <storage root>/crash-traces/crash-trace-<date>_<time>.log, i.e.
// %APPDATA%\TypeR\UXP\crash-traces on Windows and
// ~/Library/Application Support/TypeR/UXP/crash-traces on macOS.
//
// install() must run before photoshop.js is loaded: that module keeps its
// own reference to ps.action.batchPlay.
const fs = require("fs");
const os = require("os");
const ps = require("photoshop");
const files = require("./files");

const MAX_DETAIL = 700;
const MAX_GET_DETAIL = 300;
// Lines written before the file is open (the storage root is resolved
// asynchronously on Windows) wait in memory
const MAX_PENDING = 5000;
const KEEP_FILES = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const FOLDER = "crash-traces";

let target = null;
let targetPath = "";
let targetBase = "";
let part = 1;
let written = 0;
const pending = [];
let sequence = 0;
let installed = false;

const pad = (value, width = 2) => String(value).padStart(width, "0");

function clock() {
  const now = new Date();
  return pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) + "." + pad(now.getMilliseconds(), 3);
}

function fileStamp() {
  const now = new Date();
  return now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "_" + pad(now.getHours()) + "-" + pad(now.getMinutes()) + "-" + pad(now.getSeconds());
}

function clip(text, max = MAX_DETAIL) {
  const value = String(text);
  return value.length > max ? value.slice(0, max) + "…(+" + (value.length - max) + " chars)" : value;
}

// Pixel buffers and image data objects would flood the file: summarized
function safeReplacer(key, value) {
  if (value && typeof value === "object") {
    if (typeof value.getData === "function") return "[imageData " + value.width + "x" + value.height + "]";
    if (value instanceof ArrayBuffer) return "[" + value.byteLength + " bytes]";
    if (ArrayBuffer.isView(value)) return "[" + value.byteLength + " bytes]";
  }
  return value;
}

function json(value, max = MAX_DETAIL) {
  try {
    const text = JSON.stringify(value, safeReplacer);
    return clip(text === undefined ? String(value) : text, max);
  } catch (error) {
    return "[unserializable]";
  }
}

function errorText(error) {
  if (!error) return String(error);
  return clip((error.stack || error.message || String(error)).replace(/\s+/g, " "), 600);
}

function rotateIfFull() {
  if (written < MAX_FILE_BYTES) return;
  part++;
  written = 0;
  targetPath = targetBase + "-part" + part + ".log";
  target = files.toUrl(targetPath);
}

function write(line) {
  if (!target) {
    pending.push(line);
    if (pending.length > MAX_PENDING) pending.shift();
    return;
  }
  try {
    // writeFileSync with the "a" flag is the only synchronous append in
    // UXP: the line is in the file before the command it announces runs
    fs.writeFileSync(target, line + "\n", { flag: "a" });
    written += line.length + 1;
    rotateIfFull();
  } catch (error) {}
}

function note(tag, ...parts) {
  if (!installed) return;
  write(clock() + " [" + tag + "] " + parts.map((part) => (typeof part === "string" ? part : json(part))).join(" "));
}

function replace(owner, key, wrapper) {
  try {
    Object.defineProperty(owner, key, { value: wrapper, writable: true, configurable: true });
    return true;
  } catch (error) {
    write(clock() + " [trace] could not wrap " + key + ": " + errorText(error));
    return false;
  }
}

/* ======================= Photoshop API ======================= */

function describeDescriptor(descriptor) {
  return json(descriptor, descriptor && descriptor._obj === "get" ? MAX_GET_DETAIL : MAX_DETAIL);
}

function errorsOf(result) {
  const list = Array.isArray(result) ? result : [result];
  return list
    .filter((entry) => entry && entry._obj === "error")
    .map((entry) => clip((entry.message || "error") + " (" + entry.result + ")", 200));
}

function traceBatchPlay() {
  const original = ps.action.batchPlay;
  if (typeof original !== "function") return;
  replace(ps.action, "batchPlay", function (descriptors, options) {
    const tag = "play#" + ++sequence;
    const list = Array.isArray(descriptors) ? descriptors : [descriptors];
    const mode = options && options.synchronousExecution ? "sync" : "async";
    note(tag, mode + " " + list.length + " cmd: " + list.map(describeDescriptor).join(" | "));
    const started = Date.now();
    const finish = (value) => {
      const errors = errorsOf(value);
      note(tag, "done " + (Date.now() - started) + " ms" + (errors.length ? " PHOTOSHOP ERROR " + errors.join("; ") : ""));
      return value;
    };
    let result;
    try {
      result = original.apply(this, arguments);
    } catch (error) {
      note(tag, "threw after " + (Date.now() - started) + " ms: " + errorText(error));
      throw error;
    }
    if (result && typeof result.then === "function") {
      return result.then(finish, (error) => {
        note(tag, "rejected after " + (Date.now() - started) + " ms: " + errorText(error));
        throw error;
      });
    }
    return finish(result);
  });
}

// suspendHistory/resumeHistory of a modal scope's context
const tracedHostControls = new WeakSet();
function traceHostControl(context) {
  const hostControl = context && context.hostControl;
  if (!hostControl || tracedHostControls.has(hostControl)) return;
  tracedHostControls.add(hostControl);
  ["suspendHistory", "resumeHistory"].forEach((key) => {
    const original = hostControl[key];
    if (typeof original !== "function") return;
    replace(hostControl, key, function (...args) {
      const tag = "history#" + ++sequence;
      note(tag, key + " " + json(args, 300));
      const started = Date.now();
      return Promise.resolve(original.apply(hostControl, args)).then((value) => {
        note(tag, "done " + (Date.now() - started) + " ms");
        return value;
      }, (error) => {
        note(tag, "failed after " + (Date.now() - started) + " ms: " + errorText(error));
        throw error;
      });
    });
  });
}

function traceExecuteAsModal() {
  const original = ps.core.executeAsModal;
  if (typeof original !== "function") return;
  replace(ps.core, "executeAsModal", function (fn, options) {
    const tag = "modal#" + ++sequence;
    const name = (options && options.commandName) || "?";
    note(tag, "request \"" + name + "\"");
    const requested = Date.now();
    let started = 0;
    const scope = function (context) {
      started = Date.now();
      note(tag, "start \"" + name + "\" (waited " + (started - requested) + " ms)");
      traceHostControl(context);
      return fn.apply(this, arguments);
    };
    return Promise.resolve(original.call(this, scope, options)).then((value) => {
      note(tag, "end \"" + name + "\" " + (Date.now() - (started || requested)) + " ms");
      return value;
    }, (error) => {
      note(tag, "failed \"" + name + "\" after " + (Date.now() - (started || requested)) + " ms: " + errorText(error));
      throw error;
    });
  });
}

function traceImaging() {
  const imaging = ps.imaging;
  if (!imaging) return;
  Object.getOwnPropertyNames(imaging).forEach((key) => {
    const original = imaging[key];
    if (typeof original !== "function") return;
    replace(imaging, key, function (...args) {
      const tag = "imaging#" + ++sequence;
      note(tag, key + " " + json(args, 400));
      const started = Date.now();
      let result;
      try {
        result = original.apply(imaging, args);
      } catch (error) {
        note(tag, "threw after " + (Date.now() - started) + " ms: " + errorText(error));
        throw error;
      }
      if (!result || typeof result.then !== "function") return result;
      return result.then((value) => {
        note(tag, "done " + (Date.now() - started) + " ms");
        return value;
      }, (error) => {
        note(tag, "rejected after " + (Date.now() - started) + " ms: " + errorText(error));
        throw error;
      });
    });
  });
}

// Photoshop events reaching TypeR: what happened right before a call
const tracedListeners = new Map();
function traceNotifications() {
  const add = ps.action.addNotificationListener;
  const remove = ps.action.removeNotificationListener;
  if (typeof add !== "function") return;
  replace(ps.action, "addNotificationListener", function (events, listener) {
    let traced = tracedListeners.get(listener);
    if (!traced) {
      traced = function (event, descriptor) {
        note("event", event + " " + json(descriptor, MAX_GET_DETAIL));
        return listener.apply(this, arguments);
      };
      tracedListeners.set(listener, traced);
    }
    return add.call(this, events, traced);
  });
  if (typeof remove !== "function") return;
  replace(ps.action, "removeNotificationListener", function (events, listener) {
    return remove.call(this, events, tracedListeners.get(listener) || listener);
  });
}

function traceConsoleErrors() {
  const original = console.error;
  console.error = function (...args) {
    note("console.error", args.map((arg) => (arg && arg.stack ? errorText(arg) : typeof arg === "string" ? clip(arg, 600) : json(arg, 400))).join(" "));
    return original.apply(console, args);
  };
}

/* ========================= lifecycle ========================= */

function install() {
  if (installed) return;
  installed = true;
  note("session", "crash trace installed", {
    platform: os.platform(),
    release: typeof os.release === "function" ? os.release() : "",
    arch: typeof os.arch === "function" ? os.arch() : "",
  });
  traceBatchPlay();
  traceExecuteAsModal();
  traceImaging();
  traceNotifications();
  traceConsoleErrors();
}

// Opens this session's file once the storage root is known, writes what was
// noted until then, and keeps the newest KEEP_FILES sessions
async function open(storageRoot, info = {}) {
  if (!installed || target) return targetPath;
  const folder = files.joinPath(storageRoot, FOLDER);
  try {
    await files.ensureFolder(folder);
    const old = (await files.listFolder(folder))
      .filter((entry) => !entry.isFolder && /^crash-trace-.*\.log$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const stale = old.slice(0, Math.max(0, old.length - (KEEP_FILES - 1)));
    for (const name of stale) await files.remove(files.joinPath(folder, name));
  } catch (error) {}
  targetBase = files.joinPath(folder, "crash-trace-" + fileStamp());
  targetPath = targetBase + ".log";
  target = files.toUrl(targetPath);
  note("session", "file " + targetPath, info);
  const queued = pending.splice(0, pending.length);
  queued.forEach(write);
  notePhotoshopVersion(10);
  console.log("TypeR: crash trace written to " + targetPath);
  return targetPath;
}

function readPhotoshopVersion() {
  try {
    if (ps.app && ps.app.version) return String(ps.app.version);
  } catch (error) {}
  try {
    const [reply] = ps.action.batchPlay([{
      _obj: "get",
      _target: [{ _property: "hostVersion" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "silent" },
    }], { synchronousExecution: true });
    const version = reply && reply.hostVersion;
    if (version) return version.versionMajor + "." + version.versionMinor + "." + version.versionFix;
  } catch (error) {}
  return "";
}

// Photoshop may not answer yet while the plugin starts with it
function notePhotoshopVersion(attempts) {
  const version = readPhotoshopVersion();
  if (version) {
    note("session", "photoshop " + version);
  } else if (attempts > 1) {
    setTimeout(() => notePhotoshopVersion(attempts - 1), 3000);
  } else {
    note("session", "photoshop version unknown");
  }
}

module.exports = { install, open, note, clip, json, errorText, getPath: () => targetPath };
