import React from "react";
import ReactDOM from "react-dom";
import PropTypes from "prop-types";
import { FiArchive, FiFileText } from "react-icons/fi";

import { locale } from "../../utils";

// Asks for the format of a folder export: the styles alone or with their fonts.
// In a portal: the folder header around the export button reacts to clicks and drags.
const ExportFolderDialog = React.memo(function ExportFolderDialog({ folderName, onChoose, onCancel }) {
  const firstOptionRef = React.useRef(null);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    firstOptionRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  return ReactDOM.createPortal(
    <div
      className="settings-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-folder-title"
      onClick={onCancel}
    >
      <div className="settings-confirm-dialog hostBgdLight" onClick={(event) => event.stopPropagation()}>
        <div id="export-folder-title" className="settings-confirm-title">
          {locale.exportFolder || "Export folder"}
        </div>
        <div className="settings-confirm-text export-folder-name" title={folderName}>{folderName}</div>
        <div className="export-folder-options">
          <button ref={firstOptionRef} type="button" className="topcoat-button--large export-folder-option" onClick={() => onChoose(false)}>
            <FiFileText size={18} />
            <span className="export-folder-option-text">
              <strong>{locale.exportFolderJson || "Styles only (.json)"}</strong>
              <small>{locale.exportFolderJsonHint || "Just the styles, without the font files."}</small>
            </span>
          </button>
          <button type="button" className="topcoat-button--large export-folder-option" onClick={() => onChoose(true)}>
            <FiArchive size={18} />
            <span className="export-folder-option-text">
              <strong>{locale.exportFolderZip || "Styles and fonts (.zip)"}</strong>
              <small>{locale.exportFolderZipHint || "Also includes the .ttf and .otf files of the fonts used."}</small>
            </span>
          </button>
        </div>
        <div className="settings-confirm-actions">
          <button type="button" className="topcoat-button--large" onClick={onCancel}>
            {locale.cancel || "Cancel"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
});
ExportFolderDialog.propTypes = {
  folderName: PropTypes.string,
  onChoose: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default ExportFolderDialog;
