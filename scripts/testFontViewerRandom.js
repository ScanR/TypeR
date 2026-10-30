const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../app_src/fontViewerRandom.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const randomModule = { exports: {} };
new Function("require", "module", "exports", transformed)(require, randomModule, randomModule.exports);
const { getRemainingPages, shuffleFamilies } = randomModule.exports;

const families = new Array(20).fill(null).map((_, id) => ({ id }));
const first = shuffleFamilies(families, 12345);
const sameSeed = shuffleFamilies(families, 12345);
const anotherSeed = shuffleFamilies(families, 67890);

assert.deepStrictEqual(first, sameSeed, "a shuffle must stay stable for the same seed");
assert.notDeepStrictEqual(first, anotherSeed, "a new seed should produce a new inspiration order");
assert.deepStrictEqual(first.map(({ id }) => id).sort((a, b) => a - b), families.map(({ id }) => id));
assert.deepStrictEqual(families.map(({ id }) => id), new Array(20).fill(null).map((_, id) => id), "the source list must not be mutated");

// The real catalogue is sorted by name: a batch must come from all of it, not
// from its start, whatever the seed.
const catalogue = new Array(2817).fill(null).map((_, id) => ({ id }));
let seed = 12345;
let drawn = 0;
const sections = new Array(10).fill(0);
for (let round = 0; round < 200; round += 1) {
  seed = (seed + 0x9e3779b9) >>> 0;
  shuffleFamilies(catalogue, seed).slice(0, 24).forEach(({ id }) => {
    sections[Math.floor((id * sections.length) / catalogue.length)] += 1;
    drawn += 1;
  });
}
sections.forEach((count) => {
  assert.ok(Math.abs(count / drawn - 0.1) < 0.03, `each tenth of the catalogue should get about 10% of the draws: ${sections}`);
});

assert.deepStrictEqual(getRemainingPages({ page: 1, total: 2817 }, 1, 200), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
assert.deepStrictEqual(getRemainingPages({ page: 14, total: 2817 }, 14, 200), [15]);
assert.deepStrictEqual(getRemainingPages({ total: 2817 }, 14, 200), [15], "falls back on the requested page");
assert.deepStrictEqual(getRemainingPages({ page: 1, total: 150 }, 1, 200), []);

console.log("font viewer random tests passed");
