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
  windows ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installer', 'install.ps1'), ...args] : [path.join(root, 'installer', 'install_mac.sh'), ...args],
  { encoding: 'utf8', input: '', env: { ...process.env, TYPER_INSTALL_SOURCE: root, ...env } },
);

const recommendation = (versions) => {
  // Windows PowerShell 5.1 drops empty environment values. A separator alone
  // represents an explicitly empty fixture without searching the real machine.
  const result = runInstaller([], { TYPER_INSTALL_PROBE: 'recommendation', TYPER_PHOTOSHOP_VERSIONS: windows && versions === '' ? ';' : versions });
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

  // Windows exercises the transaction and updater through isolated PowerShell
  // fixtures, including a simulated open Photoshop. Never touch Adobe installs.
  if (windows) {
    const checked = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'testInstallWindows.ps1')], { encoding: 'utf8', env: process.env });
    assert.strictEqual(checked.status, 0, checked.stderr + checked.stdout);
    process.stdout.write(checked.stdout);
  }

  // The installation by hand reads JSON with macOS's osascript: not on Linux
  if (process.platform === 'darwin') {
    const byHand = installUxp('by-hand', { TYPER_INSTALL_NO_UPIA: '1' });
    assert.strictEqual(byHand.result.status, 0, byHand.result.stderr + byHand.result.stdout);
    assert.strictEqual(byHand.installedByHand, true);
    assert.strictEqual(JSON.parse(fs.readFileSync(byHand.registry, 'utf8')).plugins[0].path, '$localPlugins/External/com.scanr.typer_3.1.0');
  }

  // An unreadable registry stops the installation rather than being replaced
  const brokenRoot = path.join(sandbox, 'broken', 'UXP');
  fs.mkdirSync(path.join(brokenRoot, 'PluginsInfo', 'v1'), { recursive: true });
  fs.writeFileSync(path.join(brokenRoot, 'PluginsInfo', 'v1', 'PS.json'), '{ not json');
  if (!windows) {
    const broken = runInstaller(['--uxp', packageFile], { TYPER_UXP_ROOT: brokenRoot, TYPER_INSTALL_TARGET: path.join(sandbox, 'broken', 'no-cep'), TYPER_INSTALL_NO_UPIA: '1' });
    assert.notStrictEqual(broken.status, 0, 'a broken PS.json is an error');
    assert.strictEqual(fs.readFileSync(path.join(brokenRoot, 'PluginsInfo', 'v1', 'PS.json'), 'utf8'), '{ not json', 'and it is left alone');
  }

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

    if (process.platform === 'darwin') {
      // The standalone updater, on a complete release archive. Its scripts sit
      // next to a stale plugin, which must not be the one installed.
      const updaterDir = path.join(sandbox, 'updater');
      fs.mkdirSync(path.join(updaterDir, 'installer'), { recursive: true });
      for (const name of ['update_typer_mac.sh', 'install_mac.sh']) fs.copyFileSync(path.join(root, 'installer', name), path.join(updaterDir, 'installer', name));
      fs.writeFileSync(path.join(updaterDir, 'TypeR-UXP.ccx'), zipSync({
        'manifest.json': strToU8(JSON.stringify({ id: 'com.scanr.typer', name: 'TypeR', version: '1.0.0', host: { app: 'PS', minVersion: '26.0.0' } })),
      }));
      const { REQUIRED_PACKAGE_FILES } = require('./helpers/loadAppModule')()('app_src/releasePackage.js');
      const released = Object.fromEntries(REQUIRED_PACKAGE_FILES.map((name) => [name, strToU8('new ' + name)]));
      released['CSXS/manifest.xml'] = strToU8('<ExtensionManifest ExtensionBundleId="com.scanr.typer" ExtensionBundleVersion="3.1.0"><Menu>TypeR</Menu><ExtensionList><Extension Id="typer" Version="3.1.0" /></ExtensionList></ExtensionManifest>');
      released['app/package.sha256'] = strToU8(Object.keys(released).sort().map((name) => crypto.createHash('sha256').update(released[name]).digest('hex') + '  ' + name).join('\n') + '\n');
      const archive = path.join(sandbox, 'release-3.1.0.zip');
      fs.writeFileSync(archive, zipSync({ ...released, 'TypeR-UXP.ccx': fs.readFileSync(packageFile) }));

      const TERMINAL_DRIVER = `
import os, pty, sys
pid, terminal = pty.fork()
if pid == 0:
    os.execvp(sys.argv[2], sys.argv[2:])
keys = sys.argv[1].encode()
output = b""
while True:
    try:
        chunk = os.read(terminal, 4096)
    except OSError:
        break
    if not chunk:
        break
    sys.stdout.buffer.write(chunk)
    output += chunk
    if keys and "\u2191".encode() in output:
        os.write(terminal, keys)
        keys = b""
sys.exit(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
`;

      const LEGACY_MANIFEST = '<Menu>TypeR</Menu><Extension Id="typer" Version="3.0.0" />';
      // The extracted archive, run without any path given: the double-click
      // file finds the installer, and the installer the files around its folder
      const extracted = path.join(sandbox, 'extracted');
      for (const [name, bytes] of Object.entries(released)) {
        fs.mkdirSync(path.dirname(path.join(extracted, name)), { recursive: true });
        fs.writeFileSync(path.join(extracted, name), bytes);
      }
      fs.cpSync(path.join(root, 'installer'), path.join(extracted, 'installer'), { recursive: true });
      fs.copyFileSync(commandFile, path.join(extracted, 'install_mac.command'));
      fs.copyFileSync(packageFile, path.join(extracted, 'TypeR-UXP.ccx'));
      const runExtracted = (args, name) => spawnSync(path.join(extracted, 'install_mac.command'), args, {
        encoding: 'utf8',
        input: '',
        env: { ...process.env, TYPER_INSTALL_SOURCE: undefined, TYPER_INSTALL_NO_UPIA: '1', TYPER_INSTALL_SKIP_DEBUG: '1', TYPER_INSTALL_TARGET: path.join(sandbox, name, 'cep'), TYPER_UXP_ROOT: path.join(sandbox, name, 'UXP') },
      });
      let fromArchive = runExtracted(['--legacy'], 'archive-legacy');
      assert.strictEqual(fromArchive.status, 0, fromArchive.stderr + fromArchive.stdout);
      assert.ok(fs.existsSync(path.join(sandbox, 'archive-legacy', 'cep', 'app', 'index.js')));
      fromArchive = runExtracted(['--uxp'], 'archive-uxp');
      assert.strictEqual(fromArchive.status, 0, fromArchive.stderr + fromArchive.stdout);
      assert.ok(fs.existsSync(path.join(sandbox, 'archive-uxp', 'UXP', 'Plugins', 'External', 'com.scanr.typer_3.1.0', 'web', 'index.js')), 'offline, from the package of the archive');

      let machines = 0;
      // A computer with Legacy and/or the plugin 3.0.0; `run` starts the updater on it
      const machine = ({ legacy, plugin }) => {
        const home = path.join(sandbox, 'machine-' + ++machines);
        const cep = path.join(home, 'cep');
        const uxpRoot = path.join(home, 'UXP');
        if (legacy) {
          fs.mkdirSync(path.join(cep, 'CSXS'), { recursive: true });
          fs.writeFileSync(path.join(cep, 'CSXS', 'manifest.xml'), LEGACY_MANIFEST);
        }
        if (plugin) {
          fs.mkdirSync(path.join(uxpRoot, 'Plugins', 'External', 'com.scanr.typer_3.0.0'), { recursive: true });
        } else {
          // An interrupted installation is not an installation
          fs.mkdirSync(path.join(uxpRoot, 'Plugins', 'External', 'com.scanr.typer_3.1.0.installing'), { recursive: true });
        }
        const env = {
          ...process.env,
          TERM: 'xterm',
          TYPER_UPDATE_ARCHIVE: archive,
          TYPER_UPDATE_TARGET: cep,
          TYPER_UPDATE_SKIP_DEBUG: '1',
          TYPER_UXP_ROOT: uxpRoot,
          TYPER_INSTALL_NO_UPIA: '1',
          TYPER_PHOTOSHOP_VERSIONS: 'Photoshop 2026=27.7.0',
        };
        const updater = path.join(updaterDir, 'installer', 'update_typer_mac.sh');
        return {
          run: (extraEnv) => spawnSync('bash', [updater], { encoding: 'utf8', input: '', env: { ...env, ...extraEnv } }),
          // In a real terminal, the keys are typed once the menu is on screen
          runInTerminal: (keys, extraEnv) => spawnSync('python3', ['-I', '-c', TERMINAL_DRIVER, keys, 'bash', updater], { encoding: 'utf8', input: '', timeout: 30000, env: { ...env, ...extraEnv } }),
          legacyManifest: () => {
            const file = path.join(cep, 'CSXS', 'manifest.xml');
            return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
          },
          pluginUpdated: () => fs.existsSync(path.join(uxpRoot, 'Plugins', 'External', 'com.scanr.typer_3.1.0', 'web', 'index.js')),
        };
      };
      const ok = (result) => assert.strictEqual(result.status, 0, result.stderr + result.stdout);

      // On the plugin only: no Legacy added next to it
      let computer = machine({ plugin: true });
      ok(computer.run());
      assert.strictEqual(computer.pluginUpdated(), true);
      assert.strictEqual(computer.legacyManifest(), null, 'no Legacy appears');

      // On both: both updated, and the Legacy panel keeps its "old" name
      computer = machine({ legacy: true, plugin: true });
      ok(computer.run());
      assert.strictEqual(computer.pluginUpdated(), true);
      assert.match(computer.legacyManifest(), /Version="3\.1\.0"/);
      assert.match(computer.legacyManifest(), /<Menu>TypeR \(old\)<\/Menu>/);

      // Legacy without a console: as before, whatever Photoshop can run
      computer = machine({ legacy: true });
      ok(computer.run());
      assert.strictEqual(computer.pluginUpdated(), false);
      assert.match(computer.legacyManifest(), /Version="3\.1\.0"/);

      // Legacy in a console, Photoshop can run the plugin: Enter takes the recommended plugin
      computer = machine({ legacy: true });
      ok(computer.runInTerminal('\r'));
      assert.strictEqual(computer.pluginUpdated(), true, 'Enter takes the plugin');
      assert.match(computer.legacyManifest(), /<Menu>TypeR \(old\)<\/Menu>/, 'Legacy is kept as it was, renamed');
      assert.match(computer.legacyManifest(), /Version="3\.0\.0"/);

      // The versions found: under each option of the menu, and said once updated
      computer = machine({ legacy: true });
      const shown = computer.runInTerminal('\r');
      ok(shown);
      assert.match(shown.stdout, /3\.0\.0\D+3\.1\.0/, 'the menu says which version it updates');
      computer = machine({ plugin: true });
      const told = computer.run();
      ok(told);
      assert.match(told.stdout, /3\.0\.0 → 3\.1\.0/, 'the end says what changed');
      const installedRoot = path.join(sandbox, 'versions');
      fs.mkdirSync(path.join(installedRoot, 'cep', 'CSXS'), { recursive: true });
      fs.writeFileSync(path.join(installedRoot, 'cep', 'CSXS', 'manifest.xml'), LEGACY_MANIFEST);
      for (const name of ['3.0.0', '3.10.0', '3.9.0', '4.0.0.installing']) fs.mkdirSync(path.join(installedRoot, 'UXP', 'Plugins', 'External', 'com.scanr.typer_' + name), { recursive: true });
      const found = runInstaller([], { TYPER_INSTALL_PROBE: 'installed', TYPER_INSTALL_TARGET: path.join(installedRoot, 'cep'), TYPER_UXP_ROOT: path.join(installedRoot, 'UXP') });
      assert.strictEqual(found.status, 0, found.stderr + found.stdout);
      assert.match(found.stdout, /legacy=3\.0\.0/);
      assert.match(found.stdout, /uxp=3\.10\.0/, 'the newest folder, compared as numbers, not an interrupted one');

      // 2 keeps Legacy (the second Enter answers "Photoshop is open" if it is), and Q changes nothing
      computer = machine({ legacy: true });
      ok(computer.runInTerminal('2\r\r'));
      assert.strictEqual(computer.pluginUpdated(), false);
      assert.match(computer.legacyManifest(), /Version="3\.1\.0"/);
      computer = machine({ legacy: true });
      assert.strictEqual(computer.runInTerminal('q').status, 130);
      assert.strictEqual(computer.pluginUpdated(), false);
      assert.strictEqual(computer.legacyManifest(), LEGACY_MANIFEST);

      // A Photoshop too old for the plugin: no question
      computer = machine({ legacy: true });
      ok(computer.runInTerminal('', { TYPER_PHOTOSHOP_VERSIONS: 'Photoshop 2024=25.12.0' }));
      assert.strictEqual(computer.pluginUpdated(), false);
      assert.match(computer.legacyManifest(), /Version="3\.1\.0"/);
    }

    // The one command install, from a local copy of a release
    const release = path.join(sandbox, 'release');
    fs.mkdirSync(release);
    const zip = Buffer.from(zipSync({ 'installer/install_mac.sh': strToU8('#!/bin/bash\necho "installer ran: $*"\n') }));
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

  // At the root of the archive, one file to run per system
  const released = /\[('app'.*?)\]\.forEach\(walk\)/.exec(fs.readFileSync(path.join(__dirname, 'buildRelease.js'), 'utf8'))[1];
  assert.deepStrictEqual(released.match(/'[^']*'/g).filter((name) => /\.(cmd|command|sh|ps1)'$/.test(name)).sort(), ["'install_mac.command'", "'install_win.cmd'"]);

  // Both the bash installer's messages and the PowerShell ones exist in every language
  const macText = fs.readFileSync(path.join(root, 'installer', 'install_mac.sh'), 'utf8');
  for (const name of ['TITLE', 'UXP_NAME', 'LEGACY_NAME', 'RECOMMENDED', 'KEYS', 'CANCELLED', 'PS_FOUND', 'PS_NONE', 'UXP_TOO_OLD', 'STATUS_UPDATE', 'STATUS_CURRENT', 'STATUS_NEWER', 'CHOOSE_UPDATE', 'UPDATED']) {
    for (const language of ['EN', 'FR', 'ES', 'PT']) assert.ok(macText.includes(`MSG_${name}_${language}=`), name + ' ' + language);
  }
  const winBytes = fs.readFileSync(path.join(root, 'installer', 'install.ps1'));
  assert.deepStrictEqual([...winBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5.1 misreads accents without a byte order mark');
  const winText = winBytes.toString('utf8');
  for (const name of ['title', 'uxp_name', 'legacy_name', 'recommended', 'keys', 'cancelled', 'ps_found', 'ps_none', 'uxp_too_old', 'status_update', 'status_current', 'status_newer', 'choose_update', 'updated']) {
    assert.strictEqual(winText.split(`$msg_${name} = `).length - 1, 4, name);
  }
  assert.ok(/^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(root, 'get.ps1'), 'utf8')), 'get.ps1 stays ASCII');
  assert.ok(/^[\x00-\x7f]*$/.test(fs.readFileSync(path.join(root, 'installer', 'update_typer_win.cmd'), 'utf8')), 'update_typer_win.cmd stays ASCII');
  console.log('TypeR installer tests passed');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
