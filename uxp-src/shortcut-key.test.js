const {test} = require('node:test');
const assert = require('node:assert/strict');
const {keyToken, keysFromEvent} = require('./shortcut-key');

test('settings symbols use the stored shortcut names', () => {
  assert.equal(keyToken('+'), 'PLUS');
  assert.equal(keyToken('-'), 'MINUS');
  assert.equal(keyToken('='), 'EQUAL');
  assert.equal(keyToken('/'), 'DIVIDE');
  assert.equal(keyToken('*'), 'MULTIPLY');
  assert.equal(keyToken(' '), 'SPACE');
  assert.equal(keyToken('f5'), 'F5');
  assert.equal(keyToken('ArrowLeft'), 'ARROWLEFT');
  assert.equal(keyToken('Meta'), '');
});

test('event capture matches the settings field', () => {
  assert.deepEqual(keysFromEvent({type: 'keydown', metaKey: true, ctrlKey: true, altKey: false, shiftKey: false, key: 'Control'}), ['WIN', 'CTRL']);
  assert.deepEqual(keysFromEvent({type: 'keydown', metaKey: false, ctrlKey: true, altKey: false, shiftKey: true, key: '+'}), ['CTRL', 'SHIFT', 'PLUS']);
  assert.deepEqual(keysFromEvent({type: 'keydown', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, key: 'b'}), ['WIN', 'B']);
});
