// User support build only. Independent of the app, storage mirror, and WebView.
const uxp = require('uxp');
const os = require('os');
const { createDiagnosticLog } = require('./diagnosticLog');
const lfs = uxp.storage.localFileSystem;
const environment = { photoshop: String(uxp.host.version), uxp: String(uxp.versions && uxp.versions.uxp), platform: os.platform(), locale: uxp.host.uiLocale };
const journal = createDiagnosticLog(environment, [os.homedir()]);
let target = null;
let dirty = false;
let writing = false;
let timer = null;
let started = false;
let savedPath = '';

async function flush() {
  if (writing || !target) return;
  writing = true;
  try {
    while (dirty) {
      dirty = false;
      await target.write(journal.snapshot(), { format: uxp.storage.formats.utf8 });
    }
  } catch (error) {
    journal.note('journal.write.error', error.message || error);
    const status = document.getElementById('typer-debug-status');
    if (status) status.textContent = 'Automatic log unavailable. Use Export diagnostic.';
  } finally { writing = false; }
}

function note(stage, detail) {
  journal.note(stage, detail);
  dirty = true;
  if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 200);
}

function attachUI() {
  const bar = document.getElementById('typer-debug');
  if (!bar) return;
  bar.style.display = 'block';
  const button = document.getElementById('typer-debug-export');
  const status = document.getElementById('typer-debug-status');
  if (status) status.textContent = savedPath ? 'Automatic log: ' + savedPath : 'Recording startup. Export the report after reproducing the issue.';
  if (button) button.onclick = async () => {
    button.disabled = true;
    try {
      const file = await lfs.getFileForSaving('TypeR-diagnostic.json', { types: ['json'] });
      if (!file) return;
      note('report.export', 'user requested');
      await file.write(journal.snapshot(), { format: uxp.storage.formats.utf8 });
      if (status) status.textContent = 'Report saved: ' + file.nativePath;
    } catch (error) {
      note('report.export.error', error.message || error);
      if (status) status.textContent = 'Export failed: ' + (error.message || error);
    } finally { button.disabled = false; }
  };
}

function start() {
  if (started) return;
  started = true;
  note('host.bootstrap', 'diagnostic build; no devEval or remote execution');
  attachUI();
  window.addEventListener('error', event => note('host.error', event.message || 'native error'));
  window.addEventListener('unhandledrejection', event => note('host.rejection', event.reason && event.reason.message || event.reason));
  (async () => {
    try {
      const data = await lfs.getDataFolder();
      let folder;
      try { folder = await data.getEntry('diagnostics'); }
      catch (error) { folder = await data.createFolder('diagnostics'); }
      // Bound disk usage to at most five recent session files.
      const slot = Date.now() % 5;
      target = await folder.createFile('typer-startup-' + slot + '.json', { overwrite: true });
      savedPath = target.nativePath;
      note('journal.open', savedPath);
      attachUI();
      await flush();
    } catch (error) { note('journal.open.error', error.message || error); }
    try {
      const root = await lfs.getPluginFolder();
      const marker = JSON.parse(await (await root.getEntry('typer-debug-build.json')).read({ format: uxp.storage.formats.utf8 }));
      note('build', JSON.stringify(marker));
    } catch (error) { note('build.read.error', error.message || error); }
  })();
}

function fatal(error) {
  note('host.module.error', error && (error.stack || error.message) || error);
  attachUI();
  const status = document.getElementById('typer-status');
  if (status) { status.style.display = 'block'; status.textContent = 'TypeR DEBUG could not start: ' + (error.message || error); }
}
module.exports = { start, note, attachUI, fatal, flush };
