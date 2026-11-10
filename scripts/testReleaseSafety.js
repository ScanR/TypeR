const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const load = require('./helpers/loadAppModule')();
const { validateReleasePackage, REQUIRED_PACKAGE_FILES } = load('app_src/releasePackage.js');
const { installPackageFiles, inventoryNames, removeStaleBuildFiles } = load('app_src/updateInstaller.js');
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
  // The hashed files of the version before the running one are removed; the
  // running version's, the new one's and anything that is not a build file stay
  const hashed = {
    'legacy.modal-help.aaaaaaaaaaaa.index.js': 'two versions ago', 'modern.457.bbbbbbbbbbbb.index.js.LICENSE.txt': 'two versions ago',
    'modern.modal-help.cccccccccccc.css': 'two versions ago', '0123456789abcdef0123456789abcdef.png': 'two versions ago',
    'legacy.modal-help.dddddddddddd.index.js': 'running version', 'modern.887.eeeeeeeeeeee.index.js': 'new version',
    'notes.txt': 'not a build file', 'legacy.index.js.LICENSE.txt': 'not hashed',
  };
  Object.keys(hashed).forEach(name => fs.writeFileSync(path.join(target, 'app', name), hashed[name]));
  fs.mkdirSync(path.join(target, 'app', 'fedcba9876543210fedcba9876543210.d'));
  const running = inventoryNames('\uFEFF' + 'a'.repeat(64) + '  app/legacy.modal-help.dddddddddddd.index.js\r\n' + 'b'.repeat(64) + '  app/index.js\r\n\r\n');
  assert.deepStrictEqual(Object.keys(running), ['app/legacy.modal-help.dddddddddddd.index.js', 'app/index.js']);
  assert.strictEqual(removeStaleBuildFiles(target, [running, { 'app/modern.887.eeeeeeeeeeee.index.js': true }], { fs, path }), 4);
  assert.deepStrictEqual(fs.readdirSync(path.join(target, 'app')).filter(name => name in hashed).sort(),
    ['legacy.index.js.LICENSE.txt', 'legacy.modal-help.dddddddddddd.index.js', 'modern.887.eeeeeeeeeeee.index.js', 'notes.txt']);
  assert(fs.existsSync(path.join(target, 'app', 'fedcba9876543210fedcba9876543210.d')), 'never a folder');
  assert.strictEqual(fs.readFileSync(path.join(target, 'app/old-hashed-chunk.js'), 'utf8'), 'old lazy chunk');
  assert.strictEqual(fs.readFileSync(path.join(target, 'storage'), 'utf8'), 'user settings');
  // Every hashed file of this build is recognized as one
  const built = path.resolve(__dirname, '..', 'app');
  if (fs.existsSync(built)) {
    const probe = path.join(root, 'probe');
    fs.mkdirSync(path.join(probe, 'app'), { recursive: true });
    const names = fs.readdirSync(built).filter(name => fs.statSync(path.join(built, name)).isFile());
    names.forEach(name => fs.writeFileSync(path.join(probe, 'app', name), ''));
    removeStaleBuildFiles(probe, [], { fs, path });
    const stable = ['host.jsx', 'index.html', 'index.js', 'package.sha256', 'legacy.css', 'legacy.html', 'legacy.index.js', 'legacy.index.js.LICENSE.txt', 'modern.css', 'modern.html', 'modern.index.js', 'modern.index.js.LICENSE.txt'];
    assert.deepStrictEqual(fs.readdirSync(path.join(probe, 'app')).sort(), names.filter(name => stable.includes(name)).sort(), 'only the files replaced in place have a stable name');
  }
  Object.keys(files).forEach(name => {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), files[name]);
  });
  const installer = process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, 'helpers/runWindowsInstallerFixture.ps1')]] : ['bash', [path.resolve(__dirname, '../installer/install_mac.sh'), '--silent']];
  const runInstaller = () => spawnSync(installer[0], installer[1], { encoding: 'utf8', env: { ...process.env, TYPER_INSTALL_SOURCE: source, TYPER_INSTALL_TARGET: target, TYPER_INSTALL_SKIP_DEBUG: '1' } });
  // Finder writes this file in a folder as soon as it is opened
  if (process.platform !== 'win32') fs.writeFileSync(path.join(source, 'locale/.DS_Store'), 'Finder');
  const good = runInstaller(); assert.strictEqual(good.status, 0, good.stderr + good.stdout);
  assert.strictEqual(fs.readFileSync(path.join(target, 'storage'), 'utf8'), 'user settings');
  assert(!fs.existsSync(path.join(target, 'app/old-hashed-chunk.js')), 'offline installer replaces all owned folders');
  fs.writeFileSync(path.join(source, 'app/index.js'), 'broken');
  const bad = runInstaller(); assert.notStrictEqual(bad.status, 0);
  assert.strictEqual(fs.readFileSync(path.join(target, 'app/index.js'), 'utf8'), 'new app/index.js');
  fs.unlinkSync(path.join(source, 'app/package.sha256'));
  assert.notStrictEqual(runInstaller().status, 0);
  assert.strictEqual(fs.readFileSync(path.join(target, 'storage'), 'utf8'), 'user settings');
  console.log('Release safety tests passed: integrity, version, rollback, lazy chunks and native installer');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
