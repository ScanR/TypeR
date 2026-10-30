const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");
const filePath = path.resolve(rootDir, "app_src/fontPreview.js");
const source = fs.readFileSync(filePath, "utf8");
const { code } = babel.transformSync(source, {
  filename: filePath,
  babelrc: false,
  configFile: false,
  plugins: ["@babel/plugin-transform-modules-commonjs"],
});
const mod = new Module(filePath, module);
mod.filename = filePath;
mod.paths = Module._nodeModulePaths(path.dirname(filePath));
mod._compile(code, filePath);

const {
  createFontPreviewRegistry,
  filterFontOptions,
  findInstalledFont,
  getFontPreviewFamily,
  getInstalledFontFaceRule,
  pickFamilyPreviewFont,
} = mod.exports;

const textStyle = {
  fontPostScriptName: "ExampleSans-Bold",
  fontName: "Example Sans Bold",
};
const installedFont = {
  postScriptName: "ExampleSans-Bold",
  name: "Example Sans Bold",
  family: "Example Sans",
  style: "Bold",
};

assert.strictEqual(findInstalledFont([], textStyle), undefined);
assert.strictEqual(findInstalledFont([installedFont], textStyle), installedFont);

const missingRegistry = createFontPreviewRegistry([], [textStyle], 1);
assert.strictEqual(missingRegistry.css, "");
assert.strictEqual(
  getFontPreviewFamily(textStyle, missingRegistry),
  '"Example Sans Bold", "ExampleSans-Bold", "Tahoma"'
);

const installedRegistry = createFontPreviewRegistry([installedFont], [textStyle], 2);
assert.ok(installedRegistry.css.includes('@font-face{font-family:"TypeRPreview_2_0"'));
assert.ok(installedRegistry.css.includes('local("ExampleSans-Bold")'));
assert.strictEqual(
  getFontPreviewFamily(textStyle, installedRegistry),
  '"TypeRPreview_2_0", "Example Sans Bold", "ExampleSans-Bold", "Tahoma"'
);

const refreshedRegistry = createFontPreviewRegistry([installedFont], [textStyle], 3);
assert.notStrictEqual(
  getFontPreviewFamily(textStyle, installedRegistry),
  getFontPreviewFamily(textStyle, refreshedRegistry)
);

const wildjessRegular = {
  postScriptName: "Wildjess",
  name: "Wildjess",
  family: "Wildjess",
  style: "Regular",
};
const wildjessBoldItalic = {
  postScriptName: "Wildjess-BoldItalic",
  name: "Wildjess BoldItalic",
  family: "Wildjess",
  style: "Bold Italic",
};
const wildjessTextStyle = {
  fontPostScriptName: "Wildjess",
  fontName: "Wildjess",
  fontStyleName: "BoldItalic",
};

assert.strictEqual(
  findInstalledFont([wildjessRegular, wildjessBoldItalic], wildjessTextStyle),
  wildjessBoldItalic,
  "family + style must resolve the exact face instead of the first family member"
);

const wildjessRegistry = createFontPreviewRegistry(
  [wildjessRegular, wildjessBoldItalic],
  [wildjessTextStyle],
  0,
  "preview"
);
assert.ok(wildjessRegistry.css.includes('@font-face{font-family:"TypeRPreview_preview_0_0"'));
assert.ok(wildjessRegistry.css.includes('local("Wildjess-BoldItalic")'));
assert.ok(wildjessRegistry.css.includes('local("Wildjess Bold Italic")'));
assert.strictEqual(
  getFontPreviewFamily(wildjessTextStyle, wildjessRegistry),
  '"TypeRPreview_preview_0_0", "Wildjess", "Tahoma"'
);

// Font picker: every face previews its exact weight
assert.strictEqual(
  getInstalledFontFaceRule(wildjessBoldItalic, "TypeRPicker_0"),
  '@font-face{font-family:"TypeRPicker_0";src:local("Wildjess-BoldItalic"),local("Wildjess BoldItalic"),local("Wildjess Bold Italic");}'
);
assert.strictEqual(getInstalledFontFaceRule(null, "TypeRPicker_1"), "");
assert.strictEqual(getInstalledFontFaceRule({ postScriptName: 'Bad"Name' }, "A"), '@font-face{font-family:"A";src:local("Bad\\"Name");}');

assert.strictEqual(pickFamilyPreviewFont([wildjessBoldItalic, wildjessRegular]), wildjessRegular);
assert.strictEqual(pickFamilyPreviewFont([wildjessBoldItalic]), wildjessBoldItalic);
assert.strictEqual(pickFamilyPreviewFont([]), undefined);

const pickerOptions = ["Grace Hand", "Wild Words", "CC Wild Words", "Anime Ace 2.0 BB", "Comic Neue", "Écriture Manga", "BadaBoom BB"]
  .map((label) => ({ value: label, label }));
const labels = (query) => filterFontOptions(pickerOptions, query).map((option) => option.label);
assert.strictEqual(filterFontOptions(pickerOptions, "  "), pickerOptions);
assert.deepStrictEqual(labels("wild"), ["Wild Words", "CC Wild Words"], "prefix matches come first");
assert.deepStrictEqual(labels("words wild").sort(), ["CC Wild Words", "Wild Words"], "word order is free");
assert.deepStrictEqual(labels("animeace"), ["Anime Ace 2.0 BB"], "spaces are optional");
assert.deepStrictEqual(labels("ecriture"), ["Écriture Manga"], "accents are optional");
assert.deepStrictEqual(labels("ace"), ["Anime Ace 2.0 BB", "Grace Hand"], "word starts rank before inner matches");
assert.deepStrictEqual(labels("neue"), ["Comic Neue"]);
assert.deepStrictEqual(labels("zzz"), []);

console.log("font preview refresh tests passed");
