// The compatibility bundle replaces grid and flex gaps for Chromium 41.
// Flex gaps need Chromium 84, and a gap only exists between two items: a margin
// after the last item too would push the next block away and shrink the row.
const LEADING_MARGIN = { row: 'margin-left', 'row-reverse': 'margin-right', column: 'margin-top', 'column-reverse': 'margin-bottom' };

// Wrapped rows can't tell their first items apart, so every item keeps a margin
// on its end sides: the container gives that room back
const reclaimed = (declaration, gap) => {
  if (!declaration) return '-' + gap;
  return declaration.value === 'auto' ? 'auto' : 'calc(' + declaration.value + ' - ' + gap + ')';
};

module.exports = () => ({
  postcssPlugin: 'typer-legacy-layout',
  OnceExit(root) {
    const additions = [];
    root.walkRules(rule => {
      if (!rule.selector || rule.selector.includes('keyframes')) return;
      const declarations = {};
      rule.nodes.forEach(node => { if (node.type === 'decl') declarations[node.prop] = node; });
      const children = suffix => rule.clone({ nodes: [], selector: rule.selector.split(',').map(selector => selector + suffix).join(',') });
      let wraps = !!declarations['flex-wrap'] && declarations['flex-wrap'].value === 'wrap';
      if (declarations.display && declarations.display.value === 'grid') {
        wraps = true;
        declarations.display.value = 'flex';
        rule.append({ prop: 'flex-wrap', value: 'wrap' });
        const columns = declarations['grid-template-columns'];
        const count = columns && /repeat\((\d+),/.exec(columns.value);
        const child = children(' > *');
        child.append({ prop: 'flex', value: count ? '1 1 ' + Math.floor(90 / Number(count[1])) + '%' : '1 1 140px' });
        child.append({ prop: 'min-width', value: '0' });
        child.append({ prop: 'max-width', value: '100%' });
        additions.push([rule, child]);
      }
      if (declarations.gap) {
        const gaps = declarations.gap.value.split(/\s+/);
        const rowGap = gaps[0];
        const columnGap = gaps[1] || gaps[0];
        if (wraps) {
          const child = children(' > *');
          child.append({ prop: 'margin-right', value: columnGap });
          child.append({ prop: 'margin-bottom', value: rowGap });
          additions.push([rule, child]);
          rule.append({ prop: 'margin-right', value: reclaimed(declarations['margin-right'], columnGap) });
          rule.append({ prop: 'margin-bottom', value: reclaimed(declarations['margin-bottom'], rowGap) });
        } else {
          const direction = declarations['flex-direction'] ? declarations['flex-direction'].value : 'row';
          const child = children(' > * + *');
          child.append({ prop: LEADING_MARGIN[direction] || LEADING_MARGIN.row, value: /^column/.test(direction) ? rowGap : columnGap });
          additions.push([rule, child]);
        }
        declarations.gap.remove();
      }
      if (declarations.inset) {
        const values = declarations.inset.value.split(/\s+/);
        ['top', 'right', 'bottom', 'left'].forEach((prop, i) => rule.append({ prop, value: values[i] || values[i % 2] || values[0] }));
      }
    });
    additions.forEach(([rule, child]) => rule.after(child));
  }
});
module.exports.postcss = true;
