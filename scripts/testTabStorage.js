const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "tabStorage.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const storageModule = { exports: {} };
new Function("require", "module", "exports", transformed)(
  require,
  storageModule,
  storageModule.exports
);

const { migrateTabStorage, moveTab } = storageModule.exports;

const legacyStorage = {
  text: "Script kept from master",
  images: [{ path: "page-001.psd" }],
  currentLineIndex: 12,
  lastOpenedImagePath: "page-001.psd",
  usedLineStyles: { 12: { rawText: "Line 12", styleId: "style-1" } },
};
const firstUpgrade = migrateTabStorage(legacyStorage, "Tab 1", () => "tab-migrated");
assert.strictEqual(firstUpgrade.migrated, true, "Pre-tab storage must be marked for immediate persistence");
assert.strictEqual(firstUpgrade.currentTabId, "tab-migrated");
assert.strictEqual(firstUpgrade.tabs.length, 1);
assert.deepStrictEqual(firstUpgrade.tabs[0], {
  id: "tab-migrated",
  name: "Tab 1",
  ...legacyStorage,
});

const currentStorage = {
  tabs: [{ id: "tab-1", name: "Tab 1", text: "Current tab text" }],
  currentTabId: "tab-1",
};
const currentResult = migrateTabStorage(currentStorage, "Tab 1");
assert.strictEqual(currentResult.migrated, false, "Current tab storage must not be rewritten on startup");
assert.strictEqual(currentResult.tabs, currentStorage.tabs, "Unchanged tabs must preserve their identity");

const downgradeStorage = {
  tabs: [
    { id: "tab-1", name: "Tab 1", text: "Stale tab text", currentLineIndex: 2 },
    { id: "tab-2", name: "Tab 2", text: "Other tab text" },
  ],
  currentTabId: "tab-1",
  text: "Text rewritten by master",
  currentLineIndex: 8,
};
const downgradeResult = migrateTabStorage(downgradeStorage, "Tab 1");
assert.strictEqual(downgradeResult.migrated, true, "Legacy fields that differ from tabs must be migrated");
assert.strictEqual(downgradeResult.tabs[0].text, "Text rewritten by master");
assert.strictEqual(downgradeResult.tabs[0].currentLineIndex, 8);
assert.strictEqual(downgradeResult.tabs[1], downgradeStorage.tabs[1], "Unrelated tabs must stay untouched");
assert.strictEqual(downgradeStorage.tabs[0].text, "Stale tab text", "Migration must not mutate storage input");

const clearedLegacyText = migrateTabStorage({
  tabs: [{ id: "tab-1", name: "Tab 1", text: "Stale text" }],
  currentTabId: "tab-1",
  text: "",
}, "Tab 1");
assert.strictEqual(clearedLegacyText.tabs[0].text, "", "An intentionally cleared legacy text must beat a stale tab");

// A slot is a gap of the current list: 0 is before the first tab
const orderTabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
const movedOrder = (id, slot) => moveTab(orderTabs, id, slot).map((tab) => tab.id).join("");
assert.strictEqual(movedOrder("a", 3), "bca", "A tab must move to the end");
assert.strictEqual(movedOrder("a", 2), "bac", "A tab moved right must land in its gap");
assert.strictEqual(movedOrder("c", 0), "cab", "A tab must move to the start");
assert.strictEqual(movedOrder("c", 1), "acb", "A tab moved left must land in its gap");
assert.strictEqual(moveTab(orderTabs, "b", 1), orderTabs, "The gap before a tab must leave the list untouched");
assert.strictEqual(moveTab(orderTabs, "b", 2), orderTabs, "The gap after a tab must leave the list untouched");
assert.strictEqual(moveTab(orderTabs, "missing", 0), orderTabs, "An unknown tab must leave the list untouched");
assert.strictEqual(moveTab(orderTabs, "a", 3)[2], orderTabs[0], "A moved tab must keep its contents");
assert.strictEqual(orderTabs[0].id, "a", "Moving a tab must not mutate the list");

console.log("tab storage migration tests passed");
