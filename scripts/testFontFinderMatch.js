const assert = require("assert");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const load = require("./helpers/loadAppModule")({});
const {
  buildSearchQueries,
  collectMissingStyleFonts,
  findFontFinderMatch,
  getFontWebSearchUrl,
  pickBestMatch,
  splitWords,
  stripStyleSuffix,
} = load("app_src/fontFinderMatch.js");

const family = (id, name, fonts) => ({
  id,
  family: name,
  default_font_id: id * 10,
  fonts: fonts.map((fontName, index) => ({ id: id * 10 + index, name: fontName })),
});

// Snapshot of what the Font FindeR API returns for these searches
const catalog = [
  family(1, "Imaginary Friend", ["ImaginaryFriendBB", "ImaginaryFriendBB-Bold", "ImaginaryFriendBB-Italic"]),
  family(2, "Victory Speech", ["CCVictorySpeech-Regular", "CCVictorySpeech-Bold"]),
  family(3, "Victory Speech Lower", ["CCVictorySpeechLower-Regular", "CCVictorySpeechLower-Bold"]),
  family(4, "Wild Words", ["CCWildWords-Regular", "CCWildWords-Bold", "CCWildWordsRoman"]),
  family(5, "Daft Script", ["DaftScript-Regular", "DaftScript-Italic"]),
  family(6, "Collect Em All", ["CollectEmAllBB", "CollectEmAllBB-Bold"]),
];
const compact = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const searches = [];
const search = async (query) => {
  searches.push(query);
  const needle = compact(query);
  return catalog.filter((item) => [item.family].concat(item.fonts.map((font) => font.name)).some((name) => compact(name).includes(needle)));
};

assert.strictEqual(stripStyleSuffix("ImaginaryFriendBBW00-Bold"), "ImaginaryFriendBBW00");
assert.strictEqual(stripStyleSuffix("CCWildWords-BoldItalic"), "CCWildWords");
assert.strictEqual(stripStyleSuffix("Wild-Words"), "Wild-Words");
assert.deepStrictEqual(splitWords("ImaginaryFriendBBW00"), ["Imaginary", "Friend", "BB", "W00"]);

const queries = buildSearchQueries({ postScriptName: "ImaginaryFriendBBW00-Bold", fontName: "ImaginaryFriendBBW00" });
assert.strictEqual(queries[0], "ImaginaryFriendBBW00");
assert(queries.includes("Imaginary Friend"), "vendor tags are dropped from a later query");
assert(queries.length <= 5);

(async () => {
  // Exact PostScript name wins, and the most specific family is kept
  let match = await findFontFinderMatch({ postScriptName: "CCVictorySpeechLower-Bold", fontName: "CCVictorySpeechLower" }, search);
  assert.strictEqual(match.family.family, "Victory Speech Lower");
  assert.strictEqual(match.font.name, "CCVictorySpeechLower-Bold");
  assert.strictEqual(match.score, 100);
  match = await findFontFinderMatch({ postScriptName: "CCVictorySpeech-Bold", fontName: "CCVictorySpeech" }, search);
  assert.strictEqual(match.family.family, "Victory Speech");

  // Name differs from the files (BB W00 build): the cleaned-up name finds it
  searches.length = 0;
  match = await findFontFinderMatch({ postScriptName: "ImaginaryFriendBBW00-Bold", fontName: "ImaginaryFriendBBW00" }, search);
  assert.strictEqual(match.family.family, "Imaginary Friend");
  assert.strictEqual(match.score, 90);
  assert.strictEqual(match.exact, false, "another build of the font: its PostScript name differs");
  assert.deepStrictEqual(searches, ["ImaginaryFriendBBW00", "Imaginary Friend", "Imaginary"], "one query past the first match");

  // Exact build found on the first query: no further search
  searches.length = 0;
  match = await findFontFinderMatch({ postScriptName: "CCWildWords-Bold", fontName: "CC Wild Words" }, search);
  assert.strictEqual(match.family.family, "Wild Words");
  assert(match.exact);
  assert.deepStrictEqual(searches, ["CCWildWords"]);

  // A namesake sharing only a word is rejected
  match = await findFontFinderMatch({ postScriptName: "DaftBrush", fontName: "DaftBrush" }, search);
  assert.strictEqual(match, null);

  // A close but different name is proposed as approximate
  match = await findFontFinderMatch({ postScriptName: "CollectEmAllFixed", fontName: "Collect Em All Fixed" }, search);
  assert.strictEqual(match.family.family, "Collect Em All");
  assert.strictEqual(match.exact, false);

  assert.strictEqual(pickBestMatch({ postScriptName: "Unknown" }, []), null);

  // Missing fonts of imported styles, one entry per font with its styles
  const style = (name, postScriptName, fontName) => ({
    name,
    textProps: { layerText: { textStyleRange: [{ textStyle: { fontPostScriptName: postScriptName, fontName } }] } },
  });
  const installed = [{ postScriptName: "CCWildWords-Regular", name: "CC Wild Words Regular", family: "CC Wild Words", style: "Regular" }];
  const missing = collectMissingStyleFonts([
    style("Dialogue", "CCWildWords-Regular", "CC Wild Words"),
    style("Shout", "DaftBrush", "DaftBrush"),
    style("Shout 2", "DaftBrush", "DaftBrush"),
  ], installed);
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].postScriptName, "DaftBrush");
  assert.deepStrictEqual(missing[0].styles, ["Shout", "Shout 2"]);

  // Not on Font FindeR: Google search for "<name> font"
  assert.strictEqual(
    getFontWebSearchUrl({ postScriptName: "DaftBrush", fontName: "Daft Brush" }),
    "https://www.google.com/search?q=Daft%20Brush%20font"
  );
  assert.strictEqual(getFontWebSearchUrl({ postScriptName: "LEMONMILK" }), "https://www.google.com/search?q=LEMONMILK%20font");

  console.log("Font FindeR match tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
