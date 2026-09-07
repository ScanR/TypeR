import { serializeStyle, selectExportStyles } from "../../librarySerialization";
import React from "react";
import { FiCheckSquare, FiFolder, FiType, FiX } from "react-icons/fi";
import { MdSave } from "react-icons/md";

import config from "../../config";
import { locale, nativeAlert } from "../../utils";
import { useContext } from "../../context";
import { buildFolderTree, collectDescendantIds } from "../../folderUtils";
import { collectFontRefs, exportZipWithFonts } from "../../fontFileExport";
import { getProfileRegistry, readProfileStorage } from "../../profileStorage";

const EMPTY_LIST = [];

const ExportModal = React.memo(function ExportModal() {
  const context = useContext((state) => ({
    folders: state.folders,
    styles: state.styles,
    ignoreLinePrefixes: state.ignoreLinePrefixes,
    ignoreTags: state.ignoreTags,
    defaultStyleId: state.defaultStyleId,
    language: state.language,
    autoClosePSD: state.autoClosePSD,
    autoScrollStyle: state.autoScrollStyle,
    currentFolderTagPriority: state.currentFolderTagPriority,
    pastePointText: state.pastePointText,
  }));
  const profileRegistry = React.useMemo(getProfileRegistry, []);
  const [selectedProfileId, setSelectedProfileId] = React.useState(profileRegistry.activeProfileId);
  const [selected, setSelected] = React.useState([]);
  const [selectedFonts, setSelectedFonts] = React.useState([]);
  const [withSettings, setWithSettings] = React.useState(false);
  const [withFontFiles, setWithFontFiles] = React.useState(false);
  const [allSelected, setAllSelected] = React.useState(false);
  const selectedProfile = profileRegistry.profiles.find((profile) => profile.id === selectedProfileId) || profileRegistry.profiles[0];
  const exportSource = React.useMemo(
    () => selectedProfileId === profileRegistry.activeProfileId
      ? context.state
      : readProfileStorage(selectedProfileId),
    [context.state, profileRegistry.activeProfileId, selectedProfileId]
  );
  const sourceFolders = React.useMemo(() => {
    const folders = exportSource.folders || EMPTY_LIST;
    return (exportSource.styles || []).some(style => !style.folder)
      ? folders.concat({ id: null, name: locale.noFolderTitle, parentId: null }) : folders;
  }, [exportSource.folders, exportSource.styles]);
  const sourceStyles = exportSource.styles || EMPTY_LIST;
  const folderTree = React.useMemo(() => buildFolderTree(sourceFolders), [sourceFolders]);
  const allFolderIds = React.useMemo(() => sourceFolders.map((folder) => folder.id), [sourceFolders]);
  const previousFontKeys = React.useRef([]);
  const selectedStyles = React.useMemo(
    () => selectExportStyles(sourceStyles, selected),
    [sourceStyles, selected]
  );
  const fontOptions = React.useMemo(() => buildFontOptions(selectedStyles), [selectedStyles]);
  const selectedFontSet = React.useMemo(() => new Set(selectedFonts), [selectedFonts]);
  const exportableStyles = React.useMemo(
    () => selectedStyles.filter((style) => selectedFontSet.has(getStyleFontKey(style))),
    [selectedStyles, selectedFontSet]
  );
  const canExport = exportableStyles.length > 0 || withSettings;

  React.useEffect(() => {
    setSelected([]);
    setSelectedFonts([]);
    setAllSelected(false);
    previousFontKeys.current = [];
  }, [selectedProfileId]);

  React.useEffect(() => {
    setSelectedFonts((current) => {
      const optionKeys = fontOptions.map((font) => font.key);
      const available = new Set(optionKeys);
      const previousKeys = previousFontKeys.current;
      const selectedAllPrevious =
        previousKeys.length > 0 && previousKeys.every((key) => current.includes(key));
      const filtered = current.filter((key) => available.has(key));
      const added = optionKeys.filter((key) => !previousKeys.includes(key));
      previousFontKeys.current = optionKeys;

      if (!optionKeys.length) return [];
      if (!current.length || selectedAllPrevious) {
        return Array.from(new Set(filtered.concat(added)));
      }
      return filtered;
    });
  }, [fontOptions]);

  const close = () => {
    context.dispatch({ type: "setModal" });
  };

  const toggleFolder = (id, checked) => {
    const next = new Set(selected);
    const descendants = collectDescendantIds(sourceFolders, id);
    if (checked) {
      next.add(id);
      descendants.forEach((desc) => next.add(desc));
    } else {
      next.delete(id);
      descendants.forEach((desc) => next.delete(desc));
    }
    const arr = Array.from(next);
    setSelected(arr);
    setAllSelected(arr.length === allFolderIds.length);
  };

  const toggleFont = (key, checked) => {
    setSelectedFonts((current) =>
      checked ? Array.from(new Set(current.concat(key))) : current.filter((fontKey) => fontKey !== key)
    );
  };

  const toggleAllFonts = () => {
    const allFontKeys = fontOptions.map((font) => font.key);
    setSelectedFonts(selectedFonts.length === allFontKeys.length ? [] : allFontKeys);
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected([]);
      setAllSelected(false);
    } else {
      setSelected(allFolderIds);
      setAllSelected(true);
    }
  };

  const exportData = (e) => {
    e.preventDefault();
    if (!canExport) return;
    const ext = withFontFiles ? "zip" : "json";
    const pathSelect = window.cep.fs.showSaveDialogEx(
      false,
      false,
      [ext],
      getProfileExportFileName(selectedProfile.name, ext)
    );
    if (!pathSelect?.data) return false;
    const folders = sourceFolders.filter((f) => f.id !== null && selected.includes(f.id)).map(folder => ({
      ...folder, parentId: selected.includes(folder.parentId) ? folder.parentId : null,
    }));
    const styles = exportableStyles.map(serializeStyle);
    const data = {
      folders,
      styles,
      profileName: selectedProfile.name,
      includesSettings: withSettings,
      version: config.appVersion,
      exported: new Date(),
    };
    if (withSettings) {
      data.ignoreLinePrefixes = exportSource.ignoreLinePrefixes;
      data.ignoreTags = exportSource.ignoreTags;
      data.defaultStyleId = exportSource.defaultStyleId;
      data.language = exportSource.language;
      data.autoClosePSD = exportSource.autoClosePSD;
      data.autoScrollStyle = exportSource.autoScrollStyle;
      data.currentFolderTagPriority = exportSource.currentFolderTagPriority;
      data.pastePointText = !!exportSource.pastePointText;
    }
    if (withFontFiles) {
      const result = exportZipWithFonts({
        zipPath: pathSelect.data,
        jsonFileName: getProfileExportFileName(selectedProfile.name, "json"),
        jsonString: JSON.stringify(data),
        fontRefs: collectFontRefs(exportableStyles),
      });
      if (!result.ok) {
        nativeAlert(locale.exportFontFilesError || "Could not create the .zip archive.", locale.errorTitle, true);
        return false;
      }
      if (result.missing.length) {
        nativeAlert(
          (locale.exportFontFilesMissing || "These fonts could not be found on this computer and were not added to the archive:") +
            "\n" + result.missing.join("\n"),
          locale.errorTitle,
          true
        );
      }
      close();
      return;
    }
    const written = window.cep.fs.writeFile(pathSelect.data, JSON.stringify(data));
    if (!written || written.err) { nativeAlert(locale.saveError, locale.errorTitle, true); return; }
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
        <form className="app-modal-body-inner export-modal" onSubmit={exportData}>
          <div className="export-section hostBrdContrast">
            <div className="export-section-title">{locale.exportProfileTitle}</div>
            <div className="export-section-hint">{locale.exportProfileHint}</div>
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              aria-label={locale.exportProfileTitle}
              className="topcoat-textarea export-profile-select"
            >
              {profileRegistry.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
          </div>

          <div className="export-summary hostBrdContrast">
            <div className="export-summary-item">
              <FiFolder size={15} />
              <span>{locale.exportFolderCount?.replace("{count}", selected.length) || `${selected.length} folders`}</span>
            </div>
            <div className="export-summary-item">
              <FiType size={15} />
              <span>{locale.exportStyleCount?.replace("{count}", exportableStyles.length) || `${exportableStyles.length} styles`}</span>
            </div>
            <div className="export-summary-item">
              <FiCheckSquare size={15} />
              <span>{withSettings ? (locale.exportSettingsIncluded || "Settings included") : (locale.exportSettingsSkipped || "Settings skipped")}</span>
            </div>
          </div>

          <div className="export-section hostBrdContrast">
            <div className="export-section-header">
              <div>
                <div className="export-section-title">{locale.exportFoldersTitle || "Folders"}</div>
                <div className="export-section-hint">{locale.exportFoldersHint || "Choose the folders to include in the JSON export."}</div>
              </div>
              <button
                type="button"
                className="topcoat-button--large export-small-button"
                onClick={toggleSelectAll}
              >
                {allSelected ? locale.deselectAll : locale.selectAll}
              </button>
            </div>
            <div className="export-option-list">
              {renderFolderNodes(folderTree, selected, toggleFolder)}
            </div>
          </div>

          <div className="export-section hostBrdContrast">
            <div className="export-section-header">
              <div>
                <div className="export-section-title">{locale.exportFontsTitle || "Fonts"}</div>
                <div className="export-section-hint">
                  {fontOptions.length
                    ? (locale.exportFontsHint || "Choose exactly which fonts from the selected folders should be exported.")
                    : (locale.exportFontsEmpty || "Select a folder with styles to choose fonts.")}
                </div>
              </div>
              {fontOptions.length ? (
                <button
                  type="button"
                  className="topcoat-button--large export-small-button"
                  onClick={toggleAllFonts}
                >
                  {selectedFonts.length === fontOptions.length ? locale.deselectAll : locale.selectAll}
                </button>
              ) : null}
            </div>
            <div className="export-font-grid">
              {fontOptions.map((font) => (
                <label key={font.key} className="topcoat-checkbox export-font-item">
                  <input
                    type="checkbox"
                    checked={selectedFonts.includes(font.key)}
                    onChange={(e) => toggleFont(font.key, e.target.checked)}
                  />
                  <div className="topcoat-checkbox__checkmark"></div>
                  <div className="export-font-content">
                    <div className="export-font-name">{font.label}</div>
                    <div className="export-font-meta">
                      {locale.exportFontStyleCount?.replace("{count}", font.count) || `${font.count} styles`}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <label className="topcoat-checkbox export-settings-item hostBrdContrast">
              <input
                type="checkbox"
                checked={withSettings}
                onChange={(e) => setWithSettings(e.target.checked)}
              />
              <div className="topcoat-checkbox__checkmark"></div>
              <div className="export-settings-content">
                <div className="export-settings-title">{locale.exportIncludeSettings}</div>
                <div className="export-section-hint">
                  {locale.exportIncludeSettingsHint || "Keep this off when you only want to share style folders."}
                </div>
              </div>
          </label>

          <label className="topcoat-checkbox export-settings-item hostBrdContrast">
              <input
                type="checkbox"
                checked={withFontFiles}
                onChange={(e) => setWithFontFiles(e.target.checked)}
              />
              <div className="topcoat-checkbox__checkmark"></div>
              <div className="export-settings-content">
                <div className="export-settings-title">{locale.exportIncludeFontFiles || "Include font files (.zip)"}</div>
                <div className="export-section-hint">
                  {locale.exportIncludeFontFilesHint || "Bundle the matching .ttf/.otf files with the JSON in a .zip archive for easy install on another PC."}
                </div>
              </div>
          </label>

          <div className="fields hostBrdTopContrast export-actions">
            <button type="submit" className="topcoat-button--large--cta" disabled={!canExport}>
              <MdSave size={18} /> {locale.save}
            </button>
          </div>
        </form>
      </div>
    </React.Fragment>
  );
});

const getStyleTextStyle = (style) =>
  style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};

const getStyleFontKey = (style) => {
  const textStyle = getStyleTextStyle(style);
  return (
    textStyle.fontPostScriptName ||
    [textStyle.fontName, textStyle.fontStyleName].filter(Boolean).join(" / ") ||
    "__unknown_font__"
  );
};

const getStyleFontLabel = (style) => {
  const textStyle = getStyleTextStyle(style);
  const name = textStyle.fontName || textStyle.fontPostScriptName || "Unknown font";
  return textStyle.fontStyleName ? `${name} · ${textStyle.fontStyleName}` : name;
};

const buildFontOptions = (styles) => {
  const map = new Map();
  styles.forEach((style) => {
    const key = getStyleFontKey(style);
    const option = map.get(key) || {
      key,
      label: getStyleFontLabel(style),
      count: 0,
    };
    option.count += 1;
    map.set(key, option);
  });
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
};

const getProfileExportFileName = (profileName, extension) => {
  const safeProfileName = String(profileName || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_") || "Default";
  return `${config.exportFileName}_${safeProfileName}.${extension}`;
};

const renderFolderNodes = (nodes, selected, toggleFolder, depth = 0) => {
  if (!nodes || !nodes.length) return null;
  return nodes.map((folder) => (
    <React.Fragment key={folder.id}>
      <label className={"topcoat-checkbox export-folder-item" + (depth ? " m-nested" : "")}> 
        <input
          type="checkbox"
          checked={selected.includes(folder.id)}
          onChange={(e) => toggleFolder(folder.id, e.target.checked)}
        />
        <div className="topcoat-checkbox__checkmark"></div>
        <div className="export-folder-title" style={{ paddingLeft: depth ? depth * 12 : 0 }}>{folder.name}</div>
      </label>
      {renderFolderNodes(folder.children || [], selected, toggleFolder, depth + 1)}
    </React.Fragment>
  ));
};

export default ExportModal;
