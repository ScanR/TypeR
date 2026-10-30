// Smart paste settings in the panel state: defaults, normalization of stored
// and imported values, reducer actions, the transient notice and the style
// bubble type carried through library export/import
const assert = require("assert");
const loadContext = require("./helpers/loadContext");
const load = require("./helpers/loadAppModule")();
const { serializeStyle, validateImportData } = load("app_src/librarySerialization.js");

// Defaults
{
  const { initial } = loadContext({});
  assert.strictEqual(initial.smartPaste, true, "smart paste is on by default");
  assert.strictEqual(initial.pasteOnClick, false);
  assert.strictEqual(initial.smartPasteAutoClean, false);
  assert.strictEqual(initial.smartPasteDistribute, true);
  assert.strictEqual(initial.smartPasteMinScale, 0.85);
  assert.strictEqual(initial.smartPasteHyphenation, "auto");
  assert.deepStrictEqual(initial.refontRules, []);
  assert.strictEqual(initial.notice, null);
}

// Stored values
{
  const { initial } = loadContext({
    smartPaste: false,
    pasteOnClick: true,
    smartPasteAutoClean: true,
    smartPasteDistribute: false,
    smartPasteMinScale: 0.8,
    smartPasteHyphenation: "fr",
  });
  assert.strictEqual(initial.smartPaste, false, "a stored false stays false");
  assert.strictEqual(initial.pasteOnClick, true);
  assert.strictEqual(initial.smartPasteAutoClean, true);
  assert.strictEqual(initial.smartPasteDistribute, false);
  assert.strictEqual(initial.smartPasteMinScale, 0.8);
  assert.strictEqual(initial.smartPasteHyphenation, "fr");
}

// Stored booleans only switch on/off for real booleans
{
  const { initial } = loadContext({ pasteOnClick: "true", smartPasteAutoClean: 1, smartPaste: 0, smartPasteDistribute: "no" });
  assert.strictEqual(initial.pasteOnClick, false);
  assert.strictEqual(initial.smartPasteAutoClean, false);
  assert.strictEqual(initial.smartPaste, true);
  assert.strictEqual(initial.smartPasteDistribute, true);
}

// Minimum scale: clamped to [0.5, 1], anything else falls back to 0.85
for (const [stored, expected] of [
  [0.5, 0.5], [1, 1], [0.2, 0.5], [3, 1], [-1, 0.5], ["0.8", 0.8], [0.754, 0.75],
  ["abc", 0.85], ["", 0.85], [null, 0.85], [true, 0.85], [{}, 0.85], [NaN, 0.85], [Infinity, 0.85],
]) {
  assert.strictEqual(loadContext({ smartPasteMinScale: stored }).initial.smartPasteMinScale, expected, `minScale ${String(stored)}`);
}

// Hyphenation: one of the known modes, otherwise auto
for (const mode of ["auto", "fr", "en", "off"]) {
  assert.strictEqual(loadContext({ smartPasteHyphenation: mode }).initial.smartPasteHyphenation, mode);
}
for (const bad of ["FR", "de", 1, null, true, { mode: "fr" }, "toString"]) {
  assert.strictEqual(loadContext({ smartPasteHyphenation: bad }).initial.smartPasteHyphenation, "auto");
}

// Refont rules are normalized through the shared engine helper
{
  const { initial } = loadContext({
    refontRules: [
      { open: "\"", close: "\"", keepMarkers: true, styleId: "abc" },
      { open: "<<<<<<<<<<", close: ">>", keepMarkers: "yes", styleId: 42 },
      { open: "", close: "]", styleId: "x" },
      { open: "[", close: "]", styleId: { id: "x" } },
      null,
      "rule",
    ],
  });
  assert.deepStrictEqual(initial.refontRules, [
    { open: "\"", close: "\"", keepMarkers: true, styleId: "abc" },
    { open: "<<<<<<<<", close: ">>", keepMarkers: false, styleId: 42 },
    { open: "[", close: "]", keepMarkers: false, styleId: null },
  ]);
  assert.deepStrictEqual(loadContext({ refontRules: "bad" }).initial.refontRules, []);
  const many = Array.from({ length: 20 }, (_, i) => ({ open: "<" + i, close: ">", styleId: "s" }));
  assert.strictEqual(loadContext({ refontRules: many }).initial.refontRules.length, 16, "the rule list is capped");
}

