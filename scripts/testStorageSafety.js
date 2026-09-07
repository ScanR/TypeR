const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const load = require('./helpers/loadAppModule')();
const { readJsonStorage, writeJsonStorage } = load('app_src/storageIO.js');
const files = new Map();
let failTarget = null;
const api = {
  ERR_NOT_FOUND: 3,
  readFile: p => files.has(p) ? { err: 0, data: files.get(p) } : { err: 3 },
  writeFile: (p, data) => { if (p === failTarget) return { err: 5 }; files.set(p, data); return { err: 0 }; },
};
files.set('storage', '{"text":"original",');
assert.strictEqual(readJsonStorage('storage', api).error, 'corrupt');
assert.strictEqual(writeJsonStorage('storage', { text: 'replacement' }, api, null), false);
assert.strictEqual(files.get('storage'), '{"text":"original",');
files.set('storage.bak', '{"text":"recovered"}');
assert.strictEqual(readJsonStorage('storage', api).data.text, 'recovered');
assert.strictEqual(writeJsonStorage('storage', { text: 'new' }, api, null), true);
assert([...files.keys()].some(p => p.startsWith('storage.corrupt-')));
assert.strictEqual(JSON.parse(files.get('storage.bak')).text, 'recovered');
failTarget = 'storage';
assert.strictEqual(writeJsonStorage('storage', { text: 'failed write' }, api, null), false);
assert.strictEqual(JSON.parse(files.get('storage')).text, 'new');
assert.strictEqual(JSON.parse(files.get('storage.bak')).text, 'new');
failTarget = 'storage.bak';
assert.strictEqual(writeJsonStorage('storage', { text: 'backup fails' }, api, null), false);
assert.strictEqual(JSON.parse(files.get('storage')).text, 'new');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typer-storage-test-'));
try {
  const file = path.join(dir, 'storage');
  const diskApi = { ERR_NOT_FOUND: 3, readFile: p => { try { return { err: 0, data: fs.readFileSync(p, 'utf8') }; } catch (e) { return { err: e.code === 'ENOENT' ? 3 : 5 }; } } };
  assert(writeJsonStorage(file, { text: 'first' }, diskApi, fs));
  assert(writeJsonStorage(file, { text: 'second' }, diskApi, fs));
  assert.strictEqual(JSON.parse(fs.readFileSync(file + '.bak')).text, 'first');
  const failingFs = Object.create(fs);
  failingFs.renameSync = (from, to) => { if (to === file) throw new Error('rename denied'); fs.renameSync(from, to); };
  assert.strictEqual(writeJsonStorage(file, { text: 'third' }, diskApi, failingFs), false);
  assert.strictEqual(JSON.parse(fs.readFileSync(file)).text, 'second');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['storage', 'storage.bak']);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('Storage safety tests passed (corruption, recovery, disk failures, atomic replacement)');
