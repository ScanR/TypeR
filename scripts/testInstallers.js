// The installers' choices: which version is recommended, when Creative Cloud's
// plugin installer is used, and the one command install. The arrow menu itself
// needs a terminal and is tested by hand (see docs/uxp.md).
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { zipSync, strToU8 } = require('fflate');

const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'typer-installers-'));

const runInstaller = (args, env) => spawnSync(
  windows ? 'powershell.exe' : 'bash',
  windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'install.ps1'), ...args] : [path.join(root, 'install_mac.sh'), ...args],
  { encoding: 'utf8', input: '', env: { ...process.env, TYPER_INSTALL_SOURCE: root, ...env } },
);

const recommendation = (versions) => {
  const result = runInstaller([], { TYPER_INSTALL_PROBE: 'recommendation', TYPER_PHOTOSHOP_VERSIONS: versions });
  assert.strictEqual(result.status, 0, result.stderr + result.stdout);
  return /recommended=(.*)/.exec(result.stdout)[1].trim();
};

try {
  assert.strictEqual(recommendation('Photoshop 2026=27.7.0'), 'uxp');
  assert.strictEqual(recommendation('Photoshop 2025=26.0.0'), 'uxp', 'the first version UXP runs on');
  assert.strictEqual(recommendation('Photoshop 2024=25.12.0'), 'legacy', 'too old for UXP');
  assert.strictEqual(recommendation('Photoshop 2021=22.5.0;Photoshop 2026=27.7.0'), 'uxp', 'the newest one decides');
  assert.strictEqual(recommendation('Photoshop 2026=27.7.0;Photoshop 2021=22.5.0'), 'uxp', 'in any order');
  assert.strictEqual(recommendation(''), '', 'no Photoshop, no recommendation');
  assert.strictEqual(recommendation('Photoshop='), '', 'a version that cannot be read');

  // The search itself never stops the installer, whatever this machine has
  const searched = runInstaller([], { TYPER_INSTALL_PROBE: 'recommendation', TYPER_PHOTOSHOP_VERSIONS: undefined });
  assert.strictEqual(searched.status, 0, searched.stderr + searched.stdout);

  // A scripted installation never asks: it installs Legacy, as updates expect
  const scripted = runInstaller([], { TYPER_INSTALL_PROBE: 'choice', TYPER_PHOTOSHOP_VERSIONS: 'Photoshop 2026=27.7.0' });
  assert.strictEqual(scripted.status, 0, scripted.stderr + scripted.stdout);
  assert.match(scripted.stdout, /edition=legacy/);

  const packageFile = path.join(sandbox, 'TypeR-UXP.ccx');
  fs.writeFileSync(packageFile, zipSync({
    'manifest.json': strToU8(JSON.stringify({ id: 'com.scanr.typer', name: 'TypeR', version: '3.1.0', host: { app: 'PS', minVersion: '26.0.0' } })),
    'web/index.js': strToU8('// panel'),
  }));
  const installUxp = (name, env) => {
    const uxpRoot = path.join(sandbox, name, 'UXP');
    const result = runInstaller([windows ? '-Uxp' : '--uxp', packageFile], {
      TYPER_UXP_ROOT: uxpRoot,
      TYPER_INSTALL_TARGET: path.join(sandbox, name, 'no-cep'),
      ...env,
    });
    return { result, installedByHand: fs.existsSync(path.join(uxpRoot, 'Plugins', 'External', 'com.scanr.typer_3.1.0', 'web', 'index.js')), registry: path.join(uxpRoot, 'PluginsInfo', 'v1', 'PS.json') };
  };

  // The installation by hand reads JSON with macOS's osascript: not on Linux
  if (process.platform !== 'linux') {
    const byHand = installUxp('by-hand', { TYPER_INSTALL_NO_UPIA: '1' });
    assert.strictEqual(byHand.result.status, 0, byHand.result.stderr + byHand.result.stdout);
    assert.strictEqual(byHand.installedByHand, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(byHand.registry, 'utf8')).plugins[0].path, '$localPlugins/External/com.scanr.typer_3.1.0');
  }

  // An unreadable registry stops the installation rather than being replaced
  const brokenRoot = path.join(sandbox, 'broken', 'UXP');
  fs.mkdirSync(path.join(brokenRoot, 'PluginsInfo', 'v1'), { recursive: true });
  fs.writeFileSync(path.join(brokenRoot, 'PluginsInfo', 'v1', 'PS.json'), '{ not json');
  const broken = runInstaller([windows ? '-Uxp' : '--uxp', packageFile], { TYPER_UXP_ROOT: brokenRoot, TYPER_INSTALL_TARGET: path.join(sandbox, 'broken', 'no-cep'), TYPER_INSTALL_NO_UPIA: '1' });
  assert.notStrictEqual(broken.status, 0, 'a broken PS.json is an error');
  assert.strictEqual(fs.readFileSync(path.join(brokenRoot, 'PluginsInfo', 'v1', 'PS.json'), 'utf8'), '{ not json', 'and it is left alone');

  if (!windows) {
    // Stand-ins for Creative Cloud's plugin installer
    const standIn = (name, body) => {
      const file = path.join(sandbox, name);
      fs.writeFileSync(file, '#!/bin/bash\n' + body + '\n', { mode: 0o755 });
      return file;
    };
    const works = installUxp('works', { TYPER_INSTALL_UPIA: standIn('upia-works', 'echo "Installation Successful"') });
    assert.strictEqual(works.result.status, 0, works.result.stderr + works.result.stdout);
    assert.strictEqual(works.installedByHand, false, 'a working installer does the installation');

    if (process.platform === 'darwin') {
      const fails = installUxp('fails', { TYPER_INSTALL_UPIA: standIn('upia-fails', 'echo "Failed to install, status = -641!"; exit 0') });
      assert.strictEqual(fails.result.status, 0, fails.result.stderr + fails.result.stdout);
      assert.strictEqual(fails.installedByHand, true, 'a failure that exits with 0 falls back');

      const started = Date.now();
      const hangs = installUxp('hangs', { TYPER_INSTALL_UPIA: standIn('upia-hangs', 'exec sleep 30'), TYPER_INSTALL_UPIA_TIMEOUT: '1' });
      assert.strictEqual(hangs.result.status, 0, hangs.result.stderr + hangs.result.stdout);
      assert.strictEqual(hangs.installedByHand, true, 'a hanging installer falls back');
      assert.ok(Date.now() - started < 15000, 'without waiting for it');
    }

    // The file to double-click in Finder only starts the installer
    const commandFile = path.join(root, 'install_mac.command');
    assert.ok(fs.statSync(commandFile).mode & 0o111, 'Finder cannot open it otherwise');
    assert.ok(fs.readFileSync(path.join(__dirname, 'buildRelease.js'), 'utf8').includes("'install_mac.command'"), 'it ships in the archive');
    const commandRun = spawnSync(commandFile, [], { encoding: 'utf8', input: '', env: { ...process.env, TYPER_INSTALL_PROBE: 'choice', TYPER_INSTALL_SOURCE: root } });
    assert.strictEqual(commandRun.status, 0, commandRun.stderr);
    assert.match(commandRun.stdout, /edition=legacy/);

    // The one command install, from a local copy of a release
    const release = path.join(sandbox, 'release');
    fs.mkdirSync(release);
    const zip = Buffer.from(zipSync({ 'install_mac.sh': strToU8('#!/bin/bash\necho "installer ran: $*"\n') }));
    fs.writeFileSync(path.join(release, 'TypeR.zip'), zip);
    const runGet = () => spawnSync('bash', [path.join(root, 'get.sh'), '--uxp'], { encoding: 'utf8', input: '', env: { ...process.env, TYPER_RELEASE_URL: 'file://' + release } });
    let get = runGet();
    assert.strictEqual(get.status, 0, 'older releases have no checksum: ' + get.stderr);
    assert.match(get.stdout, /installer ran: --uxp/);
    fs.writeFileSync(path.join(release, 'TypeR.zip.sha256'), crypto.createHash('sha256').update(zip).digest('hex') + '  TypeR.zip\n');
    get = runGet();
    assert.strictEqual(get.status, 0, get.stderr);
    assert.match(get.stdout, /installer ran: --uxp/);
    fs.writeFileSync(path.join(release, 'TypeR.zip.sha256'), '0'.repeat(64) + '  TypeR.zip\n');
    get = runGet();
    assert.notStrictEqual(get.status, 0, 'a damaged download stops');
    assert.doesNotMatch(get.stdout, /installer ran/);
    assert.match(get.stderr, /damaged/);
  }

  // Both the bash installer's messages and the PowerShell ones exist in every language
  const macText = fs.readFileSync(path.join(root, 'install_mac.sh'), 'utf8');
  for (const name of ['TITLE', 'UXP_NAME', 'LEGACY_NAME', 'RECOMMENDED', 'KEYS', 'CANCELLED', 'PS_FOUND', 'PS_NONE', 'UXP_TOO_OLD']) {
    for (const language of ['EN', 'FR', 'ES', 'PT']) assert.ok(macText.includes(`MSG_${name}_${language}=`), name + ' ' + language);
  }
  const winBytes = fs.readFileSync(path.join(root, 'install.ps1'));
  assert.deepStrictEqual([...winBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5.1 misreads accents without a byte order mark');
  const winText = winBytes.toString('utf8');
  for (const name of ['title', 'uxp_name', 'legacy_name', 'recommended', 'keys', 'cancelled', 'ps_found', 'ps_none', 'uxp_too_old']) {
    assert.strictEqual(winText.split(`$msg_${name} = `).length - 1, 4, name);
  }
  assert.ok(/^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(root, 'get.ps1'), 'utf8')), 'get.ps1 stays ASCII');
  console.log('TypeR installer tests passed');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
