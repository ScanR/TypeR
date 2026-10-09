import React from 'react';
import {useContext} from '../../context';
import {locale} from '../../utils';

const modalLoaders = {
    doubleBubbleAssist: () => import(/* webpackChunkName: "modal-double-bubble-assist" */ './doubleBubbleAssist'),
    help: () => import(/* webpackChunkName: "modal-help" */ './help'),
    walkthrough: () => import(/* webpackChunkName: "modal-walkthrough" */ './walkthrough'),
    settings: () => import(/* webpackChunkName: "modal-settings" */ './settings'),
    editStyle: () => import(/* webpackChunkName: "modal-edit-style" */ './editStyle'),
    editFolder: () => import(/* webpackChunkName: "modal-edit-folder" */ './editFolder'),
    export: () => import(/* webpackChunkName: "modal-export" */ './export'),
    fontScanR: () => import(/* webpackChunkName: "modal-font-scan" */ './fontScanR'),
    update: () => import(/* webpackChunkName: "modal-update" */ './update'),
};
const DoubleBubbleAssistModal = React.lazy(modalLoaders.doubleBubbleAssist);
const HelpModal = React.lazy(modalLoaders.help);
const WalkthroughModal = React.lazy(modalLoaders.walkthrough);
const SettingsModal = React.lazy(modalLoaders.settings);
const EditStyleModal = React.lazy(modalLoaders.editStyle);
const EditFolderModal = React.lazy(modalLoaders.editFolder);
const ExportModal = React.lazy(modalLoaders.export);
const FontScanRModal = React.lazy(modalLoaders.fontScanR);
const UpdateModal = React.lazy(modalLoaders.update);
let modalStylesPromise = null;
const loadModalStyles = () => {
    if (!modalStylesPromise) {
        modalStylesPromise = import(/* webpackChunkName: "modal-shell" */ './modal.scss');
    }
    return modalStylesPromise;
};

class ModalErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {hasError: false};
    }

    static getDerivedStateFromError() {
        return {hasError: true};
    }

    componentDidUpdate(prevProps) {
        if (prevProps.modalType !== this.props.modalType && this.state.hasError) {
            this.setState({hasError: false});
        }
    }

    render() {
        if (!this.state.hasError) return this.props.children;
        return (
            <React.Fragment>
                <div className="app-modal-header hostBrdBotContrast">
                    <div className="app-modal-title">{locale.errorTitle}</div>
                </div>
                <div className="app-modal-body">
                    <div className="app-modal-body-inner article-format">
                        <p>{locale.modalLoadError || 'Unable to load this window. Please close and reopen TypeR.'}</p>
                    </div>
                </div>
                <div className="app-modal-footer hostBrdTopContrast">
                    <button className="topcoat-button--large" onClick={this.props.onClose}>{locale.close}</button>
                </div>
            </React.Fragment>
        );
    }
}

const Modal = React.memo(function Modal() {
    const context = useContext((state) => ({
        modalType: state.modalType,
        notFirstTime: state.notFirstTime,
    }));
    const close = React.useCallback(() => {
        context.dispatch({type: 'setModal'});
    }, [context.dispatch]);
    const [stylesReady, setStylesReady] = React.useState(false);

    let modalContent = null;
    let modalType = context.state.modalType;
    if (modalType === 'doubleBubbleAssist') modalContent = <DoubleBubbleAssistModal />;
    else if (modalType === 'help') modalContent = <HelpModal />;
    else if (modalType === 'walkthrough') modalContent = <WalkthroughModal />;
    else if (modalType === 'settings') modalContent = <SettingsModal />;
    else if (modalType === 'editStyle') modalContent = <EditStyleModal />;
    else if (modalType === 'editFolder') modalContent = <EditFolderModal />;
    else if (modalType === 'export') modalContent = <ExportModal />;
    else if (modalType === 'fontScanR') modalContent = <FontScanRModal />;
    else if (modalType === 'update') modalContent = <UpdateModal />;

    React.useEffect(() => {
        if (!context.state.notFirstTime) {
            context.dispatch({type: 'showFirstRunWalkthrough'});
        }
    }, []);

    React.useEffect(() => {
        if (!modalType || stylesReady) return undefined;
        let active = true;
        const modalLoader = modalLoaders[modalType] || (() => Promise.resolve());
        Promise.all([loadModalStyles(), modalLoader()]).then(
            () => {
                if (active) setStylesReady(true);
            },
            () => {
                // Let the error boundary render a useful recovery message even
                // if a local chunk could not be read.
                if (active) setStylesReady(true);
            }
        );
        return () => {
            active = false;
        };
    }, [modalType, stylesReady]);

    return modalContent && stylesReady ? (
        <div className={`app-modal${modalType === 'walkthrough' ? ' app-modal--walkthrough' : ''}`}>
            {modalType !== 'walkthrough' && <div className="app-modal-hatch hostBgd"></div>}
            <div className={`app-modal-inner hostBgdLight${modalType === 'walkthrough' ? ' app-modal-inner--walkthrough' : ''}`}>
                <ModalErrorBoundary modalType={modalType} onClose={close}>
                    <React.Suspense fallback={<div className="app-modal-body"><div className="app-modal-body-inner">{locale.loading || 'Loading...'}</div></div>}>
                        {modalContent}
                    </React.Suspense>
                </ModalErrorBoundary>
            </div>
        </div>
    ) : null;
});

export default Modal;
