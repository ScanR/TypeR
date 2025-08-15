const fs = require('fs');
const path = require('path');
const srcDir = path.resolve(__dirname, 'themes');
const destDir = path.resolve(__dirname, 'app', 'themes');
if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.lstatSync(src).isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}
