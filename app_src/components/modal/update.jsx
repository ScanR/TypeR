import { useModalClose } from "../../modalClose";
import React from 'react';
import { FiX, FiDownload, FiRefreshCw, FiCheckCircle } from 'react-icons/fi';

import { locale, openUrl, downloadAndInstallUpdate, nativeAlert, writeToStorage, clearUpdateTestConfig } from '../../utils';
import { useContext } from '../../context';

const sanitizeReleaseHtml = (html) => {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blockedTags = ["script", "style", "iframe", "object", "embed", "link", "meta"];
  blockedTags.forEach((tag) => {
    Array.from(doc.querySelectorAll(tag)).forEach((node) => node.parentNode.removeChild(node));
  });
  Array.from(doc.body.querySelectorAll("*")).forEach((node) => {
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.indexOf("on") === 0 || name === "style") {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "src") && !/^(https?:|mailto:)/i.test(value)) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
};

const UpdateModal = React.memo(function UpdateModal() {
  const context = useContext((state) => ({ modalData: state.modalData }));
  const { version, releases, downloadUrl, testMode } = context.state.modalData;
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [updateStatus, setUpdateStatus] = React.useState('');
  const [updateReady, setUpdateReady] = React.useState(false);
  const sanitizedReleases = React.useMemo(
    () => (releases || []).map((release) => ({ ...release, safeBody: sanitizeReleaseHtml(release.body) })),
    [releases]
  );
  
  const close = () => {
    if (isUpdating) return; // Prevent closing during update
    context.dispatch({ type: 'setModal' });
  };
  useModalClose(close);
  
  const download = () => {
    openUrl('https://github.com/ScanR/TypeR/releases/latest');
    close();
  };

  const skipVersion = () => {
    writeToStorage({ skippedUpdateVersion: version });
    close();
  };

  const autoUpdate = () => {
    if (!downloadUrl) {
      nativeAlert(locale.updateNoDownloadUrl || 'No download URL available', locale.errorTitle, true);
      return;
    }
    
    setIsUpdating(true);
    setUpdateStatus(locale.updateDownloading || 'Downloading update...');
    
    downloadAndInstallUpdate(
      downloadUrl,
      // onProgress
      (status) => {
        setUpdateStatus(status);
      },
      // onComplete
      (needsManualStep) => {
        setIsUpdating(false);
        setUpdateStatus('');
        if (needsManualStep) {
          // The unattended installer has been launched; the user only has to
          // close Photoshop whenever convenient
          setUpdateReady(true);
        } else {
          if (testMode) {
            clearUpdateTestConfig();
          } else {
            writeToStorage({ lastInstalledUpdateVersion: version });
          }
          nativeAlert(
            locale.updateSuccess || 'Update installed successfully! Please restart Photoshop to apply changes.',
            locale.successTitle,
            false
          );
          context.dispatch({ type: "setModal", modal: null });
        }
      },
      // onError
      (error) => {
        setIsUpdating(false);
        setUpdateStatus('');
        nativeAlert(
          (locale.updateError || 'Update failed: ') + error + '\n\n' + (locale.updateTryManual || 'Please try manual download.'),
          locale.errorTitle,
          true
        );
      },
      { expectedVersion: version }
    );
  };
  
  // Show success screen when update is ready
  if (updateReady) {
    return (
      <React.Fragment>
        <div className="app-modal-header hostBrdBotContrast">
          <div className="app-modal-title">{locale.updateTitle}</div>
          <button 
            className="topcoat-icon-button--large--quiet" 
            title={locale.close} 
            onClick={close}
          >
            <FiX size={18} />
          </button>
        </div>
        <div className="app-modal-body">
          <div className="app-modal-body-inner article-format" style={{ textAlign: 'center' }}>
            <FiCheckCircle size={48} style={{ color: '#4CAF50', marginBottom: '1rem' }} />
            <h3 style={{ marginTop: 0 }}>{locale.updateDownloadComplete || 'Download Complete!'}</h3>
            <p>{locale.updateInstallerLaunched || 'The installer has been launched in a separate window.'}</p>
            <div style={{
              backgroundColor: 'rgba(0,0,0,0.2)',
              padding: '1rem',
              borderRadius: '4px',
              marginTop: '1rem',
              textAlign: 'left'
            }}>
              <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>
                {locale.updateNextSteps || 'Next steps:'}
              </p>
              <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
                <li>{locale.updateStep1 || 'Close Photoshop'}</li>
                <li>{locale.updateAutoStep2 || 'The update installs itself and Photoshop reopens automatically'}</li>
              </ol>
            </div>
            <p style={{ marginTop: '1rem', fontSize: '0.9em', opacity: 0.7 }}>
              {(locale.updateFallbackHint || 'If nothing happens, run {file} from the TypeR_Update folder in your Downloads.').replace('{file}', 'install_update.cmd (Windows) / install_update.command (Mac)')}
            </p>
          </div>
        </div>
        <div className="app-modal-footer hostBrdTopContrast">
          <button className="topcoat-button--large--cta" onClick={close}>
            {locale.close}
          </button>
        </div>
      </React.Fragment>
    );
  }
  
  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.updateTitle}</div>
        <button 
          className="topcoat-icon-button--large--quiet" 
          title={locale.close} 
          onClick={close}
          disabled={isUpdating}
        >
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner article-format">
          <p>{locale.updateText.replace('{version}', version)}</p>
          {isUpdating && (
            <div className="update-progress" style={{ 
              padding: '1rem', 
              margin: '1rem 0', 
              backgroundColor: 'rgba(0,0,0,0.2)', 
              borderRadius: '4px',
              textAlign: 'center'
            }}>
              <FiRefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} />
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>{updateStatus}</p>
            </div>
          )}
          {sanitizedReleases.map((release, index) => (
            <React.Fragment key={release.version}>
              <h3 style={{ marginTop: index === 0 ? '1rem' : '2rem', marginBottom: '0.5rem' }}>
                Version {release.version}
              </h3>
              {release.safeBody && (
                <div dangerouslySetInnerHTML={{ __html: release.safeBody }} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          className="topcoat-button--large--quiet"
          onClick={skipVersion}
          disabled={isUpdating}
          style={{ marginRight: 'auto' }}
          title={locale.updateSkipVersionHint || 'Do not show this version again at startup'}
        >
          {locale.updateSkipVersion || 'Skip this version'}
        </button>
        <button
          className="topcoat-button--large"
          onClick={download}
          disabled={isUpdating}
          title={locale.updateDownloadManual || 'Open GitHub to download manually'}
        >
          <FiDownload size={14} style={{ marginRight: '4px' }} />
          {locale.updateDownload}
        </button>
        <button 
          className="topcoat-button--large--cta" 
          onClick={autoUpdate}
          disabled={isUpdating || !downloadUrl}
          title={locale.updateAutoInstall || 'Download and install automatically'}
        >
          <FiRefreshCw size={14} style={{ marginRight: '4px' }} />
          {locale.updateAutoUpdate || 'Install'}
        </button>
      </div>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </React.Fragment>
  );
});

export default UpdateModal;
