import React from "react";
import { FiX } from "react-icons/fi";
import { MdSave } from "react-icons/md";

import config from "../../config";
import { locale } from "../../utils";
import { useContext } from "../../context";
const fs = window.require("fs");
const path = window.require("path");
const archiver = window.require("archiver");
const { copyFonts } = window.require("fonts/helpers");

const ExportModal = React.memo(function ExportModal() {
  const context = useContext();
  const [selected, setSelected] = React.useState([]);
  const [withSettings, setWithSettings] = React.useState(true);
  const [withFonts, setWithFonts] = React.useState(false);

  const close = () => {
    context.dispatch({ type: "setModal" });
  };

  const toggleFolder = (id, checked) => {
    let arr = selected.slice();
    if (checked) arr.push(id);
    else arr = arr.filter((fid) => fid !== id);
    setSelected(arr);
  };

  const exportData = (e) => {
    e.preventDefault();
    if (!selected.length && !withSettings && !withFonts) return;
    const pathSelect = window.cep.fs.showSaveDialogEx(
      false,
      false,
      [withFonts ? "zip" : "json"],
      config.exportFileName + (withFonts ? ".zip" : ".json")
    );
    if (!pathSelect?.data) return false;
    const folders = context.state.folders.filter((f) => selected.includes(f.id));
    const styles = context.state.styles.filter((s) => selected.includes(s.folder));
    const data = {
      folders,
      styles,
      version: config.appVersion,
      exported: new Date(),
    };
    if (withSettings) {
      data.ignoreLinePrefixes = context.state.ignoreLinePrefixes;
      data.defaultStyleId = context.state.defaultStyleId;
      data.language = context.state.language;
      data.autoClosePSD = context.state.autoClosePSD;
      data.textItemKind = context.state.setTextItemKind;
    }

    if (withFonts) {
      const fontSet = new Set();
      styles.forEach((st) => {
        try {
          const ps =
            st.textProps?.layerText?.textStyleRange?.[0]?.textStyle?.fontPostScriptName;
          if (ps) fontSet.add(ps);
        } catch (e) {}
      });

      const exportFolder = pathSelect.data.replace(/\.zip$/, "");
      const fontsOutFolder = exportFolder + "_fonts";
      const copied = copyFonts([...fontSet], fontsOutFolder);
      data.fontFiles = copied.map((p) => path.basename(p));
      const jsonPath = exportFolder + ".json";
      fs.writeFileSync(jsonPath, JSON.stringify(data));
      const archive = archiver("zip", { zlib: { level: 9 } });
      const output = fs.createWriteStream(pathSelect.data);
      archive.pipe(output);
      archive.file(jsonPath, { name: path.basename(jsonPath) });
      copied.forEach((p) => {
        archive.file(p, { name: path.join("_fonts", path.basename(p)) });
      });
      archive.finalize();
    } else {
      window.cep.fs.writeFile(pathSelect.data, JSON.stringify(data));
    }
    close();
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.settingsExport}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <form className="app-modal-body-inner" onSubmit={exportData}>
          <div className="fields">
            {context.state.folders.map((folder) => (
              <label key={folder.id} className="topcoat-checkbox export-folder-item">
                <input
                  type="checkbox"
                  checked={selected.includes(folder.id)}
                  onChange={(e) => toggleFolder(folder.id, e.target.checked)}
                />
                <div className="topcoat-checkbox__checkmark"></div>
                <div className="export-folder-title">{folder.name}</div>
              </label>
            ))}
            <label className="topcoat-checkbox export-settings-item">
              <input
                type="checkbox"
                checked={withSettings}
                onChange={(e) => setWithSettings(e.target.checked)}
              />
              <div className="topcoat-checkbox__checkmark"></div>
              <div className="export-settings-title">{locale.exportIncludeSettings}</div>
            </label>
            <label className="topcoat-checkbox export-fonts-item">
              <input
                type="checkbox"
                checked={withFonts}
                onChange={(e) => setWithFonts(e.target.checked)}
              />
              <div className="topcoat-checkbox__checkmark"></div>
              <div className="export-fonts-title">{locale.exportIncludeFonts}</div>
            </label>
          </div>
          <div className="fields hostBrdTopContrast">
            <button type="submit" className="topcoat-button--large--cta">
              <MdSave size={18} /> {locale.save}
            </button>
          </div>
        </form>
      </div>
    </React.Fragment>
  );
});

export default ExportModal;
