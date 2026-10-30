// Settings window: the last tab the user looked at is restored, Insertion
// opens the first time, and an unknown or removed tab never leaves it blank
const assert = require("assert");
const load = require("./helpers/loadAppModule")();
const tabs = load("app_src/settingsTab.js");

const memoryWindow = () => {
  const values = {};
  return {
    values,
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
      setItem: (key, value) => {
        values[key] = String(value);
      },
    },
  };
};

assert.deepStrictEqual(tabs.SETTINGS_TABS, ["general", "insertion", "script", "styles", "shortcuts", "appearance", "data", "fontViewer"]);
assert.strictEqual(tabs.DEFAULT_SETTINGS_TAB, "insertion");

const win = memoryWindow();
assert.strictEqual(tabs.readSettingsTab(win), "insertion", "Insertion opens the first time");
tabs.writeSettingsTab("styles", win);
assert.strictEqual(tabs.readSettingsTab(win), "styles", "the last tab comes back");
tabs.writeSettingsTab("fontViewer", win);
assert.strictEqual(tabs.readSettingsTab(win), "fontViewer");

// Tabs of older versions, or anything else, are not written and read as Insertion
tabs.writeSettingsTab("behavior", win);
assert.strictEqual(tabs.readSettingsTab(win), "fontViewer", "an unknown tab is not stored");
win.values["typer.settingsTab"] = "profiles";
assert.strictEqual(tabs.readSettingsTab(win), "insertion", "a removed tab falls back to Insertion");

// No storage (or a storage that throws) never breaks opening the settings
assert.strictEqual(tabs.readSettingsTab(null), "insertion");
assert.strictEqual(tabs.readSettingsTab({ localStorage: { getItem: () => { throw new Error("denied"); } } }), "insertion");
assert.doesNotThrow(() => tabs.writeSettingsTab("styles", { localStorage: { setItem: () => { throw new Error("full"); } } }));

console.log("Settings tab memory tests passed");
