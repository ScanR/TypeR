// Compatibility bundle: gaps become margins between the items only, or the block
// after them moves away and the last item leaves a hole at the end of its row
const assert = require("assert");
const postcss = require("postcss");
const legacyCss = require("./legacyCss");

const squeeze = (css) => css.replace(/\s+/g, "");
const check = (css, expected, message) => {
  assert.strictEqual(squeeze(postcss([legacyCss()]).process(css, { from: undefined }).css), squeeze(expected), message);
};

check(
  ".a { display: flex; gap: 5px; }",
  ".a { display: flex; } .a > * + * { margin-left: 5px; }",
  "a row only spaces its items"
);
check(
  ".a { display: flex; flex-direction: column; gap: 8px 2px; }",
  ".a { display: flex; flex-direction: column; } .a > * + * { margin-top: 8px; }",
  "a column uses the row gap"
);
check(
  ".a { display: flex; flex-direction: row-reverse; gap: 5px; }",
  ".a { display: flex; flex-direction: row-reverse; } .a > * + * { margin-right: 5px; }",
  "a reversed row starts from the other side"
);
check(
  ".a, .b { gap: 2px; }",
  ".a, .b { } .a > * + *,.b > * + * { margin-left: 2px; }",
  "every selector of the rule is covered"
);
check(
  ".a { display: flex; flex-wrap: wrap; margin-bottom: 10px; gap: 5px; }",
  ".a { display: flex; flex-wrap: wrap; margin-bottom: 10px; margin-right: -5px; margin-bottom: calc(10px - 5px); } .a > * { margin-right: 5px; margin-bottom: 5px; }",
  "a wrapped row gives the room of its last items back, keeping its own margin"
);
check(
  ".a { display: flex; flex-wrap: wrap; margin-right: auto; gap: 1px 4px; }",
  ".a { display: flex; flex-wrap: wrap; margin-right: auto; margin-right: auto; margin-bottom: -1px; } .a > * { margin-right: 4px; margin-bottom: 1px; }",
  "an automatic margin stays automatic"
);
check(
  ".a { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }",
  ".a { display: flex; grid-template-columns: repeat(3, 1fr); flex-wrap: wrap; margin-right: -4px; margin-bottom: -4px; } .a > * { margin-right: 4px; margin-bottom: 4px; } .a > * { flex: 1 1 30%; min-width: 0; max-width: 100%; }",
  "a grid becomes a wrapped row"
);
check(
  ".a { inset: 0; }",
  ".a { inset: 0; top: 0; right: 0; bottom: 0; left: 0; }",
  "inset is spelled out"
);

console.log("Legacy CSS tests passed");
