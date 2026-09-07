// The compatibility bundle replaces grid and flex gaps for Chromium 41.
module.exports = () => ({
  postcssPlugin: 'typer-legacy-layout',
  OnceExit(root) {
    const additions = [];
    root.walkRules(rule => {
      if (!rule.selector || rule.selector.includes('keyframes')) return;
      const declarations = {};
      rule.nodes.forEach(node => { if (node.type === 'decl') declarations[node.prop] = node; });
      if (declarations.display && declarations.display.value === 'grid') {
        declarations.display.value = 'flex';
        rule.append({ prop: 'flex-wrap', value: 'wrap' });
        const columns = declarations['grid-template-columns'];
        const count = columns && /repeat\((\d+),/.exec(columns.value);
        const child = rule.clone({ nodes: [], selector: rule.selector.split(',').map(selector => selector + ' > *').join(',') });
        child.append({ prop: 'flex', value: count ? '1 1 ' + Math.floor(90 / Number(count[1])) + '%' : '1 1 140px' });
        child.append({ prop: 'min-width', value: '0' });
        child.append({ prop: 'max-width', value: '100%' });
        additions.push([rule, child]);
      }
      if (declarations.gap) {
        const gaps = declarations.gap.value.split(/\s+/);
        const child = rule.clone({ nodes: [], selector: rule.selector.split(',').map(selector => selector + ' > *').join(',') });
        child.append({ prop: 'margin-right', value: gaps[1] || gaps[0] });
        child.append({ prop: 'margin-bottom', value: gaps[0] });
        additions.push([rule, child]);
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
