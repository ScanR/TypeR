const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
// Clients up to 3.0.0 install the first .ccx with "typer" in its name, on any
// system (app_src/updateLogic.js)
assert(!/typer/i.test('UXP-Windows.ccx'));
const windowsReader = JSON.parse(fs.readFileSync(path.join(root, 'uxp-src/native/typer-keys-win.json'), 'utf8'));
const repairSource = fs.readFileSync(path.join(root, 'installer/repair_uxp_webview_win.ps1'), 'utf8');
const repairHash = crypto.createHash('sha256').update(repairSource).digest('hex');
for (const name of ['UXP-Windows.ccx', 'TypeR-UXP.ccx']) {
  const bytes = fs.readFileSync(path.join(root, 'Releases', name));
  const entries = unzipSync(bytes);
  const manifest = JSON.parse(Buffer.from(entries['manifest.json']).toString('utf8'));
  const host = Buffer.from(entries['host.js']).toString('utf8');
  assert(host.includes(JSON.stringify(repairSource)) && host.includes(repairHash), name + ': the current common repair must be embedded, including for old Windows updaters');
  assert.strictEqual(manifest.id, 'com.scanr.typer');
  assert.strictEqual(manifest.name, 'TypeR');
  assert.strictEqual(manifest.version, require('../package.json').version);
  // A .ccx carries no executable and no native addon: the readers ship base64-encoded
  assert(!Object.keys(entries).some(file => /\.(exe|ps1|uxpaddon)$/i.test(file) || file.startsWith('win/')));
  assert.strictEqual(manifest.manifestVersion, 5);
  assert(!manifest.addon && !manifest.requiredPermissions.enableAddon);
  assert(!host.includes('TypeR UXP addon reader v1'));
  if (name === 'UXP-Windows.ccx') {
    // "TypeR Shortcuts.exe" (uxp-src/native/typer-keys.cs), started by keysHelper.js
    const packed = JSON.parse(Buffer.from(entries['native/typer-keys-win.json']).toString('utf8'));
    const exe = Buffer.from(packed.binary, 'base64');
    assert.strictEqual(crypto.createHash('sha256').update(exe).digest('hex'), packed.sha256);
    assert.strictEqual(packed.sha256, windowsReader.sha256);
    assert.strictEqual(exe.readUInt16LE(0), 0x5A4D, 'The Windows reader is a Windows executable');
    assert(!entries['native/typer-keys.json']);
    assert(host.includes('TypeR Shortcuts.exe') && /WINDOWS_PACKAGE =\s*true && true;/.test(host));
  } else {
    assert(entries['native/typer-keys.json']);
    assert(!entries['native/typer-keys-win.json']);
    assert(!/WINDOWS_PACKAGE =\s*true && true;/.test(host), 'TypeR-UXP.ccx starts no reader on Windows');
    assert(/os\.platform\(\) !== "win32" \|\| WINDOWS_PACKAGE \|\| platformPackageAsked/.test(host), 'TypeR-UXP.ccx must replace itself on Windows');
  }
  assert.strictEqual(fs.readFileSync(path.join(root, 'Releases', name + '.sha256'), 'utf8').trim(),
    crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + name);
}
console.log('UXP packages verified: correct readers, manifests, checksums, and no executable or addon in a package');
