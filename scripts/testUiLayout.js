// Panel layout: each footer mode toggle is shown or hidden on its own, and
// the single switch of older versions still hides every toggle
const assert = require("assert");
const load = require("./helpers/loadAppModule")();
const layout = load("app_src/uiLayout.js");

const modeKeys = Object.keys(layout.FOOTER_MODE_KEYS).map((id) => layout.FOOTER_MODE_KEYS[id]);
assert.deepStrictEqual(Object.keys(layout.FOOTER_MODE_KEYS), ["textShapeR", "multiBubble", "autoCenter", "pasteOnClick", "autoClean"]);

// Defaults: everything shown
const defaults = layout.normalizeUiLayout(null);
modeKeys.forEach((key) => assert.strictEqual(defaults.visible[key], true, key + " shown by default"));
assert.strictEqual("footerModeToggles" in defaults.visible, false, "the old switch is not kept");

// One toggle hidden, the others stay
const one = layout.normalizeUiLayout({ visible: { footerModeAutoCenter: false } });
assert.strictEqual(one.visible.footerModeAutoCenter, false);
assert.strictEqual(layout.isFooterModeVisible(one, "autoCenter"), false);
assert.strictEqual(layout.isFooterModeVisible(one, "multiBubble"), true);
assert.strictEqual(layout.isFooterModeVisible(one, "unknown"), true, "a toggle without a key is always shown");
assert.strictEqual(layout.isFooterModeVisible(null, "autoCenter"), true);

// Older storage: the single switch off hides every toggle
const legacy = layout.normalizeUiLayout({ visible: { footerModeToggles: false, footerHelp: false } });
modeKeys.forEach((key) => assert.strictEqual(legacy.visible[key], false, key + " hidden by the old switch"));
assert.strictEqual(legacy.visible.footerHelp, false);
const legacyOn = layout.normalizeUiLayout({ visible: { footerModeToggles: true } });
modeKeys.forEach((key) => assert.strictEqual(legacyOn.visible[key], true));

// A saved layout is stable: normalizing it again changes nothing
const saved = layout.normalizeUiLayout(legacy);
assert.deepStrictEqual(layout.normalizeUiLayout(JSON.parse(JSON.stringify(saved))), saved);
// A new per-toggle value wins over the old switch
const mixed = layout.normalizeUiLayout({ visible: { footerModeToggles: false, footerModePasteOnClick: true } });
assert.strictEqual(mixed.visible.footerModePasteOnClick, true);
assert.strictEqual(mixed.visible.footerModeMultiBubble, false);

// The panel is never left empty, sizes are clamped, order is completed
const empty = layout.normalizeUiLayout({ visible: { preview: false, text: false, styles: false }, order: ["styles", "bogus"], sizes: { previewHeight: 999, uiScale: 10 } });
assert.strictEqual(empty.visible.text, true);
assert.deepStrictEqual(empty.order, ["styles", "preview", "text"]);
assert.deepStrictEqual(empty.sizes, { previewHeight: 300, uiScale: 70 });

console.log("ui layout tests passed");
