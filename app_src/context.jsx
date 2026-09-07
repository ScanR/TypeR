import { validateImportData, repairFolderHierarchy } from "./librarySerialization";
import { parsePageMarker } from "./pageMarker";
import React from "react";
import PropTypes from "prop-types";
import { locale, readStorage, writeToStorage, scrollToLine, scrollToStyle, getUpdateTestConfig, clearUpdateTestConfig, checkUpdate, prefetchUpdateZip, downloadAndInstallUpdate, nativeAlert } from "./utils";
import { shouldRunUpdateCheck } from "./updateLogic";
import config from "./config";
import { getNextLineNumberState } from "./lineNumbering";
import { CUSTOM_IMAGE_THEME_ID, normalizeCustomThemes, normalizeEditorTheme, normalizePageLineColor, setCustomEditorThemes } from "./themePresets";
import { normalizeBackgroundImage } from "./backgroundImage";
import { applyThemeState } from "./lib/themeManager";
import { getDefaultShortcuts, migrateShortcutDefaults } from "./shortcutCommands";
import { getStoredSelectionLineIndex } from "./multiBubbleHistory";
import { collectDescendantIds, getAutomaticTagStyles } from "./folderUtils";
import { perfMeasure } from "./perfDebug";
import { TAB_FIELDS, createTab, migrateTabStorage } from "./tabStorage";
import {
  cycleStyleSizePreset,
  normalizeStyleSizePresets,
  normalizeStyleSizePresetWidthConfig,
  setStyleSizePreset,
  updateActiveStyleSizePreset,
} from "./styleSizePresets";
import {
  STYLE_SIZE_TIP_THRESHOLD,
  normalizeStyleSizeTipCount,
  recordStyleSizeChange,
} from "./styleSizeTip";
const storage = readStorage();
// A successful application is the clearest signal that someone is relying on
// TextShapeR. Five applied suggestions are enough to introduce the learning
// control without interrupting a first-time user.
const TEXT_SHAPER_LEARN_TIP_THRESHOLD = 5;
const hasTextShapeRLearning = (value) => Number(value?.samples) > 0;

const storeFields = [
  "notFirstTime",
  "text",
  "styles",
  "folders",
  "textScale",
  "textSizeIncrement",
  "currentLineIndex",
  "currentStyleId",
  "usedLineStyles",
  "pastePointText",
  "ignoreLinePrefixes",
  "ignoreTags",
  "defaultStyleId",
  "autoClosePSD",
  "checkUpdates",
  "autoUpdate",
  "autoScrollStyle",
  "currentFolderTagPriority",
  "resizeTextBoxOnCenter",
  "images",
  "shortcut",
  "language",
  "direction",
  "middleEast",
  "lastOpenedImagePath",
  "multiBubbleMode",
  "showTips",
  "exportFolderFontTipDismissed",
  "showQuickStyleSize",
  "inlineTextShapeR",
  "textShapeRPerformanceTipShown",
  "textShapeRUsageCount",
  "textShapeRLearnUsed",
  "textShapeRLearnTipShown",
  "textShapeRBubbleAware",
  "dehyphenateTextShapeR",
  "textShapeRTuning",
  "internalPadding",
  "interpretMarkdown",
  "styleSizeStep",
  "styleSizeTipCount",
  "styleSizeTipLastChangeAt",
  "styleSizeTipShown",
  "resetLineCounterOnPage",
  "tabs",
  "currentTabId",
  "multiTabEnabled",
  "uiLayout",
  "editorTheme",
  "customThemes",
  "pageLineColor",
  "backgroundImage",
];

// Fields that belong to each tab (text script + PSD sync)
const tabFields = TAB_FIELDS;
// These values live inside `tabs`. Keeping another top-level copy nearly
// doubled text-heavy storage files and their JSON serialization cost. They
// remain readable for migration, but new writes persist only the tab schema.
const persistedFields = storeFields.filter((field) => !tabFields.includes(field));

const loadTabIntoState = (state, tab) => {
  state.currentTabId = tab.id;
  state.text = tab.text || "";
  state.images = tab.images || [];
  state.currentLineIndex = tab.currentLineIndex || 0;
  state.lastOpenedImagePath = tab.lastOpenedImagePath || null;
  state.usedLineStyles = tab.usedLineStyles || {};
  // Stored selections are bound to the previously opened PSD
  state.storedSelections = [];
};

const defaultUiLayout = {
  order: ["preview", "text", "styles"],
  visible: {
    preview: true,
    text: true,
    styles: true,
    tabBar: true,
    previewCreateButton: true,
    previewAlignButton: true,
    previewSizeControls: true,
    previewNav: true,
    previewWidget: true,
    footerHelp: true,
    footerRepo: true,
    footerModeToggles: true,
  },
  sizes: {
    previewHeight: 130,
    uiScale: 100,
  },
};

const clampNumber = (value, min, max, fallback) => {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

// Merge a stored/partial layout with the defaults so missing or invalid
// fields (older storage versions, bad imports) never break the UI
const normalizeUiLayout = (raw) => {
  const layout = raw && typeof raw === "object" ? raw : {};
  const visible = { ...defaultUiLayout.visible };
  if (layout.visible && typeof layout.visible === "object") {
    for (const key in visible) {
      if (typeof layout.visible[key] === "boolean") visible[key] = layout.visible[key];
    }
  }
  let order = Array.isArray(layout.order)
    ? layout.order.filter((id) => defaultUiLayout.order.includes(id))
    : [];
  order = order.concat(defaultUiLayout.order.filter((id) => !order.includes(id)));
  // The panel must never end up fully empty
  if (!visible.preview && !visible.text && !visible.styles) visible.text = true;
  const sizes = {
    previewHeight: clampNumber(layout.sizes?.previewHeight, 80, 300, defaultUiLayout.sizes.previewHeight),
    uiScale: clampNumber(layout.sizes?.uiScale, 70, 150, defaultUiLayout.sizes.uiScale),
  };
  return { order, visible, sizes };
};

const shouldShowTextShapeRLearnTip = (state) => (
  Number(state.textShapeRUsageCount) >= TEXT_SHAPER_LEARN_TIP_THRESHOLD &&
  state.inlineTextShapeR &&
  state.showTips !== false &&
  state.uiLayout?.visible?.preview !== false &&
  state.uiLayout?.visible?.previewWidget !== false &&
  state.textShapeRLearnUsed !== true &&
  state.textShapeRLearnTipShown !== true &&
  !hasTextShapeRLearning(state.textShapeRTuning)
);

const showTextShapeRLearnTipIfEligible = (state) => {
  if (!shouldShowTextShapeRLearnTip(state)) return;
  state.textShapeRLearnTipShown = true;
  state.textShapeRLearnTipVisible = true;
};

const showStyleSizeTipIfEligible = (state) => {
  if (
    normalizeStyleSizeTipCount(state.styleSizeTipCount) < STYLE_SIZE_TIP_THRESHOLD ||
    state.showTips === false ||
    state.styleSizeTipShown === true
  ) return;
  state.styleSizeTipShown = true;
  state.styleSizeTipVisible = true;
};

const defaultShortcut = getDefaultShortcuts();
const shortcutMigration = migrateShortcutDefaults(storage.data?.shortcut, defaultShortcut);

const normalizeFolders = (folders) => {
  folders = repairFolderHierarchy(folders);
  const normalized = (folders || []).map((folder) => {
    const parentId = folder?.parentId === undefined || folder?.parentId === null || folder?.parentId === "" ? null : folder.parentId;
    return {
      ...folder,
      parentId,
      order: typeof folder?.order === "number" ? folder.order : 0,
    };
  });
  const ids = new Set(normalized.map((folder) => folder.id));
  normalized.forEach((folder) => {
    if (folder.parentId === folder.id || (folder.parentId && !ids.has(folder.parentId))) {
      folder.parentId = null;
    }
  });
  const siblingsMap = new Map();
  normalized.forEach((folder) => {
    const key = folder.parentId || "__root__";
    if (!siblingsMap.has(key)) siblingsMap.set(key, []);
    siblingsMap.get(key).push(folder);
  });
  siblingsMap.forEach((siblings) => {
    siblings
      .sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 0;
        const orderB = typeof b.order === "number" ? b.order : 0;
        return orderA - orderB;
      })
      .forEach((folder, index) => {
        folder.order = index;
      });
  });
  return normalized;
};

