// UXP storage files: replacement on Windows (whose rename cannot overwrite),
// recovery of writes cut short, and the CEP storage import cut short at
// each step. A fake disk stands in for UXP's file system.
const assert = require('assert');
const createLoader = require('./helpers/loadAppModule');

let platform = 'darwin';
const files = new Map();
const folders = new Set();
// Injected failures: a predicate on (operation, from, to)
let failWhen = () => false;

const normalize = (url) => String(url).replace(/^file:\/?(?=[A-Za-z]:)/, '').replace(/^file:/, '').replace(/\\/g, '/');
const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const addFolder = (path) => {
  for (let current = path; current && current !== '/' && !folders.has(current); current = parentOf(current)) folders.add(current);
};
const childrenOf = (path) => [
  ...[...files.keys()].filter((file) => parentOf(file) === path).map((file) => ({ name: nameOf(file), isFolder: false, isFile: true })),
  ...[...folders].filter((folder) => parentOf(folder) === path).map((folder) => ({ name: nameOf(folder), isFolder: true, isFile: false })),
];
const fail = (operation, from, to) => {
  if (failWhen(operation, from, to)) throw new Error(operation + ' failed: ' + from);
};

const loadFiles = () => createLoader({
  uxp: { storage: { formats: {}, localFileSystem: {
    getEntryWithUrl: async (url) => {
      const path = normalize(url);
      const isFolder = folders.has(path);
      if (!isFolder && !files.has(path)) throw new Error('not found ' + path);
      return {
        isFolder,
        isFile: !isFolder,
        getEntries: async () => childrenOf(path),
        delete: async () => {
          fail('delete', path);
          if (isFolder) {
            if (childrenOf(path).length) throw new Error('folder not empty');
            folders.delete(path);
          } else files.delete(path);
        },
      };
    },
  } } },
  os: { platform: () => platform, homedir: () => (platform === 'win32' ? 'C:\\Users\\t' : '/Users/t') },
  fs: {
    mkdir: async (url) => addFolder(normalize(url)),
    readFile: async (url) => {
      const path = normalize(url);
      if (!files.has(path)) throw new Error('not found ' + path);
      return files.get(path);
    },
    writeFile: async (url, text) => {
      const path = normalize(url);
      fail('write', path);
      if (!folders.has(parentOf(path))) throw new Error('no folder ' + parentOf(path));
      files.set(path, String(text));
    },
    rename: async (fromUrl, toUrl) => {
      const from = normalize(fromUrl);
      const to = normalize(toUrl);
      fail('rename', from, to);
      if (!files.has(from)) throw new Error('not found ' + from);
      if (platform === 'win32' && files.has(to)) throw new Error('EEXIST ' + to);
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlink: async (url) => {
      const path = normalize(url);
      fail('unlink', path);
      if (!files.delete(path)) throw new Error('not found ' + path);
    },
  },
})('uxp-src/host/files.js');

const reset = () => {
  files.clear();
  folders.clear();
  failWhen = () => false;
};
const namesIn = (folder) => childrenOf(folder).map((child) => child.name).sort();
const leftovers = (folder) => namesIn(folder).filter((name) => /\.(tmp|old)-/.test(name));

(async () => {
  const host = loadFiles();

  /* ---------------- replacement on Windows ---------------- */
  platform = 'win32';
  const winRoot = 'C:\\TypeR\\UXP';
  const winStorage = 'C:/TypeR/UXP/storage';

  reset();
  addFolder('C:/TypeR/UXP');
  files.set(winStorage, 'old');
  await host.writeTextAtomic(winRoot + '\\storage', 'new');
  assert.strictEqual(files.get(winStorage), 'new', 'Windows: the new content replaces the old one');
  assert.deepStrictEqual(leftovers('C:/TypeR/UXP'), [], 'Windows: nothing left behind');

  // The new file cannot take the original's place: the original is put back
  failWhen = (operation, from) => operation === 'rename' && /\.tmp-/.test(from);
  await assert.rejects(host.writeTextAtomic(winRoot + '\\storage', 'newer'), /rename failed/, 'A failed replacement is reported, never written in place');
  assert.strictEqual(files.get(winStorage), 'new', 'Windows: the original is restored');
  assert.deepStrictEqual(leftovers('C:/TypeR/UXP'), []);

  // Neither the new file nor the original can be put in place (as after a
  // crash): the original survives aside and is restored at the next start
  failWhen = (operation, from) => operation === 'rename' && (/\.tmp-/.test(from) || /\.old-/.test(from));
  await assert.rejects(host.writeTextAtomic(winRoot + '\\storage', 'newest'));
  assert.strictEqual(files.has(winStorage), false);
  assert.strictEqual(leftovers('C:/TypeR/UXP').filter((name) => /\.old-/.test(name)).length, 1, 'The original is kept aside');
  failWhen = () => false;
  await host.recoverInterruptedWrites(winRoot);
  assert.strictEqual(files.get(winStorage), 'new', 'The original moved aside is put back at the next start');
  assert.deepStrictEqual(leftovers('C:/TypeR/UXP'), []);

  // A crash after the replacement: the complete new file stays, leftovers go
  files.set(winStorage + '.old-aaaaaaaa1111', 'stale original');
  files.set(winStorage + '.tmp-aaaaaaaa2222', 'partial');
  await host.recoverInterruptedWrites(winRoot);
  assert.strictEqual(files.get(winStorage), 'new', 'A complete file is never replaced by an older one');
  assert.deepStrictEqual(leftovers('C:/TypeR/UXP'), []);

  // Several originals aside: the most recent one is put back
  files.delete(winStorage);
  files.set(winStorage + '.old-aaaaaaaa1111', 'older');
  files.set(winStorage + '.old-aaaaaaab1111', 'latest');
  await host.recoverInterruptedWrites(winRoot);
  assert.strictEqual(files.get(winStorage), 'latest');
  assert.deepStrictEqual(leftovers('C:/TypeR/UXP'), []);

  /* ---------------- replacement on macOS ---------------- */
  platform = 'darwin';
  reset();
  addFolder('/data');
  files.set('/data/storage', 'old');
  await host.writeTextAtomic('/data/storage', 'new');
  assert.strictEqual(files.get('/data/storage'), 'new');
  failWhen = (operation) => operation === 'rename';
  await assert.rejects(host.writeTextAtomic('/data/storage', 'newer'));
  assert.strictEqual(files.get('/data/storage'), 'new', 'macOS: a failed rename leaves the original untouched');
  assert.deepStrictEqual(leftovers('/data'), []);

  assert.strictEqual(host.isMirroredName('storage'), true);
  assert.strictEqual(host.isMirroredName('storage.old-aaaaaaaa1111'), false, 'An original moved aside is not a panel file');
  assert.strictEqual(host.isMirroredName('storage.tmp-1730000000000-abc'), false, 'CEP temporary files are not panel files');

  /* ---------------- CEP storage import ---------------- */
  const cepRoot = '/Users/t/Library/Application Support/Adobe/CEP/extensions/typertools';
  const uxpRoot = '/Users/t/Library/Application Support/TypeR/UXP';
  const cepFiles = { storage: '{"styles":[]}', storage_profiles: '{"active":"a"}', 'storage.bak': '{}', 'storage.corrupt-1': 'x' };
  const resetImport = () => {
    reset();
    addFolder(cepRoot);
    addFolder(uxpRoot);
    Object.keys(cepFiles).forEach((name) => files.set(cepRoot + '/' + name, cepFiles[name]));
  };
  const imported = () => namesIn(uxpRoot).filter((name) => name !== '.cep-import');

  resetImport();
  assert.strictEqual(await host.importCepStorage(uxpRoot), cepRoot);
  assert.deepStrictEqual(imported(), ['storage', 'storage.bak', 'storage_profiles'], 'Every CEP file is imported, corrupt copies excepted');
  assert.strictEqual(files.get(uxpRoot + '/storage_profiles'), cepFiles.storage_profiles);
  assert.strictEqual(folders.has(uxpRoot + '/.cep-import'), false, 'The staging folder is removed');
  assert.deepStrictEqual(namesIn(cepRoot), Object.keys(cepFiles).sort(), 'The CEP files are copied, never moved');
  assert.strictEqual(await host.importCepStorage(uxpRoot), false, 'A finished import is not repeated');

  // The copy fails half-way: nothing reaches the storage folder, the next
  // start imports everything
  resetImport();
  failWhen = (operation, path) => operation === 'write' && /\.cep-import\/storage_profiles$/.test(path);
  await assert.rejects(host.importCepStorage(uxpRoot));
  assert.deepStrictEqual(imported(), [], 'A copy cut short leaves the storage folder empty');
  failWhen = () => false;
  assert.strictEqual(await host.importCepStorage(uxpRoot), cepRoot);
  assert.deepStrictEqual(imported(), ['storage', 'storage.bak', 'storage_profiles']);

  // The move fails after the first file: the next start finishes it instead
  // of taking the storage file for a finished import
  resetImport();
  let moves = 0;
  // Staged files only, not the temporary file of the ".complete" marker
  failWhen = (operation, from) => operation === 'rename' && /\.cep-import\/[^.]/.test(from) && ++moves === 2;
  await assert.rejects(host.importCepStorage(uxpRoot));
  assert.strictEqual(imported().length, 1, 'One file was moved before the failure');
  failWhen = () => false;
  assert.strictEqual(await host.importCepStorage(uxpRoot), cepRoot, 'The interrupted import is finished');
  assert.deepStrictEqual(imported(), ['storage', 'storage.bak', 'storage_profiles']);
  assert.strictEqual(folders.has(uxpRoot + '/.cep-import'), false);

  // The UXP plugin already has its own storage: nothing is imported
  resetImport();
  files.set(uxpRoot + '/storage', 'uxp data');
  assert.strictEqual(await host.importCepStorage(uxpRoot), false);
  assert.strictEqual(files.get(uxpRoot + '/storage'), 'uxp data');
  assert.deepStrictEqual(imported(), ['storage']);

  // A copy cut short, then the panel started its own storage: that storage
  // is kept and the incomplete copy is dropped
  resetImport();
  addFolder(uxpRoot + '/.cep-import');
  files.set(uxpRoot + '/.cep-import/storage', cepFiles.storage);
  files.set(uxpRoot + '/storage', 'started since');
  assert.strictEqual(await host.importCepStorage(uxpRoot), false);
  assert.strictEqual(files.get(uxpRoot + '/storage'), 'started since');
  assert.strictEqual(folders.has(uxpRoot + '/.cep-import'), false);

  console.log('UXP storage recovery tests passed (Windows replacement, interrupted writes, CEP import cut short)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
