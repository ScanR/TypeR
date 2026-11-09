// A GUI executable is opened directly: no app.system/cmd bootstrap can flash.
function createWindowsLauncher({ files, runJsx, packed, decodeBase64, wait, now = Date.now }) {
  let serial = 0;
  return async function launch(command, { mode = 'shell', waitForExit = true, timeout = 120000 } = {}) {
    if (!['shell', 'powershell'].includes(mode)) throw new Error('Unsupported launch mode');
    await files.resolveFolders();
    const job = files.joinPath(files.getStorageRoot(), 'launch', packed.sha256.slice(0, 16), now().toString(36) + '-' + (++serial) + '-' + Math.random().toString(36).slice(2));
    await files.ensureFolder(job);
    const executable = files.joinPath(job, 'TypeR Launcher.exe');
    const binary = decodeBase64(packed.binary);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
    await files.writeBinary(executable, bytes);
    await files.writeText(files.joinPath(job, 'command.txt'), mode + '\n' + command);
    const result = await runJsx('var launcher = new File(' + JSON.stringify(executable) + '); launcher.exists && launcher.execute() ? "OK" : "ERR launch failed";');
    if (result !== 'OK') throw new Error('TypeR launcher: ' + result);
    const deadline = now() + (waitForExit ? timeout : 15000);
    while (now() < deadline) {
      let error = '', answer = '';
      try { error = await files.readText(files.joinPath(job, 'error.txt')); } catch (_) {}
      if (error) throw new Error('TypeR launcher: ' + error);
      try { answer = String(await files.readText(files.joinPath(job, waitForExit ? 'exit' : 'started'))).trim(); } catch (_) {}
      if (/^-?\d+$/.test(answer)) return waitForExit ? Number(answer) : 0;
      await wait(100);
    }
    throw new Error('TypeR launcher timed out');
  };
}
module.exports = { createWindowsLauncher };
