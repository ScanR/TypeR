// Auto-centre mode in the panel state: stored, imported and set values are
// validated, and anything unknown falls back to off (the default)
const assert = require("assert");
const loadContext = require("./helpers/loadContext");

for (const mode of ["off", "single", "multi"]) {
  assert.strictEqual(loadContext({ autoCenterMode: mode }).initial.autoCenterMode, mode);
}

assert.strictEqual(loadContext({}).initial.autoCenterMode, "off", "auto-centre is off by default");
for (const bad of ["MULTI", 1, null, true, { mode: "multi" }, "toString"]) {
  assert.strictEqual(loadContext({ autoCenterMode: bad }).initial.autoCenterMode, "off");
}

const { reducer, initial } = loadContext({ autoCenterMode: "single" });

assert.strictEqual(reducer(initial, { type: "import", data: { autoCenterMode: "multi" } }).autoCenterMode, "multi");
assert.strictEqual(reducer(initial, { type: "import", data: { autoCenterMode: "everything" } }).autoCenterMode, "off");
assert.strictEqual(reducer(initial, { type: "import", data: {} }).autoCenterMode, "single", "an import without the field keeps the mode");

assert.strictEqual(reducer(initial, { type: "setAutoCenterMode", value: "multi" }).autoCenterMode, "multi");
assert.strictEqual(reducer(initial, { type: "setAutoCenterMode", value: "bogus" }).autoCenterMode, "off");

console.log("autoCenterMode tests passed");
