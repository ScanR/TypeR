const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const load = require('./helpers/loadAppModule')();
const { atlasMetrics } = load('app_src/oneClick/measureSpec.js');
const source = fs.readFileSync(path.join(__dirname, '../app_src/host.js'), 'utf8');
const extract = name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0];
const page = { width: 1200, height: 1700, resolution: 300 };
const coordinate = (value, unit) => ({ _value: unit === 'distanceUnit' ? value * 72 / page.resolution : value, _unit: unit });
const outline = (unit = 'pixelsUnit') => ({ pathContents: { pathComponents: [{ subpathListKey: [0, 1, 2].map(row => ({
  points: [[580, 810], [620, 810], [620, 850], [580, 850]].map(([x, y]) => ({
    anchor: { horizontal: coordinate(x, unit), vertical: coordinate(y + row * 256, unit) },
    forward: { horizontal: coordinate(x + 1, unit), vertical: coordinate(y + row * 256 + 1, unit) },
    backward: { horizontal: coordinate(x - 1, unit), vertical: coordinate(y + row * 256 - 1, unit) },
  })),
})) }] } });

const makeHost = (failure = null) => {
  const userLayer = { name: 'User layer' };
  const layers = [userLayer];
  const calls = [];
  let layerRemovals = 0;
  let group;
  let historyCalls = 0;
  const doc = {
    activeLayer: userLayer,
    layerSets: { add() {
      group = {
        opacity: 0,
        children: [],
        remove() { layers.splice(layers.indexOf(group), 1); doc.activeLayer = userLayer; },
      };
      layers.push(group);
      doc.activeLayer = group;
      return group;
    } },
  };
  function ActionReference() {}
  ActionReference.prototype.putEnumerated = () => {};
  const context = vm.createContext({
    app: { documents: [doc], activeDocument: doc },
    jamJSON: JSON,
    charID: { Make: 'make', Set: 'set', Path: 'path' },
    DialogModes: { NO: 'no' },
    stringIDToTypeID: value => value,
    ActionReference,
    _getDocumentPixelSize: () => page,
    _getDocumentResolution: () => page.resolution,
    _clone: value => JSON.parse(JSON.stringify(value)),
    _smartCreateMeasureGroup: () => doc.layerSets.add(),
    _smartReadPath() { if (failure === 'path') throw Error('unavailable'); return outline(); },
    _currentLayerBox() { if (failure === 'bounds') throw Error('bounds'); return { left: 580, top: 810, right: 620, bottom: 850 }; },
    jamText: { toLayerTextObject: params => {
      if (params.typeUnit === 'pixelsUnit') assert.strictEqual(params.layerText.textStyleRange[0].textStyle.leading, 256);
      return params;
    } },
    jamEngine: { jsonToActionDescriptor: data => data },
    executeAction(action, data) {
      assert.strictEqual(group.opacity, 0, 'Hide the group before creating or changing any text');
      const type = data.target[1][0][0];
      calls.push(type === 'contentLayer' ? 'convert' : action);
      if (type === 'contentLayer') {
        if (failure === 'convert') throw Error('unsupported font');
        return;
      }
      if (action === 'make') {
        if (failure === 'make') throw Error('make failed');
        const layer = { parent: group, remove() { layerRemovals++; group.children.splice(group.children.indexOf(layer), 1); doc.activeLayer = group; } };
        group.children.push(layer);
        doc.activeLayer = layer;
      } else {
        assert.strictEqual(doc.activeLayer.parent, group, 'Update only the owned staging layer');
        if (failure === 'set') throw Error('set failed');
      }
    },
    _withTemporaryHistory(name, fn) {
      historyCalls++;
      try { return fn(); } catch (error) { return null; } finally {
        assert.deepStrictEqual(layers, [userLayer], 'Remove temporary layers before any history refresh, including on failure');
        assert.strictEqual(doc.activeLayer, userLayer);
      }
    },
  });
  ['_smartAtlasMetrics', 'smartPasteMeasure'].forEach(name => vm.runInContext(extract(name), context));
  return { context, calls, run: requests => JSON.parse(context.smartPasteMeasure({ requests })), historyCalls: () => historyCalls, layerRemovals: () => layerRemovals };
};

