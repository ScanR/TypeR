import './studioPromo.scss';

import React from 'react';
import {FiX, FiZap, FiType, FiLayers, FiTool, FiHeart, FiGlobe, FiDownload} from 'react-icons/fi';

import {useModalClose} from '../../modalClose';
import {locale, openUrl, readStorage, writeToStorage} from '../../utils';
import {useContext} from '../../context';
import {
    STUDIO_PROMO_OFF_KEY,
    STUDIO_PROMO_RECORD_KEY,
    STUDIO_WEB_URL,
    closeStudioPromo,
} from '../../studioPromo';
import {studioDownloadUrl} from '../../openInStudio';
import preview from '../../assets/typer-studio-preview.jpg';
import logo from '../../assets/typer-logo-64.png';

const FEATURES = [
    {icon: FiZap, title: 'studioPromoFastTitle', text: 'studioPromoFastText'},
    {icon: FiType, title: 'studioPromoLetteringTitle', text: 'studioPromoLetteringText'},
    {icon: FiTool, title: 'studioPromoToolsTitle', text: 'studioPromoToolsText'},
    {icon: FiLayers, title: 'studioPromoPageTitle', text: 'studioPromoPageText'},
    {icon: FiHeart, title: 'studioPromoFreeTitle', text: 'studioPromoFreeText'},
];

const StudioPromoModal = React.memo(function StudioPromoModal() {
    const context = useContext((state) => ({modalData: state.modalData}));
    const data = context.state.modalData || {};
    const promo = data.promo;
    // Shown by the test mode: leaves no answer behind
    const [hideForGood, setHideForGood] = React.useState(false);

    const finish = (later) => {
        if (promo && !data.test) {
            const record = closeStudioPromo({
                promo,
                record: readStorage(STUDIO_PROMO_RECORD_KEY),
                later,
                now: Date.now(),
            });
            writeToStorage({[STUDIO_PROMO_RECORD_KEY]: record});
        }
        if (hideForGood && !data.test) writeToStorage({[STUDIO_PROMO_OFF_KEY]: true});
        context.dispatch({type: 'setModal'});
    };
    const later = () => finish(true);
    useModalClose(later);

    const tryOnline = () => {
        openUrl(STUDIO_WEB_URL);
        finish(false);
    };
    const download = () => {
        // The installer for this computer: .exe, or the .dmg for its Mac chip
        openUrl(studioDownloadUrl());
        finish(false);
    };

    return (
        <div className="studio-promo">
            <div className="studio-promo-body">
                <div className="studio-promo-hero">
                    <img src={preview} alt="" />
                    <span className="studio-promo-badge">{locale.studioPromoBadge}</span>
                    <button type="button" className="studio-promo-close" title={locale.close} onClick={later}>
                        <FiX size={14} />
                    </button>
                </div>
                <div className="studio-promo-content">
                    <div className="studio-promo-brand">
                        <img className="studio-promo-logo" src={logo} alt="" />
                        <span className="studio-promo-name">TypeR Studio</span>
                    </div>
                    <p className="studio-promo-pitch">{locale.studioPromoPitch}</p>
                    <ul className="studio-promo-features">
                        {FEATURES.map(({icon: Icon, title, text}) => (
                            <li key={title}>
                                <Icon size={14} className="studio-promo-icon" />
                                <div>
                                    <b>{locale[title]}</b>
                                    <span>{locale[text]}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div className="studio-promo-platforms">
                        <span><FiGlobe size={11} /> {locale.studioPromoBrowser}</span>
                        <span>Windows</span>
                        <span>macOS</span>
                    </div>
                </div>
                <div className="studio-promo-actions hostBgdLight">
                    <button type="button" className="topcoat-button--large--cta" onClick={tryOnline}>
                        <FiGlobe size={14} /> {locale.studioPromoTry}
                    </button>
                    <button type="button" className="topcoat-button--large" onClick={download}>
                        <FiDownload size={14} /> {locale.studioPromoDownload}
                    </button>
                </div>
            </div>
            <div className="app-modal-footer hostBrdTopContrast studio-promo-footer">
                <label className="studio-promo-hide">
                    <input type="checkbox" checked={hideForGood} onChange={(e) => setHideForGood(e.target.checked)} />
                    <div className="settings-checkbox-custom"></div>
                    <span>{locale.studioPromoHide}</span>
                </label>
                <button type="button" className="topcoat-button--large--quiet" onClick={later}>
                    {locale.studioPromoLater}
                </button>
            </div>
        </div>
    );
});

export default StudioPromoModal;
