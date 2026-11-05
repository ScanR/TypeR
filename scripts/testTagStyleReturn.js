const assert = require('assert');

// A script tag sets the style of its own line only: the next line without a
// tag goes back to the style in use before it (main → SFX → main)
const styles = [
  { id: 'main', name: 'Main', prefixes: [], textProps: {} },
  { id: 'other', name: 'Other', prefixes: [], textProps: {} },
  { id: 'sfx', name: 'SFX', prefixes: ['*'], textProps: {} },
  { id: 'shout', name: 'Shout', prefixes: ['!'], textProps: {} },
];
const { reducer, initial } = require('./helpers/loadContext')({ styles });
const script = (text) => {
  let state = reducer(initial, { type: 'setText', text });
  state = reducer(state, { type: 'setCurrentStyleId', id: 'main' });
  return state;
};
const walk = (state, steps) => {
  const seen = [state.currentStyleId];
  for (let i = 0; i < steps; i++) {
    state = reducer(state, { type: 'nextLine', add: true });
    seen.push(state.currentStyleId);
  }
  return { state, seen };
};

assert.strictEqual(initial.styles.length, 4, 'test styles loaded');

// Main → SFX → main
let { seen } = walk(script('Hello.\n*BOOM\nWhat was that?'), 2);
assert.deepStrictEqual(seen, ['main', 'sfx', 'main']);

// Two tags in a row, then back to the style from before the first one
({ seen } = walk(script('Hello.\n*BOOM\n!RUN!\nThey left.'), 3));
assert.deepStrictEqual(seen, ['main', 'sfx', 'shout', 'main']);

// A // continuation keeps the tag's style, the line after goes back
({ seen } = walk(script('Hello.\n*BOOM\n// CRASH\nQuiet now.'), 3));
assert.deepStrictEqual(seen, ['main', 'sfx', 'sfx', 'main']);

// A style picked by hand on a tagged line stays
let state = script('Hello.\n*BOOM\nWhat was that?');
state = reducer(state, { type: 'nextLine', add: true });
assert.strictEqual(state.currentStyleId, 'sfx');
state = reducer(state, { type: 'setCurrentStyleId', id: 'other' });
state = reducer(state, { type: 'nextLine', add: true });
assert.strictEqual(state.currentStyleId, 'other', 'manual choice kept');

// A default style still wins on untagged lines
state = script('Hello.\n*BOOM\nWhat was that?');
state = reducer(state, { type: 'setDefaultStyleId', id: 'other' });
state = reducer(state, { type: 'setCurrentStyleId', id: 'main' });
({ seen } = walk(state, 2));
assert.deepStrictEqual(seen.slice(1), ['sfx', 'other']);

// Going back with prevLine over a tag works the same way
state = walk(script('Hello.\n*BOOM\nWhat was that?'), 2).state;
state = reducer(state, { type: 'prevLine' });
assert.strictEqual(state.currentStyleId, 'sfx');
state = reducer(state, { type: 'prevLine' });
assert.strictEqual(state.currentStyleId, 'main');

console.log('tag style return tests passed');
