import './modal.scss';

import React from 'react';
import PropTypes from 'prop-types';
import {useContext} from '../../context';
import HelpModal from './help';
import SettingsModal from './settings';
import EditStyleModal from './editStyle';
import EditFolderModal from './editFolder';
import ExportModal from './export';
import UpdateModal from './update';


const Modal = React.memo(function Modal() {
    const context = useContext();

    let modalContent = null;
    let modalType = context.state.modalType;
    if (modalType === 'help') modalContent = <HelpModal />;
    else if (modalType === 'settings') modalContent = <SettingsModal />;
    else if (modalType === 'editStyle') modalContent = <EditStyleModal />;
    else if (modalType === 'editFolder') modalContent = <EditFolderModal />;
    else if (modalType === 'export') modalContent = <ExportModal />;
    else if (modalType === 'update') modalContent = <UpdateModal />;

    React.useEffect(() => {
        if (!context.state.notFirstTime) {
            context.dispatch({type: 'removeFirstTime'});
        }
    }, []);

    return modalContent ? (
        <div className="app-modal">
            <div className="app-modal-hatch hostBgd"></div>
            <div className="app-modal-inner hostBgdLight">
                {modalContent}
            </div>
        </div>
    ) : null;
});

export default Modal;