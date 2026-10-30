import React from "react";
import PropTypes from "prop-types";
import { FiAlertTriangle } from "react-icons/fi";

import { locale } from "../../utils";
import useFontFinderMatches from "../../useFontFinderMatches";
import { FontFinderBanner, FontFinderSuggestion, FontWebSearchButton } from "./fontFinderSuggestion";

// Shown over the settings after a style import that uses fonts this computer
// lacks: lists them and offers the Font FindeR matches.
const MissingFontsDialog = React.memo(function MissingFontsDialog({ fonts, message, onClose }) {
  const fontFinder = useFontFinderMatches(fonts);

  return (
    <div className="settings-confirm-overlay" onClick={onClose}>
      <div className="settings-confirm-dialog missing-fonts-dialog hostBgdLight" onClick={(e) => e.stopPropagation()}>
        <div className="settings-confirm-icon">
          <FiAlertTriangle size={26} />
        </div>
        <div className="settings-confirm-title">{locale.missingFontsTitle.replace("{count}", fonts.length)}</div>
        <div className="settings-confirm-text">
          {message ? <div>{message}</div> : null}
          <div>{fontFinder.available ? locale.missingFontsIntro : locale.missingFontsIntroOffline}</div>
        </div>
        {fontFinder.foundKeys.length > 1 && (
          <FontFinderBanner
            count={fontFinder.foundKeys.length}
            busy={fontFinder.busy}
            onInstallAll={() => fontFinder.install(fontFinder.foundKeys)}
          />
        )}
        <div className="missing-fonts-list">
          {fonts.map((font) => {
            const entry = fontFinder.entries[font.key];
            return (
              <div key={font.key} className="missing-fonts-item">
                <div className="missing-fonts-main">
                  <div className="missing-fonts-name" title={font.postScriptName || font.fontName}>
                    {font.fontName || font.postScriptName}
                  </div>
                  {font.styles.length > 0 && (
                    <div className="missing-fonts-styles" title={font.styles.join(", ")}>
                      {locale.missingFontsUsedBy.replace("{styles}", font.styles.join(", "))}
                    </div>
                  )}
                  <div className="missing-fonts-status">
                    <FontFinderSuggestion
                      entry={entry}
                      busy={fontFinder.busy}
                      onInstall={() => fontFinder.install([font.key])}
                    />
                    {fontFinder.available && entry && (entry.state === "none" || entry.state === "error") && (
                      <span className="missing-fonts-none">
                        {entry.state === "none" ? locale.missingFontsNotFound : locale.fontViewerUnavailable}
                      </span>
                    )}
                  </div>
                </div>
                {fontFinder.isUnmatched(font.key) && (
                  <FontWebSearchButton fontName={font.fontName} postScriptName={font.postScriptName} />
                )}
              </div>
            );
          })}
        </div>
        <div className="settings-confirm-actions">
          <button type="button" className="topcoat-button--large--cta" onClick={onClose}>
            {locale.close}
          </button>
        </div>
      </div>
    </div>
  );
});
MissingFontsDialog.propTypes = {
  fonts: PropTypes.array.isRequired,
  message: PropTypes.string,
  onClose: PropTypes.func.isRequired,
};

export default MissingFontsDialog;
