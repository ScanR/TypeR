// ExtendScript evaluates mixed && / || from left to right on this host.
// Add grouping after minification so Uglify cannot remove the required pairs.
const acorn = require('acorn');
module.exports = function groupExtendScriptLogic(code) {
  const ast = acorn.parse(code, { ecmaVersion: 5 });
  const positions = new Map();
  function add(at, value) { positions.set(at, (positions.get(at) || '') + value); }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'LogicalExpression') {
      for (const child of [node.left, node.right]) {
        if (child.type === 'LogicalExpression' && child.operator !== node.operator) {
          add(child.start, '('); add(child.end, ')');
        }
      }
    }
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value.type === 'string') visit(value);
    }
  }
  visit(ast);
  for (const at of Array.from(positions.keys()).sort((a,b)=>b-a)) code = code.slice(0,at)+positions.get(at)+code.slice(at);
  return code;
};