const line = { kind: 'line', params: {} };
const atlas = { kind: 'atlas', count: 3, params: {} };
const normal = makeHost();
assert.deepStrictEqual(normal.run([]), []);
assert.strictEqual(normal.historyCalls(), 0, 'No Photoshop work for an empty batch');
assert.strictEqual(normal.run([line, line, line]).length, 3);
assert.deepStrictEqual(normal.calls, ['make', 'set', 'set'], 'Reuse the staging layer without reading its full text descriptor');

const mixed = makeHost();
const result = mixed.run([line, atlas, line, atlas]);
assert.strictEqual(result.length, 4);
assert.ok(result[0].bounds && result[1].metrics && result[2].bounds && result[3].metrics);
assert.deepStrictEqual(mixed.calls, ['make', 'set', 'convert', 'make', 'set', 'convert']);
assert.strictEqual(mixed.layerRemovals(), 1, 'The group cleanup removes the final atlas without a redundant layer deletion');
assert.ok(JSON.stringify(result).length < 1000, 'The bridge receives metrics rather than thousands of Bezier points');
// The engine writes a pixel style's row advance in pixels: the host passes it on
const pixelAtlas = { ...atlas, params: { typeUnit: 'pixelsUnit', layerText: { textStyleRange: [{ textStyle: { leading: 256 } }] } } };
assert.ok(makeHost().run([pixelAtlas])[0].metrics);
assert.strictEqual(pixelAtlas.params.layerText.textStyleRange[0].textStyle.leading, 256, 'Do not mutate the supplied atlas');

for (const failure of ['convert', 'path']) {
  const host = makeHost(failure);
  const reply = host.run([atlas, line]);
  assert.strictEqual(reply[0], null, 'Unsupported atlases must request an individual-measure fallback');
  assert.ok(reply[1].bounds, 'Later individual requests still work');
}
for (const failure of ['make', 'set', 'bounds']) {
  assert.deepStrictEqual(makeHost(failure).run([line, line]), { error: 'measure' });
}

// CEP and UXP must interpret Bezier control points, DPI and row boundaries
// identically. Native measurements at several DPIs complement this parity test.
const host = makeHost();
for (const unit of ['pixelsUnit', 'distanceUnit']) {
  const raw = outline(unit);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(host.context._smartAtlasMetrics(raw, 3))), atlasMetrics(raw, 3, page));
}
assert.strictEqual(host.context._smartAtlasMetrics(outline('unknown'), 3), null);
assert.strictEqual(host.context._smartAtlasMetrics(outline(), 4), null, 'Missing/blank rows fall back');
assert.strictEqual(host.context._smartAtlasMetrics(outline(), 0), null);
assert.strictEqual(host.context._smartAtlasMetrics(outline(), 25), null);
const crossesRows = outline();
crossesRows.pathContents.pathComponents[0].subpathListKey[0].points[0].anchor.vertical._value = 1100;
assert.strictEqual(host.context._smartAtlasMetrics(crossesRows, 3), null, 'Glyphs crossing a row boundary fall back');
// Every measured request carries its cost, for the panel's atlas / line choice
{
  const timed = makeHost();
  timed.run([line, atlas]).forEach(reply => assert.ok(typeof reply.ms === 'number' && reply.ms >= 0, 'a reply says what it cost'));
}

