const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const load = require("./helpers/loadAppModule")();
const { imageFileTypes } = load("app_src/imageFileTypes.js");
for (const version of ["", "20.0", "23.1.9", "unknown"]) assert(!imageFileTypes(version).includes(".webp"));
for (const version of ["23.2", "23.10.0", "27.7.0"]) assert(imageFileTypes(version).includes(".webp"));
assert(imageFileTypes("", true).includes(".webp"));

const shape = load("app_src/textShapeR.js");
const source = "Bonjour   mon ami et bonne journée à toi.";
const collapsed = shape.generateTextShapeRVariants(source, { allowHyphenation: false });
assert(collapsed.length && collapsed.every(v => !v.text.includes("   ")));
shape.setPreserveTextShapeRSpaces(true);
for (const gap of ["   ", "\u00a0", "\u202f"]) {
  const text = source.replace("   ", gap);
  const variants = shape.generateTextShapeRVariants(text, { allowHyphenation: true });
  assert(variants.length && variants.every(v => v.text.includes("Bonjour" + gap + "mon")));
  const manual = shape.generateManualTextShapeRVariant(text, { lineCount: 3 });
  assert(manual.text.includes("Bonjour" + gap + "mon"));
  assert(manual.widths.every(Number.isFinite));
}
// An older learned shape must not silently collapse newly protected spaces.
shape.setTextShapeRTuning({ samples: 1, exemplars: [{ lines: ["Bonjour mon ami", "et bonne journée à toi."], hyphens: 0 }] });
assert(shape.generateTextShapeRVariants(source, { allowHyphenation: false }).every(v => v.text.includes("Bonjour   mon")));
shape.setTextShapeRTuning(null);
shape.setPreserveTextShapeRSpaces(false);
assert.deepStrictEqual(shape.generateTextShapeRVariants(source, { allowHyphenation: false }), collapsed);

const extract = (file, name) => {
  const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8").replace(/\r\n/g, "\n");
  const start = text.indexOf("function " + name + "(");
  assert(start >= 0);
  return text.slice(start, text.indexOf("\n}", start) + 2);
};
for (const file of ["app_src/host.js", "uxp-src/host/photoshop.js"]) {
  const fn = extract(file, "_smartConvertToParagraph");
  for (const rewrap of [false, true]) {
    let paragraph = false, resized = false;
    const moves = [];
    const ctx = {
      _currentDisplayedTextPixels: () => 24,
      _currentLayerBox: () => ({ left: paragraph ? 15 : 10, top: paragraph ? 21 : 20, width: rewrap && paragraph && !resized ? 80 : 100, height: rewrap && paragraph && !resized ? 70 : 40 }),
      _changeToBoxText: () => { paragraph = true; },
      _setTextBoxSize: (w, h) => { assert(w > 100 && h > 40); resized = true; },
      _moveLayer: (x, y) => moves.push([x, y]),
    };
    vm.createContext(ctx); vm.runInContext(fn, ctx); ctx._smartConvertToParagraph();
    assert(paragraph); assert.strictEqual(resized, rewrap); assert.deepStrictEqual(moves, [[-5, -1]]);
  }
  // If even the enlarged frame changes ink geometry, fail the commit so its
  // history rollback/fallback handles it; never leave silently clipped text.
  let converted = false, attempts = 0;
  const failure = { _currentDisplayedTextPixels: () => 24,
    _currentLayerBox: () => ({ left: 0, top: 0, width: converted ? 50 : 100, height: 40 }),
    _changeToBoxText: () => { converted = true; },
    _setTextBoxSize: () => { attempts++; }, _moveLayer: () => assert.fail("invalid ink must not be committed") };
  vm.createContext(failure); vm.runInContext(fn, failure);
  assert.throws(() => failure._smartConvertToParagraph(), /could not preserve/);
  assert.equal(attempts, 3);
  // Hanging punctuation: the paragraph is 3 px wider than the point text in
  // any frame, with the same height. The lines are kept: no failure, and the
  // ink goes back where the smart paste composed it. (It used to fail the
  // whole paste, which then fell back to the classic one.)
  let boxed = false, grown = 0;
  const hangingMoves = [];
  const hanging = { _currentDisplayedTextPixels: () => 24,
    _currentLayerBox: () => ({ left: boxed ? 14 : 10, top: 20, width: boxed ? 103 : 100, height: 40 }),
    _changeToBoxText: () => { boxed = true; },
    _setTextBoxSize: () => { grown++; }, _moveLayer: (x, y) => hangingMoves.push([x, y]) };
  vm.createContext(hanging); vm.runInContext(fn, hanging); hanging._smartConvertToParagraph();
  assert(grown >= 1, "the frame is enlarged before the difference is taken for hanging punctuation");
  assert.deepStrictEqual(hangingMoves, [[-4, 0]]);
  // A taller paragraph is a wrapped line, however small the change in width
  let wrapped = false;
  const taller = { _currentDisplayedTextPixels: () => 24,
    _currentLayerBox: () => ({ left: 10, top: 20, width: wrapped ? 98 : 100, height: wrapped ? 70 : 40 }),
    _changeToBoxText: () => { wrapped = true; }, _setTextBoxSize: () => {}, _moveLayer: () => assert.fail("wrapped lines must not be committed") };
  vm.createContext(taller); vm.runInContext(fn, taller);
  assert.throws(() => taller._smartConvertToParagraph(), /could not preserve/);
  const unchanged = { _currentDisplayedTextPixels: () => 24,
    _currentLayerBox: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    _changeToBoxText() {}, _setTextBoxSize() { assert.fail("unchanged ink needs no resize"); },
    _moveLayer() { assert.fail("unchanged ink needs no Move action"); } };
  vm.createContext(unchanged); vm.runInContext(fn, unchanged); unchanged._smartConvertToParagraph();
}
assert.strictEqual(extract("app_src/host.js", "_smartConvertToParagraph"), extract("uxp-src/host/photoshop.js", "_smartConvertToParagraph"));
console.log("Reported issues: WebP host gate, manual spaces and paragraph geometry passed");

