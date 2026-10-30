// Panel features that ran on CEP's Node runtime: file dialogs and files the
// user picks, the .zip export with font files, font installation and the
// update installer. Each one is a request the WebView sends to the host.
const uxp = require("uxp");
const os = require("os");
const fs = require("fs");
const { zipSync, unzipSync, strToU8, strFromU8 } = require("fflate");
const files = require("./files");
const { systemCall } = require("./jsx");
const { matchFontRef, normalize } = require("../../app_src/fontFileExport");
const { buildWindowsRegistrationScript } = require("../../app_src/fontInstaller");
const { installPluginFiles, pluginFolderName, stalePluginFolders } = require("../../app_src/uxpManualInstall");
const { legacyManifestWithName } = require("../../app_src/legacyPanelName");
const updateScript = require("../../app_src/uxpUpdateScript");

const PLUGIN_ID = "com.scanr.typer";

const lfs = uxp.storage.localFileSystem;
const isWindows = () => os.platform() === "win32";

let manifestVersion = null;
async function readManifestVersion() {
  if (manifestVersion) return manifestVersion;
  try {
    const plugin = await lfs.getPluginFolder();
    const manifest = await plugin.getEntry("manifest.json");
    manifestVersion = JSON.parse(await manifest.read({ format: uxp.storage.formats.utf8 })).version;
  } catch (error) {
    manifestVersion = "";
  }
  return manifestVersion;
}
readManifestVersion();

