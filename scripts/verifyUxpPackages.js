const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { unzipSync } = require('fflate');
const { verifiedBinary } = require('./buildKeysAddon');
const root = path.resolve(__dirname, '..');
for (const name of ['TypeR-UXP.ccx', 'TypeR-UXP-mac.ccx']) {
  const bytes = fs.readFileSync(path.join(root, 'Releases', name));
  const entries = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
  const host = Buffer.from(entries['host.js']).toString('utf8');
  assert.strictEqual(manifest.id, 'com.scanr.typer');
  assert.strictEqual(manifest.name, 'TypeR');
  assert.strictEqual(manifest.version, require('../package.json').version);
  assert(!Object.keys(entries).some(file => /typer-keys-win|\.(exe|ps1)$/i.test(file)));
  assert(!host.includes('TypeR Shortcuts.exe') && !host.includes('typer-keys-win.json'));
  if (name === 'TypeR-UXP.ccx') {
    assert.strictEqual(manifest.manifestVersion, 6);
    assert.strictEqual(manifest.requiredPermissions.enableAddon, true);
    assert.deepStrictEqual(manifest.addon, { name: 'typer-keys.uxpaddon' });
    assert(Buffer.from(entries['win/x64/typer-keys.uxpaddon']).equals(verifiedBinary()));
    assert(host.includes('TypeR UXP addon reader v1'));
    assert(!Object.keys(entries).some(file => file.startsWith('native/')));
  } else {
    assert.strictEqual(manifest.manifestVersion, 5);
    assert(!manifest.addon && !manifest.requiredPermissions.enableAddon);
    assert(entries['native/typer-keys.json']);
    assert(!Object.keys(entries).some(file => file.startsWith('win/')));
    assert(!host.includes('TypeR UXP addon reader v1'));
  }
  assert.strictEqual(fs.readFileSync(path.join(root, 'Releases', name + '.sha256'), 'utf8').trim(),
    crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + name);
}
console.log('Windows/macOS UXP packages verified: correct readers, manifests, checksums and no Windows EXE');
