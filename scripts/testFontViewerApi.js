const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

global.window = { localStorage: null };
const source = fs.readFileSync(path.resolve(__dirname, "../app_src/fontViewerApi.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const apiModule = { exports: {} };
new Function("require", "module", "exports", transformed)(name => name === "./network" ? require("./helpers/loadAppModule")()("app_src/network.js") : require(name), apiModule, apiModule.exports);
const {
  buildFontQuery,
  clearFontViewerMemoryCache,
  getFontFamilies,
  getDownloadManifest,
  getFontFilters,
  getFontViewerStatus,
} = apiModule.exports;

const query = buildFontQuery({
  page: 2,
  perPage: 999,
  q: "comic sans",
  tags: ["SFX", "MT"],
  genres: ["Action"],
});
assert(query.includes("page=2"));
assert(query.includes("per_page=200"));
assert(query.includes("q=comic%20sans"));
assert(query.includes("tag=MT%2CSFX"));
assert(query.includes("genre=Action"));

let calls = 0;
const fakeFetch = async (url, options) => {
  calls += 1;
  return {
    ok: true,
    json: async () => {
      if (url.endsWith("/status")) return { enabled: true };
      return options && options.method === "POST"
        ? { success: true, fonts: [] }
        : { success: true, families: [], pagination: { page: 1, total: 0, has_more: false } };
    },
  };
};

clearFontViewerMemoryCache();
Promise.all([
  getFontFamilies({ q: "same" }, fakeFetch),
  getFontFamilies({ q: "same" }, fakeFetch),
]).then(async () => {
  assert.strictEqual(calls, 1, "identical in-flight list requests should be deduplicated");
  await getFontFamilies({ q: "same" }, fakeFetch);
  assert.strictEqual(calls, 1, "completed list requests should use the memory cache");
  await getDownloadManifest([1, 1, 2], fakeFetch);
  assert.strictEqual(calls, 2, "download manifests must not use the GET cache");
  const status = await getFontViewerStatus(fakeFetch);
  assert.strictEqual(status.enabled, true, "the status endpoint should expose the enabled flag");
  await getFontViewerStatus(fakeFetch);
  assert.strictEqual(calls, 3, "completed status requests should use the short memory cache");

  clearFontViewerMemoryCache();
  const disabledStatus = await getFontViewerStatus(async () => ({
    ok: true,
    json: async () => ({ enabled: false }),
  }));
  assert.strictEqual(disabledStatus.enabled, false, "a disabled status must remain a valid response");

  clearFontViewerMemoryCache();
  const filters = await getFontFilters(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      tags: ["SFX"],
      tag_counts: { SFX: 163 },
      tag_descriptions: { SFX: "Sound effects" },
    }),
  }));
  assert.strictEqual(filters.tag_descriptions.SFX, "Sound effects", "filter responses should expose API tag descriptions");
  console.log("font viewer API tests passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