// Cached native identifiers must preserve anchors and optional handles. A
// point's handles share the unit of its anchor, read once per point.
{
  let typeReads = 0;
  const coordinate = (x, y, unit) => ({
    getUnitDoubleType: () => { typeReads++; return unit; },
    getUnitDoubleValue: key => key === 'horizontal' ? x : y,
  });
  const descriptor = values => ({
    hasKey: key => Object.prototype.hasOwnProperty.call(values, key),
    getObjectValue: key => values[key],
    getList: key => ({ count: values[key].length, getObjectValue: i => values[key][i] }),
    getBoolean: key => values[key],
  });
  const points = [
    descriptor({ anchor: coordinate(1, 2, '#Rlt'), forward: coordinate(3, 4, '#Pnt'), backward: coordinate(5, 6, '#Pxl') }),
    descriptor({ anchor: coordinate(7, 8, '#Pxl') }),
  ];
  const raw = descriptor({ pathContents: descriptor({ pathComponents: [descriptor({ subpathListKey: [descriptor({ closedSubpath: true, points })] })] }) });
  const identifiers = [];
  const context = vm.createContext({
    executeActionGet: () => raw,
    stringIDToTypeID: value => value,
    charIDToTypeID: value => { identifiers.push(value); return value; },
    charID: { Horizontal: 'horizontal', Vertical: 'vertical' },
  });
  ['_smartUnitOf', '_smartUnit', '_smartPathPoint', '_smartReadPath'].forEach(name => vm.runInContext(extract(name), context));
  const result = JSON.parse(JSON.stringify(context._smartReadPath({}, 2)));
  const subpath = result.pathContents.pathComponents[0].subpathListKey[0];
  const xy = (x, y, unit) => ({ horizontal: { _unit: unit, _value: x }, vertical: { _unit: unit, _value: y } });
  assert.deepStrictEqual(subpath, { closedSubpath: true, points: [
    { anchor: xy(1, 2, 'distanceUnit'), forward: xy(3, 4, 'distanceUnit'), backward: xy(5, 6, 'distanceUnit') },
    { anchor: xy(7, 8, 'pixelsUnit') },
  ] });
  assert.strictEqual(typeReads, 2, 'One unit read per point, on its anchor');
  assert.deepStrictEqual(identifiers, ['#Rlt', '#Pnt'], 'Resolve unit ids once per path, not per coordinate');
  assert.throws(() => context._smartReadPath({}, 1), /pathBudget/);
  // A dense work path (a spiky or noisy outline) is read without its handles
  const dense = JSON.parse(JSON.stringify(context._smartReadPath({}, 2, 1)));
  assert.deepStrictEqual(dense.pathContents.pathComponents[0].subpathListKey[0].points, [
    { anchor: xy(1, 2, 'distanceUnit') }, { anchor: xy(7, 8, 'pixelsUnit') },
  ], 'anchors only above the threshold');
  const sparse = JSON.parse(JSON.stringify(context._smartReadPath({}, 2, 2)));
  assert.ok(sparse.pathContents.pathComponents[0].subpathListKey[0].points[0].forward, 'handles kept at or under the threshold');
}

// The group must be invisible from creation; older hosts that ignore its
// opacity still hide it before the first text layer is created.
for (const honorsOpacity of [true, false]) {
  const group = { opacity: honorsOpacity ? 0 : 100, visible: true };
  function ActionReference() {}
  ActionReference.prototype.putClass = function (type) { this.type = type; };
  function ActionDescriptor() {}
  ActionDescriptor.prototype.putReference = function (key, value) { this[key] = value; };
  ActionDescriptor.prototype.putUnitDouble = function (key, unit, value) { this[key] = { unit, value }; };
  ActionDescriptor.prototype.putObject = function (key, type, value) { this[key] = { type, value }; };
  const context = vm.createContext({
    app: { activeDocument: { activeLayer: group } }, ActionReference, ActionDescriptor,
    charID: { Null: 'target', Make: 'make' }, stringIDToTypeID: value => value, DialogModes: { NO: 'no' },
    executeAction(action, descriptor) {
      assert.strictEqual(action, 'make');
      assert.strictEqual(descriptor.target.type, 'layerSection');
      assert.strictEqual(descriptor.using.type, 'layerSection');
      assert.strictEqual(descriptor.using.value.opacity.unit, 'percentUnit');
      assert.strictEqual(descriptor.using.value.opacity.value, 0);
    },
  });
  vm.runInContext(extract('_smartCreateMeasureGroup'), context);
  assert.strictEqual(context._smartCreateMeasureGroup(), group);
  assert.ok(group.opacity === 0 || !group.visible, 'The returned group must hide every child');
}

// Component channels already represent the visible composite. Only hosts
// unable to read it should pay for a duplicate merged layer.
for (const failures of [0, 1, 2]) {
  let reads = 0, stamps = 0;
  const channels = [{ histogram: [4, 5] }, { histogram: [6, 7] }, { histogram: [8, 9] }, { histogram: [10] }];
  function ActionDescriptor() {}
  ActionDescriptor.prototype.putBoolean = function (key, value) { this[key] = value; };
  const context = vm.createContext({
    app: { activeDocument: { get componentChannels() { if (reads++ < failures) throw Error('not ready'); return channels; } } },
    ActionDescriptor, charIDToTypeID: value => value, DialogModes: { NO: 'no' },
    executeAction(action, descriptor) { assert.strictEqual(action, 'MrgV'); assert.strictEqual(descriptor.Dplc, true); stamps++; },
  });
  ['_smartReadChannelHistograms', '_smartSelectionHistograms'].forEach(name => vm.runInContext(extract(name), context));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(context._smartSelectionHistograms())), failures === 2 ? [] : [[4, 5], [6, 7], [8, 9]]);
  assert.strictEqual(stamps, failures ? 1 : 0);
}

