const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const files = {};
function walk(relative) {
  const absolute = path.join(root, relative);
  if (fs.statSync(absolute).isDirectory()) fs.readdirSync(absolute).forEach(name => walk(relative + '/' + name));
  else files[relative] = fs.readFileSync(absolute);
}
['app', 'CSXS', 'icons', 'locale'].forEach(walk);
require('./helpers/loadAppModule')()('app_src/releasePackage.js').validateReleasePackage(files, bytes => crypto.createHash('sha256').update(bytes).digest('hex'), bytes => bytes.toString('utf8'), require('../package.json').version);
for (const flavor of ['legacy', 'modern']) {
  for (const name of ['modal-edit-folder', 'modal-edit-style', 'modal-export', 'modal-help', 'modal-settings', 'modal-update']) {
    assert(Object.keys(files).some(file => new RegExp('^app/' + flavor + '\\.' + name + '\\.[a-f0-9]{12}\\.index\\.js$').test(file)), 'Missing hashed chunk: ' + flavor + '/' + name);
  }
}
Object.keys(files).filter(name => /^app\/(legacy\..*\.js|index\.js)$/.test(name)).forEach(name => {
  acorn.parse(files[name].toString('utf8'), { ecmaVersion: 5 });
});
assert(Object.keys(files).filter(name => /[a-f0-9]{32}\.css$/.test(name)).length >= 2, 'Missing Topcoat themes');
console.log('Build artifacts, release inventory and ES5 compatibility verified');