// Compare effective selected/inactive paint declarations in the compiled theme.
const sass = require("sass");
const postcss = require("postcss");
const css = sass.compile(path.join(__dirname, "../app_src/index.scss"), { logger: { warn() {}, debug() {} } }).css;
const ast = postcss.parse(css);
const paint = (selected) => {
  const result = {};
  ast.walkRules(rule => {
    const base = 'body[data-editor-theme]:not([data-editor-theme=system]) ';
    const button = selected ? '.topcoat-icon-button--large' : '.topcoat-icon-button--large--quiet';
    if (!rule.selectors.includes(base + button) && !(selected && rule.selectors.includes(base + '.style-edit-props button[aria-pressed=true]'))) return;
    rule.walkDecls(d => { result[d.prop] = d.value; });
  });
  return result;
};
assert.notStrictEqual(paint(true).background, paint(false).background);
assert.strictEqual(paint(true).background, 'var(--editor-accent)');
console.log("Custom theme selected formatting remains visible");

const scrolls = [];
const contextLoader = require('./helpers/loadAppModule')({
  './utils': { locale: {}, readStorage: () => ({ data: { text: 'First\nSecond\nThird', autoScrollText: false, preserveTextShapeRSpaces: true } }), writeToStorage() {}, scrollToLine: index => scrolls.push(index), scrollToStyle() {}, nativeAlert() {} },
  './lib/themeManager': { applyThemeState() {} },
  './perfDebug': { perfMeasure: (a, b, fn) => fn() },
  './themePresets': { normalizeCustomThemes: x => x || [], normalizeEditorTheme: x => x || 'system', setCustomEditorThemes: x => x },
  './backgroundImage': { normalizeBackgroundImage: x => x || null },
});
const { baseReducer, initialState } = contextLoader('app_src/context.jsx', 'export { baseReducer, initialState };');
let state = baseReducer(initialState, { type: 'init' });
assert.strictEqual(state.autoScrollText, false);
assert.strictEqual(state.preserveTextShapeRSpaces, true);
state = baseReducer(state, { type: 'nextLine' });
assert.equal(state.currentLineIndex, 1);
assert.deepStrictEqual(scrolls, [], 'disabled scrolling still advances the script');
state = baseReducer(state, { type: 'setAutoScrollText', value: true });
state = baseReducer(state, { type: 'nextLine' });
assert.equal(state.currentLineIndex, 2);
assert.deepStrictEqual(scrolls, [2]);
console.log('Script auto-scroll: saved preference and navigation behavior passed');
