import React from 'react';
import { FiX } from 'react-icons/fi';

import { locale, openUrl, updateExtension, nativeAlert } from '../../utils';
import { useContext } from '../../context';

const UpdateModal = React.memo(function UpdateModal() {
  const context = useContext();
  const { version, body } = context.state.modalData;
  const close = () => {
    context.dispatch({ type: 'setModal' });
  };
  const download = () => {
    context.dispatch({ type: 'setModal', modal: 'updateInstall', data: { version } });
    updateExtension(version)
      .then(() => {
        window.location.reload();
      })
      .catch((e) => {
        console.error('Auto update failed', e);
        context.dispatch({ type: 'setModal' });
        nativeAlert('Update failed', locale.errorTitle, true);
        openUrl('https://github.com/ScanR/TypeR/releases/latest');
      });
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
          {body && (
            <React.Fragment>
              <div dangerouslySetInnerHTML={{ __html: body }} />
            </React.Fragment>
          )}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast">
        <button className="topcoat-button--large" onClick={download}>{locale.updateDownload}</button>
      </div>
    </React.Fragment>
  );
});

export default UpdateModal;
