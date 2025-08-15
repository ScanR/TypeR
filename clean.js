import fs from 'fs';
const target = process.argv[2];
if (target && fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
}
