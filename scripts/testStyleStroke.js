// The shortcut that turns a style's stroke on or off (app_src/styleStroke.js).
const assert = require("assert");
const createLoader = require("./helpers/loadAppModule");

const load = createLoader({});
const { isStyleStrokeOn, toggleStyleStroke } = load("app_src/styleStroke.js");

const red = { r: 255, g: 0, b: 0 };
const on = { id: "s", name: "Style", stroke: { enabled: true, size: 5, opacity: 80, position: "outer", color: red } };

assert.strictEqual(isStyleStrokeOn(on), true);
assert.strictEqual(isStyleStrokeOn({ stroke: { size: 5, color: red } }), true, "older styles have no enabled flag");
assert.strictEqual(isStyleStrokeOn({ stroke: { enabled: false, size: 5, color: red } }), false);
assert.strictEqual(isStyleStrokeOn({ stroke: { enabled: true, size: 0, color: red } }), false);
assert.strictEqual(isStyleStrokeOn({ stroke: null }), false);
assert.strictEqual(isStyleStrokeOn({}), false);
assert.strictEqual(isStyleStrokeOn(null), false);

// Off and back on: size, color and the rest of the style are kept
const off = toggleStyleStroke(on);
assert.deepStrictEqual(off, { ...on, stroke: { ...on.stroke, enabled: false } });
assert.strictEqual(on.stroke.enabled, true, "the input is not mutated");
assert.deepStrictEqual(toggleStyleStroke(off), on);

// A flag-less stroke counts as on, so the first press turns it off
assert.strictEqual(toggleStyleStroke({ stroke: { size: 5, color: red } }).stroke.enabled, false);

// No stroke yet: a default one, white unless a color was already chosen
const expected = { enabled: true, size: 3, opacity: 100, position: "outer", color: { r: 255, g: 255, b: 255 } };
assert.deepStrictEqual(toggleStyleStroke({ id: "s" }).stroke, expected);
assert.deepStrictEqual(toggleStyleStroke({ id: "s", stroke: null }).stroke, expected);
assert.deepStrictEqual(
  toggleStyleStroke({ stroke: { enabled: false, size: 0, opacity: 100, position: "outer", color: red } }).stroke,
  { ...expected, color: red }
);

console.log("style stroke ok");
