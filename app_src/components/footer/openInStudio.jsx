// The footer's Open in TypeR Studio button and its dialog (openInStudio.js
// does the work). Without TypeR Studio, the same dialog offers to download it.

import React from "react";
import { FiExternalLink, FiDownload } from "react-icons/fi";
import { locale, openUrl, readStorage, writeToStorage } from "../../utils";
import { useContext } from "../../context";
import {
  isStudioInstalled, launchStudio, listStudioDocuments, saveForStudio, studioDownloadUrl, writeStudioRequest,
} from "../../openInStudio";

const STORAGE_KEY = "openInStudio";
// The button reads the state when clicked: it never renders again for it
const NOTHING = {};
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (all, key) => (key in values ? values[key] : all));

// A folder for the documents that have no Photoshop file yet, or null
const chooseFolder = async (near) => {
  const title = locale.studioChooseFolder || "Choose a folder for the documents that have no Photoshop file yet.";
  const result = await Promise.resolve(window.cep.fs.showOpenDialogEx(false, true, title, near || null, []));
  return result && !result.err && result.data && result.data[0] ? result.data[0] : null;
};

const StudioDialog = ({ title, icon, children, okLabel, onOk, onCancel }) => {
  const okRef = React.useRef(null);
  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    if (okRef.current) okRef.current.focus();
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);
  return (
    <div className="settings-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="open-in-studio-title" onClick={onCancel}>
      <div className="settings-confirm-dialog open-in-studio hostBgdLight" onClick={(event) => event.stopPropagation()}>
        <div className="settings-confirm-icon">{icon}</div>
        <div id="open-in-studio-title" className="settings-confirm-title">{title}</div>
        {children}
        <div className="settings-confirm-actions">
          <button type="button" className="topcoat-button--large" onClick={onCancel}>
            {locale.cancel || "Cancel"}
          </button>
          <button ref={okRef} type="button" className="topcoat-button--large--cta" onClick={onOk}>
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const OpenInStudioButton = React.memo(function OpenInStudioButton() {
  const context = useContext(() => NOTHING);
  const [dialog, setDialog] = React.useState(null);
  const [choice, setChoice] = React.useState({ documents: "one", script: false });
  const busy = React.useRef(false);
  const label = locale.footerStudio || "Open in TypeR Studio";
  const notice = (text) => context.dispatch({ type: "showNotice", text, kind: "warning" });

  // The script of the open tab, or null when it's empty
  const currentScript = () => {
    const state = context.getState();
    const tab = (state.tabs || []).find((one) => one.id === state.currentTabId);
    const text = typeof state.text === "string" ? state.text : "";
    return text.trim() ? { name: tab ? tab.name : "", text } : null;
  };

  const send = async (documents, script) => {
    const files = await saveForStudio(documents, chooseFolder);
    if (!files) return;
    if (files.error) {
      notice(fill(locale.studioSaveFailed || "Could not save {name}: {error}", { name: files.name, error: files.error }));
      return;
    }
    try {
      await writeStudioRequest(files, script);
      await launchStudio();
      context.dispatch({ type: "showNotice", text: locale.studioOpening || "Opening in TypeR Studio…", kind: "info" });
    } catch (error) {
      notice(fill(locale.studioFailed || "TypeR Studio could not be opened: {error}", { error: (error && error.message) || error }));
    }
  };

  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await isStudioInstalled())) {
        setDialog({ missing: true });
        return;
      }
      const documents = await listStudioDocuments();
      if (!documents.length) {
        notice(locale.studioNoDocument || "Open a document in Photoshop first.");
        return;
      }
      const script = currentScript();
      // Nothing to ask: one document and no script
      if (documents.length < 2 && !script) {
        await send(documents, null);
        return;
      }
      const kept = readStorage(STORAGE_KEY) || {};
      setChoice({ documents: kept.documents === "all" ? "all" : "one", script: kept.script === true });
      setDialog({ documents, script });
    } finally {
      busy.current = false;
    }
  };

  const close = React.useCallback(() => setDialog(null), []);

  const confirm = async () => {
    const shown = dialog;
    setDialog(null);
    if (!shown || shown.missing) {
      openUrl(studioDownloadUrl());
      return;
    }
    writeToStorage({ [STORAGE_KEY]: { documents: choice.documents, script: shown.script ? choice.script : (readStorage(STORAGE_KEY) || {}).script === true } });
    const active = shown.documents.filter((doc) => doc.active);
    const documents = choice.documents === "all" || shown.documents.length < 2 ? shown.documents : (active.length ? active : shown.documents.slice(0, 1));
    busy.current = true;
    try {
      await send(documents, shown.script && choice.script ? shown.script : null);
    } finally {
      busy.current = false;
    }
  };

  return (
    <React.Fragment>
      <button type="button" className="footer-icon-button" title={label} aria-label={label} onClick={start}>
        <FiExternalLink size={14} />
      </button>
      {dialog && dialog.missing && (
        <StudioDialog
          title={locale.studioMissingTitle || "TypeR Studio is not installed"}
          icon={<FiDownload size={26} />}
          okLabel={locale.studioDownload || "Download TypeR Studio"}
          onOk={confirm}
          onCancel={close}
        >
          <div className="settings-confirm-text">
            {locale.studioMissing || "TypeR Studio, the desktop app, opens your pages with TypeR's tools. Install it, then use this button again."}
          </div>
        </StudioDialog>
      )}
      {dialog && !dialog.missing && (
        <StudioDialog title={label} icon={<FiExternalLink size={26} />} okLabel={label} onOk={confirm} onCancel={close}>
          <div className="settings-confirm-text">
            {locale.studioNote || "Unsaved changes are saved first. Documents without a Photoshop file yet are saved as PSD in a folder you choose."}
          </div>
          <div className="open-in-studio-options">
            {dialog.documents.length > 1 && (
              <select
                className="topcoat-textarea"
                value={choice.documents}
                onChange={(event) => setChoice({ ...choice, documents: event.target.value })}
              >
                <option value="one">{locale.studioThisDocument || "This document"}</option>
                <option value="all">{fill(locale.studioAllDocuments || "All open documents ({count})", { count: dialog.documents.length })}</option>
              </select>
            )}
            {dialog.script && (
              <label className="topcoat-checkbox open-in-studio-check" title={locale.studioScriptHint || "TypeR Studio opens it in a new tab, or in the tab that already holds it."}>
                <input type="checkbox" checked={choice.script} onChange={(event) => setChoice({ ...choice, script: event.target.checked })} />
                <div className="topcoat-checkbox__checkmark"></div>
                <span>{locale.studioImportScript || "Import the script"}</span>
              </label>
            )}
          </div>
        </StudioDialog>
      )}
    </React.Fragment>
  );
});

export default OpenInStudioButton;
