const assert = require("assert");
const load = require("./helpers/loadAppModule")();
const { reducer, initial } = require("./helpers/loadContext")();
const { buildStoredSelectionPayload } = load("app_src/textLayerPayload.js");
const { applyCapturedTextSize, getStyleTextSize } = load("app_src/styleSizePresets.js");

const makeStyle = (size, extra = {}) => ({
  id: "normal",
  name: "Normal",
  sizePresets: [20, 22],
  textProps: { layerText: { textStyleRange: [{ textStyle: { size, impliedFontSize: size } }] } },
  ...extra,
});
const bubble = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, xMid: 50, yMid: 50 };
const sizeOf = (style) => getStyleTextSize(style);

// A bubble captured at 20 keeps 20 when the size is switched to 22 afterwards
let state = reducer(initial, { type: "saveStyle", data: makeStyle(20) });
assert.strictEqual(state.currentStyleId, "normal");
state = reducer(state, { type: "addSelection", selection: bubble });
assert.strictEqual(state.storedSelections[0].textSize, 20, "A single capture must remember the style size");

state = reducer(state, { type: "setStyleSizePreset", id: "normal", size: 22 });
state = reducer(state, { type: "addSelectionBatch", entries: [{ selection: bubble }] });
assert.strictEqual(state.storedSelections[1].textSize, 22, "A batch capture must remember the style size");

const payload = buildStoredSelectionPayload({
  storedSelections: state.storedSelections,
  lines: [{ text: "first" }, { text: "second" }],
  currentLineIndex: 0,
  styles: state.styles,
  currentStyle: state.currentStyle,
});
assert.deepStrictEqual(payload.styles.map(sizeOf), [20, 22], "Each bubble must keep the size it was captured with");
assert.strictEqual(sizeOf(state.currentStyle), 22, "The style itself keeps the latest picked size");

// The text scale still applies on top of the captured size
const scaled = buildStoredSelectionPayload({
  storedSelections: state.storedSelections,
  lines: [{ text: "first" }, { text: "second" }],
  currentLineIndex: 0,
  styles: state.styles,
  currentStyle: state.currentStyle,
  textScale: 200,
});
assert.deepStrictEqual(scaled.styles.map(sizeOf), [40, 44]);

// Selections without a remembered size (older sessions) follow the style
const legacy = buildStoredSelectionPayload({
  storedSelections: [{ styleId: "normal" }],
  lines: [{ text: "first" }],
  currentLineIndex: 0,
  styles: state.styles,
  currentStyle: state.currentStyle,
});
assert.strictEqual(sizeOf(legacy.styles[0]), 22);

// A captured size that differs from the style must not be overridden by the
// page-width rule, while an unchanged size leaves automatic sizing alone
const auto = makeStyle(22, { autoSizeByPageWidth: true, sizePresetDefaultIndex: 0, sizePresetMinWidths: [null, 1000] });
const changed = applyCapturedTextSize(auto, 20);
assert.strictEqual(sizeOf(changed), 20);
assert.strictEqual(changed.autoSizeByPageWidth, false);
assert.strictEqual(sizeOf(auto), 22, "The original style must not be mutated");
assert.strictEqual(applyCapturedTextSize(auto, 22), auto, "An unchanged size must keep automatic sizing");
assert.strictEqual(applyCapturedTextSize(auto, undefined), auto);
assert.strictEqual(applyCapturedTextSize(auto, "bad"), auto);

console.log("stored selection size tests passed");
