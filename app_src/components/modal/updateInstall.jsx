import React from 'react';

import { locale } from '../../utils';
import { useContext } from '../../context';

const UpdateInstallModal = React.memo(function UpdateInstallModal() {
  useContext();
  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.updateTitle}</div>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner article-format">
          <p>{locale.updateInstalling}</p>
        </div>
      </div>
    </React.Fragment>
  );
});

export default UpdateInstallModal;
