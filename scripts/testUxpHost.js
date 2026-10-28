// UXP plugin host: layer text conversion against real Photoshop output, the
// evalScript parser, the pure helpers of the host.js port (compared with
// host.js itself, so a change to one without the other fails here) and the
// shape sampling of the selection mask.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jamText = require(path.join(root, "uxp-src/host/jamText.js"));
const { parseCall, callTimeout, createCallQueue, CALL_TIMEOUT_MS, LONG_CALL_TIMEOUT_MS } = require(path.join(root, "uxp-src/host/evalScript.js"));

/* ------------------------- layer text ------------------------- */

// jamJSON printed doubles with 15 significant digits
const assertClose = (actual, expected, where) => {
  if (typeof expected === "number") {
    assert.strictEqual(typeof actual, "number", where);
    assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), where + ": " + actual + " vs " + expected);
    return;
  }
  if (expected === null || typeof expected !== "object") {
    assert.strictEqual(actual, expected, where);
    return;
  }
  assert.strictEqual(Array.isArray(actual), Array.isArray(expected), where);
  assert.deepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), where);
  Object.keys(expected).forEach((key) => assertClose(actual[key], expected[key], where + "." + key));
};

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/uxpTextLayers.json"), "utf8"));
fixtures.layers.forEach((layer, index) => {
  assertClose(jamText.fromLayerTextObject(layer.actionJSON), layer.jam, "layer " + index);
  // Written back, every key keeps its actionJSON type
  const written = jamText.toLayerTextObject(layer.jam);
  assert.strictEqual(written._obj, "textLayer");
  const range = written.textStyleRange[0];
  assert.strictEqual(range._obj, "textStyleRange");
  assert.deepStrictEqual(range.textStyle.size, { _unit: layer.jam.typeUnit, _value: layer.jam.layerText.textStyleRange[0].textStyle.size });
  assert.strictEqual(range.textStyle.color._obj, "RGBColor");
  assert.strictEqual(written.textShape[0].textType._enum, "textType");
  assert.strictEqual(written.paragraphStyleRange[0].paragraphStyle.alignment._enum, "alignmentType");
  assert.ok(!("baseParentStyle" in range.textStyle), "Keys jamText does not write must be dropped");
});

// Point text is read as "point" although actionJSON names it "paint"
assert.strictEqual(fixtures.layers[1].jam.layerText.textShape[0].textType, "point");

// Float RGB text colors (Photoshop 2026) read and write as 0-255 components
const floatLayer = jamText.fromLayerTextObject({
  _obj: "textLayer",
  textKey: "x",
  textStyleRange: [{ _obj: "textStyleRange", from: 0, to: 1, textStyle: { _obj: "textStyle", size: { _unit: "pixelsUnit", _value: 20 }, color: { _obj: "RGBColor", redFloat: 1, greenFloat: 0.5, blueFloat: -0.001 } } }],
});
assert.deepStrictEqual(floatLayer.layerText.textStyleRange[0].textStyle.color, { red: 255, green: 127.5, blue: 0 });
assert.deepStrictEqual(
  jamText.toLayerTextObject({ typeUnit: "pixelsUnit", layerText: { textStyleRange: [{ from: 0, to: 1, textStyle: { color: { redFloat: 0, greenFloat: 1, blueFloat: 0.5 } } }] } })
    .textStyleRange[0].textStyle.color,
  { _obj: "RGBColor", red: 0, green: 255, blue: 127.5 }
);
assert.deepStrictEqual(
  jamText.toLayerTextObject({ layerText: { textStyleRange: [{ from: 0, to: 1, textStyle: { color: { gray: 100 } } }] } }).textStyleRange[0].textStyle.color,
  { _obj: "grayscale", gray: 100 }
);

// Middle Eastern keys are written back by both hosts: dropping directionType
// sent every right-to-left layer back to left-to-right
{
  const middleEast = {
    layerText: {
      paragraphStyleRange: [{ from: 0, to: 1, paragraphStyle: { directionType: "dirRightToLeft", textComposerEngine: "textOptycaComposer", kashidaWidthType: "kashidaWidthMedium" } }],
      textStyleRange: [{ from: 0, to: 1, textStyle: { digitSet: "arabicDigits", dirOverride: "dirOverrideDefault", kashidas: "kashidaDefault", diacVPos: "diacVPosOpenType" } }],
    },
  };
  const uxpWritten = jamText.toLayerTextObject(middleEast);
  const uxpParagraph = uxpWritten.paragraphStyleRange[0].paragraphStyle;
  const uxpText = uxpWritten.textStyleRange[0].textStyle;
  const vm = require("vm");
  const cep = {};
  vm.createContext(cep);
  vm.runInContext(fs.readFileSync(path.join(root, "app_src/lib/jam/jamText.jsxinc"), "utf8").replace(/^﻿/, ""), cep);
  const cepWritten = cep.jamText.toLayerTextObject(middleEast)[1][1];
  const cepParagraph = cepWritten.paragraphStyleRange[1][0][1][1].paragraphStyle[1][1];
  const cepText = cepWritten.textStyleRange[1][0][1][1].textStyle[1][1];
  [[middleEast.layerText.paragraphStyleRange[0].paragraphStyle, uxpParagraph, cepParagraph],
    [middleEast.layerText.textStyleRange[0].textStyle, uxpText, cepText]].forEach(([source, uxp, cepStyle]) => {
    Object.keys(source).forEach((key) => {
      assert.deepStrictEqual(uxp[key], { _enum: key, _value: source[key] }, "UXP writes " + key);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(cepStyle[key])), ["<enumerated>", [key, source[key]]], "CEP writes " + key);
    });
  });
}

/* ------------------------ evalScript ------------------------ */

assert.deepStrictEqual(parseCall("getActiveLayerText()"), { name: "getActiveLayerText", args: [] });
assert.deepStrictEqual(parseCall("changeActiveLayerTextSize(-2)"), { name: "changeActiveLayerTextSize", args: [-2] });
assert.deepStrictEqual(
  parseCall('createTextLayerInSelection({"text":"a(b)\\n\\"c\\"","style":null}, true)'),
  { name: "createTextLayerInSelection", args: [{ text: 'a(b)\n"c"', style: null }, true] }
);
assert.deepStrictEqual(parseCall('openFile("/a/b.psd", false)'), { name: "openFile", args: ["/a/b.psd", false] });
assert.deepStrictEqual(
  parseCall('setActiveLayerText({"text":"undefined stays text"}, undefined)'),
  { name: "setActiveLayerText", args: [{ text: "undefined stays text" }, null] }
);
assert.strictEqual(parseCall("alert(1); app.quit()"), null, "Anything but a single call is refused");
assert.strictEqual(parseCall("getUserFonts"), null);

/* ------------------------ host call queue ------------------------ */

assert.strictEqual(callTimeout("getActiveLayerText()"), CALL_TIMEOUT_MS);
assert.strictEqual(callTimeout('scanTextShapeRTraining("/a")'), LONG_CALL_TIMEOUT_MS);
assert.strictEqual(callTimeout('nativeConfirm({"text":"?"})'), 0, "A dialog waits for the user: no limit");
assert.strictEqual(callTimeout("not a call"), CALL_TIMEOUT_MS);

const queueChecks = (async () => {
  const timers = [];
  const enqueue = createCallQueue({
    schedule: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      const index = timers.indexOf(timer);
      if (index !== -1) timers.splice(index, 1);
    },
  });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  // A timer that fired is gone, as with setTimeout
  const fire = (timer) => {
    timers.splice(timers.indexOf(timer), 1);
    timer.fn();
  };
  const order = [];
  let finishStuck = null;
  const stuck = enqueue(() => new Promise((resolve) => { order.push("stuck"); finishStuck = resolve; }), 60000, (started) => (started ? "late" : "dropped"));
  const next = enqueue(() => { order.push("next"); return "ok"; }, 60000, () => "timeout");
  const failing = enqueue(() => { throw new Error("boom"); });
  const afterFailure = enqueue(() => "after");
  await flush();
  assert.deepStrictEqual(order, ["stuck"], "Calls run one at a time");
  assert.strictEqual(timers.length, 1, "Calls waiting behind a call within its limit have no timer");
  assert.strictEqual(timers[0].ms, 60000);
  fire(timers[0]);
  assert.strictEqual(await stuck, "late", "A call past its limit answers the timeout result");
  await flush();
  assert.deepStrictEqual(order, ["stuck"], "Photoshop may still finish a late call: the next one waits for it");
  assert.strictEqual(timers.length, 1, "A call waiting behind a late call gets a limit");
  finishStuck("late result");
  assert.strictEqual(await next, "ok", "The queue goes on once the late call settles");
  assert.deepStrictEqual(order, ["stuck", "next"]);
  assert.deepStrictEqual(timers, [], "A settled call clears its timer");
  await assert.rejects(failing, /boom/);
  assert.strictEqual(await afterFailure, "after", "A failed call does not stop the queue");

  // A call that times out while a late call holds the queue never runs:
  // the panel took it as failed, it must not happen minutes later
  let finishSecond = null;
  const second = enqueue(() => new Promise((resolve) => { finishSecond = resolve; }), 60000, (started) => (started ? "late" : "dropped"));
  let ranDropped = false;
  const dropped = enqueue(() => { ranDropped = true; return "ran"; }, 60000, (started) => (started ? "late" : "dropped"));
  const unlimited = enqueue(() => "unlimited", 0);
  await flush();
  fire(timers[0]);
  assert.strictEqual(await second, "late");
  assert.strictEqual(timers.length, 1, "Only the waiting call with a limit is armed");
  fire(timers[0]);
  assert.strictEqual(await dropped, "dropped", "A waiting call answers once its own limit passes");
  finishSecond("done");
  assert.strictEqual(await unlimited, "unlimited", "A call without a limit waits for the late call");
  assert.strictEqual(ranDropped, false, "A call answered while it waited never runs");

  // Once it runs, a call that waited behind a late call gets its full limit
  let finishThird = null;
  const third = enqueue(() => new Promise((resolve) => { finishThird = resolve; }), 60000, () => "late");
  const patient = enqueue(() => "patient", 60000, () => "dropped");
  await flush();
  fire(timers[0]);
  assert.strictEqual(await third, "late");
  const waitTimer = timers[0];
  finishThird("done");
  assert.strictEqual(await patient, "patient");
  assert.ok(!timers.includes(waitTimer), "The waiting limit is replaced when the call starts");
  assert.strictEqual(await enqueue(() => "last", 0), "last", "The queue is free again");
})();

/* ------------------------ keyboard reader ------------------------ */