const buildPrefixIndex = (prefixes) => {
  const index = new Map();
  (prefixes || []).forEach((data) => {
    if (!data?.prefix) return;
    const key = data.prefix[0];
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(data);
  });
  return index;
};

const findPrefixMatch = (index, text) => {
  if (!text) return null;
  const prefixes = index.get(text[0]);
  if (!prefixes) return null;
  return prefixes.find((data) => text.startsWith(data.prefix)) || null;
};

const initialState = {
  notFirstTime: false,
  initiated: false,
  text: "",
  lines: [],
  styles: [],
  folders: [],
  openFolders: [],
  textScale: null,
  textSizeIncrement: 1,
  currentLine: null,
  currentLineIndex: 0,
  currentStyle: null,
  currentStyleId: null,
  usedLineStyles: {},
  pastePointText: false,
  ignoreLinePrefixes: ["##"],
  ignoreTags: [],
  defaultStyleId: null,
  autoClosePSD: false,
  checkUpdates: config.checkUpdates,
  autoUpdate: storage.data?.autoUpdate === true,
  autoScrollStyle: storage.data?.autoScrollStyle !== false,
  currentFolderTagPriority: storage.data?.currentFolderTagPriority !== false,
  resizeTextBoxOnCenter: false,
  showTips: storage.data?.showTips !== false,
  exportFolderFontTipDismissed: storage.data?.exportFolderFontTipDismissed === true,
  exportFolderFontTipVisible: false,
  showQuickStyleSize: storage.data?.showQuickStyleSize !== false,
  inlineTextShapeR: storage.data?.inlineTextShapeR !== false,
  textShapeRPerformanceTipShown: storage.data?.textShapeRPerformanceTipShown === true,
  textShapeRPerformanceTipVisible: false,
  textShapeRBubbleAware: storage.data?.textShapeRBubbleAware === true,
  dehyphenateTextShapeR: storage.data?.dehyphenateTextShapeR === true,
  textShapeRTuning: storage.data?.textShapeRTuning || null,
  modalType: null,
  modalData: {},
  images: [],
  language: "auto",
  direction: "ltr",
  middleEast: false,
  lastOpenedImagePath: null,
  storedSelections: [],
  multiBubbleMode: false,
  internalPadding: 10,
  interpretMarkdown: storage.data?.interpretMarkdown !== false,
  styleSizeStep: 1,
  resetLineCounterOnPage: storage.data?.resetLineCounterOnPage !== false,
  multiTabEnabled: storage.data?.multiTabEnabled !== false,
  ...storage.data,
  textShapeRUsageCount: Math.min(
    TEXT_SHAPER_LEARN_TIP_THRESHOLD,
    Math.max(0, Math.floor(Number(storage.data?.textShapeRUsageCount) || 0))
  ),
  textShapeRLearnUsed: storage.data?.textShapeRLearnUsed === true || hasTextShapeRLearning(storage.data?.textShapeRTuning),
  textShapeRLearnTipShown: storage.data?.textShapeRLearnTipShown === true,
  textShapeRLearnTipVisible: false,
  styleSizeTipCount: normalizeStyleSizeTipCount(storage.data?.styleSizeTipCount),
  styleSizeTipLastChangeAt: Math.max(0, Number(storage.data?.styleSizeTipLastChangeAt) || 0),
  styleSizeTipShown: storage.data?.styleSizeTipShown === true,
  styleSizeTipVisible: false,
  shortcut: shortcutMigration.shortcuts,
  // Live keyboard state (is the keep-size modifier held right now); never
  // persisted, and placed after the storage spread so it always starts false
  keepSizeHeld: false,
  uiLayout: normalizeUiLayout(storage.data?.uiLayout),
  // The theme registry is filled by the theme manager at import time, so the
  // stored id can already point at a custom theme here
  customThemes: normalizeCustomThemes(storage.data?.customThemes),
  pageLineColor: normalizePageLineColor(storage.data?.pageLineColor),
  backgroundImage: normalizeBackgroundImage(storage.data?.backgroundImage),
  editorTheme: normalizeEditorTheme(storage.data?.editorTheme),
  stylePrefixRefreshVersion: 0,
};

// Persist the pre-tab -> tab migration immediately. Waiting for a later user
// action leaves the only copy of the migrated text in memory and also lets
// stale tabs win after an older TypeR version has rewritten top-level fields.
const tabStorage = migrateTabStorage(
  storage.data,
  (locale.tabDefaultName || "Tab") + " 1"
);
initialState.tabs = tabStorage.tabs;
initialState.currentTabId = tabStorage.currentTabId;
const activeTab = initialState.tabs.find((tab) => tab.id === initialState.currentTabId) || initialState.tabs[0];
loadTabIntoState(initialState, activeTab);
// Captured coordinates belong to a live Photoshop session and must be recaptured.
initialState.storedSelections = [];

if (shortcutMigration.migrated) {
  writeToStorage({ shortcut: initialState.shortcut });
}

if (tabStorage.migrated) {
  const migratedData = {
    tabs: initialState.tabs,
    currentTabId: initialState.currentTabId,
  };
  // Remove the legacy duplicates only after their values are safely inside
  // the active tab in the very same storage write.
  tabFields.forEach((field) => {
    migratedData[field] = undefined;
  });
  writeToStorage(migratedData);
}

