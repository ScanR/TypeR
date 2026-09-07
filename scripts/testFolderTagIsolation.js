const assert = require("assert");
const loadAppModule = require("./helpers/loadAppModule")();

const { getAutomaticTagStyles } = loadAppModule("app_src/folderUtils.js");

const styles = [
  { id: "unsorted-a", folder: null },
  { id: "unsorted-b" },
  { id: "folder-a-1", folder: "folder-a" },
  { id: "folder-a-2", folder: "folder-a" },
  { id: "folder-b-1", folder: "folder-b" },
  { id: "nested", folder: "folder-a-child" },
];

assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "folder-a-1").map((style) => style.id),
  ["folder-a-1", "folder-a-2"]
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "nested").map((style) => style.id),
  ["nested"]
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "unsorted-a").map((style) => style.id),
  ["unsorted-a", "unsorted-b"]
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "folder-a-1", false).map((style) => style.id),
  styles.map((style) => style.id)
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "missing").map((style) => style.id),
  styles.map((style) => style.id)
);

console.log("current folder tag isolation tests passed");
