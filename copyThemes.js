import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
