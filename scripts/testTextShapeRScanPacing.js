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

const { createScanPacer, MIN_SETTLE_MS, MAX_GAP_MS } = loadModule("app_src/textShapeRScanPacing.js");

let time = 1000000;
const pacer = createScanPacer(() => time);

assert.strictEqual(pacer.getDelay(), MIN_SETTLE_MS, "Before any scan only the settle time applies");

// A quick scan leaves a short gap: fast hosts barely notice the pacer
pacer.recordScan(50);
assert.strictEqual(pacer.getDelay(), MIN_SETTLE_MS, "A 50 ms scan must not delay the next one beyond the settle time");

// A slow scan pushes the next one away in proportion to its cost
time += 10000;
pacer.recordScan(1000);
assert.ok(pacer.getDelay() > 1000, "A 1 s scan must leave a gap of more than a second");
assert.ok(pacer.getDelay() <= MAX_GAP_MS, "The gap is capped");

// The gap shrinks as time passes and never drops below the settle time
time += 1000;
const afterOneSecond = pacer.getDelay();
time += 10000;
assert.ok(afterOneSecond > MIN_SETTLE_MS);
assert.strictEqual(pacer.getDelay(), MIN_SETTLE_MS);

// Pathological durations stay bounded
pacer.recordScan(10 * 60 * 1000);
assert.strictEqual(pacer.getDelay(), MAX_GAP_MS, "A runaway scan time must not block scanning forever");
pacer.recordScan(NaN);
pacer.recordScan(-5);
assert.ok(pacer.getDelay() >= MIN_SETTLE_MS);

// Recovery: once Photoshop is fast again the average comes back down
const recovering = createScanPacer(() => time);
recovering.recordScan(2000);
for (let i = 0; i < 12; i += 1) {
  time += 20000;
  recovering.recordScan(40);
}
assert.strictEqual(recovering.getDelay(), MIN_SETTLE_MS, "Fast scans must restore the minimum delay");

const previewSource = fs.readFileSync(
  path.join(rootDir, "app_src", "components", "previewBlock", "previewBlock.jsx"),
  "utf8"
);

assert.ok(
  /scanPacer\.getDelay\(\)[\s\S]*?getCurrentSelectionShape\([\s\S]*?scanPacer\.recordScan\(/.test(previewSource),
  "Selection outline scans must be paced and timed"
);
const bubbleCall = previewSource.indexOf("getActiveLayerBubbleShape(");
assert.ok(bubbleCall > 0, "The bubble scan call must exist");
assert.ok(
  previewSource.slice(Math.max(0, bubbleCall - 1500), bubbleCall).includes("scanPacer.getDelay()") &&
    previewSource.slice(bubbleCall, bubbleCall + 1200).includes("scanPacer.recordScan("),
  "Bubble scans must be paced and timed"
);
assert.ok(
  !/\}, 350\);/.test(previewSource),
  "The fixed 350 ms settle delay must come from the pacer"
);
assert.ok(
  /if \(!textShapeRTrackingEnabled\) return undefined;\s*refreshInlineLayerSource\(\);/.test(previewSource),
  "A hidden TextShapeR widget must not track Photoshop layers"
);

console.log("TextShapeR scan pacing tests passed");