const loadKeysHelper = () => {
  const filename = path.join(root, "uxp-src/host/keysHelper.js");
  const stubs = { os: {}, uxp: {}, fs: {}, "./files": {}, "./keyboard": {}, "./jsx": { systemCall: () => "" } };
  const mod = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))((name) => stubs[name], mod, mod.exports);
  return mod.exports._internals;
};
{
  const keys = loadKeysHelper();
  assert.deepStrictEqual(keys.parseState("aWINaCTRLa|42\n"), { state: "aWINaCTRLa", beat: "42" });
  assert.deepStrictEqual(keys.parseState("a|7"), { state: "a", beat: "7" });
  assert.deepStrictEqual(keys.parseState("a"), { state: "a", beat: null }, "TypeR's own placeholder has no beat");
  assert.deepStrictEqual(keys.parseState(""), { state: "a", beat: null });

  // First start at once; a failed one is retried after 2, 5, 10 then 30 s
  const dog = keys.createWatchdog(0);
  assert.strictEqual(dog.shouldStart(0), true);
  dog.started(0, false);
  assert.strictEqual(dog.shouldStart(1999), false);
  assert.strictEqual(dog.shouldStart(2000), true);
  dog.started(2000, false);
  assert.strictEqual(dog.shouldStart(6999), false);
  assert.strictEqual(dog.shouldStart(7000), true);
  dog.started(7000, false);
  assert.strictEqual(dog.shouldStart(16999), false);
  dog.started(17000, false);
  assert.strictEqual(dog.shouldStart(46999), false);
  assert.strictEqual(dog.shouldStart(47000), true);

  // A start that ran: no report yet, so no state, and some time to beat
  dog.started(47000, true);
  assert.strictEqual(dog.fresh(47100), false, "No state before the first beat");
  assert.strictEqual(dog.shouldStart(47000 + keys.STALL_MS), false);
  assert.strictEqual(dog.read("1", 48000), true);
  assert.notStrictEqual(dog.state.attempts, 0, "A first beat is not yet a healthy reader");
  assert.strictEqual(dog.read("1", 48500), false, "The same beat is no news");
  assert.strictEqual(dog.fresh(48000 + keys.STALE_MS), true);
  assert.strictEqual(dog.fresh(48001 + keys.STALE_MS), false, "A frozen beat holds no key");
  assert.strictEqual(dog.shouldStart(48000 + keys.STALL_MS), false);
  assert.strictEqual(dog.shouldStart(48001 + keys.STALL_MS), true, "A reader that stopped beating is started again");
  // Restarted: the dead reader's last state stays dropped
  dog.started(55000, true);
  assert.strictEqual(dog.fresh(55000), false);
  assert.strictEqual(dog.shouldStart(55000 + keys.STALL_MS), false);
  assert.strictEqual(dog.read("2", 55500), true);
  assert.strictEqual(dog.fresh(55500), true);

  assert.strictEqual(dog.read("3", 55000 + keys.HEALTHY_MS), true);
  assert.strictEqual(dog.state.attempts, 0, "A reader that stayed up resets the retry delay");

  // A reader that beats once then dies is given up too
  const flaky = keys.createWatchdog(0);
  let flakyTime = 0;
  let flakyGaveUp = false;
  for (let attempt = 1; attempt <= keys.MAX_ATTEMPTS; attempt++) {
    assert.strictEqual(flaky.shouldStart(flakyTime), true);
    flakyGaveUp = flaky.started(flakyTime, true);
    flaky.read(String(attempt), flakyTime + 500);
    flakyTime += 10 * 60 * 1000;
  }
  assert.strictEqual(flakyGaveUp, true);
  assert.strictEqual(flaky.shouldStart(flakyTime), false);

  // A reader that never reports is given up after MAX_ATTEMPTS starts
  const hopeless = keys.createWatchdog(0);
  let time = 0;
  let gaveUp = false;
  for (let attempt = 1; attempt <= keys.MAX_ATTEMPTS; attempt++) {
    assert.strictEqual(hopeless.shouldStart(time), true);
    gaveUp = hopeless.started(time, attempt % 2 === 0);
    time += 10 * 60 * 1000;
  }
  assert.strictEqual(gaveUp, true);
  assert.strictEqual(hopeless.shouldStart(time), false);
}

/* -------------------- port vs host.js helpers -------------------- */

const hostSource = fs.readFileSync(path.join(root, "app_src/host.js"), "utf8");
const HOST_HELPERS = [
  "_clone", "_normalizeTextKey", "_getHostDefaultStyle", "_getHostDefaultStroke", "_ensureStyle", "_overrideStyleTextSize",
  "_resolveStylePointText", "_getAdaptiveSelectionOpenRadius", "_calculateSelectionDimensions", "_clampAdjustAmount",
  "_getAdjustedSelectionBoundsFallback", "_buildBoundsShapeRows", "_normalizeShapeSampleCount", "_selectionBoundsKey",
  "_buildPathShapeRows", "_polygonScanlineSpan",
  // auto-centre, double bubble, size +/- and TextShapeR live size
  "_rectFrom", "_unionRect", "_usableBubble", "_bubbleCandidateValid", "_probePoints", "_probeMargin", "_pickBubble",
  "_splitBubble", "_autoCenterEnabled", "_doubleBubbleEntriesValid", "_transformScale", "_displayedTextSize",
  "_scaleTextShape", "_textResizePlan", "_appliedSizeRatio", "_keepLiveTextSize", "_alignPlacementMap",
];
const host = new Function(hostSource + "\nreturn {" + HOST_HELPERS.join(", ") + "};")();

const loadPortModule = (photoshop) => {
  const filename = path.join(root, "uxp-src/host/photoshop.js");
  const stubs = {
    photoshop: photoshop || { action: { batchPlay: () => [{}] }, app: {}, core: {}, constants: { LayerKind: {} } },
    uxp: { storage: { localFileSystem: {} } },
  };
  const mod = { exports: {} };
  const localRequire = (name) => {
    if (stubs[name]) return stubs[name];
    return require(path.resolve(path.dirname(filename), name));
  };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(localRequire, mod, mod.exports);
  return mod.exports;
};
const port = loadPortModule()._internals;

