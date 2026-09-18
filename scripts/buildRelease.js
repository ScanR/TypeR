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
const releasePackage = require('./helpers/loadAppModule')()('app_src/releasePackage.js');
// The installers offer both editions, so the UXP package must be built first
// (`npm run package:uxp`, on macOS so the native key helper is included).
const ccx = path.join(root, releasePackage.UXP_PACKAGE_FILE);
if (!fs.existsSync(ccx)) throw new Error('Missing ' + releasePackage.UXP_PACKAGE_FILE + ': run `npm run package:uxp` first');
const ccxManifest = unzipSync(fs.readFileSync(ccx))['manifest.json'];
if (!ccxManifest) throw new Error('Invalid ' + releasePackage.UXP_PACKAGE_FILE + ': no manifest.json');
const sourceUxpVersion = JSON.parse(fs.readFileSync(path.join(root, 'uxp-src/manifest.json'), 'utf8')).version;
releasePackage.validateUxpManifest(Buffer.from(ccxManifest).toString('utf8'), sourceUxpVersion);
['app', 'CSXS', 'icons', 'locale', 'install.ps1', 'install_mac.sh', 'install_win.cmd', 'update_typer_win.cmd', 'update_typer_mac.sh', releasePackage.UXP_PACKAGE_FILE, 'README.md', 'LICENSE.md', 'CHANGELOG.md'].forEach(walk);
const zip = zipSync(files, { level: 9 });
const released = unzipSync(zip);
releasePackage.validateReleasePackage(released, bytes => crypto.createHash('sha256').update(bytes).digest('hex'), bytes => Buffer.from(bytes).toString('utf8'), require('../package.json').version);
releasePackage.RELEASE_INSTALLER_FILES.forEach(name => { if (!released[name] || !released[name].length) throw new Error('Release is missing ' + name); });
const directory = path.join(root, 'Releases');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'TypeR.zip'), zip);
fs.writeFileSync(path.join(directory, 'TypeR.zip.sha256'), crypto.createHash('sha256').update(zip).digest('hex') + '  TypeR.zip\n');
console.log('Release ready: Releases/TypeR.zip (' + zip.length + ' bytes)');
