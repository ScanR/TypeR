const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const babel = require("@babel/core");

const filePath = path.resolve(__dirname, "../app_src/markdownFormatting.js");
const source = fs.readFileSync(filePath, "utf8");
const { code } = babel.transformSync(source, {
  filename: filePath,
  babelrc: false,
  configFile: false,
  plugins: ["@babel/plugin-transform-modules-commonjs"],
});
const mod = new Module(filePath, module);
mod.filename = filePath;
mod.paths = Module._nodeModulePaths(path.dirname(filePath));
mod._compile(code, filePath);

const { formatMarkdownSelection } = mod.exports;

assert.deepStrictEqual(formatMarkdownSelection("hello", 0, 5, "bold"), {
  text: "**hello**", selectionStart: 2, selectionEnd: 7,
});
assert.deepStrictEqual(formatMarkdownSelection("**hello**", 2, 7, "italic"), {
  text: "***hello***", selectionStart: 3, selectionEnd: 8,
});
assert.deepStrictEqual(formatMarkdownSelection("***hello***", 3, 8, "bold"), {
  text: "*hello*", selectionStart: 1, selectionEnd: 6,
});
assert.deepStrictEqual(formatMarkdownSelection("_hello_", 1, 6, "italic"), {
  text: "hello", selectionStart: 0, selectionEnd: 5,
});
assert.deepStrictEqual(formatMarkdownSelection("**hello**", 0, 9, "italic"), {
  text: "***hello***", selectionStart: 3, selectionEnd: 8,
});
assert.deepStrictEqual(formatMarkdownSelection("*hello*", 0, 7, "italic"), {
  text: "hello", selectionStart: 0, selectionEnd: 5,
});
assert.deepStrictEqual(formatMarkdownSelection("hello", 2, 2, "bold"), {
  text: "hello", selectionStart: 2, selectionEnd: 2,
});

console.log("markdown formatting tests passed");

// HTML paste: Word's source line breaks and inter-tag whitespace are not line
// breaks, blocks and <br> are, "*" and "_" are kept, formatting is marked
const { htmlNodeToMarkdown, applyMarkdownStyle } = mod.exports;
const text = (value) => ({ nodeType: 3, nodeValue: value });
const el = (tagName, children, attrs = {}) => ({
  nodeType: 1,
  tagName,
  childNodes: children,
  getAttribute: (name) => (name in attrs ? attrs[name] : null),
});
const body = (...children) => el("BODY", children);

assert.strictEqual(
  htmlNodeToMarkdown(body(
    text("\n\n"),
    el("P", [text("Mariclage"), el("O:P", [])]),
    text("\n\n"),
    el("P", [text("Réincarnée en méchante dans un roman adoré de\nsa vie passée. Comtesse célibataire qui gouverne une grande ville\nde l'Empire\nd'Orlea."), el("O:P", [])]),
    text("\n\n"),
  )),
  "Mariclage\nRéincarnée en méchante dans un roman adoré de sa vie passée. Comtesse célibataire qui gouverne une grande ville de l'Empire d'Orlea.\n",
);
assert.strictEqual(
  htmlNodeToMarkdown(body(el("P", [text("* *: Yoon Ari."), el("BR", []), text("\"\": Dad...!!!")]))),
  "* *: Yoon Ari.\n\"\": Dad...!!!\n",
);
assert.strictEqual(
  htmlNodeToMarkdown(body(el("P", [el("B", [text("Page 5")])]), el("P", [text("Plain "), el("I", [text("soft ")]), text("word")]))),
  "**Page 5**\nPlain *soft* word\n",
);
assert.strictEqual(
  htmlNodeToMarkdown(body(el("P", [text("Bold ")], { style: "font-weight:700" }), el("P", [text("x")], { style: "font-weight:400" }))),
  "**Bold**\nx\n",
);
assert.strictEqual(
  htmlNodeToMarkdown(body(el("STYLE", [text("p { color: red }")]), el("DIV", [text("A")]), el("DIV", [text(" ")]), el("DIV", [text("B")]))),
  "A\n\nB\n",
);
assert.strictEqual(htmlNodeToMarkdown(body(el("PRE", [text("a\n  b")]))), "a\nb\n");
assert.strictEqual(htmlNodeToMarkdown(null), "");
assert.strictEqual(applyMarkdownStyle("  hi there  ", true, false), "  **hi there**  ");
assert.strictEqual(applyMarkdownStyle("one\n\ntwo", false, true), "*one*\n\n*two*");

console.log("Markdown formatting tests passed");
