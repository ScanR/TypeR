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

const path = require('path');
const sass = require('sass');
const presetEnv = require('postcss-preset-env');
const autoprefixer = require('autoprefixer');

const declarations = (root, selector, width = Infinity) => {
  const result = {};
  root.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    if (rule.parent.type === 'atrule' && rule.parent.name === 'media') {
      const maxWidth = /max-width:\s*(\d+)px/.exec(rule.parent.params);
      if (maxWidth && width > Number(maxWidth[1])) return;
    }
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
};

(async () => {
  const fixture = await postcss([legacyCss()]).process(`
    .row, .other-row { display: flex; gap: 4px 6px; }
    .column { display: flex; flex-direction: column; gap: 4px 6px; }
    .reverse { display: flex; flex-direction: row-reverse; gap: 4px 6px; }
    .up { display: flex; flex-direction: column-reverse; gap: 4px 6px; }
    .wrap { display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 6px; }
    .calc { display: flex; gap: calc(2px + 2px) calc(3px + 3px); }
    @media (max-width: 450px) { .column { gap: 8px; } }
  `, { from: undefined });
  const css = fixture.root;
  assert.deepStrictEqual(declarations(css, '.row > * + *'), { 'margin-left': '6px' });
  assert.deepStrictEqual(declarations(css, '.other-row > * + *'), { 'margin-left': '6px' });
  assert.deepStrictEqual(declarations(css, '.column > * + *'), { 'margin-top': '4px' });
  assert.deepStrictEqual(declarations(css, '.column > * + *', 400), { 'margin-top': '8px' });
  assert.deepStrictEqual(declarations(css, '.reverse > * + *'), { 'margin-right': '6px' });
  assert.deepStrictEqual(declarations(css, '.up > * + *'), { 'margin-bottom': '4px' });
  assert.deepStrictEqual(declarations(css, '.wrap > *'), { 'margin-right': '6px', 'margin-bottom': '4px' });
  assert.strictEqual(declarations(css, '.grid')['flex-wrap'], 'wrap');
  assert.strictEqual(declarations(css, '.grid > *')['margin-bottom'], '4px');
  assert.deepStrictEqual(declarations(css, '.calc > * + *'), { 'margin-left': 'calc(3px + 3px)' });
  css.walkDecls('gap', () => assert.fail('The legacy bundle cannot depend on flex gap'));

  // Run the real settings stylesheet through the same pipeline as webpack.
  // Pack eight tabs using the emitted widths/margins to catch the extra
  // trailing gutter that made four columns turn into three in old CEP.
  const source = sass.compile(path.join(__dirname, '../app_src/components/modal/modal.scss')).css;
  for (const legacy of [false, true]) {
    const plugins = [presetEnv(), autoprefixer()];
    if (legacy) plugins.push(legacyCss());
    const result = await postcss(plugins).process(source, { from: undefined });
    const parent = declarations(result.root, '.settings-tabs');
    const tab = declarations(result.root, '.settings-tab');
    const child = declarations(result.root, '.settings-tabs > *');
    const basis = /calc\(([\d.]+)% - ([\d.]+)px\)/.exec(tab.flex);
    assert.ok(basis, 'Tabs must have a calculable percentage width');
    assert.strictEqual(tab['box-sizing'], 'border-box');
    for (const width of [240, 280, 320, 400, 463, 600]) {
      const available = width - 2 * parseFloat(parent.padding);
      const outerWidth = available * Number(basis[1]) / 100 - Number(basis[2])
        + parseFloat(child['margin-left'] || tab.margin || 0)
        + parseFloat(child['margin-right'] || tab.margin || 0);
      const gap = parseFloat(parent.gap || 0);
      const rows = [[]];
      let used = 0;
      for (let i = 0; i < 8; i++) {
        const space = outerWidth + (rows[rows.length - 1].length ? gap : 0);
        if (used + space > available + 0.001) { rows.push([]); used = 0; }
        used += outerWidth + (rows[rows.length - 1].length ? gap : 0);
        rows[rows.length - 1].push(i);
      }
      assert.deepStrictEqual(rows.map(row => row.length), [4, 4], `${legacy ? 'CEP legacy' : 'modern'} settings at ${width}px`);
    }
    if (legacy) {
      const icon = declarations(result.root, '.settings-tab > * + *');
      assert.strictEqual(icon['margin-bottom'], undefined, 'Icons and labels must stay vertically centred');
      assert.strictEqual(icon['margin-left'], '5px');
      assert.deepStrictEqual(declarations(result.root, '.settings-tab > * + *', 400), { 'margin-left': '4px' });
    }
  }
  console.log('Legacy CSS: settings keep two rows; row/column gutters, icons, wrapping and calc values verified');
})().catch(error => { console.error(error); process.exit(1); });
