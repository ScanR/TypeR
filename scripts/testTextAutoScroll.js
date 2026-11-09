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
