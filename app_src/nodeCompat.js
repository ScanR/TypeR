// These helpers also work with the io.js runtime shipped in CEP 6.1.
export const makeBuffer = (BufferClass, value, encoding) => BufferClass.from
  ? BufferClass.from(value, encoding) : new BufferClass(value, encoding);
export const allocateBuffer = (BufferClass, size) => {
  if (BufferClass.alloc) return BufferClass.alloc(size);
  const buffer = new BufferClass(size);
  buffer.fill(0);
  return buffer;
};
export const makeDirectories = (fs, path, directory) => {
  if (fs.existsSync(directory)) {
    if (!fs.statSync(directory).isDirectory()) throw new Error('Expected directory: ' + directory);
    return;
  }
  const parent = path.dirname(directory);
  if (parent !== directory) makeDirectories(fs, path, parent);
  fs.mkdirSync(directory);
};
export const removeTree = (fs, path, target) => {
  if (!fs.existsSync(target)) return;
  if (fs.lstatSync(target).isDirectory()) {
    fs.readdirSync(target).forEach(name => removeTree(fs, path, path.join(target, name)));
    fs.rmdirSync(target);
  } else fs.unlinkSync(target);
};

export const homeDirectory = (os, env = {}) => {
  const home = typeof os.homedir === 'function' ? os.homedir() : env.HOME || env.USERPROFILE;
  if (!home) throw new Error('User home directory unavailable');
  return home;
};
