const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

module.exports = (script, options) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typer update é-"));
  const run = (answers, shortPath = false) => {
    const dir = fs.mkdtempSync(path.join(root, "case-"));
    const appData = path.join(dir, "roaming");
    const plugins = path.join(appData, "Adobe", "UXP", "Plugins", "External");
    const registry = path.join(appData, "Adobe", "UXP", "PluginsInfo", "v1", "PS.json");
    const work = path.join(dir, "update");
    const payload = path.join(work, "fallback", options.pluginFolder);
    const oldFolder = path.join(plugins, "com.scanr.typer_3.0.0");
    const manifest = { id: "com.scanr.typer", version: "3.0.1" };
    const other = { pluginId: "other", path: "unchanged" };
    const entry = (version) => ({ pluginId: manifest.id, versionString: version, status: "enabled", type: "uxp", path: "$localPlugins\\External\\com.scanr.typer_" + version });
    fs.mkdirSync(payload, { recursive: true });
    fs.mkdirSync(oldFolder, { recursive: true });
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.writeFileSync(path.join(payload, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(payload, "host.js"), "new code");
    fs.writeFileSync(path.join(oldFolder, "host.js"), "old code");
    const before = JSON.stringify({ plugins: [other, entry("3.0.0")] });
    const after = JSON.stringify({ plugins: [other, entry("3.0.1")] });
    fs.writeFileSync(registry, before);
    fs.writeFileSync(path.join(work, "fallback", "PS.json"), after);
    fs.writeFileSync(path.join(work, "package.ccx"), "package");
    fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify(answers));
    const fake = path.join(dir, "installer.cjs");
    fs.writeFileSync(fake, `
      const fs = require('fs'), path = require('path');
      const dir = process.env.TYPER_TEST_CASE;
      const callsFile = path.join(dir, 'calls.json');
      const calls = fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile)) : [];
      const answers = JSON.parse(fs.readFileSync(path.join(dir, 'answers.json')));
      const answer = answers[calls.length] || { exit: 9 };
      calls.push(process.argv[2]); fs.writeFileSync(callsFile, JSON.stringify(calls));
      const plugins = path.join(process.env.APPDATA, 'Adobe/UXP/Plugins/External');
      const registry = path.join(process.env.APPDATA, 'Adobe/UXP/PluginsInfo/v1/PS.json');
      if (!path.resolve(plugins).startsWith(path.resolve(dir) + path.sep)) throw new Error('Unsafe fixture app data');
      if (answer.removes) {
        const old = path.resolve(plugins, 'com.scanr.typer_3.0.0');
        if (!old.startsWith(path.resolve(dir) + path.sep)) throw new Error('Unsafe fixture path');
        fs.rmSync(old, { recursive: true, force: true });
        const data = JSON.parse(fs.readFileSync(registry));
        data.plugins = data.plugins.filter(p => p.pluginId !== 'com.scanr.typer');
        fs.writeFileSync(registry, JSON.stringify(data));
      }
      if (answer.installs) {
        const fallback = path.join(dir, 'update/fallback');
        const target = path.join(plugins, 'com.scanr.typer_3.0.1');
        fs.mkdirSync(target, { recursive: true });
        for (const name of ['manifest.json', 'host.js']) fs.copyFileSync(path.join(fallback, 'com.scanr.typer_3.0.1', name), path.join(target, name));
        const data = JSON.parse(fs.readFileSync(path.join(fallback, 'PS.json')));
        if (answer.badPath) data.plugins[1].path = '$localPlugins/External/com.scanr.typer_3.0.1';
        fs.writeFileSync(registry, JSON.stringify(data));
        if (answer.corrupt) fs.writeFileSync(path.join(target, 'host.js'), 'wrong code');
        if (answer.extraFile) fs.writeFileSync(path.join(target, 'stale.js'), 'stale');
      }
      process.stdout.write(answer.output || '');
      process.exit(answer.exit || 0);
    `);
    const upia = path.join(dir, "installer.cmd");
    fs.writeFileSync(upia, '@echo off\r\n"%TYPER_TEST_NODE%" "%TYPER_TEST_FAKE_JS%" %*\r\nexit /b %errorlevel%\r\n');
    const batch = path.join(work, script.UPDATE_SCRIPT_WINDOWS);
    // An environment reference keeps this fixture's accented user path out of
    // the ASCII batch, as the real fixed Program Files UPI path is.
    fs.writeFileSync(batch, script.buildWindowsUpdateScript({ ...options, upia: "%TYPER_TEST_UPIA%" }));
    const launch = shortPath
      ? "$script=(New-Object -ComObject Scripting.FileSystemObject).GetFile($env:TYPER_TEST_SCRIPT).ShortPath; & $script; exit $LASTEXITCODE"
      : "& $env:TYPER_TEST_SCRIPT; exit $LASTEXITCODE";
    childProcess.execFileSync("powershell.exe", ["-NoProfile", "-Command", launch], {
      encoding: "utf8", timeout: 60000, windowsHide: true,
      env: { ...process.env, APPDATA: appData, TYPER_TEST_CASE: dir, TYPER_TEST_UPIA: upia,
        TYPER_TEST_NODE: process.execPath, TYPER_TEST_FAKE_JS: fake, TYPER_TEST_SCRIPT: batch },
    });
    const status = path.join(work, script.UPDATE_STATUS);
    const installed = path.join(plugins, options.pluginFolder, "host.js");
    return {
      status: fs.existsSync(status) ? fs.readFileSync(status, "utf8").trim() : null,
      calls: JSON.parse(fs.readFileSync(path.join(dir, "calls.json"))),
      registry: fs.readFileSync(registry, "utf8"), before, after,
      code: fs.existsSync(installed) ? fs.readFileSync(installed, "utf8") : null,
      verification: fs.existsSync(path.join(work, "verify.log")) ? fs.readFileSync(path.join(work, "verify.log"), "utf8") : "",
      installerOutput: fs.readFileSync(path.join(work, "install.log"), "utf8"),
    };
  };
  try {
    // Actual Windows regression: silent exit 0 did not remove or install.
    let result = run([{}, {}]);
    assert.deepStrictEqual(result.calls, ["--remove", "--install"]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_FAILED);
    assert.strictEqual(result.registry, result.before);
    assert.strictEqual(result.code, null);
    result = run([{ output: "Removal Successful" }, { output: "Installation Successful" }]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_FAILED, "success text alone proves nothing");
    result = run([{}, { installs: true }]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_RESTART, "verified silent installation needs a restart if the old plugin was not removed: " + JSON.stringify(result));
    assert.strictEqual(result.registry, result.after);
    result = run([{}, { installs: true }], true);
    assert.strictEqual(result.status, script.UPDATE_STATUS_RESTART, "8.3 paths must verify the same installed files: " + JSON.stringify(result));
    assert.strictEqual(result.code, "new code");
    result = run([{ removes: true }, { installs: true }]);
    assert.strictEqual(result.status, null, "a verified swap lets Photoshop reload the plugin");
    assert.strictEqual(result.code, "new code");
    result = run([{ removes: true }, {}, {}, {}]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_RESTART, "after removal, repeated no-ops must install the prepared fallback");
    assert.strictEqual(result.registry, result.after);
    assert.strictEqual(result.code, "new code");
    result = run([{}, { installs: true, badPath: true }]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_FAILED, "the Windows-unloadable registration is rejected");
    result = run([{}, { installs: true, corrupt: true }]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_FAILED, "the installed version alone does not verify its files");
    result = run([{ removes: true }, { installs: true, extraFile: true }, {}, {}]);
    assert.strictEqual(result.status, script.UPDATE_STATUS_FAILED, "a fallback with stale files must not report success");
  } finally {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("typer update é-")) throw new Error("Unsafe fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
