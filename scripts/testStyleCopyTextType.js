const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Copying a style from the selected layer keeps the style's text type: a style
// taken from a point text must not force point text on every paste while the
// paste setting asks for paragraph text (typer-support, 2026-11-04 and 11-12)
const source = fs.readFileSync(path.join(__dirname, "..", "app_src/components/modal/editStyle.jsx"), "utf8");
const start = source.indexOf("const copyLayerStyle = ");
assert(start >= 0, "copyLayerStyle not found");
const end = source.indexOf("\n  };\n", start);
const body = source.slice(start, end);
assert(/getActiveLayerText\(/.test(body));
assert(!/setTextType\(/.test(body), "copying a layer's style must not change the style's text type");

const load = require("./helpers/loadAppModule")();
const { resolveStylePointText } = load("app_src/textLayerPayload.js");
assert.strictEqual(resolveStylePointText({ textType: "inherit" }, false), false);
assert.strictEqual(resolveStylePointText({}, false), false);
assert.strictEqual(resolveStylePointText({ textType: "point" }, false), true);

console.log("style copy text type tests passed");
