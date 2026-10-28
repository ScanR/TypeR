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

// Windows' roaming AppData (%APPDATA%) may be redirected away from the user
// profile (folder redirection, roaming profiles), and install.ps1 puts the
// CEP extension in it. UXP gives no access to the environment, but Photoshop
// keeps the plugin data folder in that same folder:
// <AppData>\Adobe\UXP\PluginsStorage\PHSP\<version>\External\<id>\PluginData
const roamingAppDataOf = (dataFolderPath) => {
  const match = /^(.+?)[\\/]Adobe[\\/]UXP[\\/]/i.exec(String(dataFolderPath || ""));
  return match ? match[1] : null;
};
let roamingAppData = null;
let resolvingFolders = null;

// getStorageRoot() and getCepStorageRoots() need it: awaited before them
function resolveFolders() {
  if (!resolvingFolders) {
    resolvingFolders = (async () => {
      if (!isWindows()) return;
      try {
        roamingAppData = roamingAppDataOf((await lfs.getDataFolder()).nativePath);
      } catch (error) {}
    })();
  }
  return resolvingFolders;
}

const profileRoamingAppData = () => joinPath(os.homedir(), "AppData", "Roaming");

function getStorageRoot() {
  if (isWindows()) return joinPath(roamingAppData || profileRoamingAppData(), "TypeR", "UXP");
  return joinPath(os.homedir(), "Library", "Application Support", "TypeR", "UXP");
}

