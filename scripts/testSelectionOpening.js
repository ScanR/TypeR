const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.join(__dirname, "..");
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");

const radiusFunctionMatch = hostSource.match(
  /function _getAdaptiveSelectionOpenRadius\(bounds\) \{([\s\S]*?)\r?\n\}/
);
assert.ok(radiusFunctionMatch, "Adaptive selection radius helper must exist");

const getRadius = new Function(
  "_SELECTION_OPEN_RATIO",
  "_MIN_SELECTION_OPEN_RADIUS",
  `return function (bounds) {${radiusFunctionMatch[1]}\n};`
)(0.1, 4);

assert.strictEqual(getRadius({ width: 300, height: 500 }), 30);
assert.strictEqual(getRadius({ width: 100, height: 160 }), 10);
assert.strictEqual(getRadius({ width: 20, height: 80 }), 4);
assert.strictEqual(getRadius({ width: 6, height: 80 }), 2, "Radius must stay safe for tiny selections");

assert.ok(
  /_modifySelectionBounds\(-attemptRadius\)[\s\S]*_modifySelectionBounds\(attemptRadius\)/.test(hostSource),
  "Selection opening must contract before expanding by the same radius"
);
assert.ok(
  /attemptRadius = Math\.floor\(attemptRadius \/ 2\)/.test(hostSource),
  "Selection opening must retry with a smaller radius"
);
assert.ok(
  /function _createTextLayerInSelection\(\)[\s\S]*?_checkSelection\(\{ adaptiveOpen: true \}\)/.test(hostSource),
  "Paste must use adaptive selection opening"
);
assert.ok(
  /function _alignCurrentTextLayerToSelection\(\)[\s\S]*?_checkSelection\(\{ adaptiveOpen: true \}\)/.test(hostSource),
  "Align must use adaptive selection opening"
);
assert.ok(
  /var payloadBounds = merged;[\s\S]*?_withTemporaryHistory\("TypeR Selection Capture"[\s\S]*?_getAdaptiveOpenedSelectionBounds\(merged\[0\]\)/.test(hostSource),
  "Multi-bubble capture must store cleaned selection bounds"
);
assert.ok(!hostSource.includes("_DEFAULT_ADJUST_SEQUENCE"), "Fixed 6x5 sequence must be removed");
assert.ok(!hostSource.includes("preExpandAmount"), "The counterproductive pre-expansion pass must be removed");

console.log("selection opening tests passed");
