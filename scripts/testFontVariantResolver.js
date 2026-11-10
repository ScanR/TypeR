const assert = require("assert");
const path = require("path");

const { resolveTypeRFontVariant } = require(path.resolve(__dirname, "../app_src/fontVariantResolver.jsxinc"));

const fonts = [
  { name: "Example Regular", postScriptName: "Example-Regular", family: "Example", style: "Regular" },
  { name: "Example Bold", postScriptName: "Example-Bold", family: "Example", style: "Bold" },
  { name: "Example Italic", postScriptName: "Example-Italic", family: "Example", style: "Italic" },
  { name: "Solo Regular", postScriptName: "Solo-Regular", family: "Solo", style: "Regular" },
  { name: "Partial Regular", postScriptName: "Partial-Regular", family: "Partial", style: "Regular" },
  { name: "Partial Bold", postScriptName: "Partial-Bold", family: "Partial", style: "Bold" },
];

const makeStyle = (family = "Example", postScriptName = "Example-Regular", style = "Regular") => ({
  fontName: family,
  fontPostScriptName: postScriptName,
  fontStyleName: style,
});

const bold = resolveTypeRFontVariant(makeStyle(), { bold: true }, fonts);
assert.strictEqual(bold.fontPostScriptName, "Example-Bold");
assert.strictEqual(bold.syntheticBold, false);
assert.strictEqual(bold.syntheticItalic, false);

const italic = resolveTypeRFontVariant(makeStyle(), { italic: true }, fonts);
assert.strictEqual(italic.fontPostScriptName, "Example-Italic");
assert.strictEqual(italic.syntheticItalic, false);

const fallback = resolveTypeRFontVariant(makeStyle("Solo", "Solo-Regular"), { bold: true, italic: true }, fonts);
assert.strictEqual(fallback.fontPostScriptName, "Solo-Regular");
assert.strictEqual(fallback.syntheticBold, true);
assert.strictEqual(fallback.syntheticItalic, true);

const partial = resolveTypeRFontVariant(makeStyle("Partial", "Partial-Regular"), { bold: true, italic: true }, fonts);
assert.strictEqual(partial.fontPostScriptName, "Partial-Bold");
assert.strictEqual(partial.syntheticBold, false);
assert.strictEqual(partial.syntheticItalic, true);

const italicBase = resolveTypeRFontVariant(makeStyle("Example", "Example-Italic", "Italic"), { bold: true }, fonts);
assert.strictEqual(italicBase.fontPostScriptName, "Example-Bold");
assert.strictEqual(italicBase.syntheticItalic, true);

// A family with several heavy faces, listed as Photoshop does (by name)
const face = (family, style) => ({ name: family + " " + style, postScriptName: family + "-" + style.replace(/\s/g, ""), family, style });
const wide = ["Black", "Black Italic", "Bold", "Bold Italic", "Italic", "Regular", "SemiBold", "Semilight", "SemiCondensed", "DemiLight"].map((style) => face("Wide", style));
const pick = (style, run) => resolveTypeRFontVariant(makeStyle("Wide", "Wide-" + style.replace(/\s/g, ""), style), run, wide);

assert.strictEqual(pick("Regular", { bold: true }).fontStyleName, "Bold", "a bold run takes Bold, not the first heavy face listed");
assert.strictEqual(pick("Regular", { bold: true, italic: true }).fontStyleName, "Bold Italic");
assert.strictEqual(pick("Black", { italic: true }).fontStyleName, "Black Italic", "an italic run keeps the weight of its font");
assert.strictEqual(pick("Regular", { italic: true }).fontStyleName, "Italic");

// Light and condensed faces whose name holds "semi" or "demi" are not bold
const light = ["Regular", "Semilight", "SemiCondensed", "DemiLight"].map((style) => face("Thin", style));
const thin = resolveTypeRFontVariant(makeStyle("Thin", "Thin-Regular"), { bold: true }, light);
assert.strictEqual(thin.fontStyleName, "Regular");
assert.strictEqual(thin.syntheticBold, true, "no bold face: faux bold on the regular one");
const demi = resolveTypeRFontVariant(makeStyle("Old", "Old-Book", "Book"), { bold: true }, [face("Old", "Book"), face("Old", "Demi")]);
assert.strictEqual(demi.fontStyleName, "Demi", "a lone Demi is the bold face of its family");

assert.strictEqual(resolveTypeRFontVariant(null, { bold: true }, fonts), null);
const untouched = makeStyle();
assert.strictEqual(resolveTypeRFontVariant(untouched, null, fonts), untouched);

console.log("font variant resolver tests passed");
