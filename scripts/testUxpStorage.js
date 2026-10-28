const assert = require('assert');
const createLoader = require('./helpers/loadAppModule');
const disk = new Map();
let failWrite = '';
let failDelete = '';
const nativePath = value => String(value).replace(/^file:/, '');
const { createMirrorWriter } = createLoader({
  uxp: { storage: { formats: {}, localFileSystem: {
    getEntryWithUrl: async url => {
      const path = nativePath(url);
      if (path !== '/data' && !disk.has(path)) throw new Error('not found');
      return { isFolder: path === '/data', delete: async () => {
        if (path === failDelete) throw new Error('delete denied');
        disk.delete(path);
      } };
    },
  } } },
  os: { platform: () => 'darwin' },
  fs: {
    writeFile: async (url, text) => {
      const path = nativePath(url);
      if (failWrite && path.startsWith(failWrite)) throw new Error('disk full');
      disk.set(path, text);
    },
    rename: async (from, to) => { disk.set(nativePath(to), disk.get(nativePath(from))); disk.delete(nativePath(from)); },
    unlink: async path => disk.delete(nativePath(path)),
  },
})('uxp-src/host/files.js');

(async () => {
  const writer = createMirrorWriter('/data');
  failWrite = '/data/storage_profile';
  await assert.rejects(writer.write('storage_profile', 'unsaved'), /disk full/);
  await writer.write('storage', 'saved');
  assert(writer.lastError(), 'Another file succeeding must not hide the failed profile');
  await assert.rejects(writer.flush(), /disk full/, 'Flush must not acknowledge failed saves');
  failWrite = '';
  await writer.flush();
  assert.strictEqual(disk.get('/data/storage_profile'), 'unsaved', 'Flush retries failed content');
  assert.strictEqual(writer.lastError(), null);

  failDelete = '/data/storage_profile';
  await assert.rejects(writer.remove('storage_profile'), /Could not delete/);
  await assert.rejects(writer.flush(), /Could not delete/);
  failDelete = '';
  await writer.flush();
  assert.strictEqual(disk.has('/data/storage_profile'), false);

  // Sustained typing can coalesce many writes while a slow disk is busy.
  // Every waiter must settle without a recursive callback stack overflow.
  const writes = [];
  for (let i = 0; i < 20000; i++) writes.push(writer.write('storage', String(i)));
  await Promise.all(writes);
  await writer.flush();
  assert.strictEqual(disk.get('/data/storage'), '19999');
  failWrite = '/data/storage';
  await assert.rejects(writer.write('storage', 'old failure'), /disk full/);
  failWrite = '';
  await writer.write('storage', 'newer success');
  await writer.flush();
  assert.strictEqual(disk.get('/data/storage'), 'newer success', 'Never replay a superseded failure');
  const smartHost = createLoader({
    photoshop: { app: { documents: [{}], activeDocument: { id: 2 } } },
    './photoshop': { _internals: {}, methods: { getTypeRDocumentKey: () => 'session:2' } },
  })('uxp-src/host/smartPaste.js');
  const foreignTrigger = { source: 'rectangle', documentKey: 'session:1' };
  assert.strictEqual(JSON.parse(await smartHost.methods.replaySelectionTrigger(foreignTrigger)).error, 'doc');
  assert.strictEqual(JSON.parse(await smartHost.methods.smartPasteCapture({ trigger: foreignTrigger })).error, 'doc');
  console.log('UXP persistence regressions passed (failed saves, retries, deletes, 20,000 coalesced writes)');
})().catch(error => { console.error(error); process.exitCode = 1; });
