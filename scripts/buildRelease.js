const fs = require('fs');
const path = require('path');
const { zipSync, unzipSync } = require('fflate');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const files = {};
function walk(relative) {
  const absolute = path.join(root, relative);
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Symlink in release: ' + relative);
  // Finder writes .DS_Store files in the folders it shows: never part of a release
  if (fs.statSync(absolute).isDirectory()) fs.readdirSync(absolute).filter(name => name !== '.DS_Store').sort().forEach(name => walk(relative + '/' + name));
  else files[relative] = fs.readFileSync(absolute);
}
// One file to run per system at the root of the archive, the rest in installer/
['app', 'CSXS', 'icons', 'locale', 'installer', 'install_mac.command', 'install_win.cmd', 'README.md', 'LICENSE.md', 'CHANGELOG.md'].forEach(walk);
// The installers install the UXP plugin offline from the archive's package for
// their system (npm run package:uxp); --with-uxp makes them mandatory. The
// updaters of 3.0.0 take TypeR-UXP.ccx on every system (app_src/updateLogic.js).
for (const name of ['UXP-Windows.ccx', 'TypeR-UXP.ccx']) {
const uxpPackage = path.join(root, 'Releases', name);
if (fs.existsSync(uxpPackage)) {
  const ccx = fs.readFileSync(uxpPackage);
  const uxpManifest = JSON.parse(Buffer.from(unzipSync(ccx)['manifest.json']).toString('utf8'));
  if (uxpManifest.id !== 'com.scanr.typer' || uxpManifest.version !== require('../package.json').version) throw new Error('Releases/' + name + ' is not TypeR ' + require('../package.json').version + ': run npm run package:uxp');
  if (name === 'UXP-Windows.ccx' && (!uxpManifest.addon || !uxpManifest.requiredPermissions.enableAddon)) throw new Error('Rebuild the Windows UXP package with its native addon');
  if (name === 'TypeR-UXP.ccx' && uxpManifest.addon) throw new Error('TypeR-UXP.ccx must run on every system: no native addon');
  files[name] = ccx;
} else if (process.argv.includes('--with-uxp')) {
  throw new Error('Missing Releases/' + name + ': run npm run package:uxp');
}
}
// The macOS scripts keep their executable mode: Finder cannot open a
// .command without it, and it spares users a chmod.
const zipEntries = {};
Object.keys(files).forEach(name => {
  zipEntries[name] = /\.(sh|command)$/.test(name) ? [files[name], { os: 3, attrs: 0o100755 << 16 }] : files[name];
});
const zip = zipSync(zipEntries, { level: 9 });
require('./helpers/loadAppModule')()('app_src/releasePackage.js').validateReleasePackage(unzipSync(zip), bytes => crypto.createHash('sha256').update(bytes).digest('hex'), bytes => Buffer.from(bytes).toString('utf8'), require('../package.json').version);
const directory = path.join(root, 'Releases');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'TypeR.zip'), zip);
fs.writeFileSync(path.join(directory, 'TypeR.zip.sha256'), crypto.createHash('sha256').update(zip).digest('hex') + '  TypeR.zip\n');
console.log('Release ready: Releases/TypeR.zip (' + zip.length + ' bytes)');
