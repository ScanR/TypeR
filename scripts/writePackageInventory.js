const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(relative) {
  const absolute = path.join(root, relative);
  if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Symlinks are not allowed: ' + relative);
  if (fs.statSync(absolute).isDirectory()) fs.readdirSync(absolute).sort().forEach(name => walk(relative + '/' + name));
  else if (relative !== 'app/package.sha256') files.push(relative);
}
['app', 'CSXS', 'icons', 'locale'].forEach(walk);
fs.writeFileSync(path.join(root, 'app/package.sha256'), files.sort().map(name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') + '  ' + name).join('\n') + '\n');
console.log('Package inventory: ' + files.length + ' files');
