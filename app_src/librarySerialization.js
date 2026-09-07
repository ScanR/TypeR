const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const validId = (id) => (typeof id === 'string' && id.length > 0 && id.length < 200) || (typeof id === 'number' && Number.isFinite(id));
const check = (condition) => { if (!condition) throw new Error('invalidImport'); };
const checkUnique = (items, required = true) => {
  const ids = new Set();
  items.forEach((item) => {
    check(isObject(item));
    if (!required && item.id === undefined) return;
    check(validId(item.id) && !ids.has(item.id));
    ids.add(item.id);
  });
};
const checkJsonTree = (value, depth = 0) => {
  check(depth < 60);
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach((key) => {
    check(key !== '__proto__' && key !== 'prototype' && key !== 'constructor');
    checkJsonTree(value[key], depth + 1);
  });
};
export const validateImportData = (data) => {
  check(isObject(data));
  checkJsonTree(data);
  ['folders', 'styles', 'exportedStyles', 'tabs', 'images', 'ignoreLinePrefixes', 'ignoreTags', 'customThemes'].forEach((field) => {
    if (data[field] !== undefined) check(Array.isArray(data[field]));
  });
  ['text', 'language', 'direction'].forEach((field) => {
    if (data[field] !== undefined) check(typeof data[field] === 'string');
  });
  ['ignoreLinePrefixes', 'ignoreTags'].forEach((field) => (data[field] || []).forEach(value => check(typeof value === 'string')));
  if (data.folders) {
    checkUnique(data.folders);
    const parents = new Map(data.folders.map(folder => [folder.id, folder.parentId]));
    data.folders.forEach(folder => {
      check(typeof folder.name === 'string');
      const visited = new Set([folder.id]);
      let parent = folder.parentId;
      while (parent !== null && parent !== undefined && parents.has(parent)) {
        check(!visited.has(parent));
        visited.add(parent);
        parent = parents.get(parent);
      }
    });
  }
  const styles = data.styles || data.exportedStyles;
  if (styles) {
    checkUnique(styles, !!data.styles);
    styles.forEach(style => {
      check(typeof style.name === 'string');
      if (style.textProps !== undefined) check(isObject(style.textProps));
      if (style.prefixes !== undefined) check(Array.isArray(style.prefixes) && style.prefixes.every(value => typeof value === 'string'));
      if (style.sizePresets !== undefined) check(Array.isArray(style.sizePresets) && style.sizePresets.every(value => Number.isFinite(Number(value)) && Number(value) > 0));
    });
  }
  if (data.tabs) {
    check(data.tabs.length > 0);
    checkUnique(data.tabs);
    data.tabs.forEach(tab => {
      check(typeof tab.text === 'string');
      if (tab.images !== undefined) check(Array.isArray(tab.images));
      if (tab.currentLineIndex !== undefined) check(Number.isInteger(tab.currentLineIndex) && tab.currentLineIndex >= 0);
    });
  }
  if (data.shortcut !== undefined) {
    check(isObject(data.shortcut));
    Object.keys(data.shortcut).forEach(key => check(Array.isArray(data.shortcut[key]) && data.shortcut[key].every(value => typeof value === 'string')));
  }
  ['uiLayout', 'usedLineStyles'].forEach(field => { if (data[field] !== undefined) check(isObject(data[field])); });
  return data;
};

// Repair old on-disk hierarchies without dropping their styles. New imports
// use the strict validator above and are rejected before reaching the reducer.
export const repairFolderHierarchy = (input) => {
  const seen = new Set();
  const folders = (Array.isArray(input) ? input : []).filter(folder => {
    if (!isObject(folder) || !validId(folder.id) || seen.has(folder.id)) return false;
    seen.add(folder.id); return true;
  }).map(folder => ({ ...folder }));
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  folders.forEach(folder => {
    const visited = new Set([folder.id]);
    let current = folder;
    while (current.parentId !== null && current.parentId !== undefined) {
      const parent = byId.get(current.parentId);
      if (!parent || visited.has(parent.id)) { current.parentId = null; break; }
      visited.add(parent.id); current = parent;
    }
  });
  return folders;
};

export const serializeStyle = (style) => {
  const result = {};
  ['id', 'name', 'folder', 'edited', 'textType', 'textProps', 'prefixes', 'prefixColor', 'prefixesDisabled', 'stroke', 'sizePresets', 'autoSizeByPageWidth', 'sizePresetDefaultIndex', 'sizePresetMinWidths'].forEach(key => {
    if (style[key] !== undefined) result[key] = style[key];
  });
  return result;
};
export const selectExportStyles = (styles, selectedFolderIds) => styles.filter(style => selectedFolderIds.includes(style.folder || null));
