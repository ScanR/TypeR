// Settings window tabs, in display order: the work first (insertion, script,
// styles), then the panel and the data.
export const SETTINGS_TABS = [
  "general",
  "insertion",
  "script",
  "styles",
  "shortcuts",
  "appearance",
  "data",
  "fontViewer",
];

// Opened when the user has no last tab yet: the one used most while working
export const DEFAULT_SETTINGS_TAB = "insertion";

// A view preference, like the font viewer layout: localStorage, which the UXP
// panel mirrors into one of TypeR's storage files (uxp-src/web/domShims.js)
const STORAGE_KEY = "typer.settingsTab";

const storageOf = (root) => {
  try {
    return root && root.localStorage ? root.localStorage : null;
  } catch (error) {
    return null;
  }
};

export const normalizeSettingsTab = (id) => (SETTINGS_TABS.indexOf(id) >= 0 ? id : DEFAULT_SETTINGS_TAB);

export function readSettingsTab(root = typeof window !== "undefined" ? window : null) {
  const storage = storageOf(root);
  try {
    return normalizeSettingsTab(storage ? storage.getItem(STORAGE_KEY) : null);
  } catch (error) {
    return DEFAULT_SETTINGS_TAB;
  }
}

export function writeSettingsTab(id, root = typeof window !== "undefined" ? window : null) {
  const storage = storageOf(root);
  if (!storage || SETTINGS_TABS.indexOf(id) < 0) return;
  try {
    storage.setItem(STORAGE_KEY, id);
  } catch (error) {}
}
