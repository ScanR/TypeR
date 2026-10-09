const fs = require('fs');
const path = require('path');
const { zipSync, unzipSync } = require('fflate');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const files = {};
function walk(relative) {
  const absolute = path.join(root, relative);
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Symlink in release: ' + relative);
  if (fs.statSync(absolute).isDirectory()) fs.readdirSync(absolute).sort().forEach(name => walk(relative + '/' + name));
  else {
    const data = fs.readFileSync(absolute);
    files[relative] = relative.endsWith('.sh') ? [data, { os: 3, attrs: (0o100755 << 16) >>> 0 }] : data;
  }
}
['app', 'CSXS', 'icons', 'locale', 'install.ps1', 'install_mac.sh', 'install_win.cmd', 'install_uxp_mac.sh', 'install_uxp_win.cmd', 'update_typer_win.cmd', 'update_typer_mac.sh', 'README.md', 'LICENSE.md', 'CHANGELOG.md'].forEach(walk);
// The installers install the UXP plugin offline from the TypeR-UXP.ccx next
// to them (npm run package:uxp); --with-uxp makes it mandatory.
const uxpPackage = path.join(root, 'Releases', 'TypeR-UXP.ccx');
if (fs.existsSync(uxpPackage)) {
  const ccx = fs.readFileSync(uxpPackage);
  const uxpManifest = JSON.parse(Buffer.from(unzipSync(ccx)['manifest.json']).toString('utf8'));
  if (uxpManifest.id !== 'com.scanr.typer' || uxpManifest.version !== require('../package.json').version) throw new Error('Releases/TypeR-UXP.ccx is not TypeR ' + require('../package.json').version + ': run npm run package:uxp');
  files['TypeR-UXP.ccx'] = ccx;
} else if (process.argv.includes('--with-uxp')) {
  throw new Error('Missing Releases/TypeR-UXP.ccx: run npm run package:uxp');
}
const zip = zipSync(files, { level: 9 });
require('./helpers/loadAppModule')()('app_src/releasePackage.js').validateReleasePackage(unzipSync(zip), bytes => crypto.createHash('sha256').update(bytes).digest('hex'), bytes => Buffer.from(bytes).toString('utf8'), require('../package.json').version);
const directory = path.join(root, 'Releases');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'TypeR.zip'), zip);
fs.writeFileSync(path.join(directory, 'TypeR.zip.sha256'), crypto.createHash('sha256').update(zip).digest('hex') + '  TypeR.zip\n');
console.log('Release ready: Releases/TypeR.zip (' + zip.length + ' bytes)');