// The ink of a pasted text stays in its chamber, as in the UXP host: the rows
// the panel sends, then Photoshop's pixels; a nudge of two pixels at most,
// and a lone "…" centred when it still fits
{
  const { withInkBands } = require('./helpers/loadAppModule')({ './utils': { csInterface: {}, locale: {}, getUserFonts: () => [] } })('app_src/smartPasteClient.js');
  const square = [[100, 100], [300, 100], [300, 300], [100, 300]];
  const prepared = withInkBands({ sessions: [{ plan: { cleanPolygon: square }, text: { top: 180, bottom: 220, pad: 4 } }] });
  const band = prepared.sessions[0].text.inkBand;
  assert.deepStrictEqual([band.top, band.bottom], [177, 223], 'rows for an ink within 3 px of the planned one');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(band.rows)), [[105, 295]], 'the chamber less the padding and one pixel');
  assert.strictEqual(withInkBands({ sessions: [{ plan: {}, text: {} }] }).sessions[0].text.inkBand, null, 'no rows: the host tests the pixels');

  const makeInk = (box, pixelsOutside) => {
    const log = [];
    const state = { box: { ...box }, selection: null };
    const context = vm.createContext({
      app: { activeDocument: { selection: { invert() { log.push('invert'); }, deselect() { state.selection = null; } } } },
      _currentLayerBox: () => state.box && { ...state.box },
      _smartSelectPolygon: () => { log.push('select'); },
      _modifySelectionBounds: amount => { log.push('contract ' + -amount); },
      _smartIntersectTransparency: () => { state.selection = pixelsOutside(state.box) ? {} : null; },
      _getCurrentSelectionBounds: () => state.selection,
      _moveLayer(dx, dy) { log.push('move ' + dx + ' ' + dy); state.box = { left: state.box.left + dx, right: state.box.right + dx, top: state.box.top + dy, bottom: state.box.bottom + dy }; },
    });
    ['_smartInkFits', '_smartMoveInk', '_smartSettleInk'].forEach(name => vm.runInContext(extract(name), context));
    return { context, log, state };
  };
  const text = { ...prepared.sessions[0].text, axis: 200 };
  const plan = { cleanPolygon: square, selection: { xMid: 200, yMid: 200 } };
  const inside = makeInk({ left: 150, right: 250, top: 181, bottom: 221 }, () => { throw Error('no pixel test needed'); });
  inside.context._smartSettleInk({ plan, text });
  assert.deepStrictEqual(inside.log, [], 'an ink inside the rows costs no Photoshop action');
  const outside = makeInk({ left: 98, right: 198, top: 183, bottom: 223 }, () => true);
  outside.context._smartSettleInk({ plan, text });
  assert.deepStrictEqual(outside.log, ['select', 'contract 4', 'invert', 'move 2 -2'], 'out of the chamber: back toward the planned place, 2 px at most');
  const pause = makeInk({ left: 220, right: 240, top: 190, bottom: 200 }, () => false);
  pause.context._smartSettleInk({ plan, text: { ...text, terminalPause: true } });
  assert.deepStrictEqual(pause.state.box, { left: 190, right: 210, top: 195, bottom: 205 }, 'a lone pause is centred in the chamber');
  const cramped = makeInk({ left: 220, right: 240, top: 190, bottom: 200 }, box => box.left < 220);
  cramped.context._smartSettleInk({ plan, text: { ...text, terminalPause: true, inkBand: null } });
  assert.deepStrictEqual(cramped.state.box, { left: 220, right: 240, top: 190, bottom: 200 }, 'and stays where it was when no centring fits');
  assert.strictEqual(cramped.state.selection, null, 'no selection left behind');
}
console.log('CEP measurement: invisible groups, native updates, atlas metrics, DPI parity, composite histograms, ink fit and failure cleanup passed');
