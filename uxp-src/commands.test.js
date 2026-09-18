const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveShortcutCommand, commandFromActionName} = require('./commands');

test('insert stays insert when a selection is present', () => {
  assert.equal(resolveShortcutCommand('add', {hasSelection: true, hasTextLayer: false}), 'add');
  assert.equal(resolveShortcutCommand('add', {hasSelection: true, hasTextLayer: true}), 'add');
});

test('insert applies the style when only a text layer is active', () => {
  assert.equal(resolveShortcutCommand('add', {hasSelection: false, hasTextLayer: true}), 'apply');
});

test('multi-bubble paste stays insert even without a live selection', () => {
  assert.equal(resolveShortcutCommand('add', {hasSelection: false, hasTextLayer: true, multiBubble: true, storedCount: 3}), 'add');
});

test('other commands keep their identity', () => {
  assert.equal(resolveShortcutCommand('center', {hasSelection: false, hasTextLayer: true}), 'center');
  assert.equal(resolveShortcutCommand('apply', {hasSelection: false, hasTextLayer: true}), 'apply');
  assert.equal(resolveShortcutCommand('next', {hasSelection: false, hasTextLayer: false}), 'next');
});

test('action names map back to commands', () => {
  assert.equal(commandFromActionName('TypeR Insérer'), 'add');
  assert.equal(commandFromActionName('Unknown'), null);
});
