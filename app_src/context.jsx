import React from "react";
import PropTypes from "prop-types";
import { locale, readStorage, writeToStorage, scrollToLine, scrollToStyle, checkUpdate } from "./utils";
import config from "./config";

const storage = readStorage();
const storeFields = [
  "notFirstTime",
  "text",
  "styles",
  "folders",
  "textScale",
  "textSizeIncrement",
  "currentLineIndex",
  "currentStyleId",
  "pastePointText",
  "ignoreLinePrefixes",
  "ignoreTags",
  "defaultStyleId",
  "autoClosePSD",
  "checkUpdates",
  "autoScrollStyle",
  "currentFolderTagPriority",
  "resizeTextBoxOnCenter",
  "images",
  "shortcut",
  "language",
  "theme",
  "direction",
  "middleEast",
  "lastOpenedImagePath",
  "storedSelections",
  "multiBubbleMode",
  "internalPadding",
];

const defaultShortcut = {
  add: ["WIN", "CTRL"],
  center: ["WIN", "ALT"],
  apply: ["WIN", "SHIFT"],
  next: ["CTRL", "ENTER"],
  previous: ["CTRL", "TAB"],
  increase: ["CTRL", "SHIFT", "PLUS"],
  decrease: ["CTRL", "SHIFT", "MINUS"],
  insertText: ["WIN", "V"],
  nextPage: ["SHIFT", "X"],
};

