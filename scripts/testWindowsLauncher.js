const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { verifiedLauncher } = require('./buildWindowsLauncher');
const { createWindowsLauncher } = require('../uxp-src/host/windowsLauncher');
const { encodeCommand } = require('../uxp-src/host/webViewRepair');

const packed = verifiedLauncher();
const encode = text => encodeCommand(text, bytes => Buffer.from(bytes, 'binary').toString('base64'));
const psQuote = text => "'" + text.replace(/'/g, "''") + "'";

async function wrapperTests() {
  const storage = new Map();
  let time = 0, commandFile, completion = '0', failure = '', launches = 0;
  const launcher = createWindowsLauncher({
    packed, decodeBase64: text => Buffer.from(text, 'base64').toString('binary'),
    now: () => time, wait: async ms => { time += ms; },
    files: {
      resolveFolders: async () => {}, getStorageRoot: () => 'C:\\Profil & test\\TypeR',
      joinPath: (...parts) => parts.join('\\'), ensureFolder: async () => {},
      writeBinary: async (file, bytes) => { assert(Buffer.from(bytes).equals(Buffer.from(packed.binary, 'base64'))); },
      writeText: async (file, text) => { commandFile = file; storage.set(file, text); },
      readText: async file => {
        if (file.endsWith('error.txt')) return failure;
        return file.endsWith('started') ? '123' : completion;
      },
    },
    runJsx: async code => {
      launches++;
      assert(code.includes('new File(') && code.includes('.execute()'));
      assert(!code.includes('app.system') && !code.includes('cmd.exe'));
      return 'OK';
    },
  });
  const command = encode("Write-Output 'é & % $(literal)'");
  assert.strictEqual(await launcher(command, { mode: 'powershell' }), 0);
  assert.strictEqual(storage.get(commandFile), 'powershell\n' + command);
  completion = '7';
  assert.strictEqual(await launcher('exit /b 7'), 7, 'exit code must reach synchronous callers');
  assert.strictEqual(await launcher(command, { mode: 'powershell', waitForExit: false }), 0, 'long repairs return after the start acknowledgement');
  failure = 'Launch denied';
  await assert.rejects(launcher(command), /Launch denied/);
  failure = ''; completion = '';
  await assert.rejects(launcher(command, { timeout: 200 }), /timed out/);
  await assert.rejects(launcher(command, { mode: 'unknown' }), /Unsupported/);
  assert.strictEqual(launches, 5);
}

async function nativeTests() {
  if (process.platform !== 'win32') return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typer-launcher-é & '%-"));
  try {
    for (const mode of ['powershell', 'shell', 'batch', 'invalid']) {
      const job = path.join(root, mode);
      fs.mkdirSync(job);
      const exe = path.join(job, 'TypeR Launcher.exe');
      fs.writeFileSync(exe, Buffer.from(packed.binary, 'base64'));
      const report = path.join(job, 'console.txt');
      const probe = 'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }\'; ' +
        '[IO.File]::WriteAllText(' + psQuote(report) + ', [ConsoleProbe]::GetConsoleWindow().ToInt64().ToString()); exit 7';
      const encoded = encode(probe);
      let command = mode === 'shell' ? 'powershell.exe -NoProfile -EncodedCommand ' + encoded : encoded;
      if (mode === 'batch') {
        const batch = path.join(job, 'update test.cmd');
        fs.writeFileSync(batch, '@echo off\r\npowershell.exe -NoProfile -EncodedCommand ' + encoded + '\r\nexit /b %errorlevel%\r\n');
        command = '"' + batch + '"';
      }
      fs.writeFileSync(path.join(job, 'command.txt'), (mode === 'batch' ? 'shell' : mode) + '\n' + command);
      // No windowsHide here: the launcher itself MUST have the Windows GUI subsystem.
      await new Promise((resolve, reject) => {
        const child = spawn(exe, [], { stdio: 'ignore' });
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Native launcher test timed out')); }, 15000);
        child.on('error', error => { clearTimeout(timeout); reject(error); });
        child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Launcher exit ' + code)); });
      });
      if (mode === 'invalid') {
        assert.match(fs.readFileSync(path.join(job, 'error.txt'), 'utf8'), /Unsupported launch mode/);
        assert(!fs.existsSync(report));
      } else {
        assert.strictEqual(fs.readFileSync(report, 'utf8'), '0', mode + ': a child must have NO console window, even briefly');
        assert.strictEqual(fs.readFileSync(path.join(job, 'exit'), 'utf8'), '7');
        assert.match(fs.readFileSync(path.join(job, 'started'), 'utf8'), /^\d+$/);
      }
    }
  } finally {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('typer-launcher-')) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  // The shortcut reader also remains a GUI executable, opened directly by Photoshop.
  const reader = Buffer.from(JSON.parse(fs.readFileSync(path.join(__dirname, '../uxp-src/native/typer-keys-win.json'), 'utf8')).binary, 'base64');
  assert.strictEqual(reader.readUInt16LE(reader.readUInt32LE(0x3c) + 24 + 68), 2, 'shortcut reader must never allocate a console');
  console.log('Native Windows launch: PowerShell and cmd children have GetConsoleWindow() = 0; shortcut reader is a GUI executable');
}

(async () => { await wrapperTests(); await nativeTests(); console.log('Windowless launch: Unicode paths, errors, exit codes, asynchronous start and timeout passed'); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