const baseReducer = (state, action) => {
  if (action.type === "import" || action.type === "importStyleLibrary" || action.type === "importStyleFolder") {
    try {
      const data = action.type === "import" ? action.data : { folders: action.folders || (action.folder ? [action.folder] : []), styles: action.styles || [] };
      validateImportData(data);
    } catch (error) { nativeAlert(locale.errorImportStyles, locale.errorTitle, true); return state; }
  }
  let thenScroll = false;
  let thenSelectStyle = false;
  let forceStylePrefixRefresh = false;
  const newState = Object.assign({}, state);
  switch (action.type) {
    case "removeFirstTime": {
      newState.notFirstTime = true;
      newState.modalType = "help";
      break;
    }

    case "showFirstRunWalkthrough": {
      newState.notFirstTime = true;
      if (!state.modalType) {
        newState.modalType = "walkthrough";
        newState.modalData = {};
      }
      break;
    }

    case "completeWalkthrough": {
      newState.notFirstTime = true;
      newState.modalType = null;
      newState.modalData = {};
      break;
    }

    case "import": {
      for (const field in action.data) {
        if (!Object.prototype.hasOwnProperty.call(action.data, field)) continue;
        if (!storeFields.includes(field)) continue;
        if (field === "styles" && state.styles) {
          const styles = [];
          let asked = false;
          let keep = false;
          for (const style of state.styles) {
            const inImport = action.data.styles.find((s) => s.id === style.id);
            if (!inImport || (style.edited && !inImport.edited) || (style.edited && inImport.edited && style.edited > inImport.edited)) {
              if (!asked) {
                keep = confirm(locale.settingsImportReplace);
                asked = true;
              }
              if (keep) styles.push(style);
            }
          }
          for (const style of action.data.styles) {
            if (!keep) {
              styles.push(style);
            } else {
              const oldStyle = state.styles.find((s) => s.id === style.id);
              if (!oldStyle?.edited || (style.edited && style.edited >= oldStyle.edited)) {
                styles.push(style);
              }
            }
          }
          newState[field] = styles;
        } else {
          newState[field] = action.data[field];
        }
      }
      if (action.data.uiLayout) {
        newState.uiLayout = normalizeUiLayout(action.data.uiLayout);
      }
      break;
    }

    case "setText": {
      newState.text = action.text;
      break;
    }

    case "setCurrentLineIndex": {
      newState.currentLineIndex = action.index;
      thenSelectStyle = true;
      break;
    }

    case "prevLine": {
      if (!state.text) break;
      let newIndex = state.currentLineIndex;
      for (let i = newIndex - 1; i >= 0; i--) {
        if (!state.lines[i].ignore) {
          newState.currentLineIndex = state.lines[i].rawIndex;
          break;
        }
      }
      thenScroll = true;
      thenSelectStyle = true;
      break;
    }

    case "nextLine": {
      if (!state.text) break;
      if (action.add && typeof state.currentLineIndex === "number" && state.currentStyleId) {
        const currentLine = state.lines[state.currentLineIndex];
        if (currentLine && !currentLine.ignore) {
          newState.usedLineStyles = {
            ...(state.usedLineStyles || {}),
            [state.currentLineIndex]: {
              rawText: currentLine.rawText,
              styleId: state.currentStyleId,
            },
          };
        }
      }
      if (action.add && newState.currentLine.last) break;
      let newIndex = state.currentLineIndex;
      for (let i = newIndex + 1; i < state.lines.length; i++) {
        if (!state.lines[i].ignore) {
          newState.currentLineIndex = state.lines[i].rawIndex;
          break;
        }
      }
      thenScroll = true;
      thenSelectStyle = true;
      break;
    }

    case "commitLineBatch": {
      const usedLineStyles = { ...(state.usedLineStyles || {}) };
      for (const entry of action.entries || []) {
        const batchLine = state.lines[entry.lineIndex];
        if (!batchLine || batchLine.ignore || !entry.styleId) continue;
        usedLineStyles[entry.lineIndex] = {
          rawText: batchLine.rawText,
          styleId: entry.styleId,
        };
      }
      newState.usedLineStyles = usedLineStyles;
      if (
        typeof action.nextLineIndex === "number" &&
        state.lines[action.nextLineIndex] &&
        !state.lines[action.nextLineIndex].ignore
      ) {
        newState.currentLineIndex = action.nextLineIndex;
      }
      thenScroll = true;
      thenSelectStyle = true;
      break;
    }

    case "nextPage": {
      if (!state.text) break;
      // Find the next "Page X" marker.
      let foundNextPage = false;
      for (let i = state.currentLineIndex + 1; i < state.lines.length; i++) {
        const line = state.lines[i];
        if (parsePageMarker(line.rawText)) {
          // Select the first usable line after that page marker.
          for (let j = i + 1; j < state.lines.length; j++) {
            if (!state.lines[j].ignore) {
              newState.currentLineIndex = state.lines[j].rawIndex;
              foundNextPage = true;
              break;
            }
          }
          break;
        }
      }
      if (foundNextPage) {
        thenScroll = true;
        thenSelectStyle = true;
      }
      break;
    }

    case "previousPage": {
      if (!state.text) break;
      const pageMarkers = [];
      for (let i = 0; i < state.currentLineIndex; i++) {
        if (parsePageMarker(state.lines[i].rawText)) pageMarkers.push(i);
      }
      // The nearest marker is the current page; move to the one before it.
      const targetMarker = pageMarkers.length > 1 ? pageMarkers[pageMarkers.length - 2] : -1;
      if (targetMarker < 0) break;
      for (let i = targetMarker + 1; i < state.lines.length; i++) {
        if (parsePageMarker(state.lines[i].rawText)) break;
        if (!state.lines[i].ignore) {
          newState.currentLineIndex = state.lines[i].rawIndex;
          thenScroll = true;
          thenSelectStyle = true;
          break;
        }
      }
      break;
    }

    case "setCurrentStyleId": {
      newState.currentStyleId = action.id;
      break;
    }

    case "refreshStylePrefixes": {
      if (action.version !== state.stylePrefixRefreshVersion) return state;
      forceStylePrefixRefresh = true;
      break;
    }

    case "previousStyle":
    case "nextStyle": {
      if (!state.styles.length) break;
      const currentIndex = state.styles.findIndex((style) => style.id === state.currentStyleId);
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const direction = action.type === "previousStyle" ? -1 : 1;
      const nextIndex = (baseIndex + direction + state.styles.length) % state.styles.length;
      newState.currentStyleId = state.styles[nextIndex].id;
      break;
    }

    case "setStyleSizePreset": {
      let changed = false;
      const styles = state.styles.map((style) => {
        if (style.id !== action.id) return style;
        const nextStyle = setStyleSizePreset(style, action.size);
        if (nextStyle !== style) changed = true;
        return nextStyle;
      });
      newState.styles = changed ? styles : state.styles;
      break;
    }

    case "updateActiveStyleSizePreset": {
      let changed = false;
      const styles = state.styles.map((style) => {
        if (style.id !== action.id) return style;
        const nextStyle = updateActiveStyleSizePreset(style, action.size);
        if (nextStyle !== style) changed = true;
        return nextStyle;
      });
      newState.styles = changed ? styles : state.styles;
      if (changed && !state.styleSizeTipShown) {
        const tracking = recordStyleSizeChange({
          count: state.styleSizeTipCount,
          lastChangeAt: state.styleSizeTipLastChangeAt,
        }, action.now);
        newState.styleSizeTipCount = tracking.count;
        newState.styleSizeTipLastChangeAt = tracking.lastChangeAt;
        showStyleSizeTipIfEligible(newState);
      }
      break;
    }

    case "nextStyleSizePreset": {
      if (!state.currentStyleId) break;
      let changed = false;
      const styles = state.styles.map((style) => {
        if (style.id !== state.currentStyleId) return style;
        const nextStyle = cycleStyleSizePreset(style);
        if (nextStyle !== style) changed = true;
        return nextStyle;
      });
      newState.styles = changed ? styles : state.styles;
      break;
    }

    case "setTextScale": {
      let scale = parseInt(action.scale) || null;
      if (scale) {
        if (scale < 1) scale = 1;
        if (scale > 999) scale = 999;
      }
      newState.textScale = scale;
      break;
    }

    case "setTextSizeIncrement": {
      let increment = action.increment;
      if (increment === "" || increment === null || increment === undefined) {
        newState.textSizeIncrement = "";
      } else {
        increment = parseInt(increment) || 1;
        if (increment < 1) increment = 1;
        if (increment > 99) increment = 99;
        newState.textSizeIncrement = increment;
      }
      break;
    }

    case "saveFolder": {
      const editId = action.id || action.data.id;
      const { styleIds, ...folderPayload } = action.data;
      if (styleIds) {
        const styleIdSet = new Set(styleIds);
        const styles = state.styles.map((style) => {
          if (style.folder === editId && !styleIdSet.has(style.id)) {
            return { ...style, folder: null };
          }
          if (styleIdSet.has(style.id) && style.folder !== editId) {
            return { ...style, folder: editId };
          }
          return style;
        });
        newState.styles = styles;
      }
      let folders = state.folders.map((folder) => ({ ...folder }));
      const data = { ...folderPayload, id: editId };
      const parentId = data.parentId === undefined || data.parentId === null || data.parentId === "" ? null : data.parentId;
      data.parentId = parentId;
      if (data.parentId && !folders.find((folder) => folder.id === data.parentId)) {
        data.parentId = null;
      }
      let folder = folders.find((f) => f.id === editId);
      const siblings = folders.filter((f) => (f.parentId || null) === (data.parentId || null) && f.id !== editId);
      if (folder) {
        Object.assign(folder, data);
        folder.order = typeof data.order === "number" ? data.order : siblings.length;
      } else {
        folder = {
          ...data,
          order: typeof data.order === "number" ? data.order : siblings.length,
        };
        folders.push(folder);
      }
      folders = normalizeFolders(folders);
      newState.folders = folders;
      if (!state.folders.find((f) => f.id === editId)) {
        const toOpen = data.parentId ? [data.parentId, editId] : [editId];
        newState.openFolders = Array.from(new Set(state.openFolders.concat(toOpen)));
      } else if (state.folders.find((f) => f.id === editId)?.parentId !== data.parentId && data.parentId) {
        newState.openFolders = Array.from(new Set(state.openFolders.concat([data.parentId])));
      }
      break;
    }

    case "importStyleFolder": {
      const folderData = action.folder || {};
      const folderId = folderData.id || Math.random().toString(36).substring(2, 8);
      const siblingCount = state.folders.filter((folder) => !(folder.parentId || null)).length;
      const folder = {
        ...folderData,
        id: folderId,
        parentId: null,
        order: typeof folderData.order === "number" ? folderData.order : siblingCount,
      };
      const importedStyles = (action.styles || []).map((style) => ({
        ...style,
        id: style.id || Math.random().toString(36).substring(2, 8),
        folder: folderId,
        prefixes: style.prefixes || [],
        edited: style.edited || Date.now(),
      }));
      newState.folders = normalizeFolders(state.folders.concat(folder));
      newState.styles = state.styles.concat(importedStyles);
      newState.openFolders = Array.from(new Set(state.openFolders.concat(folderId)));
      break;
    }

    case "importStyleLibrary": {
      const importedFolders = action.folders || [];
      const importedStyles = action.styles || [];
      const folderIds = new Set(importedFolders.map((folder) => folder.id));
      newState.folders = normalizeFolders(state.folders.concat(importedFolders));
      newState.styles = state.styles.concat(
        importedStyles.map((style) => ({
          ...style,
          folder: folderIds.has(style.folder) ? style.folder : null,
          prefixes: style.prefixes || [],
          edited: style.edited || Date.now(),
        }))
      );
      newState.openFolders = Array.from(new Set(state.openFolders.concat(importedFolders.map((folder) => folder.id))));
      break;
    }

    case "deleteFolder": {
      if (!action.id) break;
      const idsToRemove = [action.id].concat(collectDescendantIds(state.folders, action.id));
      const folders = state.folders.filter((folder) => !idsToRemove.includes(folder.id)).map((folder) => ({ ...folder }));
      let styles = state.styles.concat([]);
      if (action.permanent) {
        styles = styles.filter((style) => !idsToRemove.includes(style.folder));
      } else {
        styles = styles.map((style) => {
          if (idsToRemove.includes(style.folder)) {
            return { ...style, folder: null };
          }
          return style;
        });
      }
      newState.styles = styles;
      newState.folders = normalizeFolders(folders);
      newState.openFolders = state.openFolders.filter((id) => id === "unsorted" || !idsToRemove.includes(id));
      break;
    }
    case "duplicateFolder": {
      const sourceId = action.id || action.data?.id;
      if (!sourceId) break;
      const originalFolder = state.folders.find((folder) => folder.id === sourceId);
      if (!originalFolder) break;
      const folders = state.folders.map((folder) => ({ ...folder }));
      const styles = state.styles.map((style) => ({ ...style }));
      const openFolders = state.openFolders.concat([]);
      const createdFolderIds = [];
      const duplicateStylesForFolder = (sourceFolderId, targetFolderId) => {
        const stylesToClone = state.styles.filter((style) => style.folder === sourceFolderId);
        stylesToClone.forEach((style) => {
          const newStyleId = Math.random().toString(36).substr(2, 8);
          styles.push({ ...style, id: newStyleId, name: style.name + " copy", folder: targetFolderId });
        });
      };
      const duplicateFolderRecursive = (folder, parentId) => {
        const siblingCount = folders.filter((f) => (f.parentId || null) === (parentId || null)).length;
        const newFolderId = Math.random().toString(36).substr(2, 8);
        const newFolder = {
          ...folder,
          id: newFolderId,
          name: folder.name + " copy",
          parentId: parentId || null,
          order: siblingCount,
        };
        delete newFolder.children;
        folders.push(newFolder);
        createdFolderIds.push(newFolderId);
        duplicateStylesForFolder(folder.id, newFolderId);
        const children = state.folders.filter((child) => (child.parentId || null) === folder.id);
        children.forEach((child) => duplicateFolderRecursive(child, newFolderId));
      };
      duplicateFolderRecursive(originalFolder, originalFolder.parentId);
      newState.folders = normalizeFolders(folders);
      newState.styles = styles;
      newState.openFolders = Array.from(new Set(openFolders.concat(createdFolderIds)));
      break;
    }

    case "toggleFolder": {
      let open = state.openFolders.concat([]);
      const id = action.id || "unsorted";
      if (open.includes(id)) open = open.filter((f) => f !== id);
      else open.push(id);
      newState.openFolders = open;
      break;
    }

    case "setFolders": {
      newState.folders = normalizeFolders(action.data || []);
      newState.openFolders = state.openFolders.filter((id) => id === "unsorted" || newState.folders.find((folder) => folder.id === id));
      break;
    }

    case "reorderFolders": {
      const parentId = action.parentId === undefined || action.parentId === null || action.parentId === "" ? null : action.parentId;
      const orderIds = action.order || [];
      const orderMap = new Map(orderIds.map((id, index) => [id, index]));
      const folders = state.folders.map((folder) => {
        if ((folder.parentId || null) !== parentId) return { ...folder };
        if (!orderMap.has(folder.id)) return { ...folder };
        return { ...folder, order: orderMap.get(folder.id) };
      });
      newState.folders = normalizeFolders(folders);
      break;
    }

    case "moveStyleToFolder": {
      const styleId = action.id;
      if (!styleId) break;
      const folderId = action.folderId === undefined || action.folderId === "" || action.folderId === "__unsorted__" ? null : action.folderId;
      if (folderId && !state.folders.find((folder) => folder.id === folderId)) break;
      const movedStyle = state.styles.find((style) => style.id === styleId);
      if (!movedStyle) break;

      const styles = state.styles
        .filter((style) => style.id !== styleId)
        .map((style) => ({ ...style }))
        .concat({ ...movedStyle, folder: folderId });
      const orderIds = action.order || [];
      if (!orderIds.length) {
        newState.styles = styles;
        break;
      }
      const orderMap = new Map(orderIds.map((id, index) => [id, index]));
      const targetStyles = styles
        .filter((style) => (style.folder || null) === folderId)
        .sort((a, b) => {
          const aOrder = orderMap.has(a.id) ? orderMap.get(a.id) : Number.MAX_SAFE_INTEGER;
          const bOrder = orderMap.has(b.id) ? orderMap.get(b.id) : Number.MAX_SAFE_INTEGER;
          return aOrder - bOrder;
        });

      newState.styles = styles.filter((style) => (style.folder || null) !== folderId).concat(targetStyles);
      break;
    }

    case "saveStyle": {
      const stylePayload = { ...action.data };
      if (typeof stylePayload.prefixes === "string") {
        const arr = stylePayload.prefixes.split(/(?:\r?\n|;)/);
        stylePayload.prefixes = arr.map((p) => p.trim()).filter(Boolean);
      } else if (!Array.isArray(stylePayload.prefixes)) {
        stylePayload.prefixes = [];
      }
      stylePayload.sizePresets = normalizeStyleSizePresets(stylePayload);
      Object.assign(stylePayload, normalizeStyleSizePresetWidthConfig(stylePayload));
      const editId = action.id || stylePayload.id;
      const styleExists = state.styles.some((s) => s.id === editId);
      newState.styles = styleExists
        ? state.styles.map((style) => (style.id === editId ? { ...style, ...stylePayload } : style))
        : state.styles.concat(stylePayload);
      break;
    }

    case "toggleStylePrefixes": {
      newState.styles = state.styles.map((style) => {
        if (style.id !== action.id) return style;
        return { ...style, prefixesDisabled: !style.prefixesDisabled };
      });
      break;
    }

    case "deleteStyle": {
      newState.styles = state.styles.filter((s) => s.id !== action.id);
      break;
    }

    case "duplicateStyle": {
      const styleToDup = action.data || state.styles.find((s) => s.id === state.currentStyleId);
      if (styleToDup) {
        const newStyleId = Math.random().toString(36).substr(2, 8);
        const targetFolder = action.folderId === undefined ? styleToDup.folder : action.folderId;
        const newStyle = { ...styleToDup, id: newStyleId, name: styleToDup.name + " copy", folder: targetFolder || null };
        newState.styles = state.styles.concat(newStyle);
        newState.currentStyleId = newStyleId;
      }
      break;
    }

    case "setStyles": {
      newState.styles = (action.data || []).map((style) => {
        const normalizedStyle = {
          ...style,
          sizePresets: normalizeStyleSizePresets(style),
        };
        return { ...normalizedStyle, ...normalizeStyleSizePresetWidthConfig(normalizedStyle) };
      });
      break;
    }

    case "setIgnoreLinePrefixes": {
      if (!action.data) {
        newState.ignoreLinePrefixes = [];
      } else if (Array.isArray(action.data)) {
        newState.ignoreLinePrefixes = action.data;
      } else if (typeof action.data === "string") {
        const arr = action.data.split(/(?:\r?\n|;)/);
        newState.ignoreLinePrefixes = arr.map((p) => p.trim()).filter(Boolean);
      }
      break;
    }

    case "setIgnoreTags": {
      if (!action.data) {
        newState.ignoreTags = [];
      } else if (Array.isArray(action.data)) {
        newState.ignoreTags = action.data;
      } else if (typeof action.data === "string") {
        const arr = action.data.split(/(?:\r?\n|;)/);
        newState.ignoreTags = arr.map((p) => p.trim()).filter(Boolean);
      }
      break;
    }

    case "setDefaultStyleId": {
      newState.defaultStyleId = action.id || null;
      break;
    }

  case "setPastePointText": {
    newState.pastePointText = !!action.isPoint;
    break;
  }

  case "setAutoClosePSD": {
    newState.autoClosePSD = !!action.value;
    break;
  }

  case "setCheckUpdates": {
    newState.checkUpdates = !!action.value;
    break;
  }

  case "setAutoUpdate": {
    newState.autoUpdate = !!action.value;
    break;
  }

  case "setAutoScrollStyle": {
    newState.autoScrollStyle = !!action.value;
    break;
  }

  case "setCurrentFolderTagPriority": {
    newState.currentFolderTagPriority = !!action.value;
    break;
  }

  case "setResizeTextBoxOnCenter": {
    newState.resizeTextBoxOnCenter = !!action.value;
    break;
  }

  case "setLanguage": {
    newState.language = action.lang || "auto";
    break;
  }

  case "setDirection": {
    newState.direction = action.direction || "ltr";
    break;
  }

    case "setMiddleEast": {
      newState.middleEast = !!action.value;
      break;
    }

    case "setKeepSizeHeld": {
      newState.keepSizeHeld = !!action.value;
      break;
    }

    case "setMultiBubbleMode": {
      newState.multiBubbleMode = !!action.value;
      if (!action.value) {
        newState.storedSelections = [];
      }
      break;
    }

    case "setStyleSizeStep": {
      let step = parseFloat(action.step);
      if (!Number.isFinite(step) || step <= 0) step = 1;
      newState.styleSizeStep = step;
      break;
    }

    case "setShowTips": {
      newState.showTips = !!action.value;
      if (!newState.showTips) {
        newState.textShapeRPerformanceTipVisible = false;
        newState.textShapeRLearnTipVisible = false;
        newState.styleSizeTipVisible = false;
      } else if (
        newState.inlineTextShapeR &&
        newState.uiLayout?.visible?.preview !== false &&
        !newState.textShapeRPerformanceTipShown
      ) {
        newState.textShapeRPerformanceTipShown = true;
        newState.textShapeRPerformanceTipVisible = true;
      }
      if (newState.showTips) {
        showTextShapeRLearnTipIfEligible(newState);
        showStyleSizeTipIfEligible(newState);
      }
      break;
    }

    case "hideStyleSizeTip": {
      newState.styleSizeTipVisible = false;
      break;
    }

    case "showExportFolderFontTip": {
      newState.exportFolderFontTipVisible = true;
      break;
    }

    case "hideExportFolderFontTip": {
      newState.exportFolderFontTipVisible = false;
      if (action.dismiss) newState.exportFolderFontTipDismissed = true;
      break;
    }

    case "setShowQuickStyleSize": {
      newState.showQuickStyleSize = !!action.value;
      break;
    }

    case "setInlineTextShapeR": {
      newState.inlineTextShapeR = !!action.value;
      if (newState.inlineTextShapeR) {
        if (
          state.showTips !== false &&
          state.uiLayout?.visible?.preview !== false &&
          !state.textShapeRPerformanceTipShown
        ) {
          newState.textShapeRPerformanceTipShown = true;
          newState.textShapeRPerformanceTipVisible = true;
        }
        showTextShapeRLearnTipIfEligible(newState);
      } else {
        newState.textShapeRPerformanceTipVisible = false;
        newState.textShapeRLearnTipVisible = false;
      }
      break;
    }

    case "showTextShapeRPerformanceTip": {
      if (newState.inlineTextShapeR && newState.showTips !== false && !newState.textShapeRPerformanceTipShown) {
        newState.textShapeRPerformanceTipShown = true;
        newState.textShapeRPerformanceTipVisible = true;
      }
      break;
    }

    case "hideTextShapeRPerformanceTip": {
      newState.textShapeRPerformanceTipVisible = false;
      break;
    }

    case "recordTextShapeRUse": {
      const currentCount = Math.max(0, Math.floor(Number(newState.textShapeRUsageCount) || 0));
      newState.textShapeRUsageCount = Math.min(TEXT_SHAPER_LEARN_TIP_THRESHOLD, currentCount + 1);
      showTextShapeRLearnTipIfEligible(newState);
      break;
    }

    case "showTextShapeRLearnTip": {
      showTextShapeRLearnTipIfEligible(newState);
      break;
    }

    case "hideTextShapeRLearnTip": {
      newState.textShapeRLearnTipVisible = false;
      break;
    }

    case "setTextShapeRBubbleAware": {
      newState.textShapeRBubbleAware = !!action.value;
      break;
    }

    case "setTextShapeRTuning": {
      newState.textShapeRTuning = action.value || null;
      if (action.learned === true) newState.textShapeRLearnUsed = true;
      if (action.learned === true || hasTextShapeRLearning(action.value)) {
        newState.textShapeRLearnTipVisible = false;
      }
      break;
    }

    case "setDehyphenateTextShapeR": {
      newState.dehyphenateTextShapeR = action.value === true;
      break;
    }

    case "setLastOpenedImagePath": {
      newState.lastOpenedImagePath = action.path || null;
      break;
    }

    case "setModal": {
      newState.modalType = action.modal || null;
      newState.modalData = action.data || {};
      break;
    }

    case "setImages": {
      newState.images = action.images;
      break;
    }

    case "updateShortcut": {
      newState.shortcut = { ...defaultShortcut, ...state.shortcut, ...action.shortcut };
      break;
    }

    case "resetShortcut": {
      newState.shortcut = { ...defaultShortcut };
      break;
    }

    case "addSelection": {
      if (action.selection) {
        const selectionWithStyle = {
          ...action.selection,
          styleId: state.currentStyleId,
          capturedAt: Date.now(),
        };
        if (typeof action.lineIndex === "number") {
          selectionWithStyle.lineIndex = action.lineIndex;
          const line = state.lines[action.lineIndex];
          if (line && !line.ignore && state.currentStyleId) {
            newState.usedLineStyles = {
              ...(newState.usedLineStyles || state.usedLineStyles || {}),
              [action.lineIndex]: {
                rawText: line.rawText,
                styleId: state.currentStyleId,
              },
            };
          }
        }
        newState.storedSelections = [...state.storedSelections, selectionWithStyle];
      }
      break;
    }

    case "addSelectionBatch": {
      const entries = action.entries || [];
      if (!entries.length) break;
      const capturedAt = Date.now();
      const storedSelections = state.storedSelections.concat([]);
      const usedLineStyles = { ...(state.usedLineStyles || {}) };
      for (const entry of entries) {
        if (!entry || !entry.selection) continue;
        const styleId = entry.styleId || state.currentStyleId;
        const selectionWithStyle = {
          ...entry.selection,
          styleId,
          capturedAt,
        };
        if (typeof entry.lineIndex === "number") {
          selectionWithStyle.lineIndex = entry.lineIndex;
          const entryLine = state.lines[entry.lineIndex];
          if (entryLine && !entryLine.ignore && styleId) {
            usedLineStyles[entry.lineIndex] = {
              rawText: entryLine.rawText,
              styleId,
            };
          }
        }
        storedSelections.push(selectionWithStyle);
      }
      newState.storedSelections = storedSelections;
      newState.usedLineStyles = usedLineStyles;
      if (
        typeof action.nextLineIndex === "number" &&
        state.lines[action.nextLineIndex] &&
        !state.lines[action.nextLineIndex].ignore
      ) {
        newState.currentLineIndex = action.nextLineIndex;
        thenScroll = true;
        thenSelectStyle = true;
      }
      break;
    }

    case "clearSelections": {
      if (!action.preserveLine) {
        const restoredLineIndex = getStoredSelectionLineIndex(
          state.storedSelections[0],
          state.currentLineIndex,
          state.lines
        );
        if (restoredLineIndex !== state.currentLineIndex) {
          newState.currentLineIndex = restoredLineIndex;
          thenScroll = true;
          thenSelectStyle = true;
        }
      }
      newState.storedSelections = [];
      break;
    }

    case "removeSelection": {
      if (action.index >= 0 && action.index < state.storedSelections.length) {
        const restoredLineIndex = getStoredSelectionLineIndex(
          state.storedSelections[action.index],
          state.currentLineIndex,
          state.lines
        );
        if (restoredLineIndex !== state.currentLineIndex) {
          newState.currentLineIndex = restoredLineIndex;
          thenScroll = true;
          thenSelectStyle = true;
        }
        newState.storedSelections = state.storedSelections.filter((_, i) => i !== action.index);
      }
      break;
    }

    case "setInternalPadding": {
      let padding = action.value === "" || action.value === null || action.value === undefined ? 0 : parseInt(action.value);
      if (isNaN(padding)) padding = 0;
      if (padding < 0) padding = 0;
      if (padding > 100) padding = 100;
      newState.internalPadding = padding;
      break;
    }

    case "setInterpretMarkdown": {
      newState.interpretMarkdown = action.value !== false;
      break;
    }

    case "setResetLineCounterOnPage": {
      newState.resetLineCounterOnPage = action.value !== false;
      break;
    }

    case "addTab": {
      const name = action.name || (locale.tabDefaultName || "Tab") + " " + (state.tabs.length + 1);
      const tab = createTab(name, action.data);
      newState.tabs = state.tabs.concat(tab);
      newState.multiTabEnabled = true;
      loadTabIntoState(newState, tab);
      break;
    }

    case "switchTab": {
      if (action.id === state.currentTabId) break;
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab) break;
      loadTabIntoState(newState, tab);
      break;
    }

    case "renameTab": {
      const name = (action.name || "").trim();
      if (!name) break;
      newState.tabs = state.tabs.map((tab) => (tab.id === action.id ? { ...tab, name } : tab));
      break;
    }

    case "setMultiTabEnabled": {
      const enabled = action.value !== false;
      newState.multiTabEnabled = enabled;
      break;
    }

    case "setUiLayout": {
      newState.uiLayout = normalizeUiLayout(action.layout);
      break;
    }

    case "setEditorTheme": {
      newState.editorTheme = normalizeEditorTheme(action.theme);
      break;
    }

    case "setCustomThemes": {
      // The registry has to be updated before the theme id is validated,
      // otherwise a brand new theme would be rejected as unknown
      const customThemes = setCustomEditorThemes(action.themes);
      newState.customThemes = customThemes;
      if (action.theme !== undefined) {
        newState.editorTheme = normalizeEditorTheme(action.theme);
      } else if (!customThemes.some((theme) => theme.id === state.editorTheme)) {
        newState.editorTheme = normalizeEditorTheme(state.editorTheme);
      }
      break;
    }

    case "setPageLineColor": {
      newState.pageLineColor = normalizePageLineColor(action.color);
      break;
    }

    case "setBackgroundImage": {
      newState.backgroundImage = normalizeBackgroundImage(action.image);
      if (!newState.backgroundImage && state.editorTheme === CUSTOM_IMAGE_THEME_ID) {
        newState.editorTheme = "system";
      }
      break;
    }

    case "resetUiLayout": {
      newState.uiLayout = normalizeUiLayout(null);
      break;
    }

    case "deleteTab": {
      if (state.tabs.length <= 1) break;
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) break;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      newState.tabs = tabs;
      if (state.currentTabId === action.id) {
        loadTabIntoState(newState, tabs[Math.min(index, tabs.length - 1)]);
      }
      break;
    }
  }

  // Detect which fields changed to skip unnecessary recomputation
  const stylesChanged = newState.styles !== state.styles;
  const foldersChanged = newState.folders !== state.folders;
  const textChanged = newState.text !== state.text;
  const ignoreLinePrefixesChanged = newState.ignoreLinePrefixes !== state.ignoreLinePrefixes;
  const ignoreTagsChanged = newState.ignoreTags !== state.ignoreTags;
  const currentFolderTagPriorityChanged = newState.currentFolderTagPriority !== state.currentFolderTagPriority;
  const imagesChanged = newState.images !== state.images;
  const lineIndexChanged = newState.currentLineIndex !== state.currentLineIndex;
  const styleIdChanged = newState.currentStyleId !== state.currentStyleId;
  const usedLineStylesChanged = newState.usedLineStyles !== state.usedLineStyles;
  const resetLineCounterOnPageChanged = newState.resetLineCounterOnPage !== state.resetLineCounterOnPage;

  const needsStyleProcessing = !state.initiated || stylesChanged || foldersChanged;

  // Selecting a style only affects line parsing through current-folder tag
  // isolation: skip the full text re-parse when that folder is unchanged
  // so clicking a style stays instant even with long scripts
  let stylePrefixContextChanged = styleIdChanged;
  if (styleIdChanged && !stylesChanged && state.initiated) {
    if (newState.currentFolderTagPriority === false) {
      stylePrefixContextChanged = false;
    } else {
      const prevFolder = state.currentStyle ? state.currentStyle.folder || null : null;
      const nextActive =
        newState.styles.find((style) => style.id === newState.currentStyleId) ||
        state.currentStyle ||
        null;
      const nextFolder = nextActive ? nextActive.folder || null : null;
      stylePrefixContextChanged = prevFolder !== nextFolder;
    }
  }

  // A direct style navigation must paint its active state before a potentially
  // long script re-parse. The provider schedules the folder-prefix refresh
  // after the browser has had a chance to render, and supersedes stale clicks.
  const deferStylePrefixRefresh =
    stylePrefixContextChanged &&
    (action.type === "setCurrentStyleId" ||
      action.type === "previousStyle" ||
      action.type === "nextStyle");
  if (deferStylePrefixRefresh) {
    newState.stylePrefixRefreshVersion = (state.stylePrefixRefreshVersion || 0) + 1;
    stylePrefixContextChanged = false;
  }

  const needsLineProcessing = needsStyleProcessing || textChanged ||
    ignoreLinePrefixesChanged || ignoreTagsChanged || currentFolderTagPriorityChanged ||
    imagesChanged || stylePrefixContextChanged || usedLineStylesChanged ||
    resetLineCounterOnPageChanged || forceStylePrefixRefresh;

  // Phase 1: Style/folder validation and sorting (only when styles or folders changed)
  if (needsStyleProcessing) {
    if (foldersChanged || !state.initiated) {
      newState.folders = normalizeFolders(newState.folders);
    }

    // Keep untouched style objects identity-stable so memoized style and
    // line components can skip re-rendering after a single-style edit
    const validFolderIds = new Set(newState.folders.map((folder) => folder.id));
    newState.styles = (newState.styles || []).map((style) => {
      const folderId = style.folder || null;
      if (folderId === null || validFolderIds.has(folderId)) return style;
      return { ...style, folder: null };
    });

    if (newState.openFolders) {
      if (newState.openFolders.some((id) => id !== "unsorted" && !validFolderIds.has(id))) {
        newState.openFolders = newState.openFolders.filter((id) => id === "unsorted" || validFolderIds.has(id));
      }
    }

    if (newState.defaultStyleId) {
      const hasDefault = newState.styles.find((s) => s.id === newState.defaultStyleId);
      if (!hasDefault) newState.defaultStyleId = null;
    }

    const stylesByFolder = new Map();
    for (const style of newState.styles) {
      const key = style.folder || "__unsorted__";
      if (!stylesByFolder.has(key)) stylesByFolder.set(key, []);
      stylesByFolder.get(key).push(style);
    }
    const foldersByParent = new Map();
    for (const folder of newState.folders) {
      const key = folder.parentId || "__root__";
      if (!foldersByParent.has(key)) foldersByParent.set(key, []);
      foldersByParent.get(key).push(folder);
    }
    foldersByParent.forEach((folders) => {
      folders.sort((a, b) => {
        const orderA = typeof a.order === "number" ? a.order : 0;
        const orderB = typeof b.order === "number" ? b.order : 0;
        return orderA - orderB;
      });
    });
    let sortedStyles = (stylesByFolder.get("__unsorted__") || []).concat([]);
    const appendFolderStyles = (parentId = null) => {
      const children = foldersByParent.get(parentId || "__root__") || [];
      for (const folder of children) {
        const folderStyles = stylesByFolder.get(folder.id) || [];
        sortedStyles = sortedStyles.concat(folderStyles);
        appendFolderStyles(folder.id);
      }
    };
    appendFolderStyles(null);
    newState.styles = sortedStyles;
  }

  // Phase 2: Prefix building + line parsing (only when relevant fields changed)
  if (needsLineProcessing) {
    const stylePrefixes = [];
    const automaticTagStyles = getAutomaticTagStyles(
      newState.styles,
      newState.currentStyleId,
      newState.currentFolderTagPriority !== false
    );
    for (const style of automaticTagStyles) {
      if (style.prefixesDisabled) continue;
      for (const prefix of style.prefixes || []) {
        if (!prefix) continue;
        stylePrefixes.push({ prefix, style });
      }
    }
    const stylePrefixIndex = buildPrefixIndex(stylePrefixes);

    // Pre-compile a single regex for all ignoreTags instead of split/join per tag per line
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ignoreTags = (newState.ignoreTags || []).filter(Boolean);
    const ignoreTagsRegex = ignoreTags.length
      ? new RegExp(ignoreTags.map(escapeRe).join("|"), "g")
      : null;

    let linesCounter = 0;
    const rawLines = newState.text ? newState.text.split("\n") : [];
    let lastTextLine = null;
    let previousStyle = null;
    const usedLineStyles = newState.usedLineStyles || {};
    const stylesById = new Map(newState.styles.map((style) => [style.id, style]));
    const getUsedStyle = (rawIndex, rawText) => {
      const usedLineStyle = usedLineStyles[rawIndex];
      if (!usedLineStyle || usedLineStyle.rawText !== rawText) return null;
      return stylesById.get(usedLineStyle.styleId) || null;
    };
    const nextLines = rawLines.map((rawText, rawIndex) => {
      const ignorePrefix = newState.ignoreLinePrefixes.find((pr) => rawText.startsWith(pr)) || "";
      const hasStylePrefix = findPrefixMatch(stylePrefixIndex, rawText);

      let stylePrefix = "";
      let style = null;

      if (rawText.startsWith("//")) {
        stylePrefix = rawText.startsWith("//:") ? "//:" : "//";
        style = previousStyle;
      } else if (hasStylePrefix) {
        stylePrefix = hasStylePrefix.prefix;
        style = hasStylePrefix.style;
      }
      const usedStyle = getUsedStyle(rawIndex, rawText);

      let text = rawText.replace(ignorePrefix, "").replace(stylePrefix, "");
      if (ignoreTagsRegex) {
        ignoreTagsRegex.lastIndex = 0;
        text = text.replace(ignoreTagsRegex, "");
      }
      text = text.trim();
      const isPage = parsePageMarker(rawText);
      const ignore = !!ignorePrefix || !text || isPage;
      if (isPage && newState.images.length && lastTextLine) lastTextLine.last = true;
      const lineNumberState = getNextLineNumberState({
        linesCounter,
        isPage,
        ignore,
        resetLineCounterOnPage: newState.resetLineCounterOnPage,
      });
      linesCounter = lineNumberState.linesCounter;
      const index = lineNumberState.index;
      const line = { rawText, rawIndex, ignorePrefix, stylePrefix, style, usedStyle, ignore, index, text };
      if (!line.ignore) lastTextLine = line;
      if (!line.ignore && (line.usedStyle || line.style)) {
        previousStyle = line.usedStyle || line.style;
      }
      return line;
    });
    // Reuse previous line objects when nothing changed so memoized line
    // components skip re-rendering (e.g. selecting a style rebuilds lines
    // but most of them are identical)
    const prevLines = state.lines || [];
    newState.lines = nextLines.map((line) => {
      const prev = prevLines[line.rawIndex];
      if (
        prev &&
        prev.rawIndex === line.rawIndex &&
        prev.rawText === line.rawText &&
        prev.ignorePrefix === line.ignorePrefix &&
        prev.stylePrefix === line.stylePrefix &&
        prev.style === line.style &&
        prev.usedStyle === line.usedStyle &&
        prev.ignore === line.ignore &&
        prev.index === line.index &&
        prev.text === line.text &&
        prev.last === line.last
      ) {
        return prev;
      }
      return line;
    });
  }

  // Phase 3: Update currentLine (when lines or line index changed)
  let needsStyleLookup = needsLineProcessing || lineIndexChanged || styleIdChanged;
  if (needsLineProcessing || lineIndexChanged) {
    newState.currentLine = newState.lines[newState.currentLineIndex] || null;
    if (!newState.currentLine || newState.currentLine.ignore) {
      let newIndex = 0;
      for (let line of newState.lines) {
        if (!line.ignore) {
          newIndex = line.rawIndex;
          break;
        }
      }
      newState.currentLine = newState.lines[newIndex] || null;
      newState.currentLineIndex = newIndex;
    }
    if (thenSelectStyle) {
      // Only explicit prefix styles (and // continuations) drive the style
      // picker on line change; recorded usedStyle must not override the
      // user's manual selection when advancing in multi-bubble mode (#205)
      if (newState.currentLine?.style) {
        newState.currentStyleId = newState.currentLine.style.id;
      } else if (newState.defaultStyleId) {
        newState.currentStyleId = newState.defaultStyleId;
      }
      needsStyleLookup = true;
    }
  }

  // Phase 4: Update currentStyle (when style ID or lines changed)
  if (needsStyleLookup) {
    newState.currentStyle = newState.styles.find((s) => s.id === newState.currentStyleId);
    if (!newState.currentStyle) {
      const newId = newState.styles.length ? newState.styles[0].id : null;
      newState.currentStyle = newId ? newState.styles[0] : null;
      newState.currentStyleId = newId;
    }
  }

  // Phase 5: Open folder management
  if (!newState.initiated) {
    if (newState.currentStyle?.folder) {
      newState.openFolders = [newState.currentStyle.folder];
    } else {
      newState.openFolders = ["unsorted"];
    }
  }
  if (newState.currentStyle && newState.currentStyleId !== state.currentStyleId) {
    const folder = newState.currentStyle.folder || "unsorted";
    if (!newState.openFolders.includes(folder)) newState.openFolders.push(folder);
    if (newState.autoScrollStyle && action.type !== "setCurrentStyleId") {
      scrollToStyle(newState.currentStyleId);
    }
  }
  if (thenScroll) {
    scrollToLine(newState.currentLineIndex);
  }

  // Phase 5.5: Mirror the per-tab fields into the active tab so tabs stay
  // consistent and persisted on every change
  if (newState.tabs && newState.tabs.length) {
    let tabIndex = newState.tabs.findIndex((tab) => tab.id === newState.currentTabId);
    if (tabIndex < 0) {
      // Recover from an invalid tab id (e.g. settings imported from an older version)
      tabIndex = 0;
      newState.currentTabId = newState.tabs[0].id;
    }
    if (tabIndex >= 0) {
      const activeTab = newState.tabs[tabIndex];
      if (tabFields.some((field) => activeTab[field] !== newState[field])) {
        const tabs = newState.tabs.concat([]);
        const updatedTab = { ...activeTab };
        tabFields.forEach((field) => {
          updatedTab[field] = newState[field];
        });
        tabs[tabIndex] = updatedTab;
        newState.tabs = tabs;
      }
    }
  }

  // Phase 6: Storage - only write if a stored field actually changed
  newState.initiated = true;
  let hasStorageChange = false;
  for (let i = 0; i < persistedFields.length; i++) {
    if (newState[persistedFields[i]] !== state[persistedFields[i]]) {
      hasStorageChange = true;
      break;
    }
  }
  if (hasStorageChange) {
    const dataToStore = { storedSelections: undefined };
    let shouldDebounceStorage = false;
    for (let i = 0; i < persistedFields.length; i++) {
      const field = persistedFields[i];
      if (newState.hasOwnProperty(field)) {
        dataToStore[field] = newState[field];
      }
      if (
        newState[field] !== state[field] &&
        (field === "text" || field === "currentLineIndex" || field === "currentStyleId" || field === "textScale" ||
          field === "styles" || field === "usedLineStyles" || field === "storedSelections" || field === "tabs")
      ) {
        shouldDebounceStorage = true;
      }
    }
    // Explicit undefined values remove legacy duplicates from the cached
    // storage object because JSON.stringify omits them on the next commit.
    tabFields.forEach((field) => {
      dataToStore[field] = undefined;
    });
    writeToStorage(dataToStore, false, {
      debounce: shouldDebounceStorage ? 300 : 0,
      idle: shouldDebounceStorage ? 750 : 0,
    });
  }

  return newState;
};

