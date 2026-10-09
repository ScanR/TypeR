// File access for the panel. The CEP panel read and wrote files synchronously
// through cep.fs and Node; the WebView has neither, so it keeps a mirror of
// its own files (storage, profiles, backgrounds, locales) that this module
// fills at start and persists afterwards, and it reaches any other file
// through the asynchronous calls below.
//
// The panel's files live in a folder of their own instead of the plugin data
// folder: Photoshop scopes that one by major version (PluginsStorage/PHSP/27),
// so every Photoshop upgrade would start TypeR from an empty storage.
const uxp = require("uxp");
const os = require("os");

const fs = require("fs");
const lfs = uxp.storage.localFileSystem;
const { formats } = uxp.storage;

const isWindows = () => os.platform() === "win32";
const SEP = () => (isWindows() ? "\\" : "/");

function joinPath(...parts) {
  const sep = SEP();
  return parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map((part, index) => {
      let value = String(part);
      if (index > 0) value = value.replace(/^[\\/]+/, "");
      return value.replace(/[\\/]+$/, "");
    })
    .join(sep);
}

function dirname(path) {
  const value = String(path).replace(/[\\/]+$/, "");
  const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return index <= 0 ? value.slice(0, index + 1) : value.slice(0, index);
}

function basename(path) {
  const value = String(path).replace(/[\\/]+$/, "");
  const index = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return value.slice(index + 1);
}

function toUrl(path) {
  if (/^file:/.test(path)) return path;
  if (isWindows()) return "file:/" + String(path).replace(/\\/g, "/");
  return "file:" + path;
}

function getStorageRoot() {
  const home = os.homedir();
  if (isWindows()) return joinPath(home, "AppData", "Roaming", "TypeR", "UXP");
  return joinPath(home, "Library", "Application Support", "TypeR", "UXP");
}

// Where install scripts put the CEP extension: its storage is imported once
async function getCepStorageRoots() {
  const home = os.homedir();
  if (isWindows()) {
    return [joinPath(home, "AppData", "Roaming", "Adobe", "CEP", "extensions", "typertools")];
  }
  return [
    joinPath(home, "Library", "Application Support", "Adobe", "CEP", "extensions", "typertools"),
    "/Library/Application Support/Adobe/CEP/extensions/typertools",
  ];
}

async function entryForPath(path) {
  return lfs.getEntryWithUrl(toUrl(path));
}

async function exists(path) {
  try {
    await entryForPath(path);
    return true;
  } catch (error) {
    return false;
  }
}

async function ensureFolder(path) {
  try {
    const entry = await entryForPath(path);
    if (entry.isFolder) return entry;
  } catch (error) {}
  const parent = dirname(path);
  if (parent && parent !== path) await ensureFolder(parent);
  try {
    await fs.mkdir(toUrl(path));
  } catch (error) {
    if (!(await exists(path))) throw error;
  }
  return entryForPath(path);
}

async function readText(path) {
  return fs.readFile(toUrl(path), { encoding: "utf-8" });
}

async function readBinary(path) {
  const buffer = await fs.readFile(toUrl(path));
  return new Uint8Array(buffer);
}

async function writeText(path, text) {
  await ensureFolder(dirname(path));
  await fs.writeFile(toUrl(path), String(text), { encoding: "utf-8" });
}

async function writeBinary(path, bytes) {
  await ensureFolder(dirname(path));
  const data = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await fs.writeFile(toUrl(path), data);
}

// Written next to the destination, then renamed over it: a Photoshop crash in
// the middle of a write never leaves a truncated storage file behind
async function writeTextAtomic(path, text) {
  await ensureFolder(dirname(path));
  const temporary = path + ".tmp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await fs.writeFile(toUrl(temporary), String(text), { encoding: "utf-8" });
  try {
    if (isWindows() && (await exists(path))) await fs.unlink(toUrl(path));
    await fs.rename(toUrl(temporary), toUrl(path));
  } catch (error) {
    try {
      await fs.unlink(toUrl(temporary));
    } catch (cleanupError) {}
    await fs.writeFile(toUrl(path), String(text), { encoding: "utf-8" });
  }
}

async function remove(path) {
  try {
    const entry = await entryForPath(path);
    await entry.delete();
    return true;
  } catch (error) {
    return !(await exists(path));
  }
}

