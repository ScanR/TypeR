import React from 'react';
import {useContext} from '../../context';
import {getUpdateTestConfig, locale, readStorage} from '../../utils';
import {readUxpMigrationState, startupUxpGuide} from '../../uxpMigration';
import config from '../../config';
import {getWhatsNewDock, isTourModal, restoreTourTuning, whatsNewSession} from '../../whatsNewSession';
import {getGuideStyle} from '../../whatsNewGuide';
import {fetchBody} from '../../network';
import {
    STUDIO_PROMO_OFF_KEY,
    STUDIO_PROMO_RECORD_KEY,
    STUDIO_PROMO_URL,
    isInsideStudio,
    parseStudioPromo,
    shouldShowStudioPromo,
} from '../../studioPromo';

// The TypeR Studio window waits this long once no other window is open, so it
// never takes the place of one opening at the same moment
const STUDIO_PROMO_DELAY = 1500;

const modalLoaders = {
    help: () => import(/* webpackChunkName: "modal-help" */ './help'),
    walkthrough: () => import(/* webpackChunkName: "modal-walkthrough" */ './walkthrough'),
    whatsNew: () => import(/* webpackChunkName: "modal-whats-new" */ './whatsNew'),
    settings: () => import(/* webpackChunkName: "modal-settings" */ './settings'),
    editStyle: () => import(/* webpackChunkName: "modal-edit-style" */ './editStyle'),
    editFolder: () => import(/* webpackChunkName: "modal-edit-folder" */ './editFolder'),
    export: () => import(/* webpackChunkName: "modal-export" */ './export'),
    fontScanR: () => import(/* webpackChunkName: "modal-font-scan" */ './fontScanR'),
    update: () => import(/* webpackChunkName: "modal-update" */ './update'),
    uxpMigration: () => import(/* webpackChunkName: "modal-uxp-migration" */ './uxpMigration'),
    studioPromo: () => import(/* webpackChunkName: "modal-studio-promo" */ './studioPromo'),
};
const HelpModal = React.lazy(modalLoaders.help);
const WalkthroughModal = React.lazy(modalLoaders.walkthrough);
const WhatsNewModal = React.lazy(modalLoaders.whatsNew);
const SettingsModal = React.lazy(modalLoaders.settings);
const EditStyleModal = React.lazy(modalLoaders.editStyle);
const EditFolderModal = React.lazy(modalLoaders.editFolder);
const ExportModal = React.lazy(modalLoaders.export);
const FontScanRModal = React.lazy(modalLoaders.fontScanR);
const UpdateModal = React.lazy(modalLoaders.update);
const UxpMigrationModal = React.lazy(modalLoaders.uxpMigration);
const StudioPromoModal = React.lazy(modalLoaders.studioPromo);
let modalStylesPromise = null;
const loadModalStyles = () => {
    if (!modalStylesPromise) {
        modalStylesPromise = import(/* webpackChunkName: "modal-shell" */ './modal.scss');
    }
    return modalStylesPromise;
};