// Zero-cost wrapper while the profiler is off: it only times the reducer when
// the perf logger has been enabled from the settings
const reducer = (state, action) =>
  perfMeasure("dispatch", (action && action.type) || "init", () => baseReducer(state, action));

const Context = React.createContext();
const selectWholeState = (state) => state;
const shallowEqual = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i];
    if (!Object.prototype.hasOwnProperty.call(right, key) || !Object.is(left[key], right[key])) return false;
  }
  return true;
};

// React.memo cannot shield a component from a Context update. Keep the
// provider value stable and let each consumer subscribe only to the state
// fields it reads; unrelated dispatches then cost no React render at all.
const useContext = (selector = selectWholeState) => {
  const store = React.useContext(Context);
  if (!store) throw new Error("TypeR context is unavailable");
  const selectorRef = React.useRef(selector);
  selectorRef.current = selector;
  const selectedRef = React.useRef(selector(store.getState()));
  const renderedSelection = selector(store.getState());
  if (!shallowEqual(selectedRef.current, renderedSelection)) {
    selectedRef.current = renderedSelection;
  }
  const [, forceRender] = React.useReducer((count) => count + 1, 0);

  React.useLayoutEffect(() => {
    const checkForUpdates = () => {
      const nextSelection = selectorRef.current(store.getState());
      if (shallowEqual(selectedRef.current, nextSelection)) return;
      selectedRef.current = nextSelection;
      forceRender();
    };
    const unsubscribe = store.subscribe(checkForUpdates);
    checkForUpdates();
    return unsubscribe;
  }, [store]);

  return { state: selectedRef.current, dispatch: store.dispatch, getState: store.getState };
};
const ContextProvider = React.memo(function ContextProvider(props) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const stateRef = React.useRef(state);
  const listenersRef = React.useRef(new Set());
  stateRef.current = state;
  const contextValue = React.useMemo(() => ({
    dispatch,
    getState: () => stateRef.current,
    subscribe: (listener) => {
      listenersRef.current.add(listener);
      return () => listenersRef.current.delete(listener);
    },
  }), [dispatch]);
  React.useLayoutEffect(() => {
    listenersRef.current.forEach((listener) => listener());
  }, [state]);
  React.useEffect(() => dispatch({}), []);
  React.useEffect(() => {
    if (!state.inlineTextShapeR) return undefined;
    let active = true;
    import(/* webpackChunkName: "text-shaper-engine" */ "./textShapeR").then((engine) => {
      if (!active) return;
      engine.setDehyphenationEnabled(state.dehyphenateTextShapeR === true);
      engine.setTextShapeRTuning(state.textShapeRTuning);
    });
    return () => {
      active = false;
    };
  }, [state.inlineTextShapeR, state.dehyphenateTextShapeR, state.textShapeRTuning]);
  React.useEffect(() => {
    const version = state.stylePrefixRefreshVersion || 0;
    if (!version) return undefined;
    const timer = setTimeout(() => {
      dispatch({ type: "refreshStylePrefixes", version });
    }, 75);
    return () => clearTimeout(timer);
  }, [state.stylePrefixRefreshVersion]);
  React.useEffect(() => {
    const direction = state.direction === "rtl" ? "rtl" : "ltr";
    document.documentElement.setAttribute("dir", direction);
    if (document.body) {
      document.body.setAttribute("dir", direction);
    }
  }, [state.direction]);
  React.useEffect(() => {
    applyThemeState({
      editorTheme: state.editorTheme,
      customThemes: state.customThemes,
      pageLineColor: state.pageLineColor,
      backgroundImage: state.backgroundImage,
    });
  }, [state.editorTheme, state.customThemes, state.pageLineColor, state.backgroundImage]);
  const updateCheckRan = React.useRef(false);
  React.useEffect(() => {
    if (!state.checkUpdates || updateCheckRan.current) return;
    updateCheckRan.current = true;
    const now = Date.now();
    const updateTestConfig = getUpdateTestConfig();
    // The GitHub API allows 60 unauthenticated requests/hour per IP; one check
    // per day is plenty. The manual button and explicit local test mode bypass
    // this so a test can always run on the next panel startup.
    if (!updateTestConfig && !shouldRunUpdateCheck(readStorage("lastUpdateCheckAt"), now)) return;
    checkUpdate(config.appVersion).then((data) => {
      if (!updateTestConfig) writeToStorage({ lastUpdateCheckAt: now });
      if (!data) return;
      // Already installed on disk, only waiting for a Photoshop restart —
      // do not nag or reinstall in the meantime
      if (!data.testMode && readStorage("lastInstalledUpdateVersion") === data.version) return;
      if ((state.autoUpdate || updateTestConfig?.autoInstall) && data.downloadUrl) {
        downloadAndInstallUpdate(
          data.downloadUrl,
          null,
          (needsManualStep) => {
            if (needsManualStep) {
              // inPlaceOnly prevents this, but keep the modal as safety net
              dispatch({ type: "setModal", modal: "update", data });
              return;
            }
            if (data.testMode) {
              clearUpdateTestConfig();
            } else {
              writeToStorage({ lastInstalledUpdateVersion: data.version });
            }
            nativeAlert(
              (locale.updateAutoInstalled || "TypeR {version} has been installed. Restart Photoshop to apply it.").replace("{version}", data.version),
              locale.successTitle,
              false
            );
          },
          () => {
            // Silent install failed: fall back to the interactive modal
            dispatch({ type: "setModal", modal: "update", data });
          },
          { expectedVersion: data.version }
        );
        return;
      }
      if (readStorage("skippedUpdateVersion") === data.version) return;
      // Fetch the zip in the background so the Install click is instant
      prefetchUpdateZip(data.downloadUrl);
      dispatch({ type: "setModal", modal: "update", data });
    }).catch(error => console.warn("Automatic update check failed:", error));
  }, [state.checkUpdates, state.autoUpdate]);
  return <Context.Provider value={contextValue}>{props.children}</Context.Provider>;
});
ContextProvider.propTypes = {
  children: PropTypes.any.isRequired,
};

export { useContext, ContextProvider, defaultUiLayout, normalizeUiLayout };
