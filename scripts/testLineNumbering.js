const assert = require("assert");
const loadAppModule = require("./helpers/loadAppModule")();

const { getNextLineNumberState } = loadAppModule("app_src/lineNumbering.js");

const getIndexes = (items, resetLineCounterOnPage) => {
  let linesCounter = 0;
  return items.map((item) => {
    const next = getNextLineNumberState({
      linesCounter,
      resetLineCounterOnPage,
      isPage: item === "page",
      ignore: item === "page" || item === "ignore",
    });
    linesCounter = next.linesCounter;
    return next.index;
  });
};

assert.deepStrictEqual(getIndexes(["line", "line", "page", "line", "line"], true), [1, 2, 0, 1, 2]);
assert.deepStrictEqual(getIndexes(["line", "line", "page", "line", "line"], false), [1, 2, 0, 3, 4]);
assert.deepStrictEqual(getIndexes(["line", "ignore", "line"], true), [1, 0, 2]);

console.log("line numbering tests passed");
