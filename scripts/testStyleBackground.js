// Style background color, 10 random default palettes, serialization, and reducer behavior.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const load = require("./helpers/loadAppModule")();

const {
  STYLE_BG_PALETTE_COUNT,
  generateRandomBackgroundPalettes,
  getStyleItemColors,
  normalizeStyleBackgroundColor,
} = load("app_src/styleBackground.js");
const { serializeStyle, validateImportData } = load("app_src/librarySerialization.js");
const { reducer, initial } = require("./helpers/loadContext")();

// 10 random palettes by default, all valid distinct hex colors
assert.strictEqual(STYLE_BG_PALETTE_COUNT, 10);
const palette = generateRandomBackgroundPalettes();
assert.strictEqual(palette.length, 10);
palette.forEach((color) => {
  assert.match(color, /^#[0-9a-f]{6}$/i);
});
assert.strictEqual(new Set(palette).size, 10, "default 10 random palettes should be distinct");

// Different RNG seeds yield different palettes
let seedA = 1;
const rngA = () => ((seedA = (seedA * 16807) % 2147483647) / 2147483647);
let seedB = 99991;
const rngB = () => ((seedB = (seedB * 16807) % 2147483647) / 2147483647);
assert.notDeepStrictEqual(
  generateRandomBackgroundPalettes(10, rngA),
  generateRandomBackgroundPalettes(10, rngB)
);

// Normalization and contrasting text color
assert.strictEqual(normalizeStyleBackgroundColor("  #abc  "), "#aabbcc");
assert.strictEqual(normalizeStyleBackgroundColor("rgb(255, 0, 128)"), "#ff0080");
assert.strictEqual(normalizeStyleBackgroundColor(""), "");
assert.strictEqual(normalizeStyleBackgroundColor("not-a-color"), "");
assert.strictEqual(normalizeStyleBackgroundColor(null), "");

assert.strictEqual(getStyleItemColors(""), null);
assert.deepStrictEqual(getStyleItemColors("#ffffff"), { backgroundColor: "#ffffff", color: "#151515" });
assert.deepStrictEqual(getStyleItemColors("#112233"), { backgroundColor: "#112233", color: "#ffffff" });

// Serialization and import validation
const style = {
  id: "bg1",
  name: "Narration",
  folder: null,
  textProps: {},
  prefixes: [],
  backgroundColor: "#336699",
};
assert.strictEqual(serializeStyle(style).backgroundColor, "#336699");
assert(!("backgroundColor" in serializeStyle({ id: "plain", name: "Plain" })));
assert.strictEqual(validateImportData({ folders: [], styles: [style] }).styles[0].backgroundColor, "#336699");
assert.throws(() => validateImportData({ folders: [], styles: [{ ...style, backgroundColor: 123 }] }));

// Reducer saveStyle + clearing + duplicateStyle
const saved = reducer(initial, {
  type: "saveStyle",
  data: { id: "bg1", name: "Narration", textProps: {}, backgroundColor: " #369 " },
});
assert.strictEqual(saved.styles.find((s) => s.id === "bg1").backgroundColor, "#336699");

const duplicated = reducer(saved, { type: "duplicateStyle", data: saved.styles.find((s) => s.id === "bg1") });
assert.strictEqual(duplicated.styles.length, saved.styles.length + 1);
assert.strictEqual(duplicated.styles[duplicated.styles.length - 1].backgroundColor, "#336699");

const cleared = reducer(saved, {
  type: "saveStyle",
  data: { id: "bg1", name: "Narration", textProps: {}, backgroundColor: "" },
});
assert.strictEqual(cleared.styles.find((s) => s.id === "bg1").backgroundColor, "");

// Verify EditStyleModal, StylesBlock, EditFolderModal, and index.scss wire up backgroundColor
const editStyleSrc = fs.readFileSync(path.resolve(__dirname, "../app_src/components/modal/editStyle.jsx"), "utf8");
assert(editStyleSrc.includes("generateRandomBackgroundPalettes"), "EditStyleModal should use 10 random palettes");
assert(editStyleSrc.includes("editStyleBackgroundColorLabel"), "EditStyleModal should expose background color selector");
const stylesBlockSrc = fs.readFileSync(path.resolve(__dirname, "../app_src/components/stylesBlock/stylesBlock.jsx"), "utf8");
assert(stylesBlockSrc.includes("getStyleItemColors(props.style.backgroundColor)"), "StyleItem should apply style background color");
const indexScssSrc = fs.readFileSync(path.resolve(__dirname, "../app_src/index.scss"), "utf8");
assert(indexScssSrc.includes(".style-item.m-current:not(.m-has-bg)"), "Theme active accent should not hide custom style background");

console.log("style background color tests passed");
