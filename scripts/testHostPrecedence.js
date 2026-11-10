// ExtendScript gives && and || the same precedence and reads them left to
// right: "a || b && c" is "(a || b) && c" there ("true || false && false" is
// false; checked in Photoshop 2026). The build prints the host through
// UglifyJS, which drops the parentheses the standard does not need, so
// "a || (b && c)" in app_src/host.js reaches Photoshop as "a || b && c".
// An || whose right operand is an && must therefore be written as separate
// statements. The expressions listed below were there before this check and
// are left as they are (their meaning in Photoshop is not the one written):
// fixing one changes what the Legacy panel does, so it is a decision of its
// own. Remove a line here when its expression is rewritten.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const root = path.join(__dirname, "..");
const files = fs.readFileSync(path.join(root, "webpack.config.js"), "utf8").match(/const hostFiles = \[([^]*?)\];/)[1]
  .match(/'\/[^']+'/g).map((name) => name.slice(2, -1));
assert.ok(files.includes("app_src/host.js"), "the host files are read from webpack.config.js");

const KNOWN = [
  "app_src/host.js _withTemporaryHistory",
  "app_src/lib/jam/jamHelpers.jsxinc restoreDesc",
  "app_src/lib/jam/jamStyles.jsxinc restoreDesc",
  "app_src/lib/jam/jamText.jsxinc restoreDesc",
];

const found = [];
files.forEach((file) => {
  const code = fs.readFileSync(path.join(root, file), "utf8");
  const ast = parser.parse(code, { sourceType: "script", errorRecovery: true });
  const names = [];
  const walk = (node, key) => {
    if (!node || typeof node.type !== "string") return;
    const named = /Function/.test(node.type);
    if (named) names.push((node.id && node.id.name) || key || "(anonymous)");
    if (node.type === "LogicalExpression" && node.operator === "||" && node.right.type === "LogicalExpression" && node.right.operator === "&&") {
      found.push(file + " " + (names[names.length - 1] || "(top level)"));
    }
    Object.keys(node).forEach((field) => {
      const value = node[field];
      // The name a function is assigned to: a property, a variable or a member
      const label = node.type === "VariableDeclarator" && field === "init" ? node.id.name
        : node.type === "AssignmentExpression" && field === "right" && node.left.property ? node.left.property.name
          : (node.type === "ObjectProperty" || node.type === "Property") && field === "value" ? (node.key.name || node.key.value)
            : null;
      if (Array.isArray(value)) value.forEach((child) => walk(child, null));
      else if (value && typeof value.type === "string") walk(value, label);
    });
    if (named) names.pop();
  };
  walk(ast.program, null);
});

assert.deepStrictEqual(found.slice().sort(), KNOWN.slice().sort(),
  'An "a || (b && c)" in a host file: ExtendScript reads it "(a || b) && c" once the build has dropped the parentheses. Write one test a statement.');
console.log("Host precedence: no new || with an && on its right in the ExtendScript host");
