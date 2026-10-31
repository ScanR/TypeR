// The script that swaps the UXP plugin without a Photoshop restart
// (app_src/uxpUpdateScript.js): what it does for each answer of Creative
// Cloud's plugin installer, run against a stand-in installer.
const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const load = require("./helpers/loadAppModule")();
const script = load("app_src/uxpUpdateScript.js");

const options = {
  upia: "C:\\Program Files\\Common Files\\Adobe\\UnifiedPluginInstallerAgent.exe",
  pluginName: "TypeR",
  pluginFolder: "com.scanr.typer_3.0.1",
  pluginsFolder: "C:\\Users\\Clément\\AppData\\Roaming\\Adobe\\UXP\\Plugins\\External",
  registry: "C:\\Users\\Clément\\AppData\\Roaming\\Adobe\\UXP\\PluginsInfo\\v1\\PS.json",
};

// Windows: cmd.exe reads a batch file in the console's code page, so the script
// must stay ASCII whatever the account name. Windows also runs the real batch
// against a stand-in installer, including the exit-0/no-output regression.
const batch = script.buildWindowsUpdateScript(options);
assert.ok(/^[\x00-\x7f]*$/.test(batch), "The Windows script is pure ASCII");
assert.ok(batch.indexOf("Clément") === -1, "The Windows script holds no user path");
assert.ok(batch.indexOf("%~dp0") !== -1);
assert.ok(batch.indexOf("%APPDATA%\\Adobe\\UXP\\PluginsInfo\\v1\\PS.json") !== -1);
assert.ok(/\r\n/.test(batch) && !/[^\r]\n/.test(batch), "The Windows script has CRLF line endings");
assert.ok(!/^timeout /m.test(batch), "timeout refuses to run without a console");
assert.ok(/^[\x00-\x7f]*$/.test(script.windowsUpdateCommand()));
assert.ok(script.windowsUpdateCommand().indexOf("%APPDATA%\\TypeR\\UXP\\update\\typer-update.cmd") !== -1);

if (process.platform === "win32") {
  require("./helpers/testWindowsUxpUpdate")(script, options);
  console.log("UXP update script tests passed (Windows: executed batch)");
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "typer l'update é-"));

// answers: one per call of the installer, { exit, output }
const run = (answers) => {
  const dir = fs.mkdtempSync(path.join(root, "case-"));
  const work = path.join(dir, "update");
  const pluginsFolder = path.join(dir, "External");
  const registry = path.join(dir, "PS.json");
  fs.mkdirSync(path.join(work, "fallback", options.pluginFolder), { recursive: true });
  fs.mkdirSync(pluginsFolder);
  fs.writeFileSync(path.join(work, "fallback", options.pluginFolder, "manifest.json"), "new");
  fs.writeFileSync(path.join(work, "fallback", "PS.json"), "new registry");
  fs.writeFileSync(path.join(work, "package.ccx"), "package");
  fs.writeFileSync(registry, "old registry");
  const calls = path.join(dir, "calls");
  const upia = path.join(dir, "fake upia");
  fs.writeFileSync(upia, [
    "#!/bin/sh",
    'echo "$1 $2" >> ' + JSON.stringify(calls),
    "n=$(wc -l < " + JSON.stringify(calls) + " | tr -d ' ')",
    "case $n in",
    ...answers.map((answer, index) => (index + 1) + ") echo " + JSON.stringify(answer.output) + "; exit " + answer.exit + " ;;"),
    "esac",
    "exit 9",
    "",
  ].join("\n"), { mode: 0o755 });
  const noWait = path.join(dir, "bin");
  fs.mkdirSync(noWait);
  fs.writeFileSync(path.join(noWait, "sleep"), "#!/bin/sh\n", { mode: 0o755 });
  const file = path.join(work, script.UPDATE_SCRIPT_MAC);
  fs.writeFileSync(file, script.buildMacUpdateScript({ ...options, upia, pluginsFolder, registry }));
  childProcess.execFileSync("sh", [file], { env: { ...process.env, PATH: noWait + ":" + process.env.PATH } });
  const statusFile = path.join(work, script.UPDATE_STATUS);
  return {
    started: fs.existsSync(path.join(work, script.UPDATE_STARTED)),
    status: fs.existsSync(statusFile) ? fs.readFileSync(statusFile, "utf8").trim() : null,
    calls: fs.readFileSync(calls, "utf8").trim().split("\n").map((line) => line.split(" ")[0]),
    fallbackFolder: fs.existsSync(path.join(pluginsFolder, options.pluginFolder, "manifest.json")),
    registry: fs.readFileSync(registry, "utf8"),
  };
};

const removed = { exit: 0, output: "Removal Successful for extension TypeR" };
const installed = { exit: 0, output: "Installation Successful for extension" };
// The installer's exit code does not tell
const removeFailed = { exit: 0, output: "Failed to remove TypeR, status = -406" };
const installFailed = { exit: 0, output: "Installation Failed" };
const installCrashed = { exit: 1, output: "" };

try {
  // Swapped: Photoshop replaces the plugin, nothing is left to read a status
  let result = run([removed, installed]);
  assert.deepStrictEqual(result.calls, ["--remove", "--install"]);
  assert.strictEqual(result.status, null);
  assert.strictEqual(result.started, true);
  assert.strictEqual(result.fallbackFolder, false);
  assert.strictEqual(result.registry, "old registry");

  // Not removed (a hand-made install): the plugin still runs and reads the status
  result = run([removeFailed, installed]);
  assert.deepStrictEqual(result.calls, ["--remove", "--install"]);
  assert.strictEqual(result.status, script.UPDATE_STATUS_RESTART);
  result = run([removeFailed, installFailed]);
  assert.strictEqual(result.status, script.UPDATE_STATUS_FAILED);
  assert.strictEqual(result.fallbackFolder, false);
  assert.strictEqual(result.registry, "old registry");

  // Removed, then the installer stumbles: it tries again
  result = run([removed, installFailed, installed]);
  assert.deepStrictEqual(result.calls, ["--remove", "--install", "--install"]);
  assert.strictEqual(result.fallbackFolder, false);

  // Removed, then the installer keeps failing: the plugin must not stay gone
  result = run([removed, installFailed, installCrashed, installFailed]);
  assert.deepStrictEqual(result.calls, ["--remove", "--install", "--install", "--install"]);
  assert.strictEqual(result.fallbackFolder, true);
  assert.strictEqual(result.registry, "new registry");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("UXP update script tests passed");