// Where install scripts put the CEP extension: its storage is imported once
async function getCepStorageRoots() {
  const home = os.homedir();
  if (isWindows()) {
    await resolveFolders();
    const roots = [roamingAppData, profileRoamingAppData()]
      .filter(Boolean)
      .map((appData) => joinPath(appData, "Adobe", "CEP", "extensions", "typertools"));
    return roots.filter((root, index) => roots.findIndex((other) => other.toLowerCase() === root.toLowerCase()) === index);
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
// the middle of a write never leaves a truncated storage file behind.
// Windows cannot rename over an existing file: the original is first moved
// aside, put back if the new file cannot take its place, and deleted only
// once it has. A crash in between leaves it as "<name>.old-*", which
// recoverInterruptedWrites() restores at the next start.
async function writeTextAtomic(path, text) {
  await ensureFolder(dirname(path));
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const temporary = path + ".tmp-" + suffix;
  await fs.writeFile(toUrl(temporary), String(text), { encoding: "utf-8" });
  let previous = null;
  try {
    if (isWindows() && (await exists(path))) {
      await fs.rename(toUrl(path), toUrl(path + ".old-" + suffix));
      previous = path + ".old-" + suffix;
    }
    await fs.rename(toUrl(temporary), toUrl(path));
  } catch (error) {
    if (previous && !(await exists(path))) {
      try {
        await fs.rename(toUrl(previous), toUrl(path));
      } catch (restoreError) {}
    }
    try {
      await fs.unlink(toUrl(temporary));
    } catch (cleanupError) {}
    throw error;
  }
  if (previous) {
    try {
      await fs.unlink(toUrl(previous));
    } catch (cleanupError) {}
  }
}

// Leftovers of writes cut short by a crash: an original moved aside whose
// replacement never arrived is put back, every other leftover is deleted
const INTERRUPTED_WRITE = /^(.+)\.(tmp|old)-([0-9a-z]+)$/;

async function recoverInterruptedWrites(root) {
  let names = [];
  try {
    names = (await listFolder(root)).filter((child) => !child.isFolder).map((child) => child.name);
  } catch (error) {
    return;
  }
  const present = new Set(names);
  const leftovers = names.map((name) => INTERRUPTED_WRITE.exec(name)).filter(Boolean);
  // The most recent original first: it is the one to put back
  leftovers.sort((a, b) => (b[3] > a[3] ? 1 : b[3] < a[3] ? -1 : 0));
  for (const [name, target, kind] of leftovers) {
    try {
      if (kind === "old" && !present.has(target)) {
        await fs.rename(toUrl(joinPath(root, name)), toUrl(joinPath(root, target)));
        present.add(target);
      } else {
        await fs.unlink(toUrl(joinPath(root, name)));
      }
    } catch (error) {}
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
const isMirroredName = (name) => MIRRORED_FILE.test(name) && !/\.(tmp|old)-/.test(name);

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
// files are copied (never moved) so both versions keep working side by side.
// They are copied into a staging folder, marked complete, then moved in: an
// import cut short is finished at the next start (marked complete) or never
// reached the storage folder, and is never taken for a finished one.
const IMPORT_STAGING = ".cep-import";
const IMPORT_COMPLETE = ".complete";

async function moveStagedImport(root) {
  const staging = joinPath(root, IMPORT_STAGING);
  const manifest = JSON.parse(await readText(joinPath(staging, IMPORT_COMPLETE)));
  for (const name of manifest.files) {
    const source = joinPath(staging, name);
    // Already moved before an interruption
    if (!(await exists(source))) continue;
    const target = joinPath(root, name);
    if (isWindows() && (await exists(target))) await fs.unlink(toUrl(target));
    await fs.rename(toUrl(source), toUrl(target));
  }
  await removeTree(staging);
  return manifest.from || true;
}

async function importCepStorage(root) {
  const staging = joinPath(root, IMPORT_STAGING);
  if (await exists(joinPath(staging, IMPORT_COMPLETE))) return moveStagedImport(root);
  let existing = [];
  try {
    existing = (await listFolder(root)).map((child) => child.name);
  } catch (error) {}
  if (existing.includes("storage") || existing.includes("storage_profiles")) {
    // A copy cut short before it was complete, after which the panel started
    // its own storage: that storage is the user's now, it is not replaced
    if (existing.includes(IMPORT_STAGING)) await removeTree(staging);
    return false;
  }
  for (const cepRoot of await getCepStorageRoots()) {
    const files = await loadMirror(cepRoot);
    if (!files.storage && !files.storage_profiles) continue;
    await removeTree(staging);
    const names = Object.keys(files).filter((name) => !/\.corrupt-|\.before-import$|^update-test/.test(name));
    for (const name of names) await writeText(joinPath(staging, name), files[name]);
    await writeTextAtomic(joinPath(staging, IMPORT_COMPLETE), JSON.stringify({ from: cepRoot, files: names }));
    return moveStagedImport(root);
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

// Persists the mirror into root (a folder, or a function returning it):
// writes are queued per file and only the latest content of a file is
// written when several are waiting
function createMirrorWriter(root) {
  const rootOf = typeof root === "function" ? root : () => root;
  const pending = new Map();
  let running = Promise.resolve();
  const failures = new Map();

  const flushOne = async (name) => {
    const job = pending.get(name);
    if (!job) return;
    pending.delete(name);
    try {
      if (job.remove) {
        if (!(await remove(joinPath(rootOf(), name)))) throw new Error("Could not delete " + name);
      } else await writeTextAtomic(joinPath(rootOf(), name), job.text);
      failures.delete(name);
      job.waiters.forEach(waiter => waiter.resolve(true));
    } catch (error) {
      failures.set(name, { job, error });
      job.waiters.forEach(waiter => waiter.reject(error));
    }
  };

  const enqueue = (name, job) => {
    if (!isMirroredName(name)) return Promise.reject(new Error("Not a TypeR storage file: " + name));
    const previous = pending.get(name);
    return new Promise((resolve, reject) => {
      if (previous) {
        // The newer content supersedes the queued one: both callers settle
        // with the newer write
        job.waiters = previous.waiters;
        job.waiters.push({ resolve, reject });
        pending.set(name, job);
        return;
      }
      job.waiters = [{ resolve, reject }];
      pending.set(name, job);
      running = running.then(() => flushOne(name));
    });
  };

  return {
    write: (name, text) => enqueue(name, { text: String(text) }),
    remove: (name) => enqueue(name, { remove: true }),
    flush: async () => {
      // Include writes queued while waiting, then retry failed files once.
      // A successful write to another file cannot clear an earlier failure.
      let tail;
      do { tail = running; await tail; } while (tail !== running);
      const retries = Array.from(failures.entries()).map(([name, failure]) =>
        enqueue(name, { text: failure.job.text, remove: failure.job.remove })
      );
      await Promise.all(retries);
      do { tail = running; await tail; } while (tail !== running);
      if (failures.size) throw failures.values().next().value.error;
    },
    lastError: () => failures.size ? failures.values().next().value.error : null,
  };
}

module.exports = {
  joinPath,
  dirname,
  basename,
  toUrl,
  getStorageRoot,
  resolveFolders,
  roamingAppDataOf,
  getCepStorageRoots,
  entryForPath,
  exists,
  ensureFolder,
  readText,
  readBinary,
  writeText,
  writeBinary,
  writeTextAtomic,
  recoverInterruptedWrites,
  remove,
  removeTree,
  listFolder,
  loadMirror,
  importCepStorage,
  loadLocales,
  createMirrorWriter,
  isMirroredName,
};
