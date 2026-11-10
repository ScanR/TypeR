// The way from clients up to 3.0.0 to the Windows package: TypeR-UXP.ccx runs on
// every system and replaces itself on Windows (app_src/uxpPlatformPackage.js).
const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const { strToU8, zipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const { installPluginFiles, registeredPluginFolder, stalePluginFolders } = require("./helpers/loadAppModule")()("app_src/uxpManualInstall.js");

// keysHelper on a given system, with what it needs from UXP left out
const loadKeysHelper = (platform) => {
  const filename = path.join(root, "uxp-src/host/keysHelper.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const stubs = {
    os: { platform: () => platform },
    uxp: {},
    fs: {},
    "./files": { resolveFolders: () => { throw new Error("A reader was started"); } },
    "./keyboard": { setState() {} },
    "./jsx": {},
  };
  loaded.require = (name) => stubs[name];
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return loaded.exports;
};

async function main() {
  const onWindows = loadKeysHelper("win32");
  assert.strictEqual(await onWindows.start(() => {}), false, "No macOS reader on Windows");
  assert.strictEqual(onWindows.needsPlatformPackage(), true);
  assert.strictEqual(onWindows.needsPlatformPackage(), false, "A panel reload must not install it again");
  assert.strictEqual(loadKeysHelper("darwin").needsPlatformPackage(), false, "macOS keeps this package");

  // macOS: each Photoshop version has its own report, and a start stops the
  // reader of its own Photoshop only (the Windows reader names its file itself)
  const mac = loadKeysHelper("darwin")._internals;
  assert.strictEqual(mac.stateFileName("darwin", "27.7.0"), "state-27.7.0");
  assert.notStrictEqual(mac.stateFileName("darwin", "26.11.0"), mac.stateFileName("darwin", "27.7.0"));
  assert.strictEqual(mac.stateFileName("darwin", "27.7 (beta) x/y"), "state-27.7_beta_x_y");
  assert.strictEqual(mac.stateFileName("darwin", undefined), "state-0");
  assert.strictEqual(mac.stateFileName("win32", "27.7.0"), "state");
  if (process.platform === "darwin") {
    const { spawn, spawnSync } = require("child_process");
    const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "typer keys (test)+"));
    const reader = path.join(work, "typer-keys");
    fs.writeFileSync(reader, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    const commands = mac.macCommands(reader, path.join(work, "state-27.7.0"));
    // The shell below is this test's child, as app.system's is Photoshop's
    const start = (...args) => spawn(reader, args, { stdio: "ignore" });
    const own = start(path.join(work, "state-27.7.0"), String(process.pid));
    const ownLegacy = start(path.join(work, "state"), String(process.pid));
    const other = start(path.join(work, "state-26.11.0"), "999999");
    const alive = (child) => { try { process.kill(child.pid, 0); return child.exitCode === null && child.signalCode === null; } catch (error) { return false; } };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
    try {
      await settle();
      spawnSync("/bin/sh", ["-c", commands.stopOwn]);
      await settle();
      assert.strictEqual(alive(own), false, "this Photoshop's reader stops");
      assert.strictEqual(alive(ownLegacy), false, "and the one an earlier TypeR started for it");
      assert.strictEqual(alive(other), true, "another Photoshop keeps its reader");
      spawnSync("/bin/sh", ["-c", commands.stopAll]);
      await settle();
      assert.strictEqual(alive(other), false, "replacing the program stops every reader");
    } finally {
      [own, ownLegacy, other].forEach((child) => { try { child.kill("SIGKILL"); } catch (error) {} });
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  const { needsPlatformPackage, _internals } = require("../uxp-src/host/keysAddon");
  assert.strictEqual(needsPlatformPackage(), false, "The Windows package must not replace itself");

  // The reader of 3.0.0 keeps its program busy until its owner file changes
  const written = [];
  let busy = 2;
  let present = true;
  const oldFiles = {
    resolveFolders: async () => {},
    getStorageRoot: () => "root",
    joinPath: (...parts) => parts.join("/"),
    exists: async () => present,
    writeText: async (name, text) => written.push([name, text]),
    removeTree: async () => {
      if (busy-- > 0) throw new Error("busy");
      present = false;
    },
  };
  assert.strictEqual(await _internals.removeOldReader(oldFiles, async () => {}), true);
  assert.deepStrictEqual(written, [["root/keys/state.owner", "update"]]);
  assert.strictEqual(present, false);
  written.length = 0;
  assert.strictEqual(await _internals.removeOldReader(oldFiles, async () => {}), true, "Nothing left to remove");
  assert.deepStrictEqual(written, []);
  present = true;
  busy = Infinity;
  assert.strictEqual(await _internals.removeOldReader(oldFiles, async () => {}), false, "Still running: next start");

  // By hand, the package of the running version goes next to the running folder
  const pack = zipSync({
    "manifest.json": strToU8(JSON.stringify({ id: "com.scanr.typer", name: "TypeR", version: "3.0.1", host: { app: "PS", minVersion: "26.0.0" } })),
    "win/x64/typer-keys.uxpaddon": strToU8("addon"),
  });
  const install = async (ownFolder) => {
    const removed = [];
    const renamed = [];
    let registry = null;
    await installPluginFiles(pack, {
      ownFolder,
      platform: "win32",
      pluginsFolder: "External",
      join: (...parts) => parts.join("\\"),
      removeTree: async (name) => removed.push(name),
      rename: async (from, to) => renamed.push([from, to]),
      writeFile: async () => {},
      readRegistry: async () => JSON.stringify({ plugins: [{ pluginId: "com.scanr.typer", path: "$localPlugins\\External\\com.scanr.typer_3.0.1" }, { pluginId: "other" }] }),
      writeRegistry: async (text) => { registry = text; },
    });
    return { removed, renamed, registry };
  };
  const same = await install("com.scanr.typer_3.0.1");
  assert(!same.removed.includes("External\\com.scanr.typer_3.0.1"), "The running folder stays");
  assert.deepStrictEqual(same.renamed, [["External\\com.scanr.typer_3.0.1.win.installing", "External\\com.scanr.typer_3.0.1.win"]]);
  assert.strictEqual(registeredPluginFolder(same.registry), "com.scanr.typer_3.0.1.win");
  assert.strictEqual(JSON.parse(same.registry).plugins.length, 2, "Other plugins stay registered");
  assert.deepStrictEqual(stalePluginFolders(["com.scanr.typer_3.0.1", "com.scanr.typer_3.0.1.win"], same.registry, "com.scanr.typer_3.0.1.win"), ["com.scanr.typer_3.0.1"]);
  assert.deepStrictEqual(stalePluginFolders(["com.scanr.typer_3.0.1", "com.scanr.typer_3.0.1.win"], same.registry, "com.scanr.typer_3.0.1"), [], "Nothing removed before the restart");

  const other = await install("com.scanr.typer_3.0.0");
  assert.strictEqual(registeredPluginFolder(other.registry), "com.scanr.typer_3.0.1", "Another version keeps the usual name");

  console.log("UXP platform package: no reader on Windows, single swap, old reader removal and same-version install passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
