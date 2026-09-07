// Keep storage failures observable even when they happen during module startup.
const issues = new Map();
const listeners = new Set();
const notify = () => listeners.forEach((listener) => listener(Array.from(issues.values())));
export const getStorageIssues = () => Array.from(issues.values());
export const subscribeStorageIssues = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const reportStorageIssue = (path, reason) => {
  issues.set(path, { path, reason });
  notify();
};
const clearWriteIssue = (path) => {
  if (issues.get(path)?.reason === 'write') { issues.delete(path); notify(); }
};
const isMissing = (result, api) => result && (
  result.err === api.ERR_NOT_FOUND || result.err === 2 || result.err === 3
);
const parseObject = (text) => {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalidStorage');
  return value;
};
const readRaw = (path, api) => {
  try { return api.readFile(path); } catch (error) { return { err: -1 }; }
};
export const readJsonStorage = (path, api = window.cep.fs) => {
  const result = readRaw(path, api);
  if (result && !result.err) {
    try { return { exists: true, data: parseObject(result.data) }; } catch (error) { /* Try the last valid backup. */ }
  } else if (!isMissing(result, api)) {
    reportStorageIssue(path, 'read');
    return { exists: true, data: {}, error: 'read' };
  }
  const backup = readRaw(path + '.bak', api);
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
const getNodeFs = () => {
  try {
    const requireNode = window.cep_node?.require || window.require;
    return typeof requireNode === 'function' ? requireNode('fs') : null;
  } catch (error) { return null; }
};
const writeText = (path, text, api, nodeFs) => {
  if (nodeFs) {
    const temporary = path + '.tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try {
      // fsync the temporary file before atomic replacement of the destination.
      const fd = nodeFs.openSync(temporary, 'wx');
      try { nodeFs.writeFileSync(fd, text, 'utf8'); nodeFs.fsyncSync(fd); }
      finally { nodeFs.closeSync(fd); }
      nodeFs.renameSync(temporary, path);
    } finally {
      try { nodeFs.unlinkSync(temporary); } catch (error) { /* Already renamed or not created. */ }
    }
    return;
  }
  // Older CEP-only hosts have no rename API. Keep the valid .bak before using
  // their write API and verify the result, so an interrupted write is recoverable.
  const result = api.writeFile(path, text);
  if (!result || result.err) throw new Error('writeFailed');
  const check = api.readFile(path);
  if (!check || check.err || check.data !== text) throw new Error('writeVerificationFailed');
};
export const writeJsonStorage = (path, data, api = window.cep.fs, nodeFs = getNodeFs()) => {
  try {
    const text = JSON.stringify(data);
    parseObject(text);
    const previous = readRaw(path, api);
    if (previous && !previous.err) {
      let valid = false;
      try { parseObject(previous.data); valid = true; } catch (error) { /* Preserve corrupt original below. */ }
      if (valid) {
        writeText(path + '.bak', previous.data, api, nodeFs);
      } else {
        const backup = readRaw(path + '.bak', api);
        try { if (!backup || backup.err) throw new Error('missingBackup'); parseObject(backup.data); }
        catch (error) { reportStorageIssue(path, 'corrupt'); return false; }
        writeText(path + '.corrupt-' + Date.now(), previous.data, api, nodeFs);
      }
    } else if (!isMissing(previous, api)) {
      reportStorageIssue(path, 'read');
      return false;
    }
    writeText(path, text, api, nodeFs);
    clearWriteIssue(path);
    return true;
  } catch (error) {
    reportStorageIssue(path, 'write');
    return false;
  }
};
