const {test} = require('node:test');
const assert = require('node:assert/strict');
const {isVirtualPath, fileForPath, pathForFile} = require('./virtual-files');

test('the paths the panel builds map to one file each', () => {
  const paths = [
    '/storage',
    '/storage.bak',
    '/storage_profiles',
    '/storage_profile_hero',
    '/storage_background',
    '/storage_profile_hero_background',
    '/storage.before-import',
    '/storage.corrupt-1758233000000',
  ];
  for (const path of paths) {
    const file = fileForPath(path);
    assert.ok(file, `${path} must be a virtual path`);
    assert.equal(pathForFile(file), path, `${path} must survive the round trip`);
  }
});

test("the storage file keeps the CEP version's name", () => {
  assert.equal(fileForPath('/storage'), 'storage.json');
  assert.equal(pathForFile('storage.json'), '/storage');
});

test('a picked file and a locale are not the panel’s own files', () => {
  assert.equal(isVirtualPath('file:1'), false);
  assert.equal(fileForPath('file:1'), null);
  assert.equal(isVirtualPath('/locale/fr_FR/messages.properties'), false);
  assert.equal(fileForPath('/locale/messages.properties'), null);
});

test('a path that would escape the data folder is refused', () => {
  assert.equal(isVirtualPath('/../secrets'), false);
  assert.equal(isVirtualPath('/a/b'), false);
  assert.equal(isVirtualPath('storage'), false);
  assert.equal(isVirtualPath('/'), false);
  assert.equal(fileForPath('//etc/passwd'), null);
  assert.equal(isVirtualPath(undefined), false);
  assert.equal(isVirtualPath(null), false);
  assert.equal(fileForPath(12), null);
});

test('the data folder is read back by that same naming only', () => {
  assert.equal(pathForFile('notes.txt'), null);
  assert.equal(pathForFile('.json'), null);
  assert.equal(pathForFile('storage.json.bak'), null);
  assert.equal(pathForFile(undefined), null);
});
