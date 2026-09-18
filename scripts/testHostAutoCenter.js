// CEP host (app_src/host.js) ports of the UXP auto-centre on paste, the
// double-bubble alignment, the box-growing size change and the TextShapeR
// live-size rule. Photoshop actions are mocked: this checks the decisions and
// the arithmetic, not what Photoshop itself returns.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../app_src/host.js'), 'utf8');
const doc = { id: 1, width: 1000, height: 1000, resolution: 72, suspendHistory(name, script) { vm.runInContext(script, box); } };
const box = vm.createContext({ app: { activeDocument: doc, documents: [doc] }, documents: [doc], jamJSON: JSON });
vm.runInContext(source, box);

const rect = (l, t, r, b) => box._rectFrom(l, t, r, b);
const plain = value => JSON.parse(JSON.stringify(value));

// ES3 guard on the ported functions (host.js runs in ExtendScript)
const ported = ['_rectFrom', '_unionRect', '_usableBubble', '_bubbleCandidateValid', '_probeMargin', '_probeBubble',
  '_splitBubble', '_tightLobe', '_textNeighbours', '_placeLayerInRect', '_autoCenterCreated', '_targetLayerEntries',
  '_alignTextLayersToDoubleBubble', 'alignTextLayersToDoubleBubble', '_textResizePlan', '_keepLiveTextSize',
  '_changeActiveLayerTextSize', '_resizeTextStyleFast', '_resizeTextRebuild', '_recentreOnBox', '_setTextShapeRText'];
