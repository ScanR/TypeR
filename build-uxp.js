const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const root = __dirname;
const output = path.join(root, 'uxp');
// Every host module main.js requires must be listed here: the plugin folder is
// only what this script copies, and a missing module fails at load time.
for (const name of ['manifest.json', 'index.html', 'main.js', 'photoshop.js', 'preview.js', 'layers.js', 'textshaper.js', 'text-style.js', 'commands.js', 'global-keys.js', 'virtual-files.js']) {
  fs.copyFileSync(path.join(root, 'uxp-src', name), path.join(output, name));
}
if (process.platform === 'darwin') {
  const binary = path.join(root, 'uxp-src/typer-keys');
  execFileSync('clang', [
    '-Os', '-arch', 'arm64', '-arch', 'x86_64',
    '-framework', 'Cocoa', '-framework', 'CoreGraphics', '-framework', 'Carbon',
    path.join(root, 'uxp-src/typer-keys.m'),
    '-o', binary,
  ]);
  fs.chmodSync(binary, 0o755);
  // The plugin folder is never wiped, so a file an older build left there
  // survives forever: the helper used to be copied as a raw Mach-O, and the
  // plugin only reads the JSON below, so that copy is removed.
  fs.rmSync(path.join(output, 'typer-keys'), {force: true});
  // Creative Cloud rejects unsigned Mach-O inside a CCX, so ship it as JSON.
  fs.writeFileSync(path.join(output, 'typer-keys.json'), JSON.stringify(fs.readFileSync(binary).toString('base64')));
}
fs.cpSync(path.join(root, 'locale'), path.join(output, 'locale'), {recursive: true});
fs.cpSync(path.join(root, 'icons'), path.join(output, 'icons'), {recursive: true});
fs.copyFileSync(path.join(root, 'icons/iconNormal.png'), path.join(output, 'icons/iconNormal@1x.png'));
fs.copyFileSync(path.join(root, 'icons/iconNormal@2X.png'), path.join(output, 'icons/iconNormal@2x.png'));
fs.copyFileSync(path.join(root, 'LICENSE.md'), path.join(output, 'LICENSE.md'));
if (fs.existsSync(path.join(output, 'web/host.jsx'))) throw new Error('The UXP build must not contain an ExtendScript host.');
console.log('TypeR Silicon built in ' + output);
