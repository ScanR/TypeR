// Every file that carries the TypeR version must agree with package.json: the
// panel's config.js drives the update check and the Help window, the CEP
// manifest what Photoshop installs, and the CHANGELOG what is announced. The
// 3.0.3 packages shipped with config.js still at 3.0.2 and kept offering the
// update they already were.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const version = require('../package.json').version;
assert.match(version, /^\d+\.\d+\.\d+$/, 'package.json version');
assert.strictEqual(/appVersion:\s*"([^"]+)"/.exec(read('app_src/config.js'))[1], version, 'app_src/config.js appVersion');
assert.strictEqual(require('../package-lock.json').version, version, 'package-lock.json version');
const manifest = read('CSXS/manifest.xml');
assert.strictEqual(/ExtensionBundleVersion="([^"]+)"/.exec(manifest)[1], version, 'CSXS manifest bundle version');
assert.strictEqual(/<Extension Id="typer" Version="([^"]+)"/.exec(manifest)[1], version, 'CSXS manifest extension version');
assert.strictEqual(/^## (\S+)/m.exec(read('CHANGELOG.md'))[1], version, 'CHANGELOG first entry');
console.log('version consistency ok (' + version + ')');
