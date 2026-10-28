const TAB_FIELDS = ["text", "images", "currentLineIndex", "lastOpenedImagePath", "usedLineStyles"];

const hasOwn = (object, field) => Object.prototype.hasOwnProperty.call(object, field);

const createTab = (name, data = {}, createId = () => Math.random().toString(36).substr(2, 8)) => ({
  id: createId(),
  name,
  text: typeof data.text === "string" ? data.text : "",
  images: Array.isArray(data.images) ? data.images : [],
  currentLineIndex: typeof data.currentLineIndex === "number" ? data.currentLineIndex : 0,
  lastOpenedImagePath: data.lastOpenedImagePath || null,
  usedLineStyles: data.usedLineStyles && typeof data.usedLineStyles === "object" ? data.usedLineStyles : {},
});

// Old TypeR versions keep unknown storage keys when they save. After a
// downgrade, a storage file can therefore contain a freshly written legacy
// `text` next to stale tabs. Explicit legacy fields must win during the next
// upgrade, otherwise the stale active tab hides the user's latest script.
const migrateTabStorage = (storedData, defaultName, createId) => {
  const data = storedData && typeof storedData === "object" ? storedData : {};
  let tabs = Array.isArray(data.tabs) ? data.tabs : [];
  let currentTabId = data.currentTabId;
  let migrated = false;
  const seen = new Set();
  tabs = tabs.reduce((result, tab) => {
    if (!tab || typeof tab !== "object" || Array.isArray(tab)) {
      migrated = true;
      return result;
    }
    let next = tab;
    const repair = (field, value) => { next = { ...next, [field]: value }; migrated = true; };
    if (!((typeof tab.id === "string" && tab.id) || (typeof tab.id === "number" && Number.isFinite(tab.id))) || seen.has(tab.id)) {
      const generated = createTab(defaultName, {}, createId).id;
      let id = generated;
      let suffix = 1;
      while (seen.has(id)) id = generated + "_" + suffix++;
      repair("id", id);
    }
    seen.add(next.id);
    if (typeof tab.name !== "string") repair("name", defaultName);
    if (typeof tab.text !== "string") repair("text", "");
    if (tab.images !== undefined && !Array.isArray(tab.images)) repair("images", []);
    if (tab.currentLineIndex !== undefined && (!Number.isInteger(tab.currentLineIndex) || tab.currentLineIndex < 0)) repair("currentLineIndex", 0);
    if (tab.usedLineStyles !== undefined && (!tab.usedLineStyles || typeof tab.usedLineStyles !== "object" || Array.isArray(tab.usedLineStyles))) repair("usedLineStyles", {});
    result.push(next);
    return result;
  }, []);
  if (!migrated && Array.isArray(data.tabs)) tabs = data.tabs;

  if (!tabs.length) {
    const firstTab = createTab(defaultName, data, createId);
    return {
      tabs: [firstTab],
      currentTabId: firstTab.id,
      migrated: true,
    };
  }

  let activeIndex = tabs.findIndex((tab) => tab && tab.id === currentTabId);
  if (activeIndex < 0) {
    activeIndex = 0;
    currentTabId = tabs[0].id;
    migrated = true;
  }

  const activeTab = tabs[activeIndex];
  if (activeTab && TAB_FIELDS.some((field) => hasOwn(data, field) && data[field] !== activeTab[field])) {
    const migratedTab = { ...activeTab };
    TAB_FIELDS.forEach((field) => {
      if (hasOwn(data, field)) migratedTab[field] = data[field];
    });
    tabs = tabs.concat([]);
    tabs[activeIndex] = migratedTab;
    migrated = true;
  }

  return { tabs, currentTabId, migrated };
};

export { TAB_FIELDS, createTab, migrateTabStorage };