const normalizeFolders = (folders) => {
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

const collectDescendantFolderIds = (folders, folderId) => {
  const ids = [];
  if (!folderId) return ids;
  const queue = [folderId];
  while (queue.length) {
    const current = queue.shift();
    const children = (folders || []).filter((folder) => (folder.parentId || null) === current);
    for (const child of children) {
      ids.push(child.id);
      queue.push(child.id);
    }
  }
  return ids;
};

const getFolderChildren = (folders, parentId = null) => {
  const parentKey = parentId || null;
  return (folders || [])
    .filter((folder) => (folder.parentId || null) === parentKey)
    .sort((a, b) => {
      const orderA = typeof a.order === "number" ? a.order : 0;
      const orderB = typeof b.order === "number" ? b.order : 0;
      return orderA - orderB;
    });
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
  pastePointText: false,
  ignoreLinePrefixes: ["##"],
  ignoreTags: [],
  defaultStyleId: null,
  autoClosePSD: false,
  checkUpdates: config.checkUpdates,
  autoScrollStyle: storage.data?.autoScrollStyle !== false,
  currentFolderTagPriority: storage.data?.currentFolderTagPriority !== false,
  resizeTextBoxOnCenter: false,
  modalType: null,
  modalData: {},
  images: [],
  language: "auto",
  theme: "default",
  direction: "ltr",
  middleEast: false,
  lastOpenedImagePath: null,
  storedSelections: [],
  multiBubbleMode: false,
  internalPadding: 10,
  ...storage.data,
  theme: "default",
  shortcut: { ...defaultShortcut, ...(storage.data?.shortcut || {}) },
};

const reducer = (state, action) => {
  // console.log("CONTEXT:", action);

  let thenScroll = false;
  let thenSelectStyle = false;
  const newState = Object.assign({}, state);
  switch (action.type) {
    case "removeFirstTime": {
      newState.notFirstTime = true;
      newState.modalType = "help";
      break;
    }

    case "import": {
      for (const field in action.data) {
        if (!action.data.hasOwnProperty(field)) continue;
        if (!initialState.hasOwnProperty(field)) continue;
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
      if (!state.text || (action.add && newState.currentLine.last)) break;
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

    case "nextPage": {
      if (!state.text) break;
      // Trouver la prochaine ligne "Page X"
      let foundNextPage = false;
      for (let i = state.currentLineIndex + 1; i < state.lines.length; i++) {
        const line = state.lines[i];
        if (line.rawText.match(/Page [0-9]+/i)) {
          // Trouver la première ligne non-ignorée après cette page
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

    case "setCurrentStyleId": {
      newState.currentStyleId = action.id;
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
        let styles = state.styles.concat([]);
        styles
          .filter((s) => s.folder === editId)
          .forEach((style) => {
            if (!styleIds.includes(style.id)) style.folder = null;
          });
        styleIds.forEach((sid) => {
          const style = styles.find((s) => s.id === sid);
          if (style) style.folder = editId;
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

    case "deleteFolder": {
      if (!action.id) break;
      const idsToRemove = [action.id].concat(collectDescendantFolderIds(state.folders, action.id));
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

    case "saveStyle": {
      if (typeof action.data.prefixes === "string") {
        const arr = action.data.prefixes.split(/(?:\r?\n|;)/);
        action.data.prefixes = arr.map((p) => p.trim()).filter(Boolean);
      } else if (!Array.isArray(action.data.prefixes)) {
        action.data.prefixes = [];
      }
      const styles = state.styles.concat([]);
      const editId = action.id || action.data.id;
      const style = styles.find((s) => s.id === editId);
      if (style) Object.assign(style, action.data);
      else styles.push(action.data);
      newState.styles = styles;
      break;
    }

    case "toggleStylePrefixes": {
      const styles = state.styles.concat([]);
      const style = styles.find((s) => s.id === action.id);
      if (style) {
        style.prefixesDisabled = !style.prefixesDisabled;
      }
      newState.styles = styles;
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
        const newStyle = { ...styleToDup, id: newStyleId, name: styleToDup.name + " copy" };
        newState.styles = state.styles.concat(newStyle);
        newState.currentStyleId = newStyleId;
      }
      break;
    }

    case "setStyles": {
      newState.styles = action.data || [];
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

  case "setTheme": {
    newState.theme = "default";
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

    case "setMultiBubbleMode": {
      newState.multiBubbleMode = !!action.value;
      // Vider les sélections stockées si on désactive le mode
      if (!action.value) {
        newState.storedSelections = [];
      }
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
      // console.log(action);
      newState.shortcut = { ...defaultShortcut, ...state.shortcut, ...action.shortcut };
      break;
    }

    case "addSelection": {
      if (action.selection) {
        // Capturer le style actuel au moment de la sélection
        const selectionWithStyle = {
          ...action.selection,
          styleId: state.currentStyleId,
          capturedAt: Date.now()
        };
        newState.storedSelections = [...state.storedSelections, selectionWithStyle];
      }
      break;
    }

    case "clearSelections": {
      newState.storedSelections = [];
      break;
    }

    case "removeSelection": {
      if (action.index >= 0 && action.index < state.storedSelections.length) {
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
  }

  for (const style of newState.styles) {
    const folderId = style.folder || null;
    const hasFolder = newState.folders.find((f) => f.id === folderId);
    if (!hasFolder) style.folder = null;
  }

  if (newState.folders !== state.folders) {
    newState.folders = normalizeFolders(newState.folders);
  }

  if (newState.openFolders) {
    const validFolderIds = new Set(newState.folders.map((folder) => folder.id));
    if (newState.openFolders.some((id) => id !== "unsorted" && !validFolderIds.has(id))) {
      newState.openFolders = newState.openFolders.filter((id) => id === "unsorted" || validFolderIds.has(id));
    }
  }

  if (newState.defaultStyleId) {
    const hasDefault = newState.styles.find((s) => s.id === newState.defaultStyleId);
    if (!hasDefault) newState.defaultStyleId = null;
  }

  const stylesSource = newState.styles.concat([]);
  let sortedStyles = stylesSource.filter((style) => !style.folder);
  const appendFolderStyles = (parentId = null) => {
    const children = getFolderChildren(newState.folders, parentId);
    for (const folder of children) {
      const folderStyles = stylesSource.filter((style) => style.folder === folder.id);
      sortedStyles = sortedStyles.concat(folderStyles);
      appendFolderStyles(folder.id);
    }
  };
  appendFolderStyles(null);
  newState.styles = sortedStyles;

  const stylePrefixes = [];
  const folderPrefixes = [];
  const folderOnlyPrefixes = [];
  const unsortedPrefixes = [];
  const currentFolder = state.currentStyle ? state.currentStyle.folder || null : null;
  for (const style of newState.styles) {
    if (style.prefixesDisabled) continue;
    const folder = style.folder || null;
    for (const prefix of style.prefixes) {
      const data = { prefix, style, folder };
      stylePrefixes.push(data);
      if (folder) folderOnlyPrefixes.push(data);
      else unsortedPrefixes.push(data);
      if (folder === currentFolder) folderPrefixes.push(data);
    }
  }

  let linesCounter = 0;
  const rawLines = newState.text ? newState.text.split("\n") : [];
  const last = [];
  let previousStyle = null;
  newState.lines = rawLines.map((rawText, rawIndex) => {
    const ignorePrefix = newState.ignoreLinePrefixes.find((pr) => rawText.startsWith(pr)) || "";
    const hasStylePrefix = (
      newState.currentFolderTagPriority !== false
        ? folderPrefixes.find((sp) => rawText.startsWith(sp.prefix))
        : (unsortedPrefixes.find((sp) => rawText.startsWith(sp.prefix)) ||
           folderOnlyPrefixes.find((sp) => rawText.startsWith(sp.prefix)))
    ) || stylePrefixes.find((sp) => rawText.startsWith(sp.prefix));

    let stylePrefix = "";
    let style = null;

    if (rawText.startsWith("//")) {
      stylePrefix = rawText.startsWith("//:") ? "//:" : "//";
      style = previousStyle;
    } else if (hasStylePrefix) {
      stylePrefix = hasStylePrefix.prefix;
      style = hasStylePrefix.style;
    }

    let text = rawText.replace(ignorePrefix, "").replace(stylePrefix, "");
    if (newState.ignoreTags?.length) {
      text = newState.ignoreTags.reduce((acc, tag) => {
        if (!tag) return acc;
        return acc.split(tag).join("");
      }, text);
    }
    text = text.trim();
    const isPage = rawText.match(/Page [0-9]+/i);
    const ignore = !!ignorePrefix || !text || isPage;
    if (isPage && newState.images.length) {
      last.push(linesCounter);
    }
    const index = ignore ? 0 : ++linesCounter;
    const line = { rawText, rawIndex, ignorePrefix, stylePrefix, style, ignore, index, text };
    if (!line.ignore && line.style) {
      previousStyle = line.style;
    }
    return line;
  });
  last.forEach((index) => {
    newState.lines.find((line) => line.index == index).last = true;
  });

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
    if (newState.currentLine.style) {
      newState.currentStyleId = newState.currentLine.style.id;
    } else if (newState.defaultStyleId) {
      newState.currentStyleId = newState.defaultStyleId;
    }
  }

  newState.currentStyle = newState.styles.find((s) => s.id === newState.currentStyleId);
  if (!newState.currentStyle) {
    const newId = newState.styles.length ? newState.styles[0].id : null;
    newState.currentStyle = newId ? newState.styles[0] : null;
    newState.currentStyleId = newId;
  }

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
    if (newState.autoScrollStyle) scrollToStyle(newState.currentStyleId);
  }
  if (thenScroll) {
    scrollToLine(newState.currentLineIndex);
  }

  const dataToStore = {};
  for (let field in newState) {
    if (!newState.hasOwnProperty(field)) continue;
    if (storeFields.includes(field)) {
      dataToStore[field] = newState[field];
    }
  }
  newState.initiated = true;
  writeToStorage(dataToStore);

  return newState;
};

const Context = React.createContext();
const useContext = () => React.useContext(Context);
const ContextProvider = React.memo(function ContextProvider(props) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  React.useEffect(() => dispatch({}), []);

  const defaultStyleRef = React.useRef('');
  React.useEffect(() => {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
    const indexLink = links.find((l) => !l.id && l.getAttribute('href'));
    if (indexLink) {
      defaultStyleRef.current = indexLink.getAttribute('href');
      indexLink.remove();
    }
  }, []);
  React.useEffect(() => {
    if (state.checkUpdates) {
      checkUpdate(config.appVersion).then((data) => {
        if (data) {
          dispatch({ type: 'setModal', modal: 'update', data });
        }
      });
    }
  }, [state.checkUpdates]);
  React.useEffect(() => {
    const link = document.getElementById('themeStyle');
    if (!link) return;
    if (state.theme && state.theme !== 'default') {
      link.setAttribute('href', `./themes/${state.theme}.css`);
    } else {
      link.setAttribute('href', defaultStyleRef.current || './index.css');
    }
  }, [state.theme]);
  return <Context.Provider value={{ state, dispatch }}>{props.children}</Context.Provider>;
});
ContextProvider.propTypes = {
  children: PropTypes.any.isRequired,
};

export { useContext, ContextProvider };
