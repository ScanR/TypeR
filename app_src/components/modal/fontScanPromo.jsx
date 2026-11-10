import React from 'react';
import {MdOutlineDocumentScanner} from 'react-icons/md';

import {locale} from '../../utils';
import {useContext} from '../../context';

// Small promo block shown in the create-style/create-folder modals and in the
// settings, so FontScanR stays discoverable without its own panel button
// onOpen: the window showing the promo decides when FontScanR may replace it
// (the settings confirm unsaved edits first)
const FontScanPromo = React.memo(function FontScanPromo({onOpen}) {
  const context = useContext(() => ({}));
    const openFontScanR = () => {
        const open = () => context.dispatch({type: 'setModal', modal: 'fontScanR'});
        if (onOpen) onOpen(open);
        else open();
    };

    return (
        <div className="fsr-promo hostBgd">
            <div className="fsr-promo-text">
                <b>
                    {locale.fontScanTitle}
                    <em className="fsr-promo-badge">{locale.settingsNewBadge}</em>
                </b>
                <span>{locale.fontScanPromo}</span>
            </div>
            <button type="button" className="topcoat-button--large fsr-promo-btn" data-tour="font-scan-open" onClick={openFontScanR}>
                <MdOutlineDocumentScanner size={16} /> {locale.fontScanOpen}
            </button>
        </div>
    );
});

export default FontScanPromo;
