// UXP plugin host: layer text conversion against real Photoshop output, the
// evalScript parser, the pure helpers of the host.js port (compared with
// host.js itself, so a change to one without the other fails here) and the
// shape sampling of the selection mask.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const jamText = require(path.join(root, "uxp-src/host/jamText.js"));
const { parseCall } = require(path.join(root, "uxp-src/host/evalScript.js"));

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

/* -------------------- port vs host.js helpers -------------------- */

const hostSource = fs.readFileSync(path.join(root, "app_src/host.js"), "utf8");
const HOST_HELPERS = [
  "_clone", "_normalizeTextKey", "_getHostDefaultStyle", "_getHostDefaultStroke", "_ensureStyle", "_overrideStyleTextSize",
  "_resolveStylePointText", "_getAdaptiveSelectionOpenRadius", "_calculateSelectionDimensions", "_clampAdjustAmount",
  "_getAdjustedSelectionBoundsFallback", "_buildBoundsShapeRows", "_normalizeShapeSampleCount", "_selectionBoundsKey",
  "_buildPathShapeRows", "_polygonScanlineSpan",
];
const host = new Function(hostSource + "\nreturn {" + HOST_HELPERS.join(", ") + "};")();

const loadPort = () => {
  const filename = path.join(root, "uxp-src/host/photoshop.js");
  const stubs = {
    photoshop: { action: { batchPlay: () => [{}] }, app: {}, core: {}, constants: { LayerKind: {} } },
    uxp: { storage: { localFileSystem: {} } },
  };
  const mod = { exports: {} };
  const localRequire = (name) => {
    if (stubs[name]) return stubs[name];
    return require(path.resolve(path.dirname(filename), name));
  };
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(localRequire, mod, mod.exports);
  return mod.exports._internals;
};
const port = loadPort();

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

console.log("UXP host conversion, evalScript parsing, host.js parity and mask sampling tests passed");
