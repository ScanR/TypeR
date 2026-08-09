import React from 'react';
import { FaFileImport } from 'react-icons/fa';
import { locale } from '../../utils';

const TplImportPromo = React.memo(function TplImportPromo({ onImportTpl }) {
  return (
    <div className="fsr-promo hostBgd">
      <div className="fsr-promo-text">
        <b>
          {locale.tplImportTitle || "Photoshop Presets (.TPL)"}
          <em className="fsr-promo-badge">{locale.badgeNew || "NEW"}</em>
        </b>
        <span>{locale.tplImportPromo || "Convert and import Photoshop .TPL text tool preset files directly into your TypeR style library."}</span>
      </div>
      <button type="button" className="topcoat-button--large fsr-promo-btn" onClick={onImportTpl}>
        <FaFileImport size={16} /> {locale.tplImportOpen || "Import .TPL Presets"}
      </button>
    </div>
  );
});

export default TplImportPromo;
