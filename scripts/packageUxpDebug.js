const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const { zipSync, unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const ccx = read('Releases/TypeR-UXP-debug.ccx');
const contents = unzipSync(ccx);
const manifest = JSON.parse(Buffer.from(contents['manifest.json']).toString('utf8'));
assert.strictEqual(manifest.name, 'TypeR DEBUG');
assert(!manifest.requiredPermissions.allowCodeGenerationFromStrings, 'Support builds must not enable the developer execution channel');
assert(contents['typer-debug-build.json']);
const host = Buffer.from(contents['host.js']).toString('utf8');
const page = Buffer.from(contents['web/index.html']).toString('utf8');
assert(host.includes('TypeR startup diagnostic v1'));
assert(!host.includes('/private/tmp/typer-uxp-dev/'));
assert(page.includes('html.script'));
const marker = JSON.parse(Buffer.from(contents['typer-debug-build.json']).toString('utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.strictEqual(hash(contents['host.js']), marker.hostSha256);
assert.strictEqual(hash(contents['web/index.js']), marker.panelSha256);
const cmd = '@echo off\r\ncd /d "%~dp0" || exit /b 1\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\\install.ps1" -Uxp -Package "%~dp0TypeR-UXP-debug.ccx" %*\r\nexit /b %errorlevel%\r\n';
const collect = '@echo off\r\ncd /d "%~dp0" || exit /b 1\r\n"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\\diagnose_uxp_win.ps1"\r\necho Press any key to close this window...\r\npause >nul\r\n';
// Force English only in the support archive; keep the regular installer multilingual.
const languageSelection = '$Lang = $Host.CurrentCulture.TwoLetterISOLanguageName';
const installer = read('installer/install.ps1').toString('utf8');
assert(installer.includes(languageSelection));
const englishInstaller = installer.replace(languageSelection, '$Lang = "en" # English support package');
const guide = `TYPER DEBUG - blank panel diagnostics (Windows)

1. Extract the ENTIRE ZIP into a new folder.
2. Close Photoshop, run 1-Install-TypeR-DEBUG.cmd, and wait for confirmation.
3. Open Photoshop > Plugins > TypeR DEBUG. Wait 15 seconds.
4. Click Export diagnostic in the TypeR DEBUG bar and save the JSON file.
5. Keep Photoshop open and run 2-Collect-Diagnostics.cmd.
6. Send both JSON files to TypeR support. The collector saves its report in this folder.

You can also run the collector on its own, without installing the debug build.
It checks Adobe and Microsoft WebView2 components, versions, TypeR startup logs,
and WebView/TypeR-related entries in Photoshop logs. It does not change system
components or upload anything automatically. User profile paths are redacted.
It does not collect your documents or TypeR settings.

This temporary build replaces TypeR while keeping the same plugin ID and your data.
Once troubleshooting is complete, reinstall the normal TypeR package to leave DEBUG mode.
Do not open the CCX directly: Creative Cloud is not required by this installer.
If Photoshop is installed in a custom folder that is not detected, open a terminal
in this extracted folder and run:
.\\1-Install-TypeR-DEBUG.cmd -PhotoshopPath "E:\\My Photoshop"
`;
const files = {
  '1-Install-TypeR-DEBUG.cmd': Buffer.from(cmd),
  '2-Collect-Diagnostics.cmd': Buffer.from(collect),
  'installer/install.ps1': Buffer.from(englishInstaller),
  'installer/diagnose_uxp_win.ps1': read('installer/diagnose_uxp_win.ps1'),
  'CSXS/manifest.xml': read('CSXS/manifest.xml'),
  'TypeR-UXP-debug.ccx': ccx,
  'README.txt': Buffer.from(guide.replace(/\r?\n/g, '\r\n')),
  'LICENSE.md': read('LICENSE.md')
};
const bytes = zipSync(files, { level: 9 });
const checked = unzipSync(bytes);
Object.keys(files).forEach(name => assert(Buffer.from(checked[name]).equals(files[name]), name));
const name = 'TypeR-DEBUG-Windows-EN.zip';
fs.writeFileSync(path.join(root, 'Releases', name), bytes);
fs.writeFileSync(path.join(root, 'Releases', name + '.sha256'), hash(bytes) + '  ' + name + '\n');
console.log('Verified support bundle: Releases/' + name + ' (' + bytes.length + ' bytes)');
