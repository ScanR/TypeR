import React from "react";
import { FiX, FiSettings, FiEye, FiToggleLeft, FiDatabase } from "react-icons/fi";
import { MdSave } from "react-icons/md";
import { FaKeyboard, FaFileExport, FaFileImport } from "react-icons/fa";

import config from "../../config";
import { locale, nativeAlert, nativeConfirm, checkUpdate, readStorage, writeToStorage, deleteStorageFile, openFile } from "../../utils";
import { useContext } from "../../context";
import Shortcut from "./shortCut";

const SettingsModal = React.memo(function SettingsModal() {
  const context = useContext();
  const [activeTab, setActiveTab] = React.useState("general");
  const [pastePointText, setPastePointText] = React.useState(context.state.pastePointText ? "1" : "");
  const [ignoreLinePrefixes, setIgnoreLinePrefixes] = React.useState(
    context.state.ignoreLinePrefixes.join("\n")
  );
  const [ignoreTags, setIgnoreTags] = React.useState(
    (context.state.ignoreTags || []).join("\n")
  );
  const [defaultStyleId, setDefaultStyleId] = React.useState(context.state.defaultStyleId || "");
  const [language, setLanguage] = React.useState(context.state.language || "auto");
  const [theme, setTheme] = React.useState(context.state.theme || "default");
  const [direction, setDirection] = React.useState(context.state.direction || "ltr");
  const [middleEast, setMiddleEast] = React.useState(!!context.state.middleEast);
  const [autoClosePSD, setAutoClosePSD] = React.useState(
    !!context.state.autoClosePSD
  );
  const [autoScrollStyle, setAutoScrollStyle] = React.useState(
    context.state.autoScrollStyle !== false
  );
  const [currentFolderTagPriority, setCurrentFolderTagPriority] = React.useState(
    context.state.currentFolderTagPriority !== false
  );
  const [resizeTextBoxOnCenter, setResizeTextBoxOnCenter] = React.useState(
    !!context.state.resizeTextBoxOnCenter
  );
  const [checkUpdates, setCheckUpdates] = React.useState(
    context.state.checkUpdates !== false
  );
  const [multiBubbleMode, setMultiBubbleMode] = React.useState(
    !!context.state.multiBubbleMode
  );
  const [showTips, setShowTips] = React.useState(
    context.state.showTips !== false
  );
  const [internalPadding, setInternalPadding] = React.useState(
    context.state.internalPadding !== undefined ? context.state.internalPadding : 10
  );
  const [edited, setEdited] = React.useState(false);

  // States manager
  const [stateName, setStateName] = React.useState("");
  const [savedStates, setSavedStates] = React.useState(() => readStorage("states") || {});
  const [selectedState, setSelectedState] = React.useState("");
  const [showDeleteStates, setShowDeleteStates] = React.useState(false);
  const [statesToDelete, setStatesToDelete] = React.useState({});

  const close = () => {
    context.dispatch({ type: "setModal" });
  };

  const changePastePointText = (e) => {
    setPastePointText(e.target.value);
    setEdited(true);
  };

  const changeLinePrefixes = (e) => {
    setIgnoreLinePrefixes(e.target.value);
    setEdited(true);
  };

  const changeIgnoreTags = (e) => {
    setIgnoreTags(e.target.value);
    setEdited(true);
  };

  const changeDefaultStyle = (e) => {
    setDefaultStyleId(e.target.value);
    setEdited(true);
  };

  const changeLanguage = (e) => {
    setLanguage(e.target.value);
    setEdited(true);
  };

  const changeTheme = (e) => {
    setTheme(e.target.value);
    setEdited(true);
  };

  const changeDirection = (e) => {
    setDirection(e.target.value);
    setEdited(true);
  };

  const changeMiddleEast = (e) => {
    const val = e.target.checked;
    setMiddleEast(val);
    context.dispatch({ type: "setMiddleEast", value: val });
    setEdited(true);
  };

  const changeAutoClosePSD = (e) => {
    setAutoClosePSD(e.target.checked);
    setEdited(true);
  };
  const changeAutoScrollStyle = (e) => {
    setAutoScrollStyle(e.target.checked);
    setEdited(true);
  };
  const changeCurrentFolderTagPriority = (e) => {
    setCurrentFolderTagPriority(e.target.checked);
    setEdited(true);
  };

  const changeResizeTextBoxOnCenter = (e) => {
    setResizeTextBoxOnCenter(e.target.checked);
    setEdited(true);
  };

  const changeCheckUpdates = (e) => {
    setCheckUpdates(e.target.checked);
    setEdited(true);
  };

  const changeMultiBubbleMode = (e) => {
    setMultiBubbleMode(e.target.checked);
    setEdited(true);
  };

  const changeShowTips = (e) => {
    setShowTips(e.target.checked);
    setEdited(true);
  };

  const changeInternalPadding = (e) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === "" || (!isNaN(value) && !isNaN(parseFloat(value)))) {
      setInternalPadding(value);
      setEdited(true);
    }
  };

  const save = (e) => {
    e.preventDefault();
    if (pastePointText !== context.state.pastePointText) {
      context.dispatch({
        type: "setPastePointText",
        isPoint: !!pastePointText,
      });
    }
    if (ignoreLinePrefixes !== context.state.ignoreLinePrefixes.join("\n")) {
      context.dispatch({
        type: "setIgnoreLinePrefixes",
        data: ignoreLinePrefixes,
      });
    }
    if (ignoreTags !== (context.state.ignoreTags || []).join("\n")) {
      context.dispatch({
        type: "setIgnoreTags",
        data: ignoreTags,
      });
    }
    if (defaultStyleId !== context.state.defaultStyleId) {
      context.dispatch({
        type: "setDefaultStyleId",
        id: defaultStyleId,
      });
    }
    if (language !== context.state.language) {
      context.dispatch({
        type: "setLanguage",
        lang: language,
      });
      setTimeout(() => window.location.reload(), 100);
    }
    if (theme !== context.state.theme) {
      context.dispatch({
        type: "setTheme",
        theme,
      });
    }
    if (direction !== context.state.direction) {
      context.dispatch({
        type: "setDirection",
        direction,
      });
    }
    if (middleEast !== context.state.middleEast) {
      context.dispatch({
        type: "setMiddleEast",
        value: middleEast,
      });
    }
    if (autoClosePSD !== context.state.autoClosePSD) {
      context.dispatch({
        type: "setAutoClosePSD",
        value: autoClosePSD,
      });
    }

    if (autoScrollStyle !== context.state.autoScrollStyle) {
      context.dispatch({
        type: "setAutoScrollStyle",
        value: autoScrollStyle,
      });
    }
    if (currentFolderTagPriority !== context.state.currentFolderTagPriority) {
      context.dispatch({
        type: "setCurrentFolderTagPriority",
        value: currentFolderTagPriority,
      });
    }
    if (resizeTextBoxOnCenter !== context.state.resizeTextBoxOnCenter) {
      context.dispatch({
        type: "setResizeTextBoxOnCenter",
        value: resizeTextBoxOnCenter,
      });
    }
    if (checkUpdates !== context.state.checkUpdates) {
      context.dispatch({
        type: "setCheckUpdates",
        value: checkUpdates,
      });
    }
    if (multiBubbleMode !== context.state.multiBubbleMode) {
      context.dispatch({
        type: "setMultiBubbleMode",
        value: multiBubbleMode,
      });
    }
    if (showTips !== context.state.showTips) {
      context.dispatch({
        type: "setShowTips",
        value: showTips,
      });
    }
    if (internalPadding !== context.state.internalPadding) {
      context.dispatch({
        type: "setInternalPadding",
        value: internalPadding,
      });
    }
    const shortcut = {};
    document.querySelectorAll("input[id^=shortcut_]").forEach((input) => {
      const typeShorcut = input.id.split("_").pop();
      const value = input.value.trim();
      if (value) {
        shortcut[typeShorcut] = value.split(" + ");
      } else {
        shortcut[typeShorcut] = [];
      }
    });
    context.dispatch({
      type: "updateShortcut",
      shortcut: shortcut,
    });

    context.dispatch({ type: "setModal" });
  };

  const importSettings = () => {
    const pathSelect = window.cep.fs.showOpenDialogEx(true, false, null, null, ["json"]);
    if (!pathSelect?.data?.length) return false;
    let foldersImported = 0;
    pathSelect.data.forEach((path) => {
      const result = window.cep.fs.readFile(path);
      if (result.err) {
        nativeAlert(locale.errorImportStyles, locale.errorTitle, true);
      } else {
        try {
          const data = JSON.parse(result.data);
          if (data.exportedStyles) {
            const dataFolder = { name: data.name };
            dataFolder.id = Math.random().toString(36).substring(2, 8);
            context.dispatch({ type: "saveFolder", data: dataFolder });
            data.exportedStyles.forEach((style) => {
              const dataStyle = {
                name: style.name,
                folder: dataFolder.id,
                textProps: style.textProps,
                prefixes: style.prefixes || [],
                prefixColor: style.prefixColor,
                stroke: style.stroke,
              };
              dataStyle.id = Math.random().toString(36).substring(2, 8);
              dataStyle.edited = Date.now();
              context.dispatch({ type: "saveStyle", data: dataStyle });
            });
            foldersImported++;
          } else if (
            data.folders &&
            data.styles &&
            !data.ignoreLinePrefixes &&
            !data.ignoreTags &&
            !data.defaultStyleId &&
            !data.language &&
            !data.autoClosePSD &&
            !data.autoScrollStyle &&
            !data.textItemKind
          ) {
            const idMap = {};
            const foldersWithNewIds = data.folders.map((folder) => {
              const newId = Math.random().toString(36).substring(2, 8);
              idMap[folder.id] = newId;
              return { folder, newId };
            });
            foldersWithNewIds.forEach(({ folder, newId }) => {
              context.dispatch({
                type: "saveFolder",
                data: {
                  id: newId,
                  name: folder.name,
                  parentId: folder.parentId ? idMap[folder.parentId] || null : null,
                  order: typeof folder.order === "number" ? folder.order : undefined,
                },
              });
              foldersImported++;
            });
            data.styles.forEach((style) => {
              const newId = Math.random().toString(36).substring(2, 8);
              context.dispatch({
                type: "saveStyle",
                data: {
                  id: newId,
                  name: style.name,
                  folder: style.folder ? idMap[style.folder] : null,
                  textProps: style.textProps,
                  prefixes: style.prefixes || [],
                  prefixColor: style.prefixColor,
                  stroke: style.stroke,
                  edited: Date.now(),
                },
              });
            });
          } else {
            context.dispatch({ type: "import", data });
            setTimeout(() => window.location.reload(), 100);
            close();
          }
        } catch (error) {
          nativeAlert(locale.errorImportStyles, locale.errorTitle, true);
        }
      }
    });
    if (foldersImported > 0) {
      nativeAlert(
        foldersImported > 1
          ? locale.importFoldersSuccess
          : locale.importFolderSuccess,
        locale.successTitle,
        false
      );
    }
  };

  const exportSettings = () => {
    context.dispatch({ type: "setModal", modal: "export" });
  };

  const checkUpdatesNow = () => {
    checkUpdate(config.appVersion).then((data) => {
      if (data) {
        context.dispatch({ type: "setModal", modal: "update", data });
      } else {
        nativeAlert(locale.updateNoUpdate, locale.successTitle, false);
      }
    });
  };

  const resetStorage = () => {
    nativeConfirm(
      locale.settingsResetStorageConfirm || "Supprimer le fichier de stockage et réinitialiser les réglages ?",
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        const success = deleteStorageFile();
        if (success) {
          nativeAlert(
            locale.settingsResetStorageSuccess || "Réglages réinitialisés. L'extension va redémarrer.",
            locale.successTitle,
            false
          );
          setTimeout(() => window.location.reload(), 300);
        } else {
          nativeAlert(
            locale.settingsResetStorageError || "Impossible de supprimer le fichier de stockage.",
            locale.errorTitle,
            true
          );
        }
      }
    );
  };

  const resetShortcuts = () => {
    nativeConfirm(
      locale.settingsResetShortcutsConfirm || "Voulez-vous vraiment réinitialiser les raccourcis ?",
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        context.dispatch({ type: "resetShortcut" });
      }
    );
  };

  // Save current working snapshot as a named state
  const saveCurrentState = (e) => {
    e.preventDefault();
    const name = (stateName || "").trim();
    if (!name) {
      nativeAlert(locale.settingsStateNameRequired, locale.errorTitle, true);
      return;
    }
    // Build snapshot
    const snapshot = {
      text: context.state.text,
      images: context.state.images,
      currentLineIndex: context.state.currentLineIndex,
      currentStyleId: context.state.currentStyleId,
      lastOpenedImagePath: context.state.lastOpenedImagePath || null,
      // Include a timestamp for info
      savedAt: Date.now(),
      version: 1,
    };
    const storageStates = readStorage("states") || {};
    storageStates[name] = snapshot;
    writeToStorage({ states: storageStates });
    setSavedStates(storageStates);
    setSelectedState(name);
    setStateName("");
  };

  // Load selected state into the app
  const loadSelectedState = () => {
    const name = (selectedState || "").trim();
    const storageStates = readStorage("states") || {};
    if (!name || !storageStates[name]) {
      return;
    }
    const data = storageStates[name] || {};
    // Use reducer's import path to merge safely
    context.dispatch({ type: "import", data });
    if (data.lastOpenedImagePath) {
      openFile(data.lastOpenedImagePath, context.state.autoClosePSD);
    }
  };

  const toggleDeleteStates = () => {
    setShowDeleteStates(!showDeleteStates);
    setStatesToDelete({});
  };

  const toggleStateCheckbox = (name, checked) => {
    setStatesToDelete((prev) => ({ ...prev, [name]: !!checked }));
  };

  const deleteSelectedStates = () => {
    const storageStates = readStorage("states") || {};
    const toDelete = Object.keys(statesToDelete).filter((k) => statesToDelete[k]);
    if (!toDelete.length) return;
    toDelete.forEach((k) => delete storageStates[k]);
    writeToStorage({ states: storageStates });
    setSavedStates(storageStates);
    if (toDelete.includes(selectedState)) setSelectedState("");
    setStatesToDelete({});
    setShowDeleteStates(false);
  };

  const tabs = [
    { id: "general", label: locale.settingsTabGeneral || "Général", icon: FiSettings },
    { id: "appearance", label: locale.settingsTabAppearance || "Apparence", icon: FiEye },
    { id: "behavior", label: locale.settingsTabBehavior || "Comportement", icon: FiToggleLeft },
    { id: "shortcuts", label: locale.settingsTabShortcuts || "Raccourcis", icon: FaKeyboard },
    { id: "data", label: locale.settingsTabData || "Données", icon: FiDatabase }
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <div className="fields">
            <div className="field">
              <div className="field-label">{locale.settingsTextItemKindLabel}</div>
              <div className="field-input">
                <select value={pastePointText} onChange={changePastePointText} className="topcoat-textarea">
                  <option value="">{locale.settingsTextItemKindBox}</option>
                  <option value="1">{locale.settingsTextItemKindPoint}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsLinePrefixesLabel}</div>
              <div className="field-input">
                <textarea rows={2} value={ignoreLinePrefixes} onChange={changeLinePrefixes} className="topcoat-textarea" />
              </div>
              <div className="field-descr">{locale.settingsLinePrefixesDescr}</div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsIgnoreTagsLabel}</div>
              <div className="field-input">
                <textarea rows={2} value={ignoreTags} onChange={changeIgnoreTags} className="topcoat-textarea" />
              </div>
              <div className="field-descr">{locale.settingsIgnoreTagsDescr}</div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsDefaultStyleLabel}</div>
              <div className="field-input">
                <select value={defaultStyleId} onChange={changeDefaultStyle} className="topcoat-textarea">
                  <option key="none" value="">
                    {locale.settingsDefaultStyleNone}
                  </option>
                  {context.state.styles.map((style) => (
                    <option key={style.id} value={style.id}>
                      {style.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-descr">{locale.settingsDefaultStyleDescr}</div>
            </div>
          </div>
        );

      case "appearance":
        return (
          <div className="fields">
            <div className="field">
              <div className="field-label">{locale.settingsLanguageLabel}</div>
              <div className="field-input">
                <select value={language} onChange={changeLanguage} className="topcoat-textarea">
                  {Object.entries(config.languages).map(([code, name]) => (
                    <option key={code} value={code}>
                      {code === "auto" ? locale.settingsLanguageAuto : name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsThemeLabel}</div>
              <div className="field-input">
                <select value={theme} onChange={changeTheme} className="topcoat-textarea" disabled>
                  {Object.keys(config.themes).map((code) => {
                    const key = 'settingsTheme' + code
                      .replace(/(^|-)(\w)/g, (m, p1, p2) => p2.toUpperCase());
                    return (
                      <option key={code} value={code}>
                        {locale[key] || config.themes[code]}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field-descr">{locale.settingsThemeDisabledDescr}</div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsDirectionLabel}</div>
              <div className="field-input">
                <select value={direction} onChange={changeDirection} className="topcoat-textarea">
                  <option value="ltr">{locale.settingsDirectionLtr}</option>
                  <option value="rtl">{locale.settingsDirectionRtl}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <div className="field-label">{locale.settingsMiddleEastLabel}</div>
              <div className="field-input">
                <label className="topcoat-checkbox">
                  <input type="checkbox" checked={middleEast} onChange={changeMiddleEast} />
                  <div className="topcoat-checkbox__checkmark"></div>
                </label>
              </div>
            </div>
          </div>
        );

      case "behavior":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupAutomations || "Automatisations"}</div>
              <div className="settings-checkbox-grid">
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={autoClosePSD} onChange={changeAutoClosePSD} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsAutoClosePsdLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsAutoClosePsdHint || "Ferme automatiquement les fichiers PSD après traitement"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={autoScrollStyle} onChange={changeAutoScrollStyle} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsAutoScrollStyleLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsAutoScrollStyleHint || "Fait défiler automatiquement vers le style sélectionné"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={resizeTextBoxOnCenter} onChange={changeResizeTextBoxOnCenter} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsResizeTextBoxOnCenterLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsResizeTextBoxOnCenterHint || "Redimensionne la boîte de texte lors du centrage automatique"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={multiBubbleMode} onChange={changeMultiBubbleMode} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.multiBubbleModeToggle || "Multi-Bubble Mode"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.multiBubbleModeHint || "Permet de capturer plusieurs sélections pour insérer plusieurs textes en une fois"}
                        <br />
                        <a 
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser('https://youtu.be/bQBvB0w3S0s');
                          }}
                          style={{color: '#007acc', textDecoration: 'underline', cursor: 'pointer'}}
                        >
                          {locale.multiBubbleModeHowToUse || "Comment utiliser"}
                        </a>
                      </div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={showTips} onChange={changeShowTips} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsShowTipsLabel || "Show tips"}</span>
                      <div className="settings-checkbox-hint">
                        {locale.settingsShowTipsHint || "Display tips in the interface (multi-bubble hints, etc.)"}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupTextPositioning || "Positionnement du texte"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsInternalPaddingLabel || "Padding interne (px)"}</div>
                <div className="field-input">
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    value={internalPadding} 
                    onChange={changeInternalPadding} 
                    className="topcoat-text-input--large" 
                  />
                </div>
                <div className="field-descr">{locale.settingsInternalPaddingHint || "Espace interne pour éviter que le texte touche les bords de la bulle (0-100 pixels)"}</div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupUpdates || "Priorités et mises à jour"}</div>
              <div className="settings-checkbox-grid">
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={currentFolderTagPriority} onChange={changeCurrentFolderTagPriority} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsCurrentFolderTagPriorityLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsCurrentFolderTagPriorityHint || "Donne la priorité aux styles du dossier actuel"}</div>
                    </div>
                  </label>
                </div>
                <div className="settings-checkbox-item">
                  <label className="settings-checkbox-label">
                    <input type="checkbox" checked={checkUpdates} onChange={changeCheckUpdates} />
                    <div className="settings-checkbox-custom"></div>
                    <div className="settings-checkbox-content">
                      <span>{locale.settingsCheckUpdatesLabel}</span>
                      <div className="settings-checkbox-hint">{locale.settingsCheckUpdatesHint || "Vérifie automatiquement les mises à jour disponibles"}</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        );

      case "shortcuts":
        return (
          <div className="fields">
            <div className="field">
              <div className="field-label">{locale.shortcut}</div>
              {Object.entries(context.state.shortcut).map(([index, value]) => (
                <Shortcut key={index} value={value} index={index}></Shortcut>
              ))}
            </div>
            <div className="field">
              <button type="button" className="topcoat-button--large" onClick={resetShortcuts}>
                {locale.settingsResetShortcuts || "Reset shortcuts"}
              </button>
            </div>
            <div className="field">
              <div className="field-descr">
                {locale.settingsShortcutsTip || "If shortcuts feel buggy or stop working, resetting them often fixes it."}
              </div>
            </div>
          </div>
        );

      case "data":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsStatesTitle}</div>
              <div className="field">
                <div className="field-input">
                  <input
                    type="text"
                    className="topcoat-text-input--large"
                    placeholder={locale.settingsStateNamePlaceholder}
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                  />
                </div>
                <div className="field-descr">{locale.settingsStatesDescr}</div>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={saveCurrentState}>
                  {locale.settingsSaveCurrentState}
                </button>
              </div>
              <div className="field">
                <div className="field-label">{locale.settingsStatesListLabel}</div>
                <div className="field-input">
                  {Object.keys(savedStates).length ? (
                    <select
                      className="topcoat-textarea"
                      value={selectedState}
                      onChange={(e) => setSelectedState(e.target.value)}
                    >
                      <option value="">{locale.settingsSelectState}</option>
                      {Object.keys(savedStates).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="field-descr">{locale.settingsNoStates}</div>
                  )}
                </div>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={loadSelectedState}>
                  {locale.settingsLoadSelectedState}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={toggleDeleteStates}>
                  {locale.settingsDeleteStates}
                </button>
              </div>
              {showDeleteStates && (
                <div className="field">
                  <div className="field-label">{locale.settingsDeleteStatesTitle}</div>
                  <div className="field-input">
                    {Object.keys(savedStates).length ? (
                      <div className="hostBrdContrast" style={{ maxHeight: 180, overflowY: "auto", padding: 6 }}>
                        {Object.keys(savedStates).map((name) => (
                          <label key={name} className="topcoat-checkbox" style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                            <input
                              type="checkbox"
                              checked={!!statesToDelete[name]}
                              onChange={(e) => toggleStateCheckbox(name, e.target.checked)}
                            />
                            <div className="topcoat-checkbox__checkmark" style={{ marginRight: 8 }}></div>
                            <span>{name}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="field-descr">{locale.settingsNoStates}</div>
                    )}
                  </div>
                  <div className="field-input" style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button className="topcoat-button--large--cta" onClick={deleteSelectedStates}>
                      {locale.settingsDeleteSelected}
                    </button>
                    <button className="topcoat-button--large" onClick={toggleDeleteStates}>
                      {locale.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupImportExport || "Import/Export"}</div>
              <div className="field">
                <button className="topcoat-button--large" onClick={importSettings}>
                  <FaFileImport size={18} /> {locale.settingsImport}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={exportSettings}>
                  <FaFileExport size={18} /> {locale.settingsExport}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large" onClick={checkUpdatesNow}>
                  {locale.settingsCheckUpdatesButton}
                </button>
              </div>
              <div className="field">
                <button className="topcoat-button--large--cta" onClick={resetStorage}>
                  {locale.settingsResetStorage || "Réinitialiser les réglages"}
                </button>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.settingsTitle}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner">
          <div className="settings-tabs">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <IconComponent size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <form className="settings-content" onSubmit={save}>
            {renderTabContent()}
            <div className="settings-actions">
              <button type="submit" className={edited ? "topcoat-button--large--cta" : "topcoat-button--large"}>
                <MdSave size={18} /> {locale.save}
              </button>
            </div>
          </form>
        </div>
      </div>
    </React.Fragment>
  );
});

export default SettingsModal;