for (const name of ported) {
  const fn = box[name];
  assert.strictEqual(typeof fn, 'function', name + ' must exist');
  const text = fn.toString();
  assert(!/=>|\blet\s|\bconst\s|`|\.\.\./.test(text), name + ' uses ES6 syntax');
  assert(!/\.(map|filter|forEach|some|every|reduce|find|includes)\(/.test(text), name + ' uses ES5+ array methods');
  assert(!/Number\.isFinite|Math\.hypot|Object\.(keys|assign)/.test(text), name + ' uses ES5+ builtins');
}

// Bubble plausibility
const textBox = rect(100, 100, 200, 140);
assert(box._bubbleCandidateValid(rect(80, 80, 220, 160), textBox, { width: 1000, height: 1000 }, [], 20));
assert(!box._bubbleCandidateValid(rect(0, 0, 900, 900), textBox, { width: 1000, height: 1000 }, [], 20), 'page-sized wand is rejected');
assert(!box._bubbleCandidateValid(rect(300, 300, 400, 400), textBox, { width: 1000, height: 1000 }, [], 20), 'must hold the text centre');
assert(!box._bubbleCandidateValid(rect(80, 80, 400, 160), textBox, { width: 1000, height: 1000 }, [rect(300, 100, 380, 140)], 20), 'must not reach another text');
assert.strictEqual(box._probeMargin(8), 5);
assert.strictEqual(box._probeMargin(400), 40);

// Splitting a shared bubble
let parts = box._splitBubble(rect(0, 0, 400, 100), [rect(20, 20, 120, 80), rect(260, 20, 380, 80)]);
assert.deepStrictEqual([parts[0].left, parts[0].right, parts[1].left, parts[1].right], [0, 190, 190, 400]);
assert.deepStrictEqual([parts[0].top, parts[0].bottom], [0, 100]);
parts = box._splitBubble(rect(0, 0, 100, 400), [rect(10, 250, 90, 380), rect(10, 20, 90, 120)]);
assert.deepStrictEqual([parts[0].top, parts[1].bottom], [185, 185], 'order follows the boxes, not the input');
parts = box._splitBubble(rect(0, 0, 400, 100), [rect(20, 20, 220, 80), rect(180, 30, 380, 70)]);
assert.strictEqual(parts.length, 2);
assert(parts[0].right <= parts[1].left + 0.001, 'overlapping texts still get disjoint parts');

// Resize plan: displayed size = stored x transform, box frame grows with padding
const boxText = {
  typeUnit: 'pointsUnit',
  layerText: {
    transform: { xx: 2, xy: 0, yx: 0, yy: 2, tx: 0, ty: 0 },
    textStyleRange: [{ from: 0, to: 3, textStyle: { size: 10, leading: 12, autoLeading: false } }],
    textShape: [{ textType: 'box', bounds: { top: 0, left: 0, right: 100, bottom: 50 } }],
  },
};
let plan = box._textResizePlan(boxText, 4, 72);
assert.strictEqual(plan.ratio, 24 / 20, 'delta applies to the displayed 20pt, not the stored 10pt');
assert(plan.uniform && plan.scaleLeading);
assert.strictEqual(plan.shape.bounds.right, 120 + Math.max(2, 12 * 0.3));
assert.strictEqual(plan.shape.bounds.bottom, 60 + 12 * 1.2);
assert.strictEqual(boxText.layerText.textShape[0].bounds.right, 100, 'input untouched');
const pointText = plain(boxText);
pointText.layerText.textShape = [{ textType: 'point', bounds: {} }];
assert.strictEqual(box._textResizePlan(pointText, 4, 72).shape, null, 'point text has no frame to grow');
assert.strictEqual(box._textResizePlan(plain(boxText), -100, 72).nextShown, 1, 'never below 1');

// Size change: fast path then frame, recentred on the old centre
const actions = [];
let shapeWritten = null;
let currentBox = rect(100, 100, 200, 150);
Object.assign(box, {
  _layerIsTextLayer: () => true,
  _forEachSelectedLayer(action) { action(); return 1; },
  _currentLayerBox: () => currentBox,
  _moveLayer(x, y) { actions.push(['move', x, y]); },
  jamText: {
    getLayerText: () => plain(boxText),
    setLayerText(params) { shapeWritten = params; currentBox = rect(100, 100, 240, 170); },
  },
  _resizeTextStyleFast(p) { actions.push(['fast', p.ratio]); },
});
assert.strictEqual(box.changeActiveLayerTextSize(4), '');
assert.deepStrictEqual(actions[0], ['fast', 1.2]);
assert.strictEqual(shapeWritten.layerText.textShape[0].bounds.right, 120 + 3.6);
assert.deepStrictEqual(actions[1], ['move', -20, -10]);

// Fallback rebuild keeps every run, scales the box with the same padding
actions.length = 0;
box._resizeTextStyleFast = () => { throw new Error('fast path refused'); };
const mixed = plain(boxText);
mixed.layerText.textKey = 'abcdef';
mixed.layerText.textStyleRange.push({ from: 3, to: 6, textStyle: { size: 15, autoLeading: true, impliedFontSize: 30 } });
box.jamText.getLayerText = () => plain(mixed);
box.jamText.setLayerText = params => { shapeWritten = params; };
box._applyMiddleEast = () => {};
assert.strictEqual(box.changeActiveLayerTextSize(4), '');
const ranges = shapeWritten.layerText.textStyleRange;
assert.deepStrictEqual([ranges[0].textStyle.size, ranges[0].textStyle.leading, ranges[1].textStyle.size], [12, 12 * 1.2, 18]);
assert.strictEqual(ranges[1].textStyle.leading, undefined);
assert.strictEqual(ranges[1].textStyle.impliedFontSize, undefined);
assert.strictEqual(shapeWritten.layerText.textShape[0].bounds.bottom, 60 + 12 * 1.2);

// TextShapeR keeps the live size, leading and auto-leading
const shaped = { typeUnit: 'pointsUnit', layerText: { textStyleRange: [{ textStyle: { fontName: 'A', size: 40, leading: 44, autoLeading: false } }] } };
box._keepLiveTextSize(shaped, { typeUnit: 'pointsUnit', layerText: { textStyleRange: [{ textStyle: { size: 22, autoLeading: true, leading: 30 } }] } }, 72);
assert.deepStrictEqual(plain(shaped.layerText.textStyleRange[0].textStyle), { fontName: 'A', size: 22, autoLeading: true });
const pixels = { typeUnit: 'pointsUnit', layerText: { textStyleRange: [{ textStyle: { size: 40, autoLeading: true } }] } };
box._keepLiveTextSize(pixels, { typeUnit: 'pixelsUnit', layerText: { textStyleRange: [{ textStyle: { size: 300, leading: 600, autoLeading: false } }] } }, 300);
assert.strictEqual(pixels.typeUnit, 'pointsUnit');
assert.strictEqual(pixels.layerText.textStyleRange[0].textStyle.size, 72);
assert.strictEqual(pixels.layerText.textStyleRange[0].textStyle.leading, 144);

// Auto-centre after paste
const placed = [];
let selected = null;
const layerBoxes = { 1: rect(100, 100, 160, 130), 2: rect(300, 100, 360, 130), 9: rect(500, 100, 560, 130) };
Object.assign(box, {
  _selectLayerById(id) { selected = id; },
  _currentLayerBox: () => layerBoxes[selected],
  _currentDisplayedTextPixels: () => 20,
  _deselect() {},
  _selectLayersById(ids) { actions.push(['reselect', Array.from(ids)]); },
  _openedBubble: r => r,
  _magicWandAt() {},
  _tightLobe: () => null,
  _textNeighbours: () => [],
  _placeLayerInRect(r) { if (selected === 2 && box.__failOn2) throw new Error('boom'); placed.push([selected, r.xMid, r.yMid]); },
  _probeBubble: (b) => ({ best: rect(b.left - 20, b.top - 20, b.right + 20, b.bottom + 20), loose: null }),
});
box._autoCenterCreated([1, 2], { autoCenter: 'off' });
assert.strictEqual(placed.length, 0, 'off does nothing');
box.__failOn2 = true;
actions.length = 0;
box._autoCenterCreated([1, 2, null], { autoCenter: 'single', resizeTextBox: false });
assert.deepStrictEqual(placed.map(p => p[0]), [1], 'a failed text does not stop the others');
assert.deepStrictEqual(actions[actions.length - 1], ['reselect', [1, 2]]);
box.__failOn2 = false;

// Multi: a bubble shared with a page text is cut; locked neighbours stay put
placed.length = 0;
const shared = Object.assign(rect(80, 80, 580, 150), { probeX: 130, probeY: 115 });
box._probeBubble = () => ({ best: null, loose: shared });
box._textNeighbours = () => [{ id: 9, box: layerBoxes[9], neighbour: true, locked: false, rect: null }];
box._autoCenterCreated([1], { autoCenter: 'multi' });
assert.deepStrictEqual(placed.map(p => p[0]), [1, 9], 'the unlocked neighbour is recentred');
assert(placed[0][1] < placed[1][1]);
placed.length = 0;
box._textNeighbours = () => [{ id: 9, box: layerBoxes[9], neighbour: true, locked: true, rect: null }];
box._autoCenterCreated([1], { autoCenter: 'multi' });
assert.deepStrictEqual(placed.map(p => p[0]), [1], 'a locked neighbour is never moved');

// Paste entry point hands the payload to the auto-centre
let autoArgs = null;
const realAutoCenter = box._autoCenterCreated;
Object.assign(box, {
  _checkSelection: () => ({ width: 100, height: 100 }),
  _calculateSelectionDimensions: s => s,
  _createAndSetLayerText() {}, _getCurrentTextLayerBounds: () => ({}), _resizeTextBoxToContent() {},
  _positionLayerWithinSelection() {}, _safeActiveLayerId: () => 7,
  _autoCenterCreated(ids, data) { autoArgs = [ids, data]; },
});
assert.strictEqual(box.createTextLayerInSelection({ text: 'a', autoCenter: 'multi', resizeTextBox: true, padding: 3 }, false), '');
assert.deepStrictEqual(plain(autoArgs), [[7], { autoCenter: 'multi', resizeTextBox: true, padding: 3 }]);
autoArgs = null;
box.createTextLayerInSelection({ text: 'a', autoCenter: 'off' }, false);
assert.strictEqual(autoArgs, null);
box._autoCenterCreated = realAutoCenter;

// Double bubble needs at least two text layers
box._targetLayerEntries = () => [{ id: 1, text: true }];
assert(box.alignTextLayersToDoubleBubble({ resizeTextBox: false, padding: 0 }).indexOf('scriptError: ') === 0);
box._targetLayerEntries = () => [{ id: 1, text: true }, { id: 2, text: false }];
assert(box.alignTextLayersToDoubleBubble({}).indexOf('scriptError: ') === 0);
placed.length = 0;
box._targetLayerEntries = () => [{ id: 1, text: true }, { id: 2, text: true }];
box._liveSelectionBounds = () => null;
box._probeBubble = (b) => ({ best: rect(b.left - 20, b.top - 20, b.right + 20, b.bottom + 20), loose: null });
assert.strictEqual(box.alignTextLayersToDoubleBubble({ resizeTextBox: true, padding: 2 }), '');
assert.deepStrictEqual(placed.map(p => p[0]), [1, 2]);

console.log('CEP host auto-centre, double bubble, resize and TextShapeR size tests passed');
