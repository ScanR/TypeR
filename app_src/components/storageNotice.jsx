import React from 'react';
import { getStorageIssues, subscribeStorageIssues } from '../storageIO';
import { locale, readStorage, flushStorageWrite, nativeAlert } from '../utils';

export default function StorageNotice() {
  const [issues, setIssues] = React.useState(getStorageIssues);
  React.useEffect(() => subscribeStorageIssues(setIssues), []);
  if (!issues.length) return null;
  const exportRecovery = () => {
    const result = window.cep.fs.showSaveDialogEx(false, false, ['json'], 'TypeR-recovery.json');
    if (!result?.data) return;
    const written = window.cep.fs.writeFile(result.data, JSON.stringify(readStorage().data || {}));
    if (!written || written.err) nativeAlert(locale.saveError, locale.errorTitle, true);
  };
  return (
    <div role="alert" className="hostBgd hostBrdContrast" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20000, padding: 8, fontSize: 11, maxHeight: '40vh', overflow: 'auto', border: '1px solid #c77' }}>
      <p style={{ margin: '0 0 5px' }}>{locale.storageWarning}</p>
      <button type="button" className="topcoat-button--large" onClick={exportRecovery}>{locale.exportRecovery}</button>{' '}
      <button type="button" className="topcoat-button--large" onClick={() => { if (flushStorageWrite(true)) setIssues([]); }}>{locale.retrySave}</button>
    </div>
  );
}
