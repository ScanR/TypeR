const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const original = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'photoshop') return {action: {}, core: {}};
  if (request === 'uxp') return {storage: {localFileSystem: {}, formats: {}}};
  return original.call(this, request, ...rest);
};
const {parseKeys} = require('./global-keys');
Module._load = original;

test('helper lines drop the heartbeat before reaching the panel', () => {
  assert.deepEqual(parseKeys('aWINaSHIFTaKa|42\n'), {state: 'aWINaSHIFTaKa', beat: '42'});
});

test('ScriptUI lines have no heartbeat', () => {
  assert.deepEqual(parseKeys('aCTRLa'), {state: 'aCTRLa', beat: null});
});

test('empty or bare heartbeat reads as no key', () => {
  assert.deepEqual(parseKeys(''), {state: 'a', beat: null});
  assert.deepEqual(parseKeys('|7'), {state: 'a', beat: '7'});
});

test('a bar key is not mistaken for the heartbeat', () => {
  assert.deepEqual(parseKeys('a|a'), {state: 'a|a', beat: null});
  assert.deepEqual(parseKeys('a|a|9'), {state: 'a|a', beat: '9'});
});

const {createWatchdog, STALL_MS} = require('./global-keys');

test('a modal-state failure at boot retries the helper, never ScriptUI at once', () => {
  const dog = createWatchdog(0);
  assert.equal(dog.shouldStart(0), true);
  dog.started(0, false);
  assert.equal(dog.scriptUI(), false);
  assert.equal(dog.shouldStart(500), false);
  assert.equal(dog.shouldStart(2500), true);
});

test('a beating helper is left alone, a frozen one is restarted', () => {
  const dog = createWatchdog(0);
  dog.started(0, true);
  for (let t = 1000; t <= 20000; t += 1000) {
    dog.read(String(t), t);
    assert.equal(dog.shouldStart(t), false);
  }
  assert.equal(dog.shouldStart(20000 + STALL_MS + 1), true);
  assert.equal(dog.scriptUI(), false);
});

test('ScriptUI only once the helper never beat after several launches', () => {
  const dog = createWatchdog(0);
  let t = 0;
  for (let i = 0; i < 3; i++) { dog.started(t, true); t += 60000; }
  assert.equal(dog.scriptUI(), false);
  dog.started(t, true);
  dog.state.running = false;
  assert.equal(dog.scriptUI(), true);
  dog.read('1', t + 1);
  assert.equal(dog.scriptUI(), false);
});

test('a helper that once beat never falls back to ScriptUI', () => {
  const dog = createWatchdog(0);
  dog.started(0, true);
  dog.read('1', 100);
  for (let i = 0; i < 10; i++) dog.started(i * 60000, false);
  assert.equal(dog.scriptUI(), false);
});

const {helperCommand, helperScript, HELD_STALE_MS} = require('./global-keys');

test('the launch line never kills a pid read from a file', () => {
  const cmd = helperCommand('/data/typer-keys', '/data/keys.txt');
  assert.doesNotMatch(cmd, /kill "\$\(cat/);
  assert.match(cmd, /^rm -f '\/data\/keys\.txt\.pid' ; /);
  assert.match(cmd, /'\/data\/typer-keys' '\/data\/keys\.txt' "\$PPID" >\/dev\/null 2>&1 &$/);
});

test('paths cannot break out of their shell or JSX quoting', () => {
  const evil = "/Users/o'neil/$(touch pwned)\"; `id`/typer-keys";
  const cmd = helperCommand(evil, '/k');
  // Every occurrence is one single-quoted word, the only escape being '\''
  const quoted = "'" + evil.replace(/'/g, "'\\''") + "'";
  assert.equal(cmd.split(quoted).length - 1, 4);
  assert.equal(cmd.replaceAll(quoted, 'P').includes('$('), false);
  const script = helperScript(evil, '/k');
  const inner = /^app\.system\((.*)\);$/.exec(script);
  assert.ok(inner);
  assert.equal(JSON.parse(inner[1]), cmd);
});

test('a dead helper\'s last held state is released, a live one is kept', () => {
  const dog = createWatchdog(0);
  dog.started(0, true);
  assert.equal(dog.stale(HELD_STALE_MS + 1), false, 'no beat yet: nothing to call stale');
  dog.read('1', 1000);
  assert.equal(dog.stale(1000 + HELD_STALE_MS), false);
  assert.equal(dog.stale(1000 + HELD_STALE_MS + 1), true);
  dog.read('2', 5000);
  assert.equal(dog.stale(5001), false);
  assert.ok(HELD_STALE_MS < STALL_MS, 'keys are released before the restart');
});
