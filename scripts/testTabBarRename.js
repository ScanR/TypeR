const assert = require('assert');
const React = require('react');
const slots = [];
let cursor = 0;
const hooks = {
  ...React,
  memo: (fn) => fn,
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useEffect() { cursor++; },
};
const actions = [];
const context = {
  state: { tabs: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }], currentTabId: 't1', multiTabEnabled: true },
  dispatch: (action) => actions.push(action),
};
const load = require('./helpers/loadAppModule')({
  react: hooks,
  './tabBar.scss': {},
  'react-icons/fi': { FiPlus: 'i', FiX: 'i', FiAlertTriangle: 'i' },
  '../../utils': { locale: {} },
  '../../context': { useContext: () => context },
});
const TabBar = load('app_src/components/tabBar/tabBar.jsx').default;
const render = () => { cursor = 0; return TabBar(); };
const nodes = (tree) => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.reduce((all, child) => all.concat(nodes(child)), []);
  return [tree].concat(nodes(tree.props && tree.props.children));
};
const find = (tree, className) => nodes(tree).find((node) => node.props && node.props.className === className);
const firstTab = (tree) => nodes(tree).find((node) => node.props && typeof node.props.onDoubleClick === 'function' && node.key === 't1');
const renameActions = () => actions.filter((action) => action.type === 'renameTab');

// Escape followed by the unmount blur must not save the rename.
firstTab(render()).props.onDoubleClick();
let input = find(render(), 'tab-bar-rename-input');
input.props.onChange({ target: { value: 'Changed' } });
input = find(render(), 'tab-bar-rename-input');
input.props.onKeyDown({ key: 'Escape' });
input.props.onBlur();
assert.strictEqual(renameActions().length, 0, 'Escape must cancel the rename');
assert.strictEqual(find(render(), 'tab-bar-rename-input'), undefined);

// Enter followed by the unmount blur must save exactly once.
firstTab(render()).props.onDoubleClick();
input = find(render(), 'tab-bar-rename-input');
input.props.onChange({ target: { value: 'Renamed' } });
input = find(render(), 'tab-bar-rename-input');
input.props.onKeyDown({ key: 'Enter' });
input.props.onBlur();
assert.deepStrictEqual(renameActions(), [{ type: 'renameTab', id: 't1', name: 'Renamed' }]);

// A plain blur still saves.
firstTab(render()).props.onDoubleClick();
input = find(render(), 'tab-bar-rename-input');
input.props.onChange({ target: { value: 'Blurred' } });
find(render(), 'tab-bar-rename-input').props.onBlur();
assert.strictEqual(renameActions().length, 2);
assert.strictEqual(renameActions()[1].name, 'Blurred');
console.log('Tab bar rename tests passed');