/* ========================== base64 ========================== */

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(String(text || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ========================== dialogs ========================= */

const cleanTypes = (types) => (Array.isArray(types) ? types : [])
  .map((type) => String(type || "").replace(/^\*?\./, "").trim())
  .filter(Boolean);

// cep.fs.showOpenDialogEx: native paths of the picked files or folder
async function showOpenDialog(options = {}) {
  if (options.directory) {
    const folder = await lfs.getFolder();
    return folder ? [folder.nativePath] : [];
  }
  const types = cleanTypes(options.types);
  const picked = await lfs.getFileForOpening({
    allowMultiple: !!options.multiple,
    types: types.length ? types : undefined,
  });
  if (!picked) return [];
  return (Array.isArray(picked) ? picked : [picked]).map((entry) => entry.nativePath);
}

// cep.fs.showSaveDialogEx: native path of the file to write, "" when cancelled
async function showSaveDialog(options = {}) {
  const types = cleanTypes(options.types);
  const entry = await lfs.getFileForSaving(String(options.defaultName || "TypeR.json"), {
    types: types.length ? types : undefined,
  });
  return entry ? entry.nativePath : "";
}

/* ======================= practice page ====================== */

// A guided tour's practice page (the What's new tour's, or the basics
// walkthrough's), copied to the temporary folder so a Save in Photoshop never
// targets the plugin's own (read-only) file
const PRACTICE_PAGES = ["typer-practice-page.png", "typer-basics-page.png"];

async function practicePagePath(name) {
  const page = PRACTICE_PAGES.indexOf(name) >= 0 ? name : PRACTICE_PAGES[0];
  const plugin = await lfs.getPluginFolder();
  const assets = await plugin.getEntry("assets");
  const source = await assets.getEntry(page);
  const temporary = await lfs.getTemporaryFolder();
  await source.copyTo(temporary, { overwrite: true });
  return (await temporary.getEntry(source.name)).nativePath;
}

/* ======================== user files ======================== */

async function readUserFile(path, encoding) {
  if (encoding === "Base64") return bytesToBase64(await files.readBinary(path));
  return files.readText(path);
}

async function writeUserFile(path, data, encoding) {
  if (encoding === "Base64") await files.writeBinary(path, base64ToBytes(data));
  else await files.writeText(path, data);
  return true;
}

async function deleteUserFile(path) {
  return files.remove(path);
}

async function stat(path) {
  try {
    const info = await fs.lstat(files.toUrl(path));
    return { exists: true, isFile: info.isFile(), isDirectory: info.isDirectory(), size: info.size };
  } catch (error) {
    return { exists: false };
  }
}

/* ===================== font files (.zip) ==================== */

function fontDirs() {
  const home = os.homedir();
  if (isWindows()) {
    return [
      files.joinPath("C:\\Windows", "Fonts"),
      files.joinPath(home, "AppData", "Local", "Microsoft", "Windows", "Fonts"),
    ];
  }
  return [
    "/System/Library/Fonts",
    "/System/Library/Fonts/Supplemental",
    "/Library/Fonts",
    files.joinPath(home, "Library", "Fonts"),
  ];
}

const FONT_EXT_RE = /\.(ttf|otf|ttc|otc)$/i;

async function listFontFiles(dir, depth, out) {
  let entries;
  try {
    entries = await files.listFolder(dir);
  } catch (error) {
    return;
  }
  for (const entry of entries) {
    const full = files.joinPath(dir, entry.name);
    if (entry.isFolder) {
      if (depth < 3) await listFontFiles(full, depth + 1, out);
    } else if (FONT_EXT_RE.test(entry.name)) {
      out.push(full);
    }
  }
}

async function readAt(fd, position, length) {
  const buffer = new ArrayBuffer(length);
  const { bytesRead } = await fs.read(fd, buffer, 0, length, position);
  return new DataView(buffer, 0, bytesRead);
}

const ascii = (view, start, length) => {
  let text = "";
  for (let i = 0; i < length && start + i < view.byteLength; i++) text += String.fromCharCode(view.getUint8(start + i));
  return text;
};

// Name-table records (family, subfamily, full and PostScript names) of the
// sfnt at `base`; same reading as app_src/fontFileExport.js
async function parseSfntNames(fd, base, names) {
  const header = await readAt(fd, base, 12);
  if (header.byteLength < 12) return;
  const numTables = header.getUint16(4);
  if (!numTables || numTables > 512) return;
  const tableDir = await readAt(fd, base + 12, numTables * 16);
  for (let i = 0; i < numTables; i++) {
    const rec = i * 16;
    if (rec + 16 > tableDir.byteLength) return;
    if (ascii(tableDir, rec, 4) !== "name") continue;
    const tableOffset = tableDir.getUint32(rec + 8);
    const tableLength = tableDir.getUint32(rec + 12);
    if (tableLength < 6 || tableLength > 500000) return;
    const table = await readAt(fd, tableOffset, tableLength);
    if (table.byteLength < 6) return;
    const count = table.getUint16(2);
    const stringOffset = table.getUint16(4);
    for (let j = 0; j < count; j++) {
      const r = 6 + j * 12;
      if (r + 12 > table.byteLength) break;
      const platformID = table.getUint16(r);
      const nameID = table.getUint16(r + 6);
      if (nameID !== 1 && nameID !== 2 && nameID !== 4 && nameID !== 6) continue;
      const length = table.getUint16(r + 8);
      const offset = table.getUint16(r + 10);
      const start = stringOffset + offset;
      if (start + length > table.byteLength) continue;
      let value = "";
      if (platformID === 1) {
        for (let k = 0; k < length; k++) value += String.fromCharCode(table.getUint8(start + k));
      } else {
        for (let k = 0; k + 1 < length; k += 2) value += String.fromCharCode(table.getUint16(start + k));
      }
      if (value) names.push({ nameID, value });
    }
    return;
  }
}

async function readFontNames(file) {
  const names = [];
  let fd = null;
  try {
    fd = await fs.open(files.toUrl(file), "r");
    const magic = await readAt(fd, 0, 12);
    if (magic.byteLength < 12) return names;
    const tag = ascii(magic, 0, 4);
    if (tag === "ttcf") {
      const numFonts = Math.min(magic.getUint32(8), 64);
      const offsets = await readAt(fd, 12, numFonts * 4);
      for (let i = 0; i * 4 + 4 <= offsets.byteLength; i++) {
        await parseSfntNames(fd, offsets.getUint32(i * 4), names);
      }
    } else if (magic.getUint32(0) === 0x00010000 || tag === "OTTO" || tag === "true") {
      await parseSfntNames(fd, 0, names);
    }
  } catch (error) {
    // Unreadable or corrupt font file: skip it
  } finally {
    if (fd !== null) {
      try {
        await fs.close(fd);
      } catch (error) {}
    }
  }
  return names;
}

async function buildFontIndex() {
  const fontFiles = [];
  for (const dir of fontDirs()) await listFontFiles(dir, 0, fontFiles);
  const index = [];
  for (const file of fontFiles) {
    const names = await readFontNames(file);
    if (!names.length) continue;
    const entry = { file, postScript: new Set(), full: new Set(), familyStyle: new Set() };
    const families = [];
    const subfamilies = [];
    names.forEach(({ nameID, value }) => {
      const norm = normalize(value);
      if (!norm) return;
      if (nameID === 6) entry.postScript.add(norm);
      else if (nameID === 4) entry.full.add(norm);
      else if (nameID === 1) families.push(norm);
      else if (nameID === 2) subfamilies.push(norm);
    });
    families.forEach((family) => subfamilies.forEach((sub) => entry.familyStyle.add(family + "|" + sub)));
    index.push(entry);
  }
  return index;
}

async function exportZipWithFonts({ zipPath, jsonFileName, jsonString, fontRefs }) {
  try {
    const index = await buildFontIndex();
    const missing = [];
    const fontFiles = [];
    const seenFiles = new Set();
    (fontRefs || []).forEach((ref) => {
      const file = matchFontRef(index, ref);
      if (!file) missing.push(ref.label);
      else if (!seenFiles.has(file)) {
        seenFiles.add(file);
        fontFiles.push(file);
      }
    });
    const archive = { [jsonFileName]: strToU8(jsonString) };
    const usedNames = new Set();
    for (const file of fontFiles) {
      const base = files.basename(file);
      const dot = base.lastIndexOf(".");
      const ext = dot > 0 ? base.slice(dot) : "";
      let candidate = base;
      for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) {
        candidate = base.slice(0, base.length - ext.length) + "-" + n + ext;
      }
      usedNames.add(candidate.toLowerCase());
      archive["fonts/" + candidate] = await files.readBinary(file);
    }
    const target = /\.zip$/i.test(zipPath) ? zipPath : zipPath + ".zip";
    await files.writeBinary(target, zipSync(archive, { level: 6 }));
    return { ok: true, missing, fontCount: fontFiles.length };
  } catch (error) {
    return { ok: false, error: (error && error.message) || String(error) };
  }
}

/* ======================= font install ======================= */

const psSingleQuote = (value) => "'" + String(value).replace(/'/g, "''") + "'";

// files: [{saveName, registryName, base64}]; same locations as
// app_src/fontInstaller.js
async function installFonts(fontFiles, registrationScript) {
  const home = os.homedir();
  const dir = isWindows()
    ? files.joinPath(home, "AppData", "Local", "Microsoft", "Windows", "Fonts")
    : files.joinPath(home, "Library", "Fonts");
  await files.ensureFolder(dir);
  const installed = [];
  for (const file of fontFiles || []) {
    const target = files.joinPath(dir, file.saveName);
    await files.writeBinary(target, base64ToBytes(file.base64));
    installed.push({ path: target, registryName: file.registryName });
  }
  if (isWindows() && installed.length && registrationScript) {
    // Per-user registration (HKCU Fonts key + WM_FONTCHANGE), through the same
    // PowerShell script the CEP panel ran
    await files.resolveFolders();
    const scriptPath = files.joinPath(files.getStorageRoot(), "font-registration.ps1");
    await files.writeText(scriptPath, "\ufeff" + registrationScript(installed));
    await systemCall("powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + scriptPath + "\"");
  }
  return installed.length;
}

/* ======================== network ========================= */

// Requests the WebView refuses (CORS), made from the host; see
// uxp-src/web/domShims.js installFetchFallback
async function fetchUrl(url, options = {}) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error("Unsupported URL");
  const response = await fetch(String(url), {
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 100 * 1024 * 1024) throw new Error("Response too large");
  const headers = [];
  try {
    response.headers.forEach((value, key) => headers.push([key, value]));
  } catch (error) {}
  return { status: response.status, statusText: response.statusText, headers, base64: bytesToBase64(bytes) };
}

/* ========================= updates ========================== */

function upiaPath() {
  if (isWindows()) {
    return "C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";
  }
  return "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent";
}

// A release .ccx is checked before anything is installed: it must be a TypeR
// UXP package of the announced version
function validatePackage(bytes, expectedVersion, pluginId) {
  if (!bytes || bytes.length < 100 || bytes.length > 80 * 1024 * 1024) throw new Error("Invalid update size");
  const entries = unzipSync(bytes, { filter: (entry) => entry.name === "manifest.json" });
  if (!entries["manifest.json"]) throw new Error("Missing TypeR manifest");
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  if (manifest.id !== pluginId) throw new Error("Invalid TypeR identity");
  if (expectedVersion && manifest.version !== String(expectedVersion).replace(/^v/, "")) throw new Error("Release version mismatch");
  return manifest;
}

async function installUpdatePackage(base64, expectedVersion, options = {}) {
  const bytes = base64ToBytes(base64);
  const manifest = validatePackage(bytes, expectedVersion, PLUGIN_ID);
  const installer = upiaPath();
  // Through Creative Cloud's plugin installer, Photoshop swaps the plugin at
  // once and this call never returns (app_src/uxpUpdateScript.js). It returns
  // when the new version waits for Photoshop's next start. Without the
  // installer, or when it fails, the package is installed by hand, which needs
  // that restart too.
  const hasInstaller = !options.forceManual && await files.exists(installer);
  let packagePath = null;
  if (hasInstaller) {
    try {
      packagePath = await prepareUpdateFolder(bytes);
      if (await runUpdateScript(installer, manifest)) return { ok: true, method: "upia" };
    } catch (error) {
      console.error("TypeR: plugin installer", error);
    }
  }
  try {
    await installPluginManually(bytes);
    return { ok: true, method: "manual" };
  } catch (error) {
    console.error("TypeR: manual plugin installation", error);
    if (!packagePath) throw error;
  }
  await uxp.shell.openPath(packagePath);
  return { ok: true, method: "open" };
}

async function updateFolder() {
  await files.resolveFolders();
  return files.joinPath(files.getStorageRoot(), updateScript.UPDATE_FOLDER);
}

// The update folder is outside the plugin's, which the removal deletes. The
// files of the by-hand installation are ready in it for when the plugin is gone
// and the installer fails. They are prepared from the current registry, so an
// unreadable one stops here rather than later.
async function prepareUpdateFolder(bytes) {
  const folder = await updateFolder();
  await files.removeTree(folder);
  const packagePath = files.joinPath(folder, updateScript.UPDATE_PACKAGE);
  await files.writeBinary(packagePath, bytes);
  await writePluginFiles(bytes, files.joinPath(folder, updateScript.UPDATE_FALLBACK), (text) => (
    files.writeText(files.joinPath(folder, updateScript.UPDATE_FALLBACK, updateScript.UPDATE_REGISTRY), text)
  ));
  return packagePath;
}

// The script runs in the background: app.system would hold Photoshop's main
// thread until it returns. Returns true when the new version waits for
// Photoshop's next start, false when it was not installed.
async function runUpdateScript(installer, manifest) {
  const folder = await updateFolder();
  const { pluginsFolder, registry } = await files.getPluginInstallPaths();
  const options = { upia: installer, pluginName: manifest.name, pluginFolder: pluginFolderName(manifest), pluginsFolder, registry };
  if (isWindows()) {
    await files.writeText(files.joinPath(folder, updateScript.UPDATE_SCRIPT_WINDOWS), updateScript.buildWindowsUpdateScript(options));
    await systemCall(updateScript.windowsUpdateCommand());
  } else {
    const script = files.joinPath(folder, updateScript.UPDATE_SCRIPT_MAC);
    await files.writeText(script, updateScript.buildMacUpdateScript(options));
    await systemCall(updateScript.macUpdateCommand(script));
  }
  const started = Date.now();
  while (Date.now() - started < 120000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (Date.now() - started > 20000 && !(await files.exists(files.joinPath(folder, updateScript.UPDATE_STARTED)))) return false;
    let status = "";
    try {
      status = (await files.readText(files.joinPath(folder, updateScript.UPDATE_STATUS))).trim();
    } catch (error) {}
    if (status === updateScript.UPDATE_STATUS_RESTART) return true;
    if (status === updateScript.UPDATE_STATUS_FAILED) return false;
  }
  return false;
}

// Left by the update that installed this version
async function removeUpdateFolder() {
  await files.removeTree(await updateFolder());
}

async function writePluginFiles(bytes, pluginsFolder, writeRegistry) {
  const { registry } = await files.getPluginInstallPaths();
  await installPluginFiles(bytes, {
    pluginsFolder,
    join: files.joinPath,
    removeTree: files.removeTree,
    rename: files.rename,
    writeFile: files.writeBinary,
    readRegistry: async () => ((await files.exists(registry)) ? files.readText(registry) : ""),
    writeRegistry,
  });
}

async function installPluginManually(bytes) {
  const { pluginsFolder, registry } = await files.getPluginInstallPaths();
  await writePluginFiles(bytes, pluginsFolder, (text) => files.writeTextAtomic(registry, text));
}

// After an update installed by hand, the previous version's folder stays until
// Photoshop runs the new one. Creative Cloud's installer cleans up after itself.
async function removeStalePluginFolders(options = {}) {
  if (!options.forceManual && await files.exists(upiaPath())) return;
  const { pluginsFolder, registry } = await files.getPluginInstallPaths();
  if (!(await files.exists(registry))) return;
  const own = files.basename((await lfs.getPluginFolder()).nativePath);
  const names = (await files.listFolder(pluginsFolder)).map((child) => child.name);
  for (const name of stalePluginFolders(names, await files.readText(registry), own)) {
    await files.removeTree(files.joinPath(pluginsFolder, name));
  }
}

// This plugin is installed: a Legacy (CEP) panel still there is called
// "TypeR (old)" from Photoshop's next start (app_src/legacyPanelName.js). The
// shared /Library folder usually refuses it, which only leaves the name as it is.
async function renameLegacyPanel() {
  for (const root of await files.getCepStorageRoots()) {
    const manifest = files.joinPath(root, "CSXS", "manifest.xml");
    if (!(await files.exists(manifest))) continue;
    try {
      const text = await files.readText(manifest);
      const next = legacyManifestWithName(text, true);
      if (next !== text) await files.writeTextAtomic(manifest, next);
    } catch (error) {
      console.warn("TypeR: could not rename the Legacy panel", manifest, error);
    }
  }
}

module.exports = {
  pluginVersion: () => manifestVersion || "",
  removeStalePluginFolders,
  removeUpdateFolder,
  renameLegacyPanel,
  bytesToBase64,
  base64ToBytes,
  requests: {
    showOpenDialog,
    showSaveDialog,
    readUserFile,
    writeUserFile,
    deleteUserFile,
    stat,
    exportZipWithFonts,
    fetchUrl,
    installFonts: (fontFiles) => installFonts(fontFiles, buildWindowsRegistrationScript),
    installUpdatePackage,
    pluginVersion: () => readManifestVersion(),
    practicePagePath,
  },
  _internals: { buildFontIndex, readFontNames, validatePackage, psSingleQuote },
};
