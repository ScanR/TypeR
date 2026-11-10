// Keep storage failures observable even when they happen during module startup.
const issues = new Map();
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener(Array.from(issues.values())));
export const getStorageIssues = () => Array.from(issues.values());
export const subscribeStorageIssues = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const reportStorageIssue = (path, reason, code) => {
  const previous = issues.get(path);
  const detail = code ? String(code) : '';
  // A failing autosave reports the same issue on every attempt: only a new
  // reason or error code needs to re-render the notice.
  if (previous && previous.reason === reason && previous.code === detail) return;
  issues.set(path, { path, reason, code: detail });
  notify();
};
// A successful write fixes a failed write, and a main file that was read from
// its backup is valid again. Read and corruption issues stay until dismissed:
// they mean the panel started without the user's data.
const clearWriteIssue = (path) => {
  const reason = issues.get(path)?.reason;
  if (reason === 'write' || reason === 'recovered') { issues.delete(path); notify(); }
};
const isMissing = (result, api) => result && (
  result.err === api.ERR_NOT_FOUND || result.err === 2 || result.err === 3
);
const parseObject = (text) => {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalidStorage');
  return value;
};
const getNodeFs = () => {
  try {
    const requireNode = window.cep_node?.require || window.require;
    return typeof requireNode === 'function' ? requireNode('fs') : null;
  } catch (error) { return null; }
};
const readRaw = (path, api, nodeFs) => {
  let result;
  try { result = api.readFile(path); } catch (error) { result = { err: -1 }; }
  if (!nodeFs || !result || !result.err || isMissing(result, api)) return result;
  // The CEP read API fails on some files Node reads fine; ask Node before
  // treating an existing file as unreadable.
  try { return { err: 0, data: nodeFs.readFileSync(path, 'utf8') }; } catch (error) {
    return error && error.code === 'ENOENT' ? { err: api.ERR_NOT_FOUND || 3 } : result;
  }
};
export const readJsonStorage = (path, api = window.cep.fs, nodeFs = getNodeFs()) => {
  const result = readRaw(path, api, nodeFs);
  if (result && !result.err) {
    try { return { exists: true, data: parseObject(result.data) }; } catch (error) { /* Try the last valid backup. */ }
  } else if (!isMissing(result, api)) {
    reportStorageIssue(path, 'read', result && result.err);
    return { exists: true, data: {}, error: 'read' };
  }
  const backup = readRaw(path + '.bak', api, nodeFs);
  if (backup && !backup.err) {
    try {
      const data = parseObject(backup.data);
      reportStorageIssue(path, 'recovered');
      return { exists: true, data, recovered: true };
    } catch (error) { /* Preserve both invalid files. */ }
  }
  if (isMissing(result, api)) return { exists: false, data: {} };
  reportStorageIssue(path, 'corrupt');
  return { exists: true, data: {}, error: 'corrupt' };
};
const errorCode = (error) => (error && (error.code || error.message)) || 'unknown';
const replaceInPlace = (path, text, nodeFs) => {
  // Clears the read-only attribute on Windows, which blocks a replacement.
  try { nodeFs.chmodSync(path, 0o666); } catch (error) { /* Missing or not ours. */ }
  nodeFs.writeFileSync(path, text, 'utf8');
  if (nodeFs.readFileSync(path, 'utf8') !== text) throw new Error('writeVerificationFailed');
};
const writeText = (path, text, api, nodeFs) => {
  if (nodeFs) {
    const temporary = path + '.tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try {
      // fsync the temporary file before atomic replacement of the destination.
      const fd = nodeFs.openSync(temporary, 'wx');
      try { nodeFs.writeFileSync(fd, text, 'utf8'); nodeFs.fsyncSync(fd); }
      finally { nodeFs.closeSync(fd); }
      try {
        nodeFs.renameSync(temporary, path);
      } catch (renameError) {
        // Windows refuses to replace a file that is read-only or that another
        // program (antivirus, indexer, sync client) holds open. Overwriting it
        // in place still works there, and the caller kept a valid .bak first.
        try { replaceInPlace(path, text, nodeFs); } catch (error) { throw renameError; }
      }
    } finally {
      try { nodeFs.unlinkSync(temporary); } catch (error) { /* Already renamed or not created. */ }
    }
    return;
  }
  // Older CEP-only hosts have no rename API. Keep the valid .bak before using
  // their write API and verify the result, so an interrupted write is recoverable.
  const result = api.writeFile(path, text);
  if (!result || result.err) throw new Error('writeFailed' + (result && result.err ? ' ' + result.err : ''));
  const check = api.readFile(path);
  if (!check || check.err || check.data !== text) throw new Error('writeVerificationFailed');
};
// Refreshing the backup doubles the disk work of a save, and autosave runs
// while the user types. Atomic writes keep the main file valid, so a backup
// at most this old is enough to recover from outside corruption.
const BACKUP_INTERVAL = 60000;
const backupTimes = new Map();
const lastWrittenTexts = new Map();
export const writeJsonStorage = (path, data, api = window.cep.fs, nodeFs = getNodeFs()) => {
  try {
    const text = JSON.stringify(data);
    if (typeof text !== 'string' || text.charAt(0) !== '{') throw new Error('invalidStorage');
    const previous = readRaw(path, api, nodeFs);
    if (previous && !previous.err) {
      let valid = previous.data === lastWrittenTexts.get(path);
      if (!valid) {
        try { parseObject(previous.data); valid = true; } catch (error) { /* Preserve corrupt original below. */ }
      }
      if (valid) {
        const lastBackup = backupTimes.get(path);
        if (lastBackup === undefined || Date.now() - lastBackup >= BACKUP_INTERVAL) {
          writeText(path + '.bak', previous.data, api, nodeFs);
          backupTimes.set(path, Date.now());
        }
      } else {
        // Keep the unreadable bytes aside, then save again: refusing every
        // later write would leave the user unable to save anything.
        writeText(path + '.corrupt-' + Date.now(), previous.data, api, nodeFs);
      }
    } else if (!isMissing(previous, api)) {
      reportStorageIssue(path, 'read', previous && previous.err);
      return false;
    }
    writeText(path, text, api, nodeFs);
    lastWrittenTexts.set(path, text);
    clearWriteIssue(path);
    return true;
  } catch (error) {
    try { console.error('TypeR storage write failed', path, error); } catch (logError) { /* No console. */ }
    reportStorageIssue(path, 'write', errorCode(error));
    return false;
  }
};
