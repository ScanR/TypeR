// Every installation/update route loads this host, including old updaters and
// direct CCX installation. Repair only a confirmed native storage refusal.
const quotePowerShell = value => "'" + String(value).replace(/'/g, "''") + "'";

function pathKey(value) {
  let hash = 2166136261;
  const text = String(value).replace(/\//g, '\\').toLowerCase();
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

function encodeCommand(text, encodeBase64) {
  let bytes = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes += String.fromCharCode(code & 255, code >>> 8);
  }
  return encodeBase64(bytes);
}

async function monitorRepair({ files, report, session, saveDocuments, wait, now = Date.now }) {
  const deadline = now() + 86400000;
  let answered = false;
  while (now() < deadline) {
    let receipt;
    try { receipt = JSON.parse(await files.readText(report)); } catch (error) {}
    // Old receipts and other Photoshop sessions cannot request a save or exit.
    if (receipt && receipt.session === session) {
      if (['applied', 'completed', 'restart-failed', 'failed', 'declined', 'timed-out', 'unsupported', 'disabled'].includes(receipt.status)) return;
      if (receipt.status === 'saving-documents' && !answered) {
        answered = true;
        let response = { session, status: 'saved' };
        try { await saveDocuments(); }
        catch (error) { response = { session, status: 'failed', detail: String(error && error.message || error) }; }
        await files.writeTextAtomic(report + '.' + session + '.response.json', JSON.stringify(response));
        if (response.status === 'failed') return;
      }
    }
    await wait(1000);
  }
}

function createWebViewRepair({ platform, source, sourceId, files, runJsx, runPowerShell, wait, saveDocuments }) {
  let pending = null;
  function start(kind) {
    if (platform !== 'win32' || kind !== 'storage' || !source || !sourceId) return Promise.resolve(false);
    if (pending) return pending;
    pending = (async () => {
      // Photoshop may still be in a startup modal operation. Do not block the
      // fallback UI; retry only launch errors, never a declined UAC request.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const appPath = String(await runJsx('app.path.fsName;')).trim();
          if (!/^[A-Za-z]:[\\/]/.test(appPath) && !/^\\\\[^\\]+\\[^\\]+/.test(appPath)) throw new Error('Photoshop path unavailable');
          const photoshop = files.joinPath(appPath, 'Photoshop.exe');
          const folder = files.joinPath(await files.getRoamingAppData(), 'TypeR', 'UXP', 'webview-repair', sourceId.slice(0, 16), pathKey(photoshop));
          await files.ensureFolder(folder);
          const script = files.joinPath(folder, 'repair.ps1');
          let existing = null;
          try { existing = await files.readText(script); } catch (error) {}
          if (existing !== source) await files.writeText(script, source);
          const report = files.joinPath(folder, 'status.json');
          const session = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
          const command = '& ' + quotePowerShell(script) + ' -Action Auto -PhotoshopPath ' + quotePowerShell(photoshop) + ' -ReportPath ' + quotePowerShell(report) +
            (saveDocuments ? ' -SessionId ' + quotePowerShell(session) : '');
          await runPowerShell(command, { waitForExit: false });
          if (saveDocuments) monitorRepair({ files, report, session, saveDocuments, wait })
            .catch(error => console.error('TypeR: repair save handshake', String(error && error.message || error)));
          return true;
        } catch (error) {
          if (attempt === 2) throw error;
          await wait(attempt === 0 ? 2000 : 5000);
        }
      }
      return false;
    })();
    return pending;
  }
  return { start };
}

module.exports = { createWebViewRepair, monitorRepair, quotePowerShell, encodeCommand, pathKey };
