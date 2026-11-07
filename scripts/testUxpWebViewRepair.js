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
  const launchJs = test.calls[1];
  const literal = launchJs.slice('app.system('.length, launchJs.lastIndexOf(');'));
  const launch = JSON.parse(literal);
  assert.match(launch, /^start "" \/B powershell\.exe .* -WindowStyle Hidden -EncodedCommand [A-Za-z0-9+/=]+$/);
  const command = Buffer.from(launch.split(' ').pop(), 'base64').toString('utf16le');
  assert(command.includes("L''ete & $(no) %name%"), 'PowerShell path quoting preserves metacharacters as literal data');
  assert(command.includes("O''Brien\\Photoshop\\Photoshop.exe'"));
  assert(command.includes('-Action Auto') && command.includes('-ReportPath'));
  assert(!launch.includes('O\'Brien') && !launch.includes('$(no)'), 'cmd sees no user paths');
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
  for (const env of [{}, { mac: true }, { addon: true }]) {
    const host = configs(env, { mode: 'production' })[0];
    const definitions = host.plugins.find(p => p.definitions && p.definitions.TYPER_WEBVIEW_REPAIR_SCRIPT).definitions;
    assert.strictEqual(JSON.parse(definitions.TYPER_WEBVIEW_REPAIR_SCRIPT), source);
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'testUxpWebViewRepair.ps1')], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    process.stdout.write(result.stdout);
  }
  console.log('WebView repair: all package variants, refusal gating, launch quoting, concurrency and bounded retries passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
