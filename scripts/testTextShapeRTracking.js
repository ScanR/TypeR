const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

const loadModule = (relativePath) => {
  const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  const transformed = babel.transformSync(source, {
    presets: [["@babel/preset-env", { modules: "commonjs" }]],
  }).code;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", transformed)(require, loaded, loaded.exports);
  return loaded.exports;
};

const { PS_EVENT_MOVE, isPhotoshopMoveEvent } = loadModule("app_src/photoshopEvents.js");
const { getBubbleCacheKey, haveSameLayerSize, selectionTouchesLayer } = loadModule("app_src/textShapeRTracking.js");

// A selection on another bubble is no shape for the active text
const text = { left: 100, top: 100, right: 300, bottom: 160 };
assert.strictEqual(selectionTouchesLayer({ left: 80, top: 60, right: 320, bottom: 200 }, text), true, "the bubble around the text");
assert.strictEqual(selectionTouchesLayer({ left: 250, top: 150, right: 500, bottom: 400 }, text), true, "a corner overlap");
assert.strictEqual(selectionTouchesLayer({ left: 400, top: 100, right: 700, bottom: 300 }, text), false, "the next bubble");
assert.strictEqual(selectionTouchesLayer({ left: 100, top: 160, right: 300, bottom: 260 }, text), false, "touching edges do not overlap");
assert.strictEqual(selectionTouchesLayer({ left: 400, top: 100, right: 700, bottom: 300 }, null), true, "unknown layer bounds never refuse");
assert.strictEqual(selectionTouchesLayer({ xMid: 1, yMid: 2, width: 3, height: 4 }, text), true, "a selection without sides never refuses");

assert.strictEqual(PS_EVENT_MOVE, 1836021349);
assert.strictEqual(isPhotoshopMoveEvent({ data: `{"eventID":${PS_EVENT_MOVE}}` }), true);
assert.strictEqual(isPhotoshopMoveEvent({ data: '{"eventID":1936028772}' }), false);
assert.strictEqual(isPhotoshopMoveEvent({}), false);

const original = { left: 100, top: 200, width: 80, height: 40 };
const translated = { left: 112, top: 197, width: 80, height: 40 };
const resized = { left: 112, top: 197, width: 81, height: 40 };

assert.strictEqual(
  getBubbleCacheKey(42, original, "fallback"),
  getBubbleCacheKey(42, translated, "fallback"),
  "Translating a text layer must keep its cached bubble"
);
assert.notStrictEqual(
  getBubbleCacheKey(42, original, "fallback"),
  getBubbleCacheKey(42, resized, "fallback"),
  "Resizing a text layer must invalidate its cached bubble"
);
assert.strictEqual(haveSameLayerSize(original, translated), true);
assert.strictEqual(haveSameLayerSize(original, resized), false);

const utilsSource = fs.readFileSync(path.join(rootDir, "app_src", "utils.js"), "utf8");
const previewSource = fs.readFileSync(
  path.join(rootDir, "app_src", "components", "previewBlock", "previewBlock.jsx"),
  "utf8"
);
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");

assert.ok(
  /registerEvent\.data = `\$\{PS_EVENT_SELECT\}, \$\{PS_EVENT_SET\}, \$\{PS_EVENT_MOVE\}`/.test(utilsSource),
  "The CEP bridge must subscribe to Photoshop move events"
);
assert.ok(
  /if \(isPhotoshopMoveEvent\(event\)\)[\s\S]*?refreshInlineLayerGeometry\(\);[\s\S]*?return;/.test(previewSource),
  "Move events must take the geometry-only refresh path"
);
assert.ok(
  /const contentEventVersion = inlineContentEventVersion\.current;[\s\S]*?contentEventVersion !== inlineContentEventVersion\.current/.test(previewSource),
  "A concurrent text/style event must invalidate an in-flight move acknowledgement"
);
assert.ok(
  /inlineContentEventVersion\.current \+= 1;[\s\S]*?inlineMoveDebounce\.current = null;[\s\S]*?inlineEventDebounce\.current = setTimeout/.test(previewSource),
  "Content refreshes must cancel queued move acknowledgements"
);
assert.ok(
  /function getActiveTextLayerGeometry\(\) \{[\s\S]*?_getCurrentTextLayerBounds\(\)[\s\S]*?signature:/.test(hostSource),
  "The host must expose a lightweight geometry acknowledgement"
);
const geometryStart = hostSource.indexOf("function getActiveTextLayerGeometry()");
const geometryEnd = hostSource.indexOf("// Shared lightweight snapshot", geometryStart);
assert.ok(geometryStart >= 0 && geometryEnd > geometryStart, "Geometry acknowledgement function must exist");
const geometrySource = hostSource.slice(geometryStart, geometryEnd);
assert.ok(!geometrySource.includes("getActiveLayerText("));
assert.ok(!geometrySource.includes("getActiveLayerBubbleShape("));
assert.ok(!geometrySource.includes("jamText.getLayerText("));

console.log("TextShapeR layer tracking tests passed");
