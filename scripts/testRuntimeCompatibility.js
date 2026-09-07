const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('./helpers/loadAppModule')();
const { makeBuffer, allocateBuffer, makeDirectories } = load('app_src/nodeCompat.js');
const bootstrap = fs.readFileSync(path.resolve(__dirname, '../app_src/bootstrap.js'), 'utf8');
function choose(version, chrome) {
  let destination;
  vm.runInNewContext(bootstrap, { navigator: { userAgent: 'Chrome/' + chrome }, window: { __adobe_cep__: { getHostEnvironment: () => JSON.stringify({ appVersion: version }) }, location: { search: '?test=1', hash: '#test', replace: value => { destination = value; } } } });
  return destination;
}
assert.strictEqual(choose('16.0', 41), 'legacy.html?test=1#test');
assert.strictEqual(choose('20.0', 74), 'legacy.html?test=1#test');
assert.strictEqual(choose('21.0', 74), 'modern.html?test=1#test');
assert.strictEqual(choose('26.0', 41), 'legacy.html?test=1#test');
assert.strictEqual(choose('26.0', 120), 'modern.html?test=1#test');
function OldBuffer(value, encoding) { return typeof value === 'number' ? Buffer.allocUnsafe(value) : Buffer.from(value, encoding); }
assert.strictEqual(makeBuffer(OldBuffer, 'héllo', 'utf8').toString('utf8'), 'héllo');
assert.deepStrictEqual([...allocateBuffer(OldBuffer, 10)], Array(10).fill(0));
const dirs = new Set(['/']);
makeDirectories({ existsSync: name => dirs.has(name), statSync: () => ({ isDirectory: () => true }), mkdirSync: name => { assert(dirs.has(path.posix.dirname(name))); dirs.add(name); } }, path.posix, '/a/b/c');
assert(dirs.has('/a/b/c'));
console.log('Runtime compatibility tests passed');