async function removeTree(path) {
  let entry;
  try {
    entry = await entryForPath(path);
  } catch (error) {
    return true;
  }
  if (entry.isFolder) {
    const children = await entry.getEntries();
    for (const child of children) await removeTree(joinPath(path, child.name));
  }
  await entry.delete();
  return true;
}

async function listFolder(path) {
  const entry = await entryForPath(path);
  if (!entry.isFolder) return [];
  const children = await entry.getEntries();
  return children.map((child) => ({ name: child.name, isFolder: child.isFolder }));
}

// The panel's own files: everything the CEP panel wrote next to the extension
const MIRRORED_FILE = /^(storage[A-Za-z0-9._-]*|\.typer-update-test\.json)$/;
const isMirroredName = (name) => MIRRORED_FILE.test(name) && !/\.tmp-/.test(name);

async function loadMirror(root) {
  const files = {};
  let names = [];
  try {
    names = (await listFolder(root)).filter((child) => !child.isFolder).map((child) => child.name);
  } catch (error) {
    return files;
  }
  await Promise.all(names.filter(isMirroredName).map(async (name) => {
    try {
      files[name] = await readText(joinPath(root, name));
    } catch (error) {}
  }));
  return files;
}

// First start of the UXP plugin on a machine that ran the CEP version: its
// files are copied (never moved) so both versions keep working side by side
async function importCepStorage(root) {
  let existing = [];
  try {
    existing = (await listFolder(root)).map((child) => child.name);
  } catch (error) {}
  if (existing.includes("storage") || existing.includes("storage_profiles")) return false;
  for (const cepRoot of await getCepStorageRoots()) {
    const files = await loadMirror(cepRoot);
    if (!files.storage && !files.storage_profiles) continue;
    for (const name of Object.keys(files)) {
      if (/\.corrupt-|\.before-import$|^update-test/.test(name)) continue;
      await writeTextAtomic(joinPath(root, name), files[name]);
    }
    return cepRoot;
  }
  return false;
}

async function loadLocales() {
  const plugin = await lfs.getPluginFolder();
  const locales = {};
  const localeFolder = await plugin.getEntry("locale");
  await Promise.all((await localeFolder.getEntries()).map(async (entry) => {
    if (entry.isFile && entry.name === "messages.properties") {
      locales["locale/messages.properties"] = await entry.read({ format: formats.utf8 });
    } else if (entry.isFolder) {
      try {
        const messages = await entry.getEntry("messages.properties");
        locales["locale/" + entry.name + "/messages.properties"] = await messages.read({ format: formats.utf8 });
      } catch (error) {}
    }
  }));
  return locales;
}

// Persists the mirror: writes are queued per file and only the latest
// content of a file is written when several are waiting
function createMirrorWriter(root) {
  const pending = new Map();
  let running = Promise.resolve();
  let lastError = null;

  const flushOne = async (name) => {
    const job = pending.get(name);
    if (!job) return;
    pending.delete(name);
    try {
      if (job.remove) await remove(joinPath(root, name));
      else await writeTextAtomic(joinPath(root, name), job.text);
      lastError = null;
      job.resolve(true);
    } catch (error) {
      lastError = error;
      job.reject(error);
    }
  };

  const enqueue = (name, job) => {
    if (!isMirroredName(name)) return Promise.reject(new Error("Not a TypeR storage file: " + name));
    const previous = pending.get(name);
    return new Promise((resolve, reject) => {
      if (previous) {
        // The newer content supersedes the queued one: both callers settle
        // with the newer write
        const settle = { resolve, reject };
        const chainedResolve = previous.resolve;
        const chainedReject = previous.reject;
        job.resolve = (value) => { chainedResolve(value); settle.resolve(value); };
        job.reject = (error) => { chainedReject(error); settle.reject(error); };
        pending.set(name, job);
        return;
      }
      job.resolve = resolve;
      job.reject = reject;
      pending.set(name, job);
      running = running.then(() => flushOne(name));
    });
  };

  return {
    write: (name, text) => enqueue(name, { text: String(text) }),
    remove: (name) => enqueue(name, { remove: true }),
    flush: () => running,
    lastError: () => lastError,
  };
}

module.exports = {
  joinPath,
  dirname,
  basename,
  toUrl,
  getStorageRoot,
  entryForPath,
  exists,
  ensureFolder,
  readText,
  readBinary,
  writeText,
  writeBinary,
  writeTextAtomic,
  remove,
  removeTree,
  listFolder,
  loadMirror,
  importCepStorage,
  loadLocales,
  createMirrorWriter,
  isMirroredName,
};
