const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { saveRepairDocuments } = require('../uxp-src/host/saveRepairDocuments');
const { monitorRepair } = require('../uxp-src/host/webViewRepair');

async function savingTests() {
  const calls = [];
  const doc = (name, saved, save) => ({ name, saved, async save() {
    calls.push(name);
    if (save) await save(this); else this.saved = true;
  } });
  const context = { isCancelled: false };
  const ps = { app: { documents: [] }, core: { executeAsModal: async (fn, options) => {
    assert.strictEqual(options.interactive, true, 'Save As must be able to ask for a destination');
    return fn(context);
  } } };
  const flush = async () => calls.push('flush');
  ps.app.documents = [doc('clean', true), doc('dirty.psd', false), doc('untitled', false)];
  await saveRepairDocuments(ps, flush);
  assert.deepStrictEqual(calls, ['dirty.psd', 'untitled', 'flush']);
  calls.length = 0;
  ps.app.documents = [doc('cancelled', false, () => { throw new Error('User cancelled Save As'); }), doc('later', false)];
  await assert.rejects(saveRepairDocuments(ps, flush), /User cancelled/);
  assert.deepStrictEqual(calls, ['cancelled'], 'cancel must stop before subsequent saves or a successful acknowledgement');
  ps.app.documents = [doc('silent-cancel', false, () => {})];
  await assert.rejects(saveRepairDocuments(ps, flush), /Unsaved document/);
  ps.app.documents = [doc('failed-write', false, () => { throw new Error('Disk full'); })];
  await assert.rejects(saveRepairDocuments(ps, flush), /Disk full/);
  ps.app.documents = [doc('new-dirty-document', false, self => {
    self.saved = true;
    ps.app.documents.push(doc('appeared-during-save', false));
  })];
  await assert.rejects(saveRepairDocuments(ps, flush), /Unsaved documents remain/);
  ps.app.documents = [];
  await assert.rejects(saveRepairDocuments(ps, async () => { throw new Error('TypeR storage write failed'); }), /storage write failed/);
  context.isCancelled = true;
  await assert.rejects(saveRepairDocuments(ps, flush), /Unsaved documents remain/);
}

async function handshakeTests() {
  const session = 'current-session';
  let time = 0, saves = 0;
  const writes = [];
  const receipts = [
    { session: 'old-session', status: 'saving-documents' },
    { session, status: 'preparing' },
    { session, status: 'saving-documents' },
    { session, status: 'saving-documents' },
    { session, status: 'applied' },
  ];
  const options = {
    session, report: 'status.json',
    files: { readText: async () => JSON.stringify(receipts.shift()), writeTextAtomic: async (file, text) => writes.push([file, JSON.parse(text)]) },
    saveDocuments: async () => { saves++; }, now: () => time, wait: async () => { time += 1000; },
  };
  await monitorRepair(options);
  assert.strictEqual(saves, 1);
  assert.deepStrictEqual(writes, [['status.json.current-session.response.json', { session, status: 'saved' }]]);
  receipts.push({ session, status: 'saving-documents' });
  options.saveDocuments = async () => { throw new Error('Save cancelled'); };
  await monitorRepair(options);
  assert.strictEqual(writes[1][1].status, 'failed');
  assert.match(writes[1][1].detail, /Save cancelled/);
  for (const status of ['declined', 'failed', 'timed-out', 'unsupported', 'disabled', 'completed', 'restart-failed']) {
    receipts.push({ session, status });
    await monitorRepair(options);
  }
  assert.strictEqual(writes.length, 2, 'no save after cancellation, failure or unsupported DLL');
  options.files.readText = async () => { throw new Error('No receipt'); };
  options.wait = async () => { time += 86400000; };
  await monitorRepair(options);
  assert.strictEqual(writes.length, 2, 'missing receipt cannot authorize saving');
}

(async () => {
  await savingTests();
  await handshakeTests();
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'testUxpRepairProgress.ps1')], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, String(result.error || '') + result.stdout + result.stderr);
    process.stdout.write(result.stdout);
  }
  console.log('Repair save: dirty/untitled documents, cancellation, disk errors, new documents, persistence and session handshake passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
