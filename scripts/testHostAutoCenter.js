// CEP host (app_src/host.js): auto-centre after a paste, "centre double
// bubble", the size +/- on the displayed size and the TextShapeR live size.
// Photoshop is mocked: this checks the decisions and the arithmetic, not what
// Photoshop itself returns. uxp-src/host/photoshop.js is compared with these
// helpers by scripts/testUxpHost.js.
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "../app_src/host.js"), "utf8");
const history = [];
const doc = {
  id: 1,
  width: 1000,
  height: 1000,
  resolution: 72,
  activeHistoryState: "before",
  suspendHistory(name, script) {
    history.push(name);
    this.activeHistoryState = name;
    vm.runInContext(script, box);
  },
};
const box = vm.createContext({
  app: { activeDocument: doc, documents: [doc] },
  documents: [doc],
  jamJSON: JSON,
  stringIDToTypeID: (id) => id,
});
vm.runInContext(source, box);

const rect = (l, t, r, b) => box._rectFrom(l, t, r, b);
const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);

/* --------------------------- ES3 guard --------------------------- */

const sectionStart = source.indexOf("/* ===== bubble detection: auto-centre and double bubble ==== */");
const sectionEnd = source.indexOf("Retrieve stroke information");
assert(sectionStart > 0 && sectionEnd > sectionStart, "The auto-centre section must stay in one block of host.js");
const ported = [
  "_changeActiveLayerTextSize", "_readTextStyleSize", "_resizeTextStyleFast", "_resizeTextRebuild", "_fitFrameToTextSize",
  "_recentreOnBox", "_setTextShapeRText", "_createTextLayerInSelection", "_createTextLayersInStoredSelections",
  "alignTextLayersToDoubleBubble",
];
const sectionFunctions = [...source.slice(sectionStart, sectionEnd).matchAll(/^function (\w+)\(/gm)].map((match) => match[1]);
assert(sectionFunctions.length > 40, "The section functions must be found");
for (const name of sectionFunctions.concat(ported)) {
  const fn = box[name];
  assert.strictEqual(typeof fn, "function", name + " must exist");
  const text = fn.toString();
  assert(!/=>|\blet\s|\bconst\s|`|\.\.\./.test(text), name + " uses ES6 syntax");
  assert(!/\.(map|filter|forEach|some|every|reduce|find|includes|indexOf)\(/.test(text), name + " uses ES5 array methods");
  assert(!/Number\.isFinite|Math\.hypot|Object\.(keys|assign)|JSON\./.test(text), name + " uses ES5+ builtins");
}
// The optional double-bubble wand mode (feature/double-bubble) defines its
// helpers with a _typeR prefix: none of these names may collide with it
sectionFunctions.forEach((name) => assert(!/^_typeR/.test(name), name + " clashes with the double-bubble mode prefix"));

// Host errors are codes the panel translates, never hard-coded sentences
assert(!/S\\u00e9lectionnez|Impossible de d\\u00e9tecter|Le texte ne tient pas|calques de texte/.test(source), "French host error strings");

/* ------------------------ bubble geometry ------------------------ */

const page = { width: 1000, height: 1000 };
const textBox = rect(100, 100, 200, 140);
assert(box._bubbleCandidateValid(rect(80, 80, 220, 160), textBox, page, [], 20));
assert(!box._bubbleCandidateValid(rect(0, 0, 900, 900), textBox, page, [], 20), "a page-sized wand is rejected");
assert(!box._bubbleCandidateValid(rect(300, 300, 400, 400), textBox, page, [], 20), "the bubble must hold the text centre");
assert(!box._bubbleCandidateValid(rect(80, 80, 400, 160), textBox, page, [rect(300, 100, 380, 140)], 20), "it must not reach another text");
assert(!box._bubbleCandidateValid(rect(149, 119, 152, 122), textBox, page, [], 20), "a speck is not a bubble");
assert(!box._bubbleCandidateValid(rect(140, 105, 165, 135), textBox, page, [], 20), "a glyph under the text centre is not a bubble");
assert.strictEqual(box._probeMargin(8), 5);
assert.strictEqual(box._probeMargin(400), 40);
assert.strictEqual(box._probeMargin(NaN), 5);

let parts = box._splitBubble(rect(0, 0, 400, 100), [rect(20, 20, 120, 80), rect(260, 20, 380, 80)]);
assert.deepStrictEqual([parts[0].left, parts[0].right, parts[1].left, parts[1].right], [0, 190, 190, 400]);
assert.deepStrictEqual([parts[0].top, parts[0].bottom], [0, 100]);
parts = box._splitBubble(rect(0, 0, 100, 400), [rect(10, 250, 90, 380), rect(10, 20, 90, 120)]);
assert.deepStrictEqual([parts[0].top, parts[1].bottom], [185, 185], "parts follow the order of the boxes");
parts = box._splitBubble(rect(0, 0, 400, 100), [rect(20, 20, 220, 80), rect(180, 30, 380, 70)]);
assert.strictEqual(parts.length, 2);
assert(parts[0].right <= parts[1].left + 0.001, "overlapping texts still get disjoint parts");

assert.strictEqual(box._doubleBubbleEntriesValid([{ id: 1, text: true }]), false);
assert.strictEqual(box._doubleBubbleEntriesValid([{ id: 1, text: true }, { id: 2, text: false }]), false);
assert.strictEqual(box._doubleBubbleEntriesValid(null), false);
assert.strictEqual(box._doubleBubbleEntriesValid([{ id: 1, text: true }, { id: 2, text: true }]), true);
assert.strictEqual(box._autoCenterEnabled({ autoCenter: "single" }), true);
assert.strictEqual(box._autoCenterEnabled({ autoCenter: "multi" }), true);
["off", "MULTI", "", undefined, "toString", "constructor"].forEach((mode) => {
  assert.strictEqual(box._autoCenterEnabled({ autoCenter: mode }), false, String(mode));
});

/* ---------- opening: the optional double-bubble mode may answer {error} ---------- */

const probe = rect(100, 100, 300, 200);
box._getAdaptiveOpenedSelectionBounds = () => ({ error: "noSelection" });
assert.strictEqual(box._openedBubble(probe, textBox), probe, "an {error} answer keeps the probed bubble");
box._getAdaptiveOpenedSelectionBounds = () => { throw new Error("no channel"); };
assert.strictEqual(box._openedBubble(probe, textBox), probe);
box._getAdaptiveOpenedSelectionBounds = () => rect(500, 500, 700, 600);
assert.strictEqual(box._openedBubble(probe, textBox), probe, "a lobe outside the probed bubble is ignored");
box._getAdaptiveOpenedSelectionBounds = () => rect(220, 110, 290, 190);
assert.strictEqual(box._openedBubble(probe, textBox), probe, "the opened shape must hold the text centre");
box._getAdaptiveOpenedSelectionBounds = () => rect(110, 105, 290, 195);
assert.deepStrictEqual(plain(box._openedBubble(probe, textBox)), plain(rect(110, 105, 290, 195)));

/* ---------------------- size +/- arithmetic ---------------------- */

const boxText = () => ({
  typeUnit: "pointsUnit",
  layerText: {
    textKey: "abc",
    transform: { xx: 2, xy: 0, yx: 0, yy: 2, tx: 0, ty: 0 },
    textStyleRange: [{ from: 0, to: 3, textStyle: { size: 10, leading: 12, autoLeading: false } }],
    textShape: [{ textType: "box", bounds: { top: 0, left: 0, right: 100, bottom: 50 } }],
  },
});
let plan = box._textResizePlan(boxText(), 4, 72);
assert.strictEqual(plan.ratio, 24 / 20, "the step applies to the displayed 20pt, not the stored 10pt");
assert(plan.uniform && plan.scaleLeading);
assert.deepStrictEqual(plain(plan.frame.bounds), { top: 0, left: 0, right: 100, bottom: 50 }, "the plan keeps the frame from before");
assert.deepStrictEqual(plain(box._scaleTextShape(plan.frame, 1.5).bounds), { top: 0, left: 0, right: 150, bottom: 75 }, "no padding");
const pointText = boxText();
pointText.layerText.textShape = [{ textType: "point", bounds: {} }];
assert.strictEqual(box._textResizePlan(pointText, 4, 72).frame, null, "point text has no frame");
assert.strictEqual(box._scaleTextShape(pointText.layerText.textShape[0], 2), null);
assert.strictEqual(box._textResizePlan(boxText(), -100, 72).nextShown, 1, "never below 1");
const implied = boxText();
implied.layerText.textStyleRange[0].textStyle.impliedFontSize = 30;
assert.strictEqual(box._textResizePlan(implied, 3, 72).ratio, 33 / 30, "impliedFontSize is the displayed size");
const mixedLeading = boxText();
mixedLeading.layerText.textStyleRange.push({ from: 3, to: 6, textStyle: { size: 10, autoLeading: true } });
assert.strictEqual(box._textResizePlan(mixedLeading, 2, 72).scaleLeading, false, "leading only scales when fixed and shared");
assert.strictEqual(box._textResizePlan(mixedLeading, 2, 72).uniform, true);
const impliedLeading = boxText();
impliedLeading.layerText.textStyleRange[0].textStyle.impliedFontSize = 30;
impliedLeading.layerText.textStyleRange[0].textStyle.impliedLeading = 36;
assert.strictEqual(box._textResizePlan(impliedLeading, 3, 72).nextLeading, 36 * 33 / 30, "the next leading is a displayed one");
assert.strictEqual(box._textResizePlan(boxText(), 4, 72).nextLeading, 24 * 1.2, "without implied leading: stored x transform");
assert.strictEqual(box._displayedStyleValue({ baselineShift: 2, impliedBaselineShift: 0 }, "baselineShift", "impliedBaselineShift", 2), 0, "an implied 0 is a value");
assert.strictEqual(box._appliedSizeRatio({ value: 10, unit: "p" }, { value: 12.5, unit: "p" }, 9), 1.25);
assert.strictEqual(box._appliedSizeRatio({ value: 10, unit: "p" }, { value: 12, unit: "px" }, 9), 9, "units must match");
assert.strictEqual(box._appliedSizeRatio(null, { value: 12, unit: "p" }, 9), 9);

/* ---------------- size +/-: the frame stays stable ---------------- */

// A text layer whose stored size Photoshop rounds to 0.01 pt
const layer = {
  size: 10,
  leading: 12,
  shape: { top: 0, left: 0, right: 100, bottom: 50 },
  shapeWrites: 0,
  rebuilds: 0,
};
const layerParams = () => ({
  typeUnit: "pointsUnit",
  layerText: {
    textKey: "abcdef",
    transform: { xx: 2, xy: 0, yx: 0, yy: 2, tx: 0, ty: 0 },
    textStyleRange: [{ from: 0, to: 6, textStyle: { size: layer.size, leading: layer.leading, autoLeading: false } }],
    paragraphStyleRange: [{ from: 0, to: 6, paragraphStyle: { align: "center" } }],
    textShape: [{ textType: "box", orientation: "horizontal", bounds: plain(layer.shape) }],
  },
});
const round = (value) => Math.round(value * 100) / 100;
const moves = [];
Object.assign(box, {
  _layerIsTextLayer: () => true,
  _forEachSelectedLayer(action) { action(); return 1; },
  // The text grows from its top left corner
  _currentLayerBox: () => rect(100, 100, 100 + layer.size * 10, 100 + layer.size * 5),
  _moveLayer(x, y) { moves.push([x, y]); },
  _readTextStyleSize: () => ({ value: layer.size, unit: "pointsUnit" }),
  _resizeTextStyleFast(fastPlan) {
    layer.size = round(layer.size * fastPlan.ratio);
    if (fastPlan.scaleLeading) layer.leading = layer.leading * fastPlan.ratio;
  },
  _applyMiddleEast() {},
  jamText: {
    getLayerText: () => layerParams(),
    setLayerText(params) {
      const ranges = params.layerText.textStyleRange;
      if (ranges) {
        layer.rebuilds++;
        // Photoshop takes a written size as a displayed one
        layer.size = round(ranges[0].textStyle.size / 2);
      }
      const shape = params.layerText.textShape && params.layerText.textShape[0];
      if (shape) {
        layer.shape = plain(shape.bounds);
        layer.shapeWrites++;
      }
    },
  },
});
const frameRatio = () => layer.shape.right / layer.size;
const startRatio = frameRatio();
const startShape = plain(layer.shape);

assert.strictEqual(box.changeActiveLayerTextSize(4), "");
assert.strictEqual(layer.size, 12, "displayed 20 + 4 = 24, stored 10 x 1.2");
close(layer.shape.right, 120, "the frame grows with the text, without padding");
close(layer.shape.bottom, 60, "the frame height grows with the text");
assert.strictEqual(layer.shapeWrites, 1);
assert.strictEqual(box.changeActiveLayerTextSize(-4), "");
assert.strictEqual(layer.size, 10);
assert.deepStrictEqual(layer.shape, startShape, "+ then - puts the frame back where it was");

// Odd steps: Photoshop rounds the size, the frame follows the rounded size
[3, 3, -1, 7, -2, -3, 5, -12].forEach((step) => {
  box.changeActiveLayerTextSize(step);
  close(frameRatio(), startRatio, "frame / size after a step of " + step);
});
// Back to the starting size: the starting frame
box.changeActiveLayerTextSize((10 - layer.size) * 2);
assert.strictEqual(layer.size, 10);
close(layer.shape.right, startShape.right, "frame width after many presses");
close(layer.shape.bottom, startShape.bottom, "frame height after many presses");
assert(moves.length > 0, "the layer is put back on its old centre");

// Mixed sizes: the rebuild keeps every run and writes the frame once
const mixed = () => {
  const params = layerParams();
  params.layerText.textStyleRange = [
    { from: 0, to: 3, textStyle: { size: 10, leading: 12, autoLeading: false, fontName: "A" } },
    { from: 3, to: 6, textStyle: { size: 15, autoLeading: true, impliedFontSize: 30, fontName: "B" } },
  ];
  return params;
};
let written = null;
box.jamText.getLayerText = mixed;
box.jamText.setLayerText = (params) => { written = params; };
box._readTextStyleSize = () => null;
box._resizeTextStyleFast = () => { throw new Error("must not run on mixed sizes"); };
assert.strictEqual(box.changeActiveLayerTextSize(4), "");
const ranges = written.layerText.textStyleRange;
assert.deepStrictEqual([ranges[0].textStyle.size, ranges[0].textStyle.leading, ranges[1].textStyle.size], [24, 24 * 1.2, 36], "what is written is displayed sizes");
assert.deepStrictEqual([ranges[0].textStyle.fontName, ranges[1].textStyle.fontName], ["A", "B"], "every run keeps its style");
assert.strictEqual(ranges[1].textStyle.leading, undefined);
assert.strictEqual(ranges[1].textStyle.impliedFontSize, undefined);
assert.strictEqual(ranges[1].to, 6);
close(written.layerText.textShape[0].bounds.right, layer.shape.right * 1.2, "the rebuilt frame is scaled, not padded");
// A layer that cannot be read nor rebuilt reports the error
box.jamText.getLayerText = () => { throw new Error("no text"); };
box._resizeTextStyleFast = () => { throw new Error("refused"); };
assert.strictEqual(box.changeActiveLayerTextSize(2), "layer");

/* ------------- size +/- on a layer scaled with Ctrl+T ------------- */

// The numbers of a real layer: Photoshop reads the stored size but takes any
// written size as a displayed one, whichever way it is written
const scaled = { stored: 16, scale: 1.3520103342483452, baselineShift: 2, frameRight: 129 };
const scaledParams = () => ({
  typeUnit: "pixelsUnit",
  layerText: {
    textKey: "abcdef",
    transform: { xx: scaled.scale, xy: 0, yx: 0, yy: scaled.scale, tx: 0, ty: 0 },
    textStyleRange: [{ from: 0, to: 6, textStyle: {
      size: scaled.stored,
      impliedFontSize: scaled.stored * scaled.scale,
      autoLeading: true,
      baselineShift: scaled.baselineShift,
      impliedBaselineShift: scaled.baselineShift * scaled.scale,
    } }],
    textShape: [{ textType: "box", orientation: "horizontal", bounds: { top: 0, left: 0, right: scaled.frameRight, bottom: 76 } }],
  },
});
const applyWrite = (params) => {
  const style = params.layerText.textStyleRange[0].textStyle;
  scaled.stored = style.size / scaled.scale;
  scaled.baselineShift = style.baselineShift / scaled.scale;
  scaled.frameRight = params.layerText.textShape[0].bounds.right;
};
box.jamText.getLayerText = scaledParams;
box.jamText.setLayerText = applyWrite;
box._readTextStyleSize = () => null;
box._resizeTextStyleFast = () => { throw new Error("no textStyle"); };
const displayed = () => scaled.stored * scaled.scale;
const startDisplayed = displayed();
assert.strictEqual(box.changeActiveLayerTextSize(1), "");
close(displayed(), startDisplayed + 1, "+ grows the displayed size by one step");
close(scaled.baselineShift, 2, "the baseline shift stays as it is displayed");
close(scaled.frameRight / scaled.stored, 129 / 16, "the frame keeps its proportion to the text");
box.changeActiveLayerTextSize(1);
close(displayed(), startDisplayed + 2, "a second + grows it again");
box.changeActiveLayerTextSize(-2);
close(displayed(), startDisplayed, "- comes back");
close(scaled.stored, 16, "the stored size comes back too");
close(scaled.frameRight, 129, "the frame comes back too");

/* ------------------------ TextShapeR size ------------------------ */

const shaped = { typeUnit: "pointsUnit", layerText: { textStyleRange: [{ textStyle: { fontName: "A", size: 40, leading: 44, autoLeading: false } }] } };
box._keepLiveTextSize(shaped, { typeUnit: "pointsUnit", layerText: { textStyleRange: [{ textStyle: { size: 22, autoLeading: true, leading: 30 } }] } }, 72);
assert.deepStrictEqual(plain(shaped.layerText.textStyleRange[0].textStyle), { fontName: "A", size: 22, autoLeading: true });
const pixels = { typeUnit: "pointsUnit", layerText: { textStyleRange: [{ textStyle: { size: 40, autoLeading: true } }] } };
box._keepLiveTextSize(pixels, { typeUnit: "pixelsUnit", layerText: { textStyleRange: [{ textStyle: { size: 300, leading: 600, autoLeading: false } }] } }, 300);
assert.strictEqual(pixels.typeUnit, "pointsUnit");
assert.strictEqual(pixels.layerText.textStyleRange[0].textStyle.size, 72);
assert.strictEqual(pixels.layerText.textStyleRange[0].textStyle.leading, 144);
const noUnit = { layerText: { textStyleRange: [{ textStyle: { size: 40 } }] } };
box._keepLiveTextSize(noUnit, { typeUnit: "pixelsUnit", layerText: { textStyleRange: [{ textStyle: { size: 30 } }] } }, 300);
assert.deepStrictEqual([noUnit.typeUnit, noUnit.layerText.textStyleRange[0].textStyle.size], ["pixelsUnit", 30]);
assert(/payload\.preserveActiveTextSize = true;\s*_hostState\.setActiveLayerText\.data = payload;/.test(source),
  "the TextShapeR fallback must keep the layer size");

/* ------------------------- auto-centre ------------------------- */

const calls = [];
const placed = [];
let selected = null;
let liveSelection = rect(0, 0, 50, 50);
const layerBoxes = { 1: rect(100, 100, 160, 130), 2: rect(300, 100, 360, 130), 9: rect(500, 100, 560, 130) };
Object.assign(box, {
  _selectLayerById(id) { selected = id; calls.push(["select", id]); },
  _getActiveLayerId: () => 2,
  _currentLayerBox: () => layerBoxes[selected],
  _currentDisplayedTextPixels: () => 20,
  _getCurrentSelectionBounds: () => liveSelection || undefined,
  _storeSelectionChannel(name) { calls.push(["store", name]); },
  _loadSelectionChannel(name) { calls.push(["load", name]); },
  _channelExists: () => true,
  _deleteChannelByName(name) { calls.push(["dropChannel", name]); },
  _deselect() { calls.push(["deselect"]); },
  _openedBubble: (r) => r,
  _magicWandAt() {},
  _tightLobe: () => null,
  _wandCoversBox: () => true,
  _textNeighbours: () => [],
  _placeLayerInRect(r) {
    if (selected === 2 && box.__failOn2) throw new Error("boom");
    placed.push([selected, r.xMid, r.yMid]);
    return true;
  },
  _probeBubble: (b) => ({ best: rect(b.left - 20, b.top - 20, b.right + 20, b.bottom + 20), loose: null }),
});
const reset = () => { calls.length = 0; placed.length = 0; };

box._autoCenterCreated([1, 2], { autoCenter: "off" });
assert.strictEqual(calls.length + placed.length, 0, "off does nothing at all");

box.__failOn2 = true;
box._autoCenterCreated([1, 2, null], { autoCenter: "single", resizeTextBox: false });
assert.deepStrictEqual(placed.map((p) => p[0]), [1], "a failed text does not stop the others");
assert.deepStrictEqual(calls[0], ["store", "__TyperSavedSelection__"], "the user's selection is parked first");
const tail = calls.slice(-3);
assert.deepStrictEqual(tail, [["load", "__TyperSavedSelection__"], ["dropChannel", "__TyperSavedSelection__"], ["select", 2]],
  "then it comes back, the channel goes and the pasted layer is active again");
box.__failOn2 = false;

reset();
liveSelection = null;
box._autoCenterCreated([1], { autoCenter: "single" });
assert(!calls.some((call) => call[0] === "store" || call[0] === "load"), "no selection: nothing to park");
assert.deepStrictEqual(calls.slice(-2), [["deselect"], ["select", 2]], "no selection before, none after");

reset();
liveSelection = rect(0, 0, 50, 50);
box._autoCenterLayers = () => { throw new Error("Photoshop refused"); };
box._autoCenterCreated([1], { autoCenter: "multi" });
assert.deepStrictEqual(calls.slice(-3), [["load", "__TyperSavedSelection__"], ["dropChannel", "__TyperSavedSelection__"], ["select", 2]],
  "a failure is silent and still restores the selection and removes the channel");
delete box._autoCenterLayers;
vm.runInContext(source.slice(source.indexOf("function _autoCenterLayers("), source.indexOf("// Centring right after a paste")), box);

// Multi: a bubble shared with a page text is cut between them
reset();
const shared = Object.assign(rect(80, 80, 580, 150), { probeX: 130, probeY: 115 });
box._probeBubble = () => ({ best: null, loose: shared });
const neighbour = (overrides) => () => [Object.assign({ id: 9, box: layerBoxes[9], neighbour: true, locked: false, rect: null }, overrides)];
box._textNeighbours = neighbour({});
box._autoCenterCreated([1], { autoCenter: "multi" });
assert.deepStrictEqual(placed.map((p) => p[0]), [1, 9], "the unlocked neighbour is centred in its part");
assert(placed[0][1] < placed[1][1]);

reset();
box._textNeighbours = neighbour({ locked: true });
box._autoCenterCreated([1], { autoCenter: "multi" });
assert.deepStrictEqual(placed.map((p) => p[0]), [1], "a locked neighbour is never moved");
assert(placed[0][1] < shared.xMid, "but it still takes its part of the bubble");

reset();
box._textNeighbours = neighbour({});
box._wandCoversBox = () => false;
box._autoCenterCreated([1], { autoCenter: "multi" });
assert.deepStrictEqual(placed.map((p) => p[0]), [1], "a text inside the bounding box but outside the marquee is left alone");
close(placed[0][1], shared.xMid, "and the bubble is not split");
box._wandCoversBox = () => true;

reset();
box._textNeighbours = () => [{ id: 9, box: rect(700, 400, 760, 430), neighbour: true, locked: false, rect: null }];
box._autoCenterCreated([1], { autoCenter: "multi" });
assert.deepStrictEqual(placed.map((p) => p[0]), [1], "a text outside the bubble is never moved");

// Single: a bubble shared with another text is not this text's own
reset();
box._textNeighbours = neighbour({});
box._autoCenterCreated([1], { autoCenter: "single" });
assert.deepStrictEqual(placed, [], "single keeps the paste position in one lobe of a double bubble");

reset();
const excluded = [];
box._textNeighbours = () => [];
box._probeBubble = (b, size, exclude) => {
  excluded.push(exclude.length);
  return { best: null, loose: shared };
};
box._autoCenterCreated([1, 2], { autoCenter: "single" });
assert.deepStrictEqual(excluded, [1, 1], "texts pasted together exclude each other in single too");
assert.deepStrictEqual(placed, [], "so they are not stacked on the merged centre");
box._probeBubble = () => ({ best: null, loose: shared });

// Multi: a moved neighbour keeps the frame the user set
reset();
const resizes = [];
const placeLayer = box._placeLayerInRect;
box._placeLayerInRect = (r, resize) => {
  resizes.push([selected, resize]);
  return placeLayer(r, resize);
};
box._textNeighbours = neighbour({});
box._autoCenterCreated([1], { autoCenter: "multi", resizeTextBox: true });
assert.deepStrictEqual(resizes, [[1, true], [9, false]], "only the pasted text's frame is refitted");
box._placeLayerInRect = placeLayer;

/* ------------- neighbours: hidden and locked layers ------------- */

const descriptor = (values) => ({
  hasKey: (key) => Object.prototype.hasOwnProperty.call(values, key),
  getBoolean: (key) => values[key],
  getInteger: (key) => values[key],
  getEnumerationValue: (key) => values[key],
  getObjectValue: (key) => values[key],
});
const charID = box.charID;
const layerDesc = ({ id, section = "layerSectionContent", visible = true, text = true, locked = false }) => {
  const values = { layerSection: section };
  values[charID.Visible] = visible;
  values[charID.LayerID] = id;
  if (text) values[charID.Text] = true;
  values.layerLocking = descriptor({ protectAll: locked });
  values.boundsNoEffects = { left: id * 10, top: 0, right: id * 10 + 5, bottom: 5 };
  return descriptor(values);
};
// Top of the stack first: a hidden group, a locked group, loose layers
const stack = [
  layerDesc({ id: 50, section: "layerSectionStart", visible: false }),
  layerDesc({ id: 51 }),
  layerDesc({ id: 52, section: "layerSectionEnd" }),
  layerDesc({ id: 60, section: "layerSectionStart", locked: true }),
  layerDesc({ id: 61 }),
  layerDesc({ id: 62, section: "layerSectionEnd" }),
  layerDesc({ id: 70, visible: false }),
  layerDesc({ id: 71, text: false }),
  layerDesc({ id: 72 }),
  layerDesc({ id: 1 }),
];
Object.assign(box, {
  _getCurrent: () => descriptor({ numberOfLayers: stack.length }),
  _getLayerByIndex: (index) => stack[stack.length - index],
  _getBoundsFromDescriptor: (b) => b,
});
vm.runInContext(source.slice(source.indexOf("function _textNeighbours("), source.indexOf("// Centres the active text layer on `rect`")), box);
const found = box._textNeighbours([1]);
assert.deepStrictEqual(plain(found.map((item) => [item.id, item.locked])), [[61, true], [72, false]],
  "hidden layers and groups are skipped, a locked group locks its layers, pasted layers are not neighbours");

/* -------------------- paste entry points -------------------- */

let autoArgs = null;
Object.assign(box, {
  _checkSelection: () => ({ width: 100, height: 100 }),
  _calculateSelectionDimensions: (s) => s,
  _createAndSetLayerText() {},
  _getCurrentTextLayerBounds: () => ({}),
  _resizeTextBoxToContent() {},
  _positionLayerWithinSelection() {},
  _safeActiveLayerId: () => 7,
  _autoCenterCreated(ids, data) { autoArgs = [ids, data]; },
});
assert.strictEqual(box.createTextLayerInSelection({ text: "a", autoCenter: "multi", resizeTextBox: true, padding: 3 }, false), "");
assert.deepStrictEqual(plain(autoArgs), [[7], { autoCenter: "multi", resizeTextBox: true, padding: 3 }]);
autoArgs = null;
box.createTextLayerInSelection({ text: "a", autoCenter: "off" }, false);
assert.strictEqual(autoArgs, null, "off never reaches the auto-centre");
const batchSelection = { width: 100, height: 80, xMid: 50, yMid: 40, documentKey: "doc" };
box.getTypeRDocumentKey = () => "doc";
box._ensureStyle = (style) => style;
assert.strictEqual(box.createTextLayersInStoredSelections({
  texts: ["a", "b"], styles: [{}], selections: [batchSelection, batchSelection], autoCenter: "single", resizeTextBox: false, padding: 0,
}, false), "");
assert.deepStrictEqual(plain(autoArgs), [[7, 7], { autoCenter: "single", resizeTextBox: false, padding: 0 }], "a batch centres every pasted text once");

/* ------------------------ double bubble ------------------------ */

vm.runInContext(source.slice(source.indexOf("function _autoCenterCreated("), source.indexOf("// Selected layers as {id, text}")), box);
history.length = 0;
box._targetLayerEntries = () => [{ id: 1, text: true }];
assert.strictEqual(box.alignTextLayersToDoubleBubble({ resizeTextBox: false, padding: 0 }), "doubleBubbleLayers");
box._targetLayerEntries = () => [{ id: 1, text: true }, { id: 2, text: false }];
assert.strictEqual(box.alignTextLayersToDoubleBubble({}), "doubleBubbleLayers");
box._targetLayerEntries = () => { throw new Error("no target"); };
assert.strictEqual(box.alignTextLayersToDoubleBubble({}), "doubleBubbleLayers");
assert.strictEqual(history.length, 0, "a refused selection never opens a history state");

reset();
liveSelection = null;
box._targetLayerEntries = () => [{ id: 1, text: true }, { id: 2, text: true }];
box._probeBubble = (b) => ({ best: rect(b.left - 20, b.top - 20, b.right + 20, b.bottom + 20), loose: null });
box._selectLayersById = (ids) => calls.push(["selectAll", Array.from(ids)]);
assert.strictEqual(box.alignTextLayersToDoubleBubble({ resizeTextBox: true, padding: 2 }), "");
assert.deepStrictEqual(placed.map((p) => p[0]), [1, 2]);
assert.deepStrictEqual(calls[calls.length - 1], ["deselect"], "no selection before, none after");
assert.deepStrictEqual(history, ["TyperTools Align Double"]);

// A user selection holding both texts is the bubble, used up like Align
reset();
liveSelection = rect(60, 60, 420, 170);
assert.strictEqual(box.alignTextLayersToDoubleBubble({}), "");
assert.deepStrictEqual(placed.map((p) => p[0]), [1, 2]);
assert(placed[0][1] < placed[1][1]);
assert(!calls.some((call) => call[0] === "load"), "the used selection is not restored");
assert(calls.some((call) => call[0] === "dropChannel"), "its parked copy is removed");

// Not found: an error code, the document rolled back and the selection back
reset();
liveSelection = rect(0, 0, 30, 30);
doc.activeHistoryState = "before";
box._probeBubble = () => ({ best: null, loose: null });
assert.strictEqual(box.alignTextLayersToDoubleBubble({}), "doubleBubbleNotFound");
assert.strictEqual(doc.activeHistoryState, "before", "a failed split is rolled back");
assert(calls.some((call) => call[0] === "load"), "the ignored user selection comes back");
assert.strictEqual(placed.length, 0);

// An empty text layer
box._probeBubble = (b) => ({ best: rect(b.left - 20, b.top - 20, b.right + 20, b.bottom + 20), loose: null });
const emptyBoxes = Object.assign({}, layerBoxes);
box._currentLayerBox = () => (selected === 2 ? null : emptyBoxes[selected]);
assert.strictEqual(box.alignTextLayersToDoubleBubble({}), "doubleBubbleEmpty");

console.log("CEP host auto-centre, double bubble, size +/- frame stability and TextShapeR size tests passed");
