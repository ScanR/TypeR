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
  else files[relative] = fs.readFileSync(absolute);
}
['app', 'CSXS', 'icons', 'locale', 'install.ps1', 'install_mac.sh', 'install_win.cmd', 'update_typer_win.cmd', 'update_typer_mac.sh', 'README.md', 'LICENSE.md', 'CHANGELOG.md'].forEach(walk);
const zip = zipSync(files, { level: 9 });
require('./helpers/loadAppModule')()('app_src/releasePackage.js').validateReleasePackage(unzipSync(zip), bytes => crypto.createHash('sha256').update(bytes).digest('hex'), bytes => Buffer.from(bytes).toString('utf8'), require('../package.json').version);
const directory = path.join(root, 'Releases');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'TypeR.zip'), zip);
fs.writeFileSync(path.join(directory, 'TypeR.zip.sha256'), crypto.createHash('sha256').update(zip).digest('hex') + '  TypeR.zip\n');
console.log('Release ready: Releases/TypeR.zip (' + zip.length + ' bytes)');
