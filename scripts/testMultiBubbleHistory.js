const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const historySource = fs.readFileSync(
  path.join(rootDir, "app_src", "multiBubbleHistory.js"),
  "utf8"
);
const transformedHistory = babel.transformSync(historySource, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const historyModule = { exports: {} };
new Function("require", "module", "exports", transformedHistory)(
  (name) => name === "./pageMarker" ? require("./helpers/loadAppModule")()("app_src/pageMarker.js") : require(name),
  historyModule,
  historyModule.exports
);

const { getStoredSelectionLineIndex } = historyModule.exports;

const lines = [
  { rawIndex: 0, rawText: "Page 1", ignore: true },
  { rawIndex: 1, rawText: "First page, first line", ignore: false },
  { rawIndex: 2, rawText: "First page, second line", ignore: false },
  { rawIndex: 3, rawText: "Page 2", ignore: true },
  { rawIndex: 4, rawText: "// Translator note", ignore: true },
  { rawIndex: 5, rawText: "Second page, first line", ignore: false },
  { rawIndex: 6, rawText: "Second page, second line", ignore: false },
];

assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 7 }, 12),
  7,
  "A removed selection must restore the text line it captured"
);
assert.strictEqual(
  getStoredSelectionLineIndex(null, 12),
  12,
  "Missing legacy selection history must keep the current text line"
);
assert.strictEqual(
  getStoredSelectionLineIndex({}, 12),
  12,
  "Selections without a line index must keep the current text line"
);
assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 2 }, 5, lines),
  5,
  "Removing a selection from the previous page must stay on the first line of the current page"
);
assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 5 }, 6, lines),
  5,
  "Removing a selection from the current page must still restore its captured line"
);
assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 1 }, 2, lines),
  1,
  "Removing a selection must still move backwards within the current page"
);

const contextSource = fs.readFileSync(
  path.join(rootDir, "app_src", "context.jsx"),
  "utf8"
);
assert(
  /case "clearSelections"[\s\S]*state\.storedSelections\[0\],[\s\S]*state\.currentLineIndex,[\s\S]*state\.lines/.test(contextSource),
  "Clearing selections must restore the line without leaving the current page"
);
assert(
  /case "removeSelection"[\s\S]*state\.storedSelections\[action\.index\],[\s\S]*state\.currentLineIndex,[\s\S]*state\.lines/.test(contextSource),
  "Removing a selection must restore its line without leaving the current page"
);

console.log("multi-bubble history tests passed");
