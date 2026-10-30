const assert = require('assert');
const React = require('react');
const slots = [];
let cursor = 0;
const hooks = {
  ...React,
  memo: (fn) => fn,
  useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  },
  useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  },
  useMemo(factory) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = factory();
    return slots[index];
  },
  useEffect() { cursor++; },
};
const scans = [];
const context = { state: { folders: [], openFolders: [] }, dispatch() {} };
const load = require('./helpers/loadAppModule')({
  react: hooks,
  './fontScanR.scss': {},
  '../../modalClose': { useModalClose() {} },
  '../../utils': {
    locale: new Proxy({}, { get: (target, key) => (typeof key === 'string' ? key : undefined) }), nativeAlert() {}, getStyleObject: () => ({}), rgbToHex: () => '#000',
    getUserFonts: () => [], scanPsdFonts: (file, callback) => scans.push({ file, callback }),
  },
  '../../context': { useContext: () => context },
  '../../useFontFinderMatches': () => ({ available: false, entries: {}, busy: false, install() {}, foundKeys: [], isUnmatched: () => false }),
  './fontFinderSuggestion': { FontFinderBanner: () => null, FontFinderSuggestion: () => null, FontWebSearchButton: () => null },
});
const Modal = load('app_src/components/modal/fontScanR.jsx').default;
const render = () => { cursor = 0; return Modal(); };
const nodes = (tree) => {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.reduce((all, child) => all.concat(nodes(child)), []);
  return [tree].concat(nodes(tree.props && tree.props.children));
};
const fileInput = (tree) => nodes(tree).find((node) => node.type === 'input' && node.props.type === 'file');
const pick = (names) => fileInput(render()).props.onChange({ target: { files: names.map((name) => ({ name, path: '/p/' + name })) } });
const cancelButton = (tree) => nodes(tree).find((node) => node.type === 'button' && node.props.onClick && node.props.onClick.name === 'cancelScan');

pick(['a1.psd', 'a2.psd']);
assert.deepStrictEqual(scans.map((scan) => scan.file), ['/p/a1.psd']);
const cancel = cancelButton(render());
assert(cancel, 'scan view must offer a cancel button');
cancel.props.onClick();
pick(['b1.psd']);
assert.deepStrictEqual(scans.map((scan) => scan.file), ['/p/a1.psd', '/p/b1.psd']);
// The cancelled scan's host reply arrives late: it must not resume scanning a2.
scans[0].callback({ layers: [] });
assert.deepStrictEqual(scans.map((scan) => scan.file), ['/p/a1.psd', '/p/b1.psd']);
scans[1].callback({ layers: [] });
assert.strictEqual(scans.length, 2);
console.log('FontScanR cancel/rescan tests passed');
