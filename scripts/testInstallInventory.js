const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const powershell = process.env.TYPER_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : null);
if (!powershell) {
  console.log('Windows inventory installation tests skipped; set TYPER_POWERSHELL to enable them.');
} else {
  const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'testInstallInventory.ps1')], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0, String(result.error || '') + result.stdout + result.stderr);
  process.stdout.write(result.stdout);
}
