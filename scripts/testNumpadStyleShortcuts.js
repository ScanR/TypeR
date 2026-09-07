const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const filePath = path.resolve(__dirname, "../app_src/numpadStyleShortcuts.js");
const source = fs.readFileSync(filePath, "utf8");
const { code } = babel.transformSync(source, {
  filename: filePath,
  babelrc: false,
  configFile: false,
  plugins: ["@babel/plugin-transform-modules-commonjs"],
});
const mod = new Module(filePath, module);
mod.filename = filePath;
mod.paths = Module._nodeModulePaths(path.dirname(filePath));
mod._compile(code, filePath);

const { getNumpadStyleId, getNumpadStylePosition } = mod.exports;

assert.strictEqual(getNumpadStylePosition(["NUMPAD1"]), 0);
assert.strictEqual(getNumpadStylePosition(["NUM9"]), 8);
assert.strictEqual(getNumpadStylePosition(["KP4"]), 3);
assert.strictEqual(getNumpadStylePosition(["1"]), 0);
assert.strictEqual(getNumpadStylePosition(["CTRL", "NUMPAD1"]), null);
assert.strictEqual(getNumpadStylePosition(["NUMPAD0"]), null);

const styles = [
  { id: "unsorted", folder: null },
  { id: "a1", folder: "a" },
  { id: "a2", folder: "a" },
  { id: "b1", folder: "b" },
];
assert.strictEqual(getNumpadStyleId(styles, "a1", ["NUMPAD2"]), "a2");
assert.strictEqual(getNumpadStyleId(styles, "b1", ["NUMPAD2"]), null);
assert.strictEqual(getNumpadStyleId(styles, "unsorted", ["NUMPAD1"]), "unsorted");

console.log("numpad style shortcut tests passed");
