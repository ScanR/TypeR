// Ships prebuilt, like the keyboard reader. Rebuild on Windows after editing it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'scripts/native/typer-launcher.cs');
const icon = path.join(root, 'icons/typer.ico');
const target = path.join(root, 'uxp-src/native/typer-launcher-win.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceHash = () => hash(Buffer.concat([Buffer.from(fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n')), fs.readFileSync(icon)]));
function verifiedLauncher() {
  const packed = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (packed.sourceHash !== sourceHash()) throw new Error('Rebuild the Windows launcher: node scripts/buildWindowsLauncher.js');
  const bytes = Buffer.from(packed.binary, 'base64');
  if (hash(bytes) !== packed.sha256 || bytes.readUInt16LE(bytes.readUInt32LE(0x3c) + 24 + 68) !== 2) {
    throw new Error('Windows launcher must be a verified GUI executable');
  }
  return packed;
}
if (require.main === module) {
  if (process.platform !== 'win32') throw new Error('Build on Windows with .NET Framework');
  const out = path.join(root, '.native-build', 'TypeR Launcher.exe');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(csc, ['/nologo', '/target:winexe', '/optimize+', '/win32icon:' + icon, '/out:' + out, source], { stdio: 'inherit', windowsHide: true });
  const bytes = fs.readFileSync(out);
  fs.writeFileSync(target, JSON.stringify({ sourceHash: sourceHash(), sha256: hash(bytes), binary: bytes.toString('base64') }) + '\n');
  verifiedLauncher();
  console.log('Windowless launcher built and verified');
}
module.exports = { verifiedLauncher };
