const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "updateTestMode.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const testModule = { exports: {} };
new Function("require", "module", "exports", transformed)(require, testModule, testModule.exports);

const { isLoopbackHttpUrl, parseUpdateTestConfig } = testModule.exports;

assert.strictEqual(isLoopbackHttpUrl("http://127.0.0.1:17831/releases"), true);
assert.strictEqual(isLoopbackHttpUrl("http://localhost/releases"), true);
assert.strictEqual(isLoopbackHttpUrl("https://127.0.0.1/releases"), false);
assert.strictEqual(isLoopbackHttpUrl("http://example.com/releases"), false);
assert.strictEqual(isLoopbackHttpUrl("http://127.0.0.1:70000/releases"), false);

assert.deepStrictEqual(
  parseUpdateTestConfig(JSON.stringify({
    enabled: true,
    releasesUrl: "http://127.0.0.1:17831/releases",
    currentVersion: "2.9.9",
    autoInstall: true,
  })),
  {
    releasesUrl: "http://127.0.0.1:17831/releases",
    currentVersion: "2.9.9",
    autoInstall: true,
    forceUxpMigration: false,
  }
);
assert.strictEqual(parseUpdateTestConfig("not json"), null);
assert.strictEqual(parseUpdateTestConfig({ enabled: false }), null);
assert.strictEqual(parseUpdateTestConfig({
  enabled: true,
  releasesUrl: "http://example.com/releases",
  currentVersion: "2.9.9",
}), null);
assert.strictEqual(parseUpdateTestConfig({
  enabled: true,
  releasesUrl: "http://localhost/releases",
  currentVersion: "3.0.0-beta",
}), null);

console.log("update test mode tests passed");
