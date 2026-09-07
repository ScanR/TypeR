const assert = require("assert");
const loadAppModule = require("./helpers/loadAppModule")();

const { buildFontGroups, getFontGroupKey } = loadAppModule("app_src/fontScan.js");

const makeRun = (overrides = {}) => ({
  fontPostScriptName: "CCWildWords",
  fontName: "CC Wild Words",
  fontStyleName: "Regular",
  syntheticBold: false,
  syntheticItalic: false,
  size: 16,
  color: { red: 0, green: 0, blue: 0 },
  ...overrides,
});

const makeLayer = (runs, overrides = {}) => ({
  layerName: "text layer",
  antiAlias: "antiAliasSmooth",
  typeUnit: "pixelsUnit",
  paragraphStyle: { alignment: "center" },
  stroke: null,
  runs,
  ...overrides,
});

// Real and synthetic bold/italic variants get distinct group keys
assert.notStrictEqual(getFontGroupKey(makeRun()), getFontGroupKey(makeRun({ fontPostScriptName: "CCWildWords-BoldItalic" })));
assert.notStrictEqual(getFontGroupKey(makeRun()), getFontGroupKey(makeRun({ syntheticBold: true })));
assert.notStrictEqual(getFontGroupKey(makeRun()), getFontGroupKey(makeRun({ syntheticItalic: true })));

// Most-used size wins; variants stay separate groups
const groups = buildFontGroups([
  {
    file: "a.psd",
    layers: [
      makeLayer([makeRun({ size: 16 })]),
      makeLayer([makeRun({ size: 16 })]),
      makeLayer([makeRun({ size: 20 })]),
      makeLayer([makeRun({ fontPostScriptName: "CCWildWords-BoldItalic", fontStyleName: "Bold Italic", size: 18 })]),
    ],
  },
  {
    file: "b.psd",
    layers: [
      makeLayer([makeRun({ size: 16 })]),
      makeLayer([makeRun({ syntheticItalic: true, size: 14 })]),
    ],
  },
]);

assert.strictEqual(groups.length, 3, "regular, real bold-italic and faux italic should be separate");
const regular = groups.find((g) => g.key === getFontGroupKey(makeRun()));
assert.ok(regular, "regular group exists");
assert.strictEqual(regular.topSize, 16, "most-used size wins");
assert.strictEqual(regular.usageCount, 4);
assert.strictEqual(regular.fileCount, 2);
assert.strictEqual(regular.textProps.layerText.textStyleRange[0].textStyle.size, 16);
assert.strictEqual(groups[0].key, regular.key, "groups sorted by usage count");

const fauxItalic = groups.find((g) => g.syntheticItalic);
assert.ok(fauxItalic, "faux italic group exists");
assert.ok(/faux italic/i.test(fauxItalic.defaultName), "faux italic flagged in default name");

// Identical runs inside one layer count once; different sizes still feed the histogram
const dedupGroups = buildFontGroups([
  {
    file: "c.psd",
    layers: [
      makeLayer([makeRun({ size: 12 }), makeRun({ size: 12 }), makeRun({ size: 13 })]),
    ],
  },
]);
assert.strictEqual(dedupGroups.length, 1);
assert.strictEqual(dedupGroups[0].usageCount, 2, "identical runs in a layer deduplicated");

// Stroke of the representative variant is normalized and kept
const strokeGroups = buildFontGroups([
  {
    file: "d.psd",
    layers: [
      makeLayer([makeRun({ size: 15 })], { stroke: { enabled: true, size: 3.14159, opacity: 87.4, position: "outer", color: { r: 254.6, g: 0, b: 0 } } }),
    ],
  },
]);
assert.strictEqual(strokeGroups[0].stroke.enabled, true);
assert.strictEqual(strokeGroups[0].stroke.size, 3.14);
assert.strictEqual(strokeGroups[0].stroke.opacity, 87);
assert.strictEqual(strokeGroups[0].stroke.color.r, 255);

// Disabled or missing strokes normalize to the default disabled stroke
assert.strictEqual(regular.stroke.enabled, false);
assert.strictEqual(regular.stroke.color.r, 255);

// Paragraph defaults mirror copyLayerStyle normalization
const paragraphStyle = regular.textProps.layerText.paragraphStyleRange[0].paragraphStyle;
assert.strictEqual(paragraphStyle.burasagari, "burasagariNone");
assert.strictEqual(paragraphStyle.singleWordJustification, "justifyAll");
assert.strictEqual(paragraphStyle.justificationMethodType, "justifMethodAutomatic");
assert.strictEqual(paragraphStyle.textEveryLineComposer, false);
assert.strictEqual(paragraphStyle.alignment, "center");

// Empty input stays safe
assert.deepStrictEqual(buildFontGroups([]), []);
assert.deepStrictEqual(buildFontGroups(null), []);

console.log("fontScan tests passed");
