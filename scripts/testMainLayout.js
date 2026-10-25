const assert = require('assert');
const stub = {};
const load = require('./helpers/loadAppModule')({
  './main.scss': stub,
  react: { memo: (fn) => fn, useRef: () => ({}), useEffect: () => {}, Fragment: 'Fragment', createElement: () => null },
  '../../utils': { readStorage: () => undefined, writeToStorage: () => {}, resizeTextArea: () => {} },
  '../../context': { useContext: () => ({}) },
  '../modal/modal': stub,
  '../textBlock/textBlock': stub,
  '../tabBar/tabBar': stub,
  '../previewBlock/previewBlock': stub,
  '../stylesBlock/stylesBlock': stub,
  '../footer/footer': stub,
  '../../pasteOnClick': stub,
});
const { resolveBottomHeight } = load('app_src/components/main/main.jsx');

assert.strictEqual(resolveBottomHeight(200, 500, 400), 200);
assert.strictEqual(resolveBottomHeight(10, 500, 400), 70);
assert.strictEqual(resolveBottomHeight(900, undefined, 400), 400);
// A stored height from a taller window must be clamped on startup and resize.
assert.strictEqual(resolveBottomHeight(undefined, 900, 400), 400);
assert.strictEqual(resolveBottomHeight(undefined, 20, 400), 70);
assert.strictEqual(resolveBottomHeight(undefined, undefined, 400), 70);
assert.strictEqual(resolveBottomHeight(undefined, 'garbage', 400), 70);
console.log('Main layout height tests passed');
