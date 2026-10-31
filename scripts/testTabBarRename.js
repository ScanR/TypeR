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

// Drag and drop: three tabs 100px wide, side by side
context.state.tabs = [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }, { id: 't3', name: 'Three' }];
let textDirection = 'ltr';
global.document = { documentElement: { getAttribute: () => textDirection } };
const tabAt = (index) => ({ getBoundingClientRect: () => (textDirection === 'rtl'
  ? { left: 200 - index * 100, width: 100 }
  : { left: index * 100, width: 100 }) });
const stripEvent = (clientX, clientY = 10) => ({
  clientX,
  clientY,
  preventDefault() { this.prevented = true; },
  dataTransfer: { setData() {} },
  currentTarget: {
    querySelectorAll: () => [tabAt(0), tabAt(1), tabAt(2)],
    getBoundingClientRect: () => ({ left: 0, right: 330, top: 0, bottom: 20 }),
  },
});
const list = (tree) => find(tree, 'tab-bar-list');
const tabNode = (tree, id) => nodes(tree).find((node) => node.key === id);
const moveActions = () => actions.filter((action) => action.type === 'moveTab');

const ignored = stripEvent(50);
list(render()).props.onDragOver(ignored);
assert.ok(!ignored.prevented, 'A file or style dragged over the strip must not be accepted');
list(render()).props.onDrop(stripEvent(50));
assert.strictEqual(moveActions().length, 0);

const startDrag = (id) => tabNode(render(), id).props.onDragStart(stripEvent(0));
startDrag('t1');
assert.ok(tabNode(render(), 't1').props.className.includes('m-dragging'));
let over = stripEvent(50);
list(render()).props.onDragOver(over);
assert.ok(over.prevented, 'A dragged tab must be accepted');
assert.ok(!nodes(render()).some((node) => /m-drop-/.test(node.props && node.props.className)), 'No indicator around the dragged tab');
list(render()).props.onDragOver(stripEvent(280));
assert.ok(tabNode(render(), 't3').props.className.includes('m-drop-after'), 'The gap after the last tab shows on its far edge');
list(render()).props.onDragLeave(stripEvent(120));
assert.ok(tabNode(render(), 't3').props.className.includes('m-drop-after'), 'A move between two tabs must keep the indicator');
list(render()).props.onDragLeave(stripEvent(120, 40));
assert.ok(!tabNode(render(), 't3').props.className.includes('m-drop-after'), 'Leaving the strip must clear the indicator');
list(render()).props.onDrop(stripEvent(280));
assert.deepStrictEqual(moveActions(), [{ type: 'moveTab', id: 't1', slot: 3 }]);
assert.ok(!tabNode(render(), 't1').props.className.includes('m-dragging'), 'A drop must end the drag');

startDrag('t3');
list(render()).props.onDragOver(stripEvent(120));
assert.ok(tabNode(render(), 't2').props.className.includes('m-drop-before'));
tabNode(render(), 't3').props.onDragEnd();
assert.ok(!tabNode(render(), 't2').props.className.includes('m-drop-before'), 'A cancelled drag must clear the indicator');
assert.strictEqual(moveActions().length, 1, 'A cancelled drag must not move the tab');

// In Arabic the first tab sits on the right
textDirection = 'rtl';
startDrag('t3');
list(render()).props.onDrop(stripEvent(280));
assert.deepStrictEqual(moveActions()[1], { type: 'moveTab', id: 't3', slot: 0 });
textDirection = 'ltr';

// A tab being renamed keeps the mouse for its text
assert.strictEqual(tabNode(render(), 't1').props.draggable, true);
tabNode(render(), 't1').props.onDoubleClick();
assert.strictEqual(tabNode(render(), 't1').props.draggable, false);
find(render(), 'tab-bar-rename-input').props.onKeyDown({ key: 'Escape' });
context.state.tabs = [{ id: 't1', name: 'One' }];
assert.strictEqual(tabNode(render(), 't1').props.draggable, false, 'A single tab has nowhere to go');

// A plain blur still saves.
firstTab(render()).props.onDoubleClick();
input = find(render(), 'tab-bar-rename-input');
input.props.onChange({ target: { value: 'Blurred' } });
find(render(), 'tab-bar-rename-input').props.onBlur();
assert.strictEqual(renameActions().length, 2);
assert.strictEqual(renameActions()[1].name, 'Blurred');
console.log('Tab bar rename tests passed');
