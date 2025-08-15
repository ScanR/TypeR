import React from 'react';
import { FiX } from 'react-icons/fi';

import { locale, openUrl } from '../../utils';
import { useContext } from '../../context';

const UpdateModal = React.memo(function UpdateModal() {
  const context = useContext();
  const { version, releases } = context.state.modalData;
  const close = () => {
    context.dispatch({ type: 'setModal' });
  };
  const download = () => {
    openUrl('https://github.com/ScanR/TypeR/releases/latest');
    close();
  };
  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.updateTitle}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner article-format">
          <p>{locale.updateText.replace('{version}', version)}</p>
          {releases && releases.map((release, index) => (
            <React.Fragment key={release.version}>
              <h3 style={{ marginTop: index === 0 ? '1rem' : '2rem', marginBottom: '0.5rem' }}>
                Version {release.version}
              </h3>
              {release.body && (
                <div dangerouslySetInnerHTML={{ __html: release.body }} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast">
        <button className="topcoat-button--large" onClick={download}>{locale.updateDownload}</button>
      </div>
    </React.Fragment>
  );
});

export default UpdateModal;
