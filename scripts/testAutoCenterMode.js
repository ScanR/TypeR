const assert = require("assert");
const loadContext = require("./helpers/loadContext");

// Valid stored modes survive a reload
for (const mode of ["off", "single", "multi"]) {
  assert.strictEqual(loadContext({ autoCenterMode: mode }).initial.autoCenterMode, mode);
}

// Missing or corrupt stored values fall back to off
assert.strictEqual(loadContext({}).initial.autoCenterMode, "off");
for (const bad of ["MULTI", 1, null, true, { mode: "multi" }]) {
  assert.strictEqual(loadContext({ autoCenterMode: bad }).initial.autoCenterMode, "off");
}

const { reducer, initial } = loadContext({ autoCenterMode: "single" });

// Imported settings go through the same validation
assert.strictEqual(reducer(initial, { type: "import", data: { autoCenterMode: "multi" } }).autoCenterMode, "multi");
assert.strictEqual(reducer(initial, { type: "import", data: { autoCenterMode: "everything" } }).autoCenterMode, "off");
// Imports without the field keep the current mode
assert.strictEqual(reducer(initial, { type: "import", data: {} }).autoCenterMode, "single");

// The setter rejects unknown values
assert.strictEqual(reducer(initial, { type: "setAutoCenterMode", value: "multi" }).autoCenterMode, "multi");
assert.strictEqual(reducer(initial, { type: "setAutoCenterMode", value: "bogus" }).autoCenterMode, "off");

console.log("autoCenterMode tests passed");