// Import normalizes the new fields and leaves them alone when absent
{
  const { reducer, initial } = loadContext({ smartPaste: false, smartPasteMinScale: 0.9, smartPasteHyphenation: "en" });
  const imported = reducer(initial, {
    type: "import",
    data: {
      smartPaste: true,
      pasteOnClick: true,
      smartPasteAutoClean: true,
      smartPasteDistribute: false,
      smartPasteMinScale: 12,
      smartPasteHyphenation: "klingon",
      refontRules: [{ open: "*", close: "*", styleId: "s1" }, { open: "x" }],
    },
  });
  assert.strictEqual(imported.smartPaste, true);
  assert.strictEqual(imported.pasteOnClick, true);
  assert.strictEqual(imported.smartPasteAutoClean, true);
  assert.strictEqual(imported.smartPasteDistribute, false);
  assert.strictEqual(imported.smartPasteMinScale, 1);
  assert.strictEqual(imported.smartPasteHyphenation, "auto");
  assert.deepStrictEqual(imported.refontRules, [{ open: "*", close: "*", keepMarkers: false, styleId: "s1" }]);

  const badTypes = reducer(initial, { type: "import", data: { smartPaste: "nope", pasteOnClick: "yes", smartPasteMinScale: "x", refontRules: {} } });
  assert.strictEqual(badTypes.smartPaste, true);
  assert.strictEqual(badTypes.pasteOnClick, false);
  assert.strictEqual(badTypes.smartPasteMinScale, 0.85);
  assert.deepStrictEqual(badTypes.refontRules, []);

  const untouched = reducer(initial, { type: "import", data: {} });
  assert.strictEqual(untouched.smartPaste, false, "an import without the field keeps the setting");
  assert.strictEqual(untouched.smartPasteMinScale, 0.9);
  assert.strictEqual(untouched.smartPasteHyphenation, "en");
}

// Reducer actions, persisted on change
{
  const { reducer, initial, writes } = loadContext({});
  const lastWrite = () => writes[writes.length - 1][0];

  let state = reducer(initial, { type: "setSmartPaste", value: false });
  assert.strictEqual(state.smartPaste, false);
  assert.strictEqual(lastWrite().smartPaste, false, "the setting is written to storage");
  assert.strictEqual(reducer(state, { type: "setSmartPaste", value: true }).smartPaste, true);

  state = reducer(initial, { type: "setPasteOnClick", value: true });
  assert.strictEqual(state.pasteOnClick, true);
  assert.strictEqual(lastWrite().pasteOnClick, true);
  assert.strictEqual(reducer(state, { type: "setPasteOnClick", value: 0 }).pasteOnClick, false);

  assert.strictEqual(reducer(initial, { type: "setSmartPasteAutoClean", value: true }).smartPasteAutoClean, true);
  assert.strictEqual(reducer(initial, { type: "setSmartPasteDistribute", value: false }).smartPasteDistribute, false);

  assert.strictEqual(reducer(initial, { type: "setSmartPasteMinScale", value: 0.55 }).smartPasteMinScale, 0.55);
  assert.strictEqual(reducer(initial, { type: "setSmartPasteMinScale", value: 0.1 }).smartPasteMinScale, 0.5);
  assert.strictEqual(reducer(initial, { type: "setSmartPasteMinScale", value: "bogus" }).smartPasteMinScale, 0.85);

  assert.strictEqual(reducer(initial, { type: "setSmartPasteHyphenation", value: "off" }).smartPasteHyphenation, "off");
  assert.strictEqual(reducer(initial, { type: "setSmartPasteHyphenation", value: "es" }).smartPasteHyphenation, "auto");

  state = reducer(initial, {
    type: "setRefontRules",
    rules: [{ open: "«", close: "»", keepMarkers: true, styleId: "s2" }, { open: "", close: "" }],
  });
  assert.deepStrictEqual(state.refontRules, [{ open: "«", close: "»", keepMarkers: true, styleId: "s2" }]);
  assert.deepStrictEqual(lastWrite().refontRules, state.refontRules);
  assert.deepStrictEqual(reducer(state, { type: "setRefontRules", rules: null }).refontRules, []);
}

