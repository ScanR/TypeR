const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "updateLogic.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const logicModule = { exports: {} };
new Function("require", "module", "exports", transformed)(require, logicModule, logicModule.exports);

const {
  UPDATE_CHECK_INTERVAL,
  INSTALL_FOLDERS,
  parseVersion,
  compareVersions,
  pickUpdateDownloadUrl,
  findNewerReleases,
  findZipRootPrefix,
  mapZipEntryToTargetPath,
  shouldRunUpdateCheck,
} = logicModule.exports;

// --- parseVersion / compareVersions ---
assert.deepStrictEqual(parseVersion("v3.1.0"), [3, 1, 0]);
assert.deepStrictEqual(parseVersion("3.1"), [3, 1]);
assert.deepStrictEqual(parseVersion(null), [0]);
assert.strictEqual(compareVersions("3.1.0", "3.0.9"), 1);
assert.strictEqual(compareVersions("v3.0.0", "3.0.0"), 0);
assert.strictEqual(compareVersions("3.0.0", "3.0.0-rc.1"), 1);
assert.strictEqual(compareVersions("3.0.0-rc.10", "3.0.0-rc.2"), 1);
assert.strictEqual(compareVersions("3.0.0+build.1", "3.0.0"), 0);
assert.strictEqual(compareVersions("2.10.0", "2.9.9"), 1, "numeric compare, not lexicographic");

// --- pickUpdateDownloadUrl ---
const builtAsset = { name: "TypeR-3.1.0.zip", browser_download_url: "https://example.com/TypeR-3.1.0.zip" };
assert.strictEqual(
  pickUpdateDownloadUrl({ assets: [{ name: "readme.txt" }, builtAsset] }),
  builtAsset.browser_download_url
);
assert.strictEqual(pickUpdateDownloadUrl({ assets: [{ name: "typer.dmg" }] }), null);
// A release without a built asset must NOT fall back to the source zipball:
// the source has no compiled app/ folder and would break the extension
assert.strictEqual(
  pickUpdateDownloadUrl({ assets: [], zipball_url: "https://api.github.com/zipball/v3.1.0" }),
  null
);
assert.strictEqual(pickUpdateDownloadUrl(null), null);
assert.strictEqual(pickUpdateDownloadUrl({ assets: [{ name: "other-tool.zip" }] }), null);

// --- findNewerReleases ---
const releases = [
  { assets: [builtAsset], tag_name: "v3.0.0" },
  { assets: [builtAsset], tag_name: "v3.2.0" },
  { assets: [builtAsset], tag_name: "v3.1.0" },
  { tag_name: null },
  { assets: [builtAsset], tag_name: "4.0.0", prerelease: true },
  { assets: [builtAsset], tag_name: "4.0.0-beta.1" },
  { assets: [builtAsset], tag_name: "garbage" },
  { assets: [builtAsset], tag_name: "4.0.0", draft: true },
  { tag_name: "5.0.0", assets: [] },
];
assert.deepStrictEqual(
  findNewerReleases(releases, "3.0.0").map((r) => r.tag_name),
  ["v3.2.0", "v3.1.0"],
  "newer releases only, sorted descending"
);
assert.deepStrictEqual(findNewerReleases(releases, "3.2.0"), []);
assert.deepStrictEqual(findNewerReleases(null, "3.0.0"), []);

// --- findZipRootPrefix ---
assert.strictEqual(findZipRootPrefix(["CSXS/manifest.xml", "app/index.html"]), "");
assert.strictEqual(
  findZipRootPrefix(["TypeR-3.1.0/CSXS/manifest.xml", "TypeR-3.1.0/app/index.html"]),
  "TypeR-3.1.0/"
);
assert.strictEqual(findZipRootPrefix(["app/index.html"]), null, "not a TypeR package");
assert.strictEqual(findZipRootPrefix(["../CSXS/manifest.xml"]), null, "traversal prefix rejected");
assert.strictEqual(
  findZipRootPrefix(["deep/TypeR/CSXS/manifest.xml", "TypeR/CSXS/manifest.xml"]),
  "TypeR/",
  "shortest prefix wins"
);
assert.strictEqual(findZipRootPrefix([]), null);

// --- mapZipEntryToTargetPath ---
assert.strictEqual(mapZipEntryToTargetPath("TypeR/app/index.js", "TypeR/"), "app/index.js");
assert.strictEqual(mapZipEntryToTargetPath("CSXS/manifest.xml", ""), "CSXS/manifest.xml");
assert.strictEqual(mapZipEntryToTargetPath("app/", ""), null, "directories skipped");
assert.strictEqual(mapZipEntryToTargetPath("app/../storage", ""), null, "zip-slip rejected");
assert.strictEqual(mapZipEntryToTargetPath("app\\index.js", ""), null, "backslash rejected");
assert.strictEqual(mapZipEntryToTargetPath("other/app/index.js", "TypeR/"), null, "prefix mismatch");
assert.strictEqual(mapZipEntryToTargetPath("themes/dark.css", ""), "app/themes/dark.css");
assert.strictEqual(mapZipEntryToTargetPath("storage", ""), null, "user settings never overwritten");
assert.strictEqual(mapZipEntryToTargetPath("install.ps1", ""), null, "outside allow-list");
INSTALL_FOLDERS.forEach((folder) => {
  assert.strictEqual(mapZipEntryToTargetPath(folder + "file.bin", ""), folder + "file.bin");
});

// --- shouldRunUpdateCheck ---
const now = 1754200000000;
assert.strictEqual(shouldRunUpdateCheck(undefined, now), true, "never checked");
assert.strictEqual(shouldRunUpdateCheck(0, now), true);
assert.strictEqual(shouldRunUpdateCheck("garbage", now), true);
assert.strictEqual(shouldRunUpdateCheck(now - 1000, now), false, "checked recently");
assert.strictEqual(shouldRunUpdateCheck(now - UPDATE_CHECK_INTERVAL, now), true, "interval elapsed");
assert.strictEqual(shouldRunUpdateCheck(now + 60000, now), true, "clock moved back");

console.log("update logic tests passed");
