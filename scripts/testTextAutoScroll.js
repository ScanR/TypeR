const assert = require('assert');
const React = require('react');
const fs = require('fs');
const vm = require('vm');
const effects = [];
const calls = [];
let cancelled = 0;
let state = { interpretMarkdown: false, text: 'First\nSecond', lines: [], images: [], currentLineIndex: 1, autoScrollText: false };
const load = require('./helpers/loadAppModule')({
  react: { ...React, memo: fn => fn, useMemo: fn => fn(), useCallback: fn => fn,
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
    useRef: value => ({ current: value }), useEffect: (fn, deps) => effects.push({fn, deps}), useLayoutEffect() {},
  },
  './textBlock.scss': {},
  '../../whatsNewSession': { practiceTabIds: () => [], whatsNewSession: { active: false } },
  '../../utils': { locale: {}, resizeTextArea() {}, scrollToLine: (...args) => { calls.push(args); return () => cancelled++; } },
  '../../context': { useContext: select => ({ state: select(state), dispatch() {} }) },
  '../../perfDebug': { notePerfRender() {} },
});
const Component = load('app_src/components/textBlock/textBlock.jsx').default;
const scrollEffect = () => {
  effects.length = 0; Component();
  const effect = effects.find(e => String(e.fn).includes('scrollToLine'));
  assert(effect, 'exercise the actual TextBlock scrolling effect');
  return effect;
};
assert.strictEqual(scrollEffect().fn(), undefined);
assert.deepStrictEqual(calls, [], 'TextBlock must not bypass the disabled preference');
state = { ...state, autoScrollText: true };
const enabled = scrollEffect();
assert.deepStrictEqual(enabled.deps, [1, true]);
const cleanup = enabled.fn();
assert.deepStrictEqual(calls, [[1, 1000]], 'enabled scrolling still runs after layout settles');
cleanup(); assert.equal(cancelled, 1);
state = { ...state, autoScrollText: false, currentLineIndex: 0 };
assert.strictEqual(scrollEffect().fn(), undefined);
assert.equal(calls.length, 1);

// Real scrolling implementation: effect cleanup cancels both delayed work and
// a frame already queued after the first scroll.
const source = fs.readFileSync(require.resolve('../app_src/utils.js'), 'utf8');
const timers = new Map(), frames = [];
let tick = 0, top = 0, writes = 0;
const sheet = { set scrollTop(value) { top = value; writes++; } };
const rows = { parentElement: sheet, querySelector: () => ({ offsetTop: 120 }) };
const context = { document: { querySelector: () => rows },
  setTimeout: fn => { timers.set(++tick, fn); return tick; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => frames.push(fn) };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const SCROLL_CONTEXT_LINES'), source.indexOf('const scrollToStyle')) + '\nthis.scrollToLine = scrollToLine;', context);
const cancel = context.scrollToLine(8, 1000); cancel();
for (const fn of timers.values()) fn(); timers.clear();
assert.equal(writes, 0, 'disable before timeout must cancel the pending automatic scroll');
const stopFrame = context.scrollToLine(8, 1000);
for (const fn of timers.values()) fn(); timers.clear();
assert.equal(top, 120); assert.equal(writes, 1);
stopFrame(); frames.forEach(fn => fn()); assert.equal(writes, 1);
console.log('TextBlock auto-scroll: disabled/enabled effect and pending work cleanup passed');

// Five raw lines can exceed the viewport when dialogue wraps. Exercise both
// mounted rows and the layout fallback used for a distant virtualized row.
const flush = () => {
  for (const fn of timers.values()) fn();
  timers.clear();
  frames.splice(0).forEach(fn => fn());
};
sheet.clientHeight = 140;
rows.querySelector = selector => ({ offsetTop: 4 + Number(selector.match(/"(\d+)"/)[1]) * 153 });
context.scrollToLine(81); flush();
assert.equal(top, 4 + 81 * 153 - 70, 'wrapped context must leave the current line visible');
rows.querySelector = () => null;
rows.__typerRowLayout = { offsets: Array.from({ length: 500 }, (_, i) => i * 153) };
context.getComputedStyle = () => ({ paddingTop: '4px' });
context.scrollToLine(400); flush();
assert.equal(top, 4 + 400 * 153 - 70, 'unmounted current row uses the same viewport limit');
sheet.clientHeight = 460;
rows.__typerRowLayout = { offsets: Array.from({ length: 500 }, (_, i) => i * 17) };
context.scrollToLine(81); flush();
assert.equal(top, 4 + 76 * 17, 'retain five context rows when they fit');

const scrolls = [];
const loadContext = require('./helpers/loadAppModule')({
  './utils': { locale: {}, readStorage: () => ({ data: {
    text: 'First\nLast on page\nPage 2\nNext page', images: [{ path: '1.psd' }],
  } }), writeToStorage() {}, scrollToLine: index => scrolls.push(index), scrollToStyle() {}, nativeAlert() {} },
  './lib/themeManager': { applyThemeState() {} },
  './perfDebug': { perfMeasure: (a, b, fn) => fn() },
  './themePresets': { normalizeCustomThemes: x => x || [], normalizeEditorTheme: x => x || 'system', setCustomEditorThemes: x => x },
  './backgroundImage': { normalizeBackgroundImage: x => x || null },
});
const { baseReducer, initialState } = loadContext('app_src/context.jsx', 'export { baseReducer, initialState };');
let page = baseReducer(initialState, { type: 'init' });
page = baseReducer(page, { type: 'setCurrentLineIndex', index: 1 });
assert.equal(page.currentLine.last, true);
scrolls.length = 0;
page = baseReducer(page, { type: 'nextLine', add: true });
assert.equal(page.currentLineIndex, 1, 'a paste must not cross a linked page boundary');
assert.deepStrictEqual(scrolls, [1], 'a successful page-ending paste must still reveal the line');
page = baseReducer(page, { type: 'setAutoScrollText', value: false });
scrolls.length = 0;
baseReducer(page, { type: 'nextLine', add: true });
assert.deepStrictEqual(scrolls, [], 'page-ending pastes respect the preference');
console.log('Script auto-scroll: wrapped context, virtualized rows and linked page boundaries passed');
