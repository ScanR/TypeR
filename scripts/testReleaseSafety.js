const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const load = require('./helpers/loadAppModule')();
const { validateReleasePackage, REQUIRED_PACKAGE_FILES, RELEASE_INSTALLER_FILES, UXP_PACKAGE_FILE, validateUxpManifest } = load('app_src/releasePackage.js');
const { installPackageFiles } = load('app_src/updateInstaller.js');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const decode = bytes => Buffer.from(bytes).toString('utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'typer-release-safety-'));
const files = Object.fromEntries(REQUIRED_PACKAGE_FILES.map(name => [name, Buffer.from('new ' + name)]));
files['CSXS/manifest.xml'] = Buffer.from('<ExtensionManifest ExtensionBundleId="com.scanr.typer" ExtensionBundleVersion="3.0.0"><ExtensionList><Extension Id="typer" Version="3.0.0" /></ExtensionList></ExtensionManifest>');
files['app/legacy.chunk.123.js'] = Buffer.from('lazy chunk');
files['app/package.sha256'] = Buffer.from(Object.keys(files).sort().map(name => hash(files[name]) + '  ' + name).join('\n') + '\n');
try {
  assert.deepStrictEqual(validateReleasePackage(files, hash, decode, 'v3.0.0'), files);
  assert.throws(() => validateReleasePackage(files, hash, decode, '3.1.0'), /version mismatch/);
  const missing = { ...files }; delete missing['app/legacy.chunk.123.js'];
  assert.throws(() => validateReleasePackage(missing, hash, decode), /checksum mismatch/);
  assert.throws(() => validateReleasePackage({ ...files, 'app/index.js': Buffer.from('corrupt') }, hash, decode), /checksum mismatch/);
  assert.throws(() => validateReleasePackage({ ...files, 'app/../storage': Buffer.from('bad') }, hash, decode), /Unsafe/);
  assert.throws(() => validateReleasePackage({ ...files, 'app/extra.js': Buffer.from('extra') }, hash, decode), /Unlisted/);
  // Both editions ship in the release: CEP files plus the UXP .ccx.
  assert(RELEASE_INSTALLER_FILES.includes(UXP_PACKAGE_FILE) && RELEASE_INSTALLER_FILES.includes('install_mac.sh') && RELEASE_INSTALLER_FILES.includes('install.ps1'));
  assert(/'TypeR-Silicon\.ccx'|UXP_PACKAGE_FILE/.test(fs.readFileSync(path.resolve(__dirname, 'buildRelease.js'), 'utf8')));
  const uxpManifest = { id: 'fr.scanr.typer.silicon', version: '3.0.3', host: { app: 'PS', minVersion: '26.0.0' } };
  assert.strictEqual(validateUxpManifest(JSON.stringify(uxpManifest), '3.0.3').host.minVersion, '26.0.0');
  assert.throws(() => validateUxpManifest(JSON.stringify(uxpManifest), '3.0.4'), /version mismatch/);
  assert.throws(() => validateUxpManifest(JSON.stringify({ ...uxpManifest, id: 'other' })), /identity/);
  assert.throws(() => validateUxpManifest('{'), /Invalid UXP manifest/);
  // The CEP-only validator ignores the .ccx at the release root.
  assert.deepStrictEqual(validateReleasePackage({ ...files, [UXP_PACKAGE_FILE]: Buffer.from('ccx') }, hash, decode), files);
  const source = path.join(root, 'source'), target = path.join(root, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'storage'), 'user settings');
  fs.mkdirSync(path.join(target, 'app'));
  fs.writeFileSync(path.join(target, 'app/index.js'), 'old entrypoint');
  fs.writeFileSync(path.join(target, 'app/old-hashed-chunk.js'), 'old lazy chunk');
  // Fail after earlier files were replaced, then verify complete rollback.
  let replacements = 0;
  const failingFs = Object.create(fs);
  failingFs.renameSync = (from, to) => {
    if (from.includes(path.join('new', 'app')) && ++replacements === 3) throw new Error('injected write failure');
    return fs.renameSync(from, to);
  };
  assert.throws(() => installPackageFiles(files, target, { fs: failingFs, path, Buffer }), /injected write failure/);
  assert.strictEqual(fs.readFileSync(path.join(target, 'app/index.js'), 'utf8'), 'old entrypoint');
  assert.strictEqual(fs.readFileSync(path.join(target, 'storage'), 'utf8'), 'user settings');
  assert(!fs.existsSync(path.join(target, 'app/legacy.html')));
  installPackageFiles(files, target, { fs, path, Buffer });
  assert.strictEqual(fs.readFileSync(path.join(target, 'app/old-hashed-chunk.js'), 'utf8'), 'old lazy chunk');
  assert(!fs.existsSync(path.join(target, '.typer-update-journal.json')));
  Object.keys(files).forEach(name => {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), files[name]);
  });
  const installer = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, '../install.ps1'), '-Silent']] : ['bash', [path.resolve(__dirname, '../install_mac.sh'), '--silent']];
  const runInstaller = () => spawnSync(installer[0], installer[1], { encoding: 'utf8', env: { ...process.env, TYPER_INSTALL_SOURCE: source, TYPER_INSTALL_TARGET: target, TYPER_INSTALL_SKIP_DEBUG: '1' } });
  const good = runInstaller(); assert.strictEqual(good.status, 0, good.stderr + good.stdout);
  assert.strictEqual(fs.readFileSync(path.join(target, 'storage'), 'utf8'), 'user settings');
  assert(!fs.existsSync(path.join(target, 'app/old-hashed-chunk.js')), 'offline installer replaces all owned folders');
  fs.writeFileSync(path.join(source, 'app/index.js'), 'broken');
  const bad = runInstaller(); assert.notStrictEqual(bad.status, 0);
  assert.strictEqual(fs.readFileSync(path.join(target, 'app/index.js'), 'utf8'), 'new app/index.js');
  fs.unlinkSync(path.join(source, 'app/package.sha256'));
  assert.notStrictEqual(runInstaller().status, 0);
  assert.strictEqual(fs.readFileSync(path.join(target, 'storage'), 'utf8'), 'user settings');
  if (process.platform === 'darwin') {
    // UXP edition: installs into a temporary HOME and merges PS.json.
    const { zipSync } = require('fflate');
    const home = path.join(root, 'home'), uxpSource = path.join(root, 'uxp-source');
    const uxpRoot = path.join(home, 'Library/Application Support/Adobe/UXP');
    const registry = path.join(uxpRoot, 'PluginsInfo/v1/PS.json');
    fs.mkdirSync(uxpSource); fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.mkdirSync(path.join(uxpRoot, 'Plugins/External/fr.scanr.typer.silicon_0.9.0'), { recursive: true });
    const other = { pluginId: 'com.example.other', name: 'Other', status: 'enabled', type: 'uxp', versionString: '1.0.0', path: '$localPlugins/External/com.example.other_1.0.0' };
    fs.writeFileSync(registry, JSON.stringify({ plugins: [other, { pluginId: 'fr.scanr.typer.silicon', versionString: '0.9.0' }] }));
    fs.writeFileSync(path.join(uxpSource, UXP_PACKAGE_FILE), zipSync({ 'manifest.json': Buffer.from(JSON.stringify(uxpManifest)), 'index.html': Buffer.from('<html></html>') }));
    const runUxp = (args, extra = {}) => spawnSync('bash', [path.resolve(__dirname, '../install_mac.sh'), ...args], { encoding: 'utf8', input: '', env: { ...process.env, HOME: home, TYPER_INSTALL_SOURCE: uxpSource, ...extra } });
    const uxp = runUxp(['--uxp']); assert.strictEqual(uxp.status, 0, uxp.stderr + uxp.stdout);
    const merged = JSON.parse(fs.readFileSync(registry, 'utf8')).plugins;
    assert.deepStrictEqual(merged[0], other, 'other UXP plugins are preserved');
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[1].path, '$localPlugins/External/fr.scanr.typer.silicon_3.0.3');
    assert.strictEqual(merged[1].hostMinVersion, '26.0.0');
    assert.deepStrictEqual(fs.readdirSync(path.join(uxpRoot, 'Plugins/External')), ['fr.scanr.typer.silicon_3.0.3']);
    fs.writeFileSync(registry, '{"plugins":{}}');
    assert.notStrictEqual(runUxp([], { TYPER_INSTALL_EDITION: 'uxp' }).status, 0);
    assert.strictEqual(fs.readFileSync(registry, 'utf8'), '{"plugins":{}}', 'unexpected PS.json is never overwritten');
    assert.deepStrictEqual(fs.readdirSync(path.join(uxpRoot, 'Plugins/External')), ['fr.scanr.typer.silicon_3.0.3'], 'failed UXP install leaves the previous plugin');
    assert.strictEqual(runUxp(['--uxp', '--cep']).status, 2);
  }
  console.log('Release safety tests passed: integrity, version, rollback, lazy chunks, UXP package and native installer');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
