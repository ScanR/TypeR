const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "styleSizePresets.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const presetModule = { exports: {} };
new Function("require", "module", "exports", transformed)(require, presetModule, presetModule.exports);

const {
  MAX_STYLE_SIZE_PRESETS,
  cycleStyleSizePreset,
  normalizeStyleSizePresetWidthConfig,
  normalizeStyleSizePresets,
  resolveStyleSizePresetForPageWidth,
  setStyleSizePreset,
  updateActiveStyleSizePreset,
} = presetModule.exports;

const makeStyle = (size, sizePresets) => ({
  id: "title",
  sizePresets,
  textProps: {
    layerText: {
      textStyleRange: [{ textStyle: { size, impliedFontSize: size } }],
    },
  },
});

assert.strictEqual(MAX_STYLE_SIZE_PRESETS, 3);
assert.deepStrictEqual(normalizeStyleSizePresets(makeStyle(23)), [23]);
assert.deepStrictEqual(normalizeStyleSizePresets(makeStyle(35, [23, 23, 0, "bad"])), [35, 23]);
assert.deepStrictEqual(normalizeStyleSizePresets(makeStyle(23, [23, 35, 48, 60])), [23, 35, 48]);

const original = makeStyle(23, [23, 35, 48]);
const selected = setStyleSizePreset(original, 35);
assert.notStrictEqual(selected, original);
assert.strictEqual(original.textProps.layerText.textStyleRange[0].textStyle.size, 23);
assert.strictEqual(selected.textProps.layerText.textStyleRange[0].textStyle.size, 35);
assert.strictEqual(selected.textProps.layerText.textStyleRange[0].textStyle.impliedFontSize, 35);
assert.deepStrictEqual(selected.sizePresets, [23, 35, 48]);

const cycled = cycleStyleSizePreset(selected);
assert.strictEqual(cycled.textProps.layerText.textStyleRange[0].textStyle.size, 48);
const wrapped = cycleStyleSizePreset(cycled);
assert.strictEqual(wrapped.textProps.layerText.textStyleRange[0].textStyle.size, 23);
assert.strictEqual(setStyleSizePreset(original, 99), original);
const resizedActive = updateActiveStyleSizePreset(original, 26);
assert.deepStrictEqual(resizedActive.sizePresets, [26, 35, 48]);
assert.strictEqual(resizedActive.textProps.layerText.textStyleRange[0].textStyle.size, 26);
assert.strictEqual(resizedActive.textProps.layerText.textStyleRange[0].textStyle.impliedFontSize, 26);
assert.strictEqual(updateActiveStyleSizePreset(original, 35), original, "Quick editing must not create duplicate presets");

const automatic = {
  ...original,
  autoSizeByPageWidth: true,
  sizePresetDefaultIndex: 0,
  sizePresetMinWidths: [null, 1000, 1500],
};
assert.deepStrictEqual(normalizeStyleSizePresetWidthConfig(automatic), {
  autoSizeByPageWidth: true,
  sizePresetDefaultIndex: 0,
  sizePresetMinWidths: [null, 1000, 1500],
});
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 999), 23);
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 1000), 35);
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 1499), 35);
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 1500), 48);
assert.strictEqual(resolveStyleSizePresetForPageWidth({ ...automatic, autoSizeByPageWidth: false }, 2000), 23);

const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");
assert(hostSource.includes("function _resolveStyleSizeForDocument(style)"));
assert(hostSource.includes('activeDocument.width.as("px")'));

// A size picked by hand must win over the page-width rule on the page being
// lettered, and the rule must resume on any other document
const holdStart = hostSource.indexOf("// A size picked by hand in the panel");
const holdEnd = hostSource.indexOf("function _changeToPointText()");
assert(holdStart >= 0 && holdEnd > holdStart, "Missing manual size hold implementation");
const activeDocument = { id: 1, width: { as: () => 1200 } };
const host = new Function(
  "documents", "activeDocument", "app", "_hostState",
  `${hostSource.slice(holdStart, holdEnd)}\nreturn { hold: holdStyleSizeOnActiveDocument, resolve: _resolveStyleSizeForDocument };`
)({ length: 1 }, activeDocument, { activeDocument }, { manualSizeStyles: {} });

const makeAutoStyle = (id, size) => ({
  id,
  autoSizeByPageWidth: true,
  sizePresets: [20, 22],
  sizePresetDefaultIndex: 0,
  sizePresetMinWidths: [null, 1000],
  textProps: { layerText: { textStyleRange: [{ textStyle: { size, impliedFontSize: size } }] } },
});
const sizeOf = (style) => style.textProps.layerText.textStyleRange[0].textStyle.size;

assert.strictEqual(sizeOf(host.resolve(makeAutoStyle("normal", 20))), 22, "Automatic sizing must still follow the page width");
host.hold("normal");
assert.strictEqual(sizeOf(host.resolve(makeAutoStyle("normal", 20))), 20, "A hand-picked size must beat the page-width rule on this page");
assert.strictEqual(sizeOf(host.resolve(makeAutoStyle("normal", 22))), 22);
assert.strictEqual(sizeOf(host.resolve(makeAutoStyle("title", 20))), 22, "Holding one style must not affect the others");
activeDocument.id = 2;
assert.strictEqual(sizeOf(host.resolve(makeAutoStyle("normal", 20))), 22, "Automatic sizing must resume on another document");
host.hold("normal");
assert.strictEqual(sizeOf(host.resolve(makeAutoStyle("normal", 20))), 20, "A new pick on another page holds there too");
const unnamed = makeAutoStyle(undefined, 20);
host.hold(undefined);
assert.strictEqual(sizeOf(host.resolve(unnamed)), 22, "A style without an id cannot be held");

const stylesSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "stylesBlock", "stylesBlock.jsx"), "utf8");
assert(
  /holdStyleSizeOnActiveDocument\(props\.style\);\s*dispatch\(\{ type: "setStyleSizePreset"/.test(stylesSource),
  "Clicking a size preset must hold the size against the page-width rule"
);
assert(
  /holdStyleSizeOnActiveDocument\(props\.style\);\s*dispatch\(\{ type: "updateActiveStyleSizePreset"/.test(stylesSource),
  "Quick size edits must hold the size against the page-width rule"
);

console.log("style size preset tests passed");
