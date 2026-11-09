import { useModalClose } from "../../modalClose";
import React from 'react';
import { FiX, FiDownload, FiRefreshCw, FiArrowUpCircle } from 'react-icons/fi';

import { locale, openUrl, downloadAndInstallUpdate, nativeAlert, writeToStorage, clearUpdateTestConfig } from '../../utils';
import { useContext } from '../../context';
import config from '../../config';

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
  // GitHub prints bare links as their full URL: show a short, readable form
  Array.from(doc.body.querySelectorAll("a[href]")).forEach((link) => {
    const href = link.getAttribute("href");
    const text = (link.textContent || "").trim();
    if (text === href || text.replace(/\/$/, "") === href.replace(/\/$/, "")) {
      link.textContent = href.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
    }
  });
  // Real elements for the bullets: list markers and pseudo-elements render
  // differently in CEP, the UXP WebView and UXP's own panel DOM
  Array.from(doc.body.querySelectorAll("ul > li")).forEach((item) => {
    const bullet = doc.createElement("span");
    bullet.className = "update-bullet";
    item.insertBefore(bullet, item.firstChild);
  });
  return doc.body.innerHTML;
};

const findLink = (node, root) => {
  while (node && node !== root) {
    if (node.tagName && node.tagName.toLowerCase() === "a" && node.getAttribute("href")) return node;
    node = node.parentNode;
  }
  return null;
};

const formatReleaseDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  try {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch (e) {
    return date.toLocaleDateString();
  }
};

const UpdateModal = React.memo(function UpdateModal() {
  const context = useContext((state) => ({ modalData: state.modalData }));
  const { version, releases, downloadUrl, testMode, currentVersion } = context.state.modalData;
  const installedVersion = currentVersion || config.appVersion;
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [updateStatus, setUpdateStatus] = React.useState('');
  const sanitizedReleases = React.useMemo(
    () => (releases || []).map((release) => ({ ...release, safeBody: sanitizeReleaseHtml(release.body) })),
    [releases]
  );
  
  const close = () => {
    if (isUpdating) return; // Prevent closing during update
    context.dispatch({ type: 'setModal' });
  };
  useModalClose(close);
  
  // Links in the release notes would navigate the panel itself: open them in the browser
  const onNotesClick = (event) => {
    const link = findLink(event.target, event.currentTarget);
    if (!link) return;
    event.preventDefault();
    openUrl(link.getAttribute("href"));
  };

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
      ({ reloading }) => {
        if (testMode) {
          clearUpdateTestConfig();
        } else if (!reloading) {
          writeToStorage({ lastInstalledUpdateVersion: version });
        }
        // The panel is about to reload with the new version
        if (reloading) return;
        setIsUpdating(false);
        setUpdateStatus('');
        nativeAlert(
          locale.updateSuccess || 'Update installed successfully! Please restart Photoshop to apply changes.',
          locale.successTitle,
          false
        );
        context.dispatch({ type: "setModal", modal: null });
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
        <div className="app-modal-body-inner update-modal">
          <div className="update-hero">
            <span className="update-hero-icon"><FiArrowUpCircle size={22} /></span>
            <div className="update-hero-text">
              <div className="update-hero-version">TypeR {version}</div>
              {installedVersion && (
                <div className="update-hero-current">
                  {(locale.updateInstalledVersion || 'You have version {version}').replace('{version}', installedVersion)}
                </div>
              )}
            </div>
          </div>
          {isUpdating && (
            <div className="update-progress">
              <FiRefreshCw size={18} className="update-spin" />
              <span>{updateStatus}</span>
            </div>
          )}
          <div className="update-notes article-format" onClick={onNotesClick}>
            {sanitizedReleases.map((release) => (
              <section className="update-release" key={release.version}>
                {sanitizedReleases.length > 1 && (
                  <div className="update-release-title">
                    <span>{release.version}</span>
                    {formatReleaseDate(release.published_at) && (
                      <span className="update-release-date">{formatReleaseDate(release.published_at)}</span>
                    )}
                  </div>
                )}
                {release.safeBody && (
                  <div dangerouslySetInnerHTML={{ __html: release.safeBody }} />
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast update-footer">
        <button
          className="topcoat-button--large--quiet update-skip"
          onClick={skipVersion}
          disabled={isUpdating}
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
          <FiDownload size={14} />
          {locale.updateDownload}
        </button>
        <button 
          className="topcoat-button--large--cta" 
          onClick={autoUpdate}
          disabled={isUpdating || !downloadUrl}
          title={locale.updateAutoInstall || 'Download and install automatically'}
        >
          <FiRefreshCw size={14} />
          {locale.updateAutoUpdate || 'Install'}
        </button>
      </div>
    </React.Fragment>
  );
});

export default UpdateModal;
