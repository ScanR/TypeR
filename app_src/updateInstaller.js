import { unzip } from 'fflate';
import { validateReleasePackage } from './releasePackage';
import { makeBuffer, makeDirectories, removeTree } from './nodeCompat';

const unzipAsync = (bytes) => new Promise((resolve, reject) => {
  let total = 0;
  unzip(bytes, { filter: entry => {
    total += entry.originalSize;
    if (total > 150 * 1024 * 1024) return false;
    return true;
  } }, (error, entries) => {
    if (total > 150 * 1024 * 1024) reject(new Error('Update package is too large'));
    else if (error) reject(error);
    else resolve(entries);
  });
});

// Keep content-addressed chunks from the running version until Photoshop reloads.
// Every replacement is journaled before writing; interrupted installs can be rolled back.
export const installPackageFiles = (files, target, node) => {
  const { fs, path, Buffer: BufferClass } = node;
  const journalPath = path.join(target, '.typer-update-journal.json');
  const recover = (journal) => {
    if (!journal || !/^\.typer-update-[a-z0-9-]+$/.test(journal.name) || !Array.isArray(journal.files)) throw new Error('Invalid update recovery journal');
    const directory = path.join(target, journal.name);
    journal.files.slice().reverse().forEach(file => {
      if (!file || !/^(app|CSXS|icons|locale)\/[A-Za-z0-9_@./-]+$/.test(file.name) || file.name.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid recovery path');
      const destination = path.join(target, file.name);
      const backup = path.join(directory, 'backup', file.name);
      if (file.existed) {
        // The backup is copied before recording intent. Recovery is repeatable.
        fs.writeFileSync(destination, fs.readFileSync(backup));
      } else if (fs.existsSync(destination)) fs.unlinkSync(destination);
    });
    fs.unlinkSync(journalPath);
    removeTree(fs, path, directory);
  };
  if (fs.existsSync(journalPath)) recover(JSON.parse(fs.readFileSync(journalPath, 'utf8')));
  const journal = { name: '.typer-update-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), files: [] };
  const stage = path.join(target, journal.name);
  makeDirectories(fs, path, stage);
  const persist = () => {
    const temporary = journalPath + '.tmp';
    const fd = fs.openSync(temporary, 'w');
    try { fs.writeFileSync(fd, JSON.stringify(journal)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, journalPath);
  };
  try {
    const names = Object.keys(files).sort((a, b) => Number(/^(app\/index\.|app\/host|CSXS\/)/.test(a)) - Number(/^(app\/index\.|app\/host|CSXS\/)/.test(b)));
    names.forEach(name => {
      const staged = path.join(stage, 'new', name);
      makeDirectories(fs, path, path.dirname(staged));
      fs.writeFileSync(staged, makeBuffer(BufferClass, files[name]));
    });
    names.forEach(name => {
      const destination = path.join(target, name);
      makeDirectories(fs, path, path.dirname(destination));
      // Do not follow symlinks when replacing application files.
      let parent = destination;
      while (parent !== target && parent !== path.dirname(parent)) {
        if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error('Symbolic link in installation path');
        parent = path.dirname(parent);
      }
      const existed = fs.existsSync(destination);
      if (existed) {
        const backup = path.join(stage, 'backup', name);
        makeDirectories(fs, path, path.dirname(backup));
        fs.writeFileSync(backup, fs.readFileSync(destination));
      }
      journal.files.push({ name, existed });
      persist();
      fs.renameSync(path.join(stage, 'new', name), destination);
    });
    fs.unlinkSync(journalPath);
  } catch (error) {
    try { if (fs.existsSync(journalPath)) recover(JSON.parse(fs.readFileSync(journalPath, 'utf8'))); }
    catch (rollbackError) { throw new Error('Update failed; recovery files retained at ' + stage + ': ' + rollbackError.message); }
    removeTree(fs, path, stage);
    throw error;
  }
  // Cleanup failure does not invalidate a successfully installed package.
  try { removeTree(fs, path, stage); } catch (error) { console.warn('Update cleanup:', error); }
  return Object.keys(files).length;
};

export const installUpdateInPlace = async (zipBytes, targetRoot, onProgress, expectedVersion) => {
  if (!zipBytes || zipBytes.length > 60 * 1024 * 1024) throw new Error('Invalid update size');
  const requireNode = window.cep_node && window.cep_node.require || window.require;
  if (typeof requireNode !== 'function' || !targetRoot) throw new Error('Node filesystem unavailable; use the manual installer');
  const fs = requireNode('fs'), path = requireNode('path'), crypto = requireNode('crypto'), BufferClass = requireNode('buffer').Buffer;
  const files = validateReleasePackage(await unzipAsync(zipBytes), bytes => crypto.createHash('sha256').update(makeBuffer(BufferClass, bytes)).digest('hex'), bytes => makeBuffer(BufferClass, bytes).toString('utf8'), expectedVersion);
  return installPackageFiles(files, path.resolve(targetRoot), { fs, path, Buffer: BufferClass });
};

export const uint8ToBase64 = bytes => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return window.btoa(binary);
};
