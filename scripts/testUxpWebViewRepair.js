const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createWebViewRepair } = require('../uxp-src/host/webViewRepair');

function fixture(platform = 'win32', failPath = 0) {
  const calls = [], writes = new Map(), waits = [];
  let paths = 0;
  const repair = createWebViewRepair({
    platform, source: '# fixture script', sourceId: '0123456789abcdef0123456789abcdef',
    files: {
      joinPath: (...parts) => parts.join('\\'), getRoamingAppData: async () => "D:\\Profiles\\L'ete & $(no) %name%",
      ensureFolder: async () => {}, readText: async name => writes.get(name),
      writeText: async (name, content) => writes.set(name, content),
    },
    runJsx: async code => {
      calls.push(code);
      if (code === 'app.path.fsName;') { if (++paths <= failPath) throw new Error('modal busy'); return "E:\\Adobe & O'Brien\\Photoshop"; }
      return 'OK';
    },
    runPowerShell: async (command, options) => { calls.push({ command, options }); return 0; },
    encodeBase64: value => Buffer.from(value, 'binary').toString('base64'), wait: async ms => waits.push(ms),
  });
  return { repair, calls, writes, waits };
}

(async () => {
  for (const [platform, kind] of [['darwin', 'storage'], ['win32', 'creation'], ['win32', 'timeout']]) {
    const test = fixture(platform);
    assert.strictEqual(await test.repair.start(kind), false);
    assert.strictEqual(test.calls.length, 0, 'unrelated failures and macOS must not launch Windows repair');
  }
  const test = fixture();
  assert.deepStrictEqual(await Promise.all([test.repair.start('storage'), test.repair.start('storage')]), [true, true]);
  assert.strictEqual(test.calls.length, 2, 'one path lookup and one launch, even with simultaneous requests');
  assert.strictEqual(test.writes.size, 1);
  const { command, options } = test.calls[1];
  assert.strictEqual(options.waitForExit, false, 'repair continues outside Photoshop without holding its main thread');
  assert(command.includes("L''ete & $(no) %name%"), 'PowerShell path quoting preserves metacharacters as literal data');
  assert(command.includes("O''Brien\\Photoshop\\Photoshop.exe'"));
  assert(command.includes('-Action Auto') && command.includes('-ReportPath'));
  assert(!test.calls.some(call => typeof call === 'string' && call.includes('app.system')), 'repair must never open a cmd bootstrap');
  const retry = fixture('win32', 2);
  assert.strictEqual(await retry.repair.start('storage'), true);
  assert.deepStrictEqual(retry.waits, [2000, 5000]);
  const failure = fixture('win32', 3);
  await assert.rejects(failure.repair.start('storage'), /modal busy/);
  assert.strictEqual(failure.calls.length, 3, 'launch retry is bounded');

  // Every host build gets the same source, including the cross-platform CCX
  // older clients select on Windows and the hybrid/addon package.
  const configs = require('../webpack.uxp.config');
  const source = fs.readFileSync(path.join(__dirname, '../installer/repair_uxp_webview_win.ps1'), 'utf8');
  const profiles = JSON.parse(source.match(/\$RepairProfiles = @'\r?\n([\s\S]*?)\r?\n'@ \| ConvertFrom-Json/)[1]);
  const hashes = profiles.flatMap(profile => [profile.originalHash, profile.patchedHash]);
  assert.strictEqual(new Set(hashes).size, hashes.length, 'ambiguous profile hashes must never select an arbitrary repair');
  for (const profile of profiles) {
    assert.match(profile.originalHash, /^[a-f0-9]{64}$/);
    assert.match(profile.patchedHash, /^[a-f0-9]{64}$/);
    assert.strictEqual(profile.before.length, profile.after.length, 'a repair must not move the PE sections');
    assert(profile.offset >= profile.functionOffset && profile.offset + profile.after.length / 2 <= profile.functionOffset + profile.functionSize);
  }
  for (const env of [{}, { mac: true }, { addon: true }]) {
    const host = configs(env, { mode: 'production' })[0];
    const definitions = host.plugins.find(p => p.definitions && p.definitions.TYPER_WEBVIEW_REPAIR_SCRIPT).definitions;
    assert.strictEqual(JSON.parse(definitions.TYPER_WEBVIEW_REPAIR_SCRIPT), source);
  }
  const powershell = process.env.TYPER_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : null);
  if (powershell) {
    for (const profile of profiles) {
      const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'testUxpWebViewRepair.ps1'), '-ProfileId', profile.id], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, String(result.error || '') + result.stdout + result.stderr);
      process.stdout.write(profile.id + ': ' + result.stdout);
    }
  } else {
    console.log('PowerShell repair tests skipped on this OS; set TYPER_POWERSHELL to run them.');
  }
  console.log('WebView repair: all package variants, refusal gating, launch quoting, concurrency and bounded retries passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