assert.deepStrictEqual(port._getHostDefaultStyle(), host._getHostDefaultStyle(), "Default style must match host.js");
assert.deepStrictEqual(port._getHostDefaultStroke(), host._getHostDefaultStroke(), "Default stroke must match host.js");
["a\nb\r\nc", "", null, "x\ry"].forEach((text) => assert.strictEqual(port._normalizeTextKey(text), host._normalizeTextKey(text)));
[undefined, null, {}, { textProps: { layerText: { a: 1 } } }, { stroke: null }].forEach((style) => {
  assert.deepStrictEqual(port._ensureStyle(style), host._ensureStyle(style));
});
[[{ textType: "point" }, false], [{ textType: "paragraph" }, true], [{ textType: "inherit" }, true], [null, false]].forEach(([style, fallback]) => {
  assert.strictEqual(port._resolveStylePointText(style, fallback), host._resolveStylePointText(style, fallback));
});
const sized = () => ({ textProps: { layerText: { textStyleRange: [{ textStyle: { size: 10, impliedFontSize: 10 } }, { textStyle: { size: 12 } }] } } });
assert.deepStrictEqual(port._overrideStyleTextSize(sized(), 30), host._overrideStyleTextSize(sized(), 30));

const boundsOf = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, xMid: (left + right) / 2, yMid: (top + bottom) / 2 });
const shapes = [boundsOf(0, 0, 300, 500), boundsOf(10, 20, 110, 180), boundsOf(5, 5, 25, 85), boundsOf(0, 0, 6, 80), boundsOf(0, 0, 2, 2)];
shapes.forEach((bounds) => {
  assert.strictEqual(port._getAdaptiveSelectionOpenRadius(bounds), host._getAdaptiveSelectionOpenRadius(bounds));
  [0, 5, 40].forEach((padding) => assert.deepStrictEqual(port._calculateSelectionDimensions(bounds, padding), host._calculateSelectionDimensions(bounds, padding)));
  [-200, -3, 0, 7].forEach((amount) => {
    assert.strictEqual(port._clampAdjustAmount(bounds, amount), host._clampAdjustAmount(bounds, amount));
    assert.deepStrictEqual(port._getAdjustedSelectionBoundsFallback(bounds, amount), host._getAdjustedSelectionBoundsFallback(bounds, amount));
  });
  assert.strictEqual(port._selectionBoundsKey(bounds), host._selectionBoundsKey(bounds));
  [1, 5, 17, 31].forEach((count) => assert.deepStrictEqual(port._buildBoundsShapeRows(bounds, count), host._buildBoundsShapeRows(bounds, count)));
});
[undefined, 0, "3", 17, "21", 40, "x"].forEach((value) => {
  assert.strictEqual(port._normalizeShapeSampleCount(value, 17), host._normalizeShapeSampleCount(value, 17));
});

/* -------------- auto-centre and size +/- helpers vs host.js -------------- */