// The tip of the current tour step, under a window the tour sent the user
// to (settings, style editor): the guide itself is hidden behind it
const TourCoach = React.memo(function TourCoach() {
    const [, refresh] = React.useReducer((count) => count + 1, 0);
    React.useEffect(() => {
        const timer = setInterval(refresh, 400);
        return () => clearInterval(timer);
    }, []);
    const coach = whatsNewSession.coach;
    if (!coach) return null;
    const done = !!whatsNewSession.done[coach.stepId];
    return (
        <div className={`whats-new-coach hostBgdLight${done ? ' m-done' : ''}`} role="status">
            <div className="whats-new-coach-title">
                {done
                    ? '✓ ' + (locale.whatsNewCoachDone || 'Done! Close this window to go on with the guide.')
                    : whatsNewSession.course === 'walkthrough'
                        ? locale.walkthroughCoachTitle || 'TypeR guide'
                        : locale.whatsNewCoachTitle || 'TypeR 3.0 guide'}
            </div>
            <div>{coach.text}</div>
        </div>
    );
});

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
        checkUpdates: state.checkUpdates,
        whatsNewSeen: state.whatsNewSeen,
        modalData: state.modalData,
        uiLayout: state.uiLayout,
    }));
    const close = React.useCallback(() => {
        context.dispatch({type: 'setModal'});
    }, [context.dispatch]);
    const [stylesReady, setStylesReady] = React.useState(false);

    let modalContent = null;
    let modalType = context.state.modalType;
    if (modalType === 'help') modalContent = <HelpModal />;
    else if (modalType === 'walkthrough') modalContent = <WalkthroughModal />;
    else if (modalType === 'whatsNew') modalContent = <WhatsNewModal />;
    else if (modalType === 'settings') modalContent = <SettingsModal />;
    else if (modalType === 'editStyle') modalContent = <EditStyleModal />;
    else if (modalType === 'editFolder') modalContent = <EditFolderModal />;
    else if (modalType === 'export') modalContent = <ExportModal />;
    else if (modalType === 'fontScanR') modalContent = <FontScanRModal />;
    else if (modalType === 'update') modalContent = <UpdateModal />;
    else if (modalType === 'uxpMigration') modalContent = <UxpMigrationModal />;
    else if (modalType === 'studioPromo') modalContent = <StudioPromoModal />;

    const openStartWindow = () => {
        if (!context.state.notFirstTime) {
            context.dispatch({type: 'showFirstRunWalkthrough'});
        } else if (context.state.whatsNewSeen !== config.whatsNewVersion) {
            context.dispatch({type: 'showWhatsNew'});
        }
    };

    // Legacy panel: the guide to the new TypeR comes first, and hands over to
    // the walkthrough or What's new when it closes. Runs before the effect
    // below opens it, which would otherwise count as closed.
    const uxpGuideOpen = React.useRef(false);
    React.useEffect(() => {
        if (!uxpGuideOpen.current || modalType === 'uxpMigration') return;
        uxpGuideOpen.current = false;
        if (!modalType) openStartWindow();
    }, [modalType]);

    React.useEffect(() => {
        // A TextShapeR lesson left by a tour Photoshop closed in the middle of
        if (!whatsNewSession.active) restoreTourTuning(context.dispatch);
        let guide = null;
        try {
            guide = startupUxpGuide({
                ...readUxpMigrationState(getUpdateTestConfig()),
                noticeHidden: readStorage('uxpInstalledNoticeHidden'),
                record: readStorage('uxpMigration'),
                now: Date.now(),
                notFirstTime: context.state.notFirstTime,
                checkUpdates: context.state.checkUpdates,
            });
        } catch (error) {
            console.warn('TypeR: UXP guide', error);
        }
        if (guide) {
            uxpGuideOpen.current = true;
            context.dispatch({type: 'setModal', modal: 'uxpMigration', data: guide});
        } else {
            openStartWindow();
        }
    }, []);

    // TypeR Studio window: the TypeR site says once per startup whether it is
    // on. Not for someone opening TypeR for the first time, who has the
    // walkthrough to go through, nor inside TypeR Studio itself.
    const [studioPromo, setStudioPromo] = React.useState(null);
    const knownUser = React.useRef(context.state.notFirstTime);
    React.useEffect(() => {
        if (isInsideStudio()) return undefined;
        let testConfig = null;
        try {
            testConfig = getUpdateTestConfig();
        } catch (error) {}
        // Test mode shows it whatever the site and what was answered before
        if (testConfig && testConfig.forceStudioPromo) {
            setStudioPromo({promo: {id: 1}, test: true});
            return undefined;
        }
        if (!knownUser.current || readStorage(STUDIO_PROMO_OFF_KEY) === true) return undefined;
        let active = true;
        fetchBody(STUDIO_PROMO_URL, {}, 'json', 10000).then((data) => {
            const promo = parseStudioPromo(data);
            if (!active || !shouldShowStudioPromo({
                promo,
                record: readStorage(STUDIO_PROMO_RECORD_KEY),
                off: readStorage(STUDIO_PROMO_OFF_KEY),
                now: Date.now(),
            })) return;
            setStudioPromo({promo});
        }).catch(() => {
            // Offline or no switch on the site: nothing to show
        });
        return () => {
            active = false;
        };
    }, []);
    React.useEffect(() => {
        if (!studioPromo || modalType || whatsNewSession.active) return undefined;
        const timer = setTimeout(() => {
            if (whatsNewSession.active) return;
            context.dispatch({type: 'setModal', modal: 'studioPromo', data: studioPromo});
            setStudioPromo(null);
        }, STUDIO_PROMO_DELAY);
        return () => clearTimeout(timer);
    }, [studioPromo, modalType]);

    // A window opened from a tour hands back to it on close
    React.useEffect(() => {
        if (!modalType && whatsNewSession.active) context.dispatch({type: 'setModal', modal: whatsNewSession.course});
    }, [modalType]);

    // The tours float over the panel so it stays usable
    const floating = isTourModal(modalType);
    const coached = !floating && whatsNewSession.active && !!whatsNewSession.coach &&
        whatsNewSession.coach.modal === modalType;

    // A window covers the panel. In Photoshop's own panel DOM (no WebView,
    // uxp-src/web/inpanel/style.scss), form fields are native widgets drawn
    // above everything: the panel's own fields under the window are hidden
    const covering = !!modalType && !floating;
    React.useEffect(() => {
        document.body.classList.toggle('typer-modal-open', covering);
        return () => document.body.classList.remove('typer-modal-open');
    }, [covering]);

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
        <div className={`app-modal${floating ? ' app-modal--walkthrough' : ''}${coached ? ' app-modal--coached' : ''}`}>
            {!floating && <div className="app-modal-hatch hostBgd"></div>}
            {/* Own element for the tour: its dragged position never sticks to another window */}
            <div
                key={floating ? 'tour-' + modalType : 'modal'}
                className={`app-modal-inner hostBgdLight${floating ? ' app-modal-inner--walkthrough app-modal-inner--whats-new m-' + getWhatsNewDock(context.state.uiLayout) : ''}`}
                style={floating ? getGuideStyle() : undefined}
            >
                <ModalErrorBoundary modalType={modalType} onClose={close}>
                    <React.Suspense fallback={<div className="app-modal-body"><div className="app-modal-body-inner">{locale.loading || 'Loading...'}</div></div>}>
                        {modalContent}
                    </React.Suspense>
                </ModalErrorBoundary>
            </div>
            {coached && <TourCoach />}
        </div>
    ) : null;
});

export default Modal;
