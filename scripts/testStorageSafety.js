const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const load = require('./helpers/loadAppModule')();
const { readJsonStorage, writeJsonStorage, getStorageIssues } = load('app_src/storageIO.js');
// Failed writes are logged on purpose: keep the expected ones out of the output.
const realConsoleError = console.error;
console.error = () => {};
const files = new Map();
let failTarget = null;
const api = {
  ERR_NOT_FOUND: 3,
  readFile: p => files.has(p) ? { err: 0, data: files.get(p) } : { err: 3 },
  writeFile: (p, data) => { if (p === failTarget) return { err: 5 }; files.set(p, data); return { err: 0 }; },
};
files.set('storage', '{"text":"original",');
assert.strictEqual(readJsonStorage('storage', api).error, 'corrupt');
// Without a valid backup the corrupt bytes are kept aside and saving resumes,
// instead of refusing every later save of the session.
assert.strictEqual(writeJsonStorage('storage', { text: 'replacement' }, api, null), true);
assert.strictEqual(JSON.parse(files.get('storage')).text, 'replacement');
const corruptCopies = [...files.keys()].filter(p => p.startsWith('storage.corrupt-'));
assert.strictEqual(corruptCopies.length, 1);
assert.strictEqual(files.get(corruptCopies[0]), '{"text":"original",');
assert.strictEqual(getStorageIssues().find(i => i.path === 'storage').reason, 'corrupt');
for (const key of corruptCopies) files.delete(key);
files.set('storage', '{"text":"original",');
files.set('storage.bak', '{"text":"recovered"}');
assert.strictEqual(readJsonStorage('storage', api).data.text, 'recovered');
assert.strictEqual(writeJsonStorage('storage', { text: 'new' }, api, null), true);
assert([...files.keys()].some(p => p.startsWith('storage.corrupt-')));
assert.strictEqual(JSON.parse(files.get('storage.bak')).text, 'recovered');
failTarget = 'storage';
assert.strictEqual(writeJsonStorage('storage', { text: 'failed write' }, api, null), false);
assert.strictEqual(JSON.parse(files.get('storage')).text, 'new');
assert.strictEqual(JSON.parse(files.get('storage.bak')).text, 'new');
assert.strictEqual(getStorageIssues().find(i => i.path === 'storage').code, 'writeFailed 5');
// The backup is refreshed at most once a minute, so a save right after one
// does not rewrite it.
failTarget = 'storage.bak';
assert.strictEqual(writeJsonStorage('storage', { text: 'no backup due' }, api, null), true);
assert.strictEqual(JSON.parse(files.get('storage.bak')).text, 'new');
assert(!getStorageIssues().some(i => i.path === 'storage'));
const realNow = Date.now;
Date.now = () => realNow() + 61000;
try {
  assert.strictEqual(writeJsonStorage('storage', { text: 'backup fails' }, api, null), false);
} finally { Date.now = realNow; }
assert.strictEqual(JSON.parse(files.get('storage')).text, 'no backup due');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'typer-storage-test-'));
try {
  const file = path.join(dir, 'storage');
  const diskApi = { ERR_NOT_FOUND: 3, readFile: p => { try { return { err: 0, data: fs.readFileSync(p, 'utf8') }; } catch (e) { return { err: e.code === 'ENOENT' ? 3 : 5 }; } } };
  assert(writeJsonStorage(file, { text: 'first' }, diskApi, fs));
  assert(writeJsonStorage(file, { text: 'second' }, diskApi, fs));
  assert.strictEqual(JSON.parse(fs.readFileSync(file + '.bak')).text, 'first');
  const failingFs = Object.create(fs);
  // Windows refuses the replacement when an antivirus holds the file or it is
  // read-only: the save falls back to an in-place write.
  const denied = () => Object.assign(new Error('rename denied'), { code: 'EPERM' });
  failingFs.renameSync = (from, to) => { if (to === file) throw denied(); fs.renameSync(from, to); };
  assert.strictEqual(writeJsonStorage(file, { text: 'third' }, diskApi, failingFs), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(file)).text, 'third');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['storage', 'storage.bak']);
  failingFs.writeFileSync = (target, ...rest) => { if (target === file) throw denied(); return fs.writeFileSync(target, ...rest); };
  assert.strictEqual(writeJsonStorage(file, { text: 'fourth' }, diskApi, failingFs), false);
  assert.strictEqual(JSON.parse(fs.readFileSync(file)).text, 'third');
  assert.strictEqual(getStorageIssues().find(i => i.path === file).code, 'EPERM');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['storage', 'storage.bak']);
} finally { fs.rmSync(dir, { recursive: true, force: true }); console.error = realConsoleError; }
console.log('Storage safety tests passed (corruption, recovery, disk failures, atomic replacement, in-place fallback)');