// Every public host.js function answers in the UXP plugin too: photoshop.js
// or the plugin entry (uxp-src/host/main.js) provides it
const portMethods = loadPortModule().methods;
const mainSource = fs.readFileSync(path.join(root, "uxp-src/host/main.js"), "utf8");
[...hostSource.matchAll(/^function ([A-Za-z]\w*)\(/gm)].map((match) => match[1]).forEach((name) => {
  const inMain = new RegExp("^\\s+" + name + "(,|:)", "m").test(mainSource);
  assert.ok(typeof portMethods[name] === "function" || inMain, name + " is missing from the UXP host");
});
assert.strictEqual(typeof portMethods.alignTextLayersToDoubleBubble, "function");
assert.ok(/alignTextLayersToDoubleBubble: "set"/.test(mainSource), "The panel must hear about a double bubble alignment");
assert.deepStrictEqual(parseCall('alignTextLayersToDoubleBubble({"resizeTextBox":true,"padding":4})'),
  { name: "alignTextLayersToDoubleBubble", args: [{ resizeTextBox: true, padding: 4 }] });

const page = { width: 1000, height: 1000 };
const rects = [boundsOf(80, 80, 220, 160), boundsOf(0, 0, 900, 900), boundsOf(300, 300, 400, 400), boundsOf(80, 80, 400, 160), boundsOf(149, 119, 152, 122), boundsOf(140, 105, 165, 135)];
const textBox = boundsOf(100, 100, 200, 140);
rects.forEach((candidate) => {
  [[], [boundsOf(300, 100, 380, 140)]].forEach((exclude) => {
    [0, 20, 90].forEach((size) => {
      assert.strictEqual(port._bubbleCandidateValid(candidate, textBox, page, exclude, size), host._bubbleCandidateValid(candidate, textBox, page, exclude, size));
    });
  });
  assert.deepStrictEqual(port._usableBubble(candidate, page), host._usableBubble(candidate, page));
  assert.deepStrictEqual(port._pickBubble(null, Object.assign({}, candidate), textBox), host._pickBubble(null, Object.assign({}, candidate), textBox));
  assert.deepStrictEqual(port._pickBubble(rects[0], Object.assign({}, candidate), textBox), host._pickBubble(rects[0], Object.assign({}, candidate), textBox));
});
[[1, 2, 3, 4], [5, 5, 4, 9], ["1", "2", "30", "40"], [0, 0, NaN, 3]].forEach((args) => {
  assert.deepStrictEqual(port._rectFrom(...args), host._rectFrom(...args));
});
assert.deepStrictEqual(port._unionRect(rects), host._unionRect(rects));
[0, 8, 20, 400, NaN, "12"].forEach((size) => assert.strictEqual(port._probeMargin(size), host._probeMargin(size)));
assert.deepStrictEqual(port._probePoints(textBox, 7), host._probePoints(textBox, 7));
[
  [boundsOf(0, 0, 400, 100), [boundsOf(20, 20, 120, 80), boundsOf(260, 20, 380, 80)]],
  [boundsOf(0, 0, 100, 400), [boundsOf(10, 250, 90, 380), boundsOf(10, 20, 90, 120)]],
  [boundsOf(0, 0, 400, 100), [boundsOf(20, 20, 220, 80), boundsOf(180, 30, 380, 70)]],
  [boundsOf(0, 0, 600, 600), [boundsOf(20, 20, 120, 80), boundsOf(300, 300, 380, 380), boundsOf(450, 30, 560, 90)]],
  [boundsOf(0, 0, 300, 300), [boundsOf(100, 100, 200, 200), boundsOf(100, 100, 200, 200)]],
].forEach(([merged, boxes]) => assert.deepStrictEqual(port._splitBubble(merged, boxes), host._splitBubble(merged, boxes)));
// Align placements in a double bubble: the chamber's optical centre is kept
// only inside its rectangle; broken entries are dropped
[
  [{ id: 4, rect: { left: 10, top: 20, right: 110, bottom: 90, xMid: 40, yMid: 60 } }, { id: 5, rect: { left: 0, top: 0, right: 50, bottom: 50, xMid: 400, yMid: 9 } }],
  [{ id: null, rect: { left: 0, top: 0, right: 5, bottom: 5 } }, { id: 6, rect: { left: 9, top: 0, right: 5, bottom: 5 } }, { id: 7 }, null],
  null,
].forEach((list) => assert.deepStrictEqual(port._alignPlacementMap(list), host._alignPlacementMap(list)));
assert.strictEqual(host._alignPlacementMap([{ id: 4, rect: { left: 10, top: 20, right: 110, bottom: 90, xMid: 40, yMid: 60 } }]).id4.xMid, 40);
assert.strictEqual(host._alignPlacementMap([{ id: 5, rect: { left: 0, top: 0, right: 50, bottom: 50, xMid: 400, yMid: 9 } }]).id5.xMid, 25);
assert.ok(/^async function alignCapture\(/m.test(fs.readFileSync(path.join(root, "uxp-src/host/photoshop.js"), "utf8")));
[{ autoCenter: "single" }, { autoCenter: "multi" }, { autoCenter: "off" }, { autoCenter: "constructor" }, null].forEach((data) => {
  assert.strictEqual(port._autoCenterEnabled(data), host._autoCenterEnabled(data));
});
[null, [], [{ text: true }], [{ text: true }, { text: false }], [{ text: true }, { text: true }]].forEach((entries) => {
  assert.strictEqual(port._doubleBubbleEntriesValid(entries), host._doubleBubbleEntriesValid(entries));
});

const resizeFixture = (overrides = {}) => ({
  typeUnit: overrides.typeUnit || "pointsUnit",
  layerText: {
    transform: overrides.transform === undefined ? { xx: 2, xy: 0, yx: 0, yy: 2, tx: 0, ty: 0 } : overrides.transform,
    textStyleRange: overrides.ranges || [{ from: 0, to: 3, textStyle: { size: 10, leading: 12, autoLeading: false } }],
    textShape: [overrides.shape || { textType: "box", bounds: { top: 0, left: 0, right: 100, bottom: 50 } }],
  },
});
const resizeCases = [
  resizeFixture(),
  resizeFixture({ transform: null, typeUnit: "pixelsUnit" }),
  resizeFixture({ shape: { textType: "point", bounds: {} } }),
  resizeFixture({ ranges: [{ textStyle: { size: 10, impliedFontSize: 24 } }, { textStyle: { size: 12, autoLeading: true } }] }),
  resizeFixture({ transform: { xx: 0, xy: 1.5, yx: -1.5, yy: 0 }, typeUnit: "millimetersUnit" }),
  resizeFixture({ ranges: [] }),
];
resizeCases.forEach((fixture) => {
  [72, 300].forEach((resolution) => {
    assert.deepStrictEqual(port._displayedTextSize(fixture, resolution), host._displayedTextSize(fixture, resolution));
    [4, -3, -100, 0.5].forEach((delta) => {
      assert.deepStrictEqual(port._textResizePlan(fixture, delta, resolution), host._textResizePlan(fixture, delta, resolution));
    });
  });
  assert.strictEqual(port._transformScale(fixture.layerText), host._transformScale(fixture.layerText));
  assert.deepStrictEqual(port._scaleTextShape(fixture.layerText.textShape[0], 1.25), host._scaleTextShape(fixture.layerText.textShape[0], 1.25));
});
[[{ value: 10, unit: "a" }, { value: 12, unit: "a" }], [{ value: 10, unit: "a" }, { value: 12, unit: "b" }], [null, null], [{ value: 0, unit: "a" }, { value: 1, unit: "a" }]]
  .forEach(([before, after]) => assert.strictEqual(port._appliedSizeRatio(before, after, 7), host._appliedSizeRatio(before, after, 7)));
const liveCases = [
  [{ typeUnit: "pointsUnit", layerText: { textStyleRange: [{ textStyle: { fontName: "A", size: 40, leading: 44, autoLeading: false } }] } },
    { typeUnit: "pointsUnit", layerText: { textStyleRange: [{ textStyle: { size: 22, autoLeading: true, leading: 30 } }] } }],
  [{ typeUnit: "pointsUnit", layerText: { textStyleRange: [{ textStyle: { size: 40, autoLeading: true } }, { textStyle: { size: 41 } }] } },
    { typeUnit: "pixelsUnit", layerText: { textStyleRange: [{ textStyle: { size: 300, leading: 600, autoLeading: false } }] } }],
  [{ layerText: { textStyleRange: [{ textStyle: { size: 40 } }] } }, { typeUnit: "millimetersUnit", layerText: { textStyleRange: [{ textStyle: { size: 3 } }] } }],
  [{ typeUnit: "rulerUnit", layerText: { textStyleRange: [{ textStyle: { size: 40 } }] } }, { typeUnit: "pixelsUnit", layerText: { textStyleRange: [{ textStyle: { size: 3 } }] } }],
  [{ typeUnit: "pointsUnit", layerText: {} }, null],
];
liveCases.forEach(([target, live]) => {
  [72, 300].forEach((resolution) => {
    const fromPort = port._keepLiveTextSize(JSON.parse(JSON.stringify(target)), live, resolution);
    const fromHost = host._keepLiveTextSize(JSON.parse(JSON.stringify(target)), live, resolution);
    assert.deepStrictEqual(fromPort, fromHost);
  });
});

/* ---------- size +/- and auto-centre against a simulated Photoshop ---------- */

// Just enough of Photoshop for the size change, the wand probes and the
// selection channel: one text layer, a page with round bubbles drawn as
// rectangles, a marquee and named channels.
const simulatedPhotoshop = () => {
  const sim = {
    roundSize: (value) => Math.round(value * 100) / 100,
    page: boundsOf(0, 0, 1000, 1000),
    bubbles: [],
    selection: null,
    channels: {},
    active: 1,
    layers: {},
    fastRefused: false,
    log: [],
  };
  const value = (v) => (v && typeof v === "object" && "_value" in v ? v._value : v);
  const unitBounds = (b) => ({ top: px(b.top), left: px(b.left), bottom: px(b.bottom), right: px(b.right) });
  const px = (v) => ({ _unit: "pixelsUnit", _value: v });
  const rectOf = (b) => boundsOf(value(b.left), value(b.top), value(b.right), value(b.bottom));
  const textKeyOf = (layer) => ({
    _obj: "textLayer",
    textKey: layer.text,
    transform: { _obj: "transform", xx: layer.scale, xy: 0, yx: 0, yy: layer.scale, tx: 0, ty: 0 },
    textStyleRange: [{
      _obj: "textStyleRange", from: 0, to: layer.text.length,
      textStyle: { _obj: "textStyle", size: { _unit: "pointsUnit", _value: layer.size }, autoLeading: true },
    }],
    textShape: [{
      _obj: "textShape",
      char: { _enum: "char", _value: "box" },
      bounds: { _obj: "rectangle", top: layer.shape.top, left: layer.shape.left, bottom: layer.shape.bottom, right: layer.shape.right },
    }],
  });
  const layerBox = (layer) => boundsOf(layer.x, layer.y, layer.x + layer.size * layer.scale * 5, layer.y + layer.size * layer.scale * 2);
  const run = (d) => {
    const target = d._target || [];
    const ref = target[target.length - 1] || {};
    const property = target[0] && target[0]._property;
    const layer = sim.layers[ref._id !== undefined ? ref._id : sim.active];
    if (d._obj === "get") {
      if (ref._ref === "channel" && ref._name) return sim.channels[ref._name] ? { channelName: ref._name } : { _obj: "error", result: -25922 };
      if (property === "targetLayersIDs") return { targetLayersIDs: (sim.targets || [sim.active]).map((id) => ({ _ref: "layer", _id: id })) };
      if (property === "selection") return sim.selection ? { selection: unitBounds(sim.selection) } : {};
      if (property === "resolution") return { resolution: 72 };
      if (property === "width" || property === "height") return { [property]: { _unit: "pixelsUnit", _value: 1000 } };
      if (property === "layerID") return { layerID: layer.id };
      if (property === "textKey") return { textKey: textKeyOf(layer) };
      if (property === "textStyle") return { textStyle: { size: { _unit: "pointsUnit", _value: layer.size } } };
      if (property === "boundsNoEffects" || property === "bounds") return { [property]: unitBounds(layerBox(layer)) };
      return {};
    }
    if (d._obj === "set" && property === "textStyle") {
      if (sim.fastRefused) return { _obj: "error", result: -1 };
      layer.size = sim.roundSize(value(d.to.size));
      sim.log.push(["fast", layer.size]);
      return {};
    }
    if (d._obj === "set" && property === "selection") {
      const to = d.to;
      if (to._enum === "ordinal") sim.selection = null;
      else if (to._ref === "channel") sim.selection = sim.channels[to._name] ? Object.assign({}, sim.channels[to._name]) : sim.selection;
      else if (to._obj === "paint") {
        const x = value(to.horizontal);
        const y = value(to.vertical);
        const hit = sim.bubbles.find((bubble) => x >= bubble.left && x <= bubble.right && y >= bubble.top && y <= bubble.bottom);
        sim.selection = hit ? Object.assign({}, hit) : Object.assign({}, sim.page);
        sim.log.push(["wand"]);
      }
      return {};
    }
    if (d._obj === "set" && target[0] && target[0]._ref === "layer") {
      if (d.to.textStyleRange) layer.size = sim.roundSize(value(d.to.textStyleRange[0].textStyle.size));
      if (d.to.textShape) {
        const b = d.to.textShape[0].bounds;
        layer.shape = { top: b.top, left: b.left, bottom: b.bottom, right: b.right };
        sim.log.push(["frame", layer.shape.right]);
      }
      return {};
    }
    if (d._obj === "intersectWith") {
      const r = rectOf(d.to);
      const s = sim.selection;
      const cut = s && boundsOf(Math.max(s.left, r.left), Math.max(s.top, r.top), Math.min(s.right, r.right), Math.min(s.bottom, r.bottom));
      sim.selection = cut && cut.width > 0 && cut.height > 0 ? cut : null;
      return {};
    }
    if (d._obj === "contract" || d._obj === "expand") {
      const by = value(d.by) * (d._obj === "contract" ? 1 : -1);
      const s = sim.selection;
      sim.selection = boundsOf(s.left + by, s.top + by, s.right - by, s.bottom - by);
      return {};
    }
    if (d._obj === "duplicate" && target[0] && target[0]._property === "selection") {
      sim.channels[d.name] = Object.assign({}, sim.selection);
      return {};
    }
    if (d._obj === "delete" && ref._ref === "channel") {
      delete sim.channels[ref._name];
      return {};
    }
    if (d._obj === "select") {
      sim.active = target[0]._id;
      return {};
    }
    if (d._obj === "move") {
      layer.x += value(d.to.horizontal);
      layer.y += value(d.to.vertical);
      sim.log.push(["move", value(d.to.horizontal), value(d.to.vertical)]);
      return {};
    }
    return {};
  };
  const historyStates = [];
  const module = loadPortModule({
    action: { batchPlay: (descriptors) => descriptors.map(run) },
    app: { documents: { length: 1 }, get activeDocument() { return { id: 7, historyStates }; } },
    core: {
      executeAsModal: async (fn) => fn({
        hostControl: {
          suspendHistory: async ({ name }) => { sim.suspended = { name, snapshot: JSON.stringify([sim.layers, sim.selection, sim.channels]) }; return 1; },
          resumeHistory: async (id, commit) => {
            if (!commit) [sim.layers, sim.selection, sim.channels] = JSON.parse(sim.suspended.snapshot);
            sim.log.push(["history", sim.suspended.name, commit]);
          },
        },
      }),
    },
    constants: { LayerKind: {} },
  });
  sim.methods = module.methods;
  sim.internals = module._internals;
  sim.addLayer = (id, props) => {
    sim.layers[id] = Object.assign({ id, text: "Hello", size: 10, scale: 2, x: 100, y: 100, shape: { top: 0, left: 0, right: 100, bottom: 50 } }, props);
  };
  return sim;
};

(async () => {
  // Size +/-: the frame follows the size Photoshop applied, with no padding
  const sim = simulatedPhotoshop();
  sim.addLayer(1);
  const start = Object.assign({}, sim.layers[1].shape);
  assert.strictEqual(await sim.methods.changeActiveLayerTextSize(4), "");
  assert.strictEqual(sim.layers[1].size, 12, "UXP: displayed 20 + 4 = 24, stored 10 x 1.2");
  assert.ok(Math.abs(sim.layers[1].shape.right - 120) < 1e-9, "UXP: frame scaled with the text, unpadded");
  assert.strictEqual(await sim.methods.changeActiveLayerTextSize(-4), "");
  assert.deepStrictEqual(sim.layers[1].shape, start, "UXP: + then - puts the frame back");
  for (const step of [3, 3, -1, 7, -2, -3, 5]) {
    await sim.methods.changeActiveLayerTextSize(step);
    const layer = sim.layers[1];
    assert.ok(Math.abs(layer.shape.right / layer.size - start.right / 10) < 1e-9, "UXP: frame / size after " + step);
  }
  sim.fastRefused = true;
  sim.log.length = 0;
  await sim.methods.changeActiveLayerTextSize(2);
  assert.ok(Math.abs(sim.layers[1].shape.right / sim.layers[1].size - start.right / 10) < 1e-9, "UXP: rebuilt frame keeps the proportion");
  assert.ok(sim.log.some((entry) => entry[0] === "move"), "UXP: re-centred on the old centre");

  // Auto-centre: the text moves to its bubble, the user's marquee comes back
  // and no channel is left behind
  const auto = simulatedPhotoshop();
  auto.addLayer(5, { x: 120, y: 130, size: 5, scale: 1 });
  auto.bubbles = [boundsOf(100, 100, 300, 220)];
  auto.active = 5;
  auto.selection = boundsOf(90, 95, 250, 230);
  auto.internals._autoCenterCreated([5], { autoCenter: "single", resizeTextBox: false });
  const placedBox = boundsOf(auto.layers[5].x, auto.layers[5].y, auto.layers[5].x + 25, auto.layers[5].y + 10);
  assert.deepStrictEqual([placedBox.xMid, placedBox.yMid], [200, 160], "UXP: centred on the bubble");
  assert.deepStrictEqual(auto.selection, boundsOf(90, 95, 250, 230), "UXP: the user's selection comes back");
  assert.deepStrictEqual(Object.keys(auto.channels), [], "UXP: no channel left behind");
  assert.strictEqual(auto.active, 5);
  auto.selection = null;
  auto.layers[5].x = 110;
  auto.internals._autoCenterCreated([5], { autoCenter: "off" });
  assert.strictEqual(auto.layers[5].x, 110, "UXP: off does nothing");
  auto.internals._autoCenterCreated([5], { autoCenter: "single" });
  assert.strictEqual(auto.selection, null, "UXP: no selection before, none after");
  auto.bubbles = [];
  auto.layers[5].x = 110;
  auto.internals._autoCenterCreated([5], { autoCenter: "multi" });
  assert.strictEqual(auto.layers[5].x, 110, "UXP: no bubble found, the text stays where it was pasted");

  // Double bubble: two texts in one merged shape are each centred in their part
  const double = simulatedPhotoshop();
  double.addLayer(1, { x: 120, y: 140, size: 5, scale: 1 });
  double.addLayer(2, { x: 330, y: 145, size: 5, scale: 1 });
  double.bubbles = [boundsOf(100, 100, 500, 220)];
  double.active = 1;
  assert.strictEqual(await double.methods.alignTextLayersToDoubleBubble({}), "doubleBubbleLayers", "UXP: one layer is not a double bubble");
  double.targets = [1, 2];
  double.selection = boundsOf(0, 0, 40, 40);
  assert.strictEqual(await double.methods.alignTextLayersToDoubleBubble({ resizeTextBox: false, padding: 0 }), "");
  const centreOf = (layer) => [layer.x + 12.5, layer.y + 5];
  const [left, right] = [centreOf(double.layers[1]), centreOf(double.layers[2])];
  assert.ok(left[0] < 300 && right[0] > 300, "UXP: each text in its own half of the merged bubble");
  assert.deepStrictEqual([left[1], right[1]], [160, 160], "UXP: centred vertically in the bubble");
  assert.deepStrictEqual(double.selection, boundsOf(0, 0, 40, 40), "UXP: an unrelated user selection comes back");
  assert.deepStrictEqual(Object.keys(double.channels), []);
  // Nothing found: an error code and the whole run rolled back
  double.bubbles = [];
  const before = JSON.stringify(double.layers);
  assert.strictEqual(await double.methods.alignTextLayersToDoubleBubble({}), "doubleBubbleNotFound");
  assert.strictEqual(JSON.stringify(double.layers), before, "UXP: a failed split is rolled back");
  assert.deepStrictEqual(double.log[double.log.length - 1], ["history", "TyperTools Align Double", false]);
  console.log("UXP auto-centre, double bubble and size +/- tests passed (simulated Photoshop)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/* ------------------- selection mask sampling ------------------- */

// An ellipse drawn into a mask, and the same ellipse as the polygon the CEP
// host traced from a work path: both samplers must find the same outline
const ellipseMask = (width, height) => {
  const data = new Uint8Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - cx) / cx;
      const dy = (y + 0.5 - cy) / cy;
      if (dx * dx + dy * dy <= 1) data[y * width + x] = 255;
    }
  }
  return { data, width, height, left: 100, top: 50 };
};
const mask = ellipseMask(600, 400);
const maskBounds = boundsOf(100, 50, 700, 450);
const polygon = [];
for (let i = 0; i < 720; i++) {
  const angle = (i / 720) * Math.PI * 2;
  polygon.push([400 + 300 * Math.cos(angle), 250 + 200 * Math.sin(angle)]);
}
[5, 17, 21].forEach((count) => {
  const fromMask = port._buildMaskShapeRows(mask, maskBounds, count);
  const fromPath = host._buildPathShapeRows([polygon], count);
  assert.strictEqual(fromMask.length, fromPath.length);
  fromMask.forEach((row, index) => {
    const reference = fromPath[index];
    assert.strictEqual(row.y, reference.y);
    ["left", "right", "width"].forEach((key) => {
      assert.ok(Math.abs(row[key] - reference[key]) < 0.012, `mask row ${index}/${count} ${key}: ${row[key]} vs ${reference[key]}`);
    });
  });
});
assert.strictEqual(port._buildMaskShapeRows({ data: new Uint8Array(100), width: 10, height: 10, left: 0, top: 0 }, boundsOf(0, 0, 10, 10), 5), null);

/* --------------------- Windows roaming AppData --------------------- */

// %APPDATA% may be redirected away from the profile: the CEP extension
// (install.ps1) and the UXP storage follow it, read from the plugin data folder
const loadFiles = (dataFolder) => {
  const filename = path.join(root, "uxp-src/host/files.js");
  const stubs = {
    uxp: { storage: { formats: {}, localFileSystem: { getDataFolder: async () => (dataFolder instanceof Error ? Promise.reject(dataFolder) : { nativePath: dataFolder }) } } },
    os: { platform: () => "win32", homedir: () => "C:\\Users\\ana" },
    fs: {},
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))((name) => stubs[name], mod, mod.exports);
  return mod.exports;
};
const pluginData = (appData) => appData + "\\Adobe\\UXP\\PluginsStorage\\PHSP\\27\\External\\com.scanr.typer\\PluginData";
(async () => {
  const redirected = loadFiles(pluginData("\\\\server\\profiles$\\ana\\AppData\\Roaming"));
  assert.deepStrictEqual(await redirected.getCepStorageRoots(), [
    "\\\\server\\profiles$\\ana\\AppData\\Roaming\\Adobe\\CEP\\extensions\\typertools",
    "C:\\Users\\ana\\AppData\\Roaming\\Adobe\\CEP\\extensions\\typertools",
  ]);
  assert.strictEqual(redirected.getStorageRoot(), "\\\\server\\profiles$\\ana\\AppData\\Roaming\\TypeR\\UXP");
  const usual = loadFiles(pluginData("C:\\Users\\ana\\AppData\\Roaming"));
  assert.deepStrictEqual(await usual.getCepStorageRoots(), ["C:\\Users\\ana\\AppData\\Roaming\\Adobe\\CEP\\extensions\\typertools"]);
  const unknown = loadFiles(new Error("no data folder"));
  await unknown.resolveFolders();
  assert.strictEqual(unknown.getStorageRoot(), "C:\\Users\\ana\\AppData\\Roaming\\TypeR\\UXP");
  assert.strictEqual(usual.roamingAppDataOf("D:\\Adobe\\Profiles\\Adobe\\UXP\\PluginsStorage"), "D:\\Adobe\\Profiles");
  assert.strictEqual(usual.roamingAppDataOf("/Users/ana/Library/Application Support/Adobe/UXP/PluginsStorage"), "/Users/ana/Library/Application Support");
  assert.strictEqual(usual.roamingAppDataOf("C:\\elsewhere"), null);
  await queueChecks;
  console.log("UXP host conversion, evalScript parsing, call queue, keyboard reader watchdog, host.js parity, mask sampling and Windows storage path tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
