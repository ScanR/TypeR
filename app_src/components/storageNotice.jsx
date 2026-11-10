import React from 'react';
import { getStorageIssues, subscribeStorageIssues } from '../storageIO';
import { locale, readStorage, retryStorageSave, nativeAlert } from '../utils';

const fileName = (path) => String(path || '').split(/[\\/]/).pop();
// Closing hides the current issues only: a new file or reason shows it again,
// while the same autosave failure repeated every few seconds does not.
const issuesKey = (issues) => issues.map((issue) => issue.path + ':' + issue.reason).sort().join('|');

export default function StorageNotice() {
  const [issues, setIssues] = React.useState(getStorageIssues);
  const [dismissedKey, setDismissedKey] = React.useState('');
  React.useEffect(() => subscribeStorageIssues(setIssues), []);
  if (!issues.length || issuesKey(issues) === dismissedKey) return null;
  const exportRecovery = async () => {
    const result = await window.cep.fs.showSaveDialogEx(false, false, ['json'], 'TypeR-recovery.json');
    if (!result?.data) return;
    const written = await window.cep.fs.writeFile(result.data, JSON.stringify(readStorage().data || {}));
    if (!written || written.err) nativeAlert(locale.saveError, locale.errorTitle, true);
  };
  const details = issues.map((issue) => fileName(issue.path) + ': ' + issue.reason + (issue.code ? ' (' + issue.code + ')' : '')).join(', ');
  return (
    <div role="alert" className="hostBgd hostBrdContrast" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20000, padding: '8px 26px 8px 8px', fontSize: 11, maxHeight: '40vh', overflow: 'auto', border: '1px solid #c77' }}>
      <button type="button" aria-label={locale.close} title={locale.close} onClick={() => setDismissedKey(issuesKey(issues))}
        style={{ position: 'absolute', top: 4, right: 4, width: 18, height: 18, padding: 0, border: 0, background: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14, lineHeight: '18px' }}>×</button>
      <p style={{ margin: '0 0 3px' }}>{locale.storageWarning}</p>
      <p style={{ margin: '0 0 5px', opacity: 0.6, fontSize: 10, wordBreak: 'break-all' }}>{details}</p>
      <button type="button" className="topcoat-button--large" onClick={exportRecovery}>{locale.exportRecovery}</button>{' '}
      <button type="button" className="topcoat-button--large" onClick={retryStorageSave}>{locale.retrySave}</button>
    </div>
  );
}