// Transient notice: shown, replaced and cleared by id, never persisted
{
  const { reducer, initial, writes } = loadContext({});
  const writeCount = writes.length;

  let state = reducer(initial, { type: "showNotice", text: "Paste on click enabled", kind: "info" });
  const first = state.notice;
  assert.strictEqual(first.text, "Paste on click enabled");
  assert.strictEqual(first.kind, "info");
  assert.strictEqual(typeof first.id, "number");
  assert.strictEqual(writes.length, writeCount, "a notice never touches storage");

  state = reducer(state, { type: "showNotice", text: "Smart paste unavailable", kind: "warning" });
  const second = state.notice;
  assert.strictEqual(second.kind, "warning");
  assert(second.id > first.id, "every notice gets a new id");

  assert.strictEqual(reducer(state, { type: "showNotice", text: "x", kind: "error" }).notice.kind, "info", "unknown kinds fall back to info");
  assert.strictEqual(reducer(state, { type: "showNotice", text: "   " }).notice, second, "a blank notice is ignored");
  assert.strictEqual(reducer(state, { type: "showNotice", text: "" }).notice, second);
  assert.strictEqual(reducer(state, { type: "showNotice" }).notice, second);

  assert.strictEqual(reducer(state, { type: "clearNotice", id: first.id }).notice, second, "a stale id keeps the newer notice");
  assert.strictEqual(reducer(state, { type: "clearNotice", id: second.id }).notice, null);
  assert.strictEqual(reducer(state, { type: "clearNotice" }).notice, null, "clearing without id clears any notice");
  const cleared = reducer(state, { type: "clearNotice" });
  assert.strictEqual(reducer(cleared, { type: "clearNotice", id: 1 }).notice, null);

  const ids = new Set();
  for (let i = 0; i < 50; i++) {
    state = reducer(state, { type: "showNotice", text: "n" + i });
    ids.add(state.notice.id);
  }
  assert.strictEqual(ids.size, 50, "ids stay unique within the same millisecond");
  writes.forEach(([data]) => assert(!data || !("notice" in data), "notice is not a stored field"));
}

// Style bubble type survives library export, validation and duplication
{
  const style = { id: "s", name: "Shout", textProps: {}, prefixes: [], bubbleType: "shout" };
  assert.strictEqual(serializeStyle(style).bubbleType, "shout");
  assert.strictEqual(serializeStyle({ ...style, bubbleType: "" }).bubbleType, "");
  assert(!("bubbleType" in serializeStyle({ id: "a", name: "A" })));
  assert.strictEqual(validateImportData({ folders: [], styles: [style] }).styles[0].bubbleType, "shout");
  assert.throws(() => validateImportData({ folders: [], styles: [{ ...style, bubbleType: 3 }] }));

  const { reducer, initial } = loadContext({});
  let state = reducer(initial, { type: "saveStyle", data: { ...style, textProps: { layerText: {} } } });
  state = reducer(state, { type: "setCurrentStyleId", id: "s" });
  state = reducer(state, { type: "duplicateStyle" });
  assert.deepStrictEqual(state.styles.map((item) => item.bubbleType), ["shout", "shout"]);
  state = reducer(state, { type: "saveStyle", data: { id: "s", name: "Shout", bubbleType: "narration" } });
  assert.strictEqual(state.styles.find((item) => item.id === "s").bubbleType, "narration");
}

console.log("smart paste settings tests passed");
