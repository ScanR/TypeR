const assert = require("assert");
const { createReader, parseSnapshot } = require("../uxp-src/host/keysAddon")._internals;

function snapshot(patch = {}) {
  return JSON.stringify(Object.assign({ apiVersion: 1, foreground: true, state: "a", mouseDown: 0, mousePressed: 0, mouseModifiers: "" }, patch));
}

function fixture() {
  let next = snapshot();
  let callback = null;
  let loads = 0;
  const states = [], lines = [], errors = [];
  const reader = createReader({
    loadAddon: () => { loads++; return { readSnapshot: () => { if (next instanceof Error) throw next; return next; } }; },
    setState: state => states.push(state),
    schedule: (fn, ms) => { assert.strictEqual(ms, 25); assert.strictEqual(callback, null); callback = fn; return 1; },
    cancel: id => { assert.strictEqual(id, 1); callback = null; },
    reportError: (...args) => errors.push(args),
  });
  return { reader, states, lines, errors, start: () => reader.start(line => lines.push(line)),
    tick: patch => { next = patch instanceof Error ? patch : snapshot(patch); assert(callback); callback(); },
    get running() { return callback !== null; }, get loads() { return loads; } };
}

// Native polling needs no DOM event and no focus on the UXP panel.
async function main() {
const f = fixture();
assert(await f.start());
f.tick({ state: "aCTRLaKa" });
assert.strictEqual(f.states.at(-1), "aCTRLaKa");
assert.strictEqual(f.reader.diagnostics().state, "aCTRLaKa");
assert.strictEqual(f.reader.diagnostics().lastKeys, "aCTRLaKa");
assert.strictEqual(f.reader.diagnostics().samples, 2);
assert(f.reader.diagnostics().sampledAt > 0);
f.tick({});
assert.strictEqual(f.reader.diagnostics().state, "a", "Releases clear the live display");
assert.strictEqual(f.reader.diagnostics().lastKeys, "aCTRLaKa", "A short press stays readable after release");
f.tick({ state: "aSHIFTaLEFTaARROWLEFTa" });
assert.strictEqual(f.states.at(-1), "aSHIFTaLEFTaARROWLEFTa");
assert(await f.start());
assert.strictEqual(f.loads, 1, "Repeated start must not duplicate polling");

// No repeats for held buttons; both side buttons and modifiers survive the bridge.
f.tick({ mouseDown: 1, mousePressed: 1, mouseModifiers: "WCAS" });
f.tick({ mouseDown: 1, mousePressed: 1, mouseModifiers: "WCAS" });
assert.deepStrictEqual(f.lines, ["MB|5|WCAS|Photoshop"]);
f.tick({});
f.tick({ mouseDown: 3, mouseModifiers: "C" });
assert.deepStrictEqual(f.lines.slice(-2), ["MB|5|C|Photoshop", "MB|6|C|Photoshop"]);
f.tick({});
f.tick({ mousePressed: 2 });
assert.strictEqual(f.lines.at(-1), "MB|6||Photoshop", "A short click between polls is forwarded when Windows reports it");

// Other apps, loss of focus and stale low bits must not trigger TypeR shortcuts.
const count = f.lines.length;
f.tick({ foreground: false, state: "aCTRLaKa", mousePressed: 3, mouseDown: 3 });
assert.strictEqual(f.states.at(-1), "a");
assert.strictEqual(f.reader.diagnostics().foreground, false);
assert.strictEqual(f.reader.diagnostics().state, "a", "Other applications never appear in diagnostics");
f.tick({ mousePressed: 3, mouseDown: 3 });
f.tick({ mouseDown: 3 });
assert.strictEqual(f.lines.length, count);
f.tick({});
f.tick({ mouseDown: 1 });
assert.strictEqual(f.lines.length, count + 1);

// Fail closed, clear held keys and allow a deliberate restart after failure.
f.tick(new Error("addon unavailable"));
assert(!f.running);
assert.strictEqual(f.states.at(-1), "a");
assert.strictEqual(f.errors.length, 1);
assert.strictEqual(f.reader.access(), "missing");
assert.strictEqual(f.reader.diagnostics().running, false);
assert.strictEqual(f.reader.diagnostics().error, "addon unavailable");
assert.strictEqual(f.reader.diagnostics().state, "a");
f.reader.stop();

const restarting = fixture();
assert(await restarting.start());
restarting.reader.stop();
assert(!restarting.running);
assert(await restarting.start());
assert.strictEqual(restarting.loads, 2);
restarting.reader.stop();

for (const patch of [{ apiVersion: 2 }, { state: null }, { state: "a\nINJECT" }, { foreground: "true" }, { mouseDown: 4 }, { mousePressed: -1 }, { mouseModifiers: "SC" }]) {
  assert.throws(() => parseSnapshot(snapshot(patch)), /Incompatible/);
}
assert.throws(() => parseSnapshot("null"), /Incompatible/);
let neutral = null;
const missing = createReader({ loadAddon: () => { throw new Error("module missing"); }, setState: value => { neutral = value; }, reportError: () => {} });
assert.strictEqual(await missing.start(), false);
assert.strictEqual(neutral, "a");
assert.strictEqual(missing.diagnostics().error, "module missing", "The loading error is visible in settings");
assert.strictEqual(await missing.start(), false, "A synchronous loading failure remains retryable");

// Match Photoshop's asynchronous require(.uxpaddon), not just Node's require.
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let loadingAddon = deferred();
let loads = 0, polls = 0;
const asyncStates = [], asyncErrors = [];
const delayed = createReader({
  loadAddon: () => { loads++; return loadingAddon.promise; },
  setState: value => asyncStates.push(value),
  schedule: () => { polls++; return 1; }, cancel: () => { polls--; },
  reportError: (...args) => asyncErrors.push(args),
});
const native = { readSnapshot: () => snapshot({ state: "aCTRLaKa" }) };
const first = delayed.start();
assert.strictEqual(delayed.start(), first, "Concurrent starts share the pending load");
assert.strictEqual(delayed.diagnostics().loading, true);
assert.strictEqual(delayed.access(), "unknown");
assert.strictEqual(delayed.diagnostics().error, "");
assert.strictEqual(polls, 0, "Do not poll unresolved native exports");
loadingAddon.resolve(native);
assert.strictEqual(await first, true);
assert.strictEqual(loads, 1);
assert.strictEqual(polls, 1);
assert.strictEqual(asyncStates.at(-1), "aCTRLaKa");
assert.strictEqual(delayed.diagnostics().loading, false);
assert.strictEqual(delayed.access(), "granted");
delayed.stop();

loadingAddon = deferred();
const cancelled = delayed.start();
await Promise.resolve();
delayed.stop();
loadingAddon.resolve(native);
assert.strictEqual(await cancelled, false);
assert.strictEqual(polls, 0, "Closing the plugin while loading must not start a timer later");
assert.strictEqual(asyncStates.at(-1), "a");

loadingAddon = deferred();
const oldLoad = loadingAddon;
const oldStart = delayed.start();
await Promise.resolve();
delayed.stop();
loadingAddon = deferred();
const newStart = delayed.start();
loadingAddon.resolve(native);
assert.strictEqual(await newStart, true);
oldLoad.reject(new Error("old load failed"));
assert.strictEqual(await oldStart, false);
assert.strictEqual(delayed.diagnostics().error, "");
assert.strictEqual(polls, 1, "A stale rejection cannot stop the new reader");
delayed.stop();

loadingAddon = deferred();
const rejected = delayed.start();
loadingAddon.reject(new Error("native loader refused the module"));
assert.strictEqual(await rejected, false);
assert.strictEqual(delayed.diagnostics().error, "native loader refused the module");
assert.strictEqual(delayed.diagnostics().loading, false);
assert.strictEqual(polls, 0);
assert.strictEqual(asyncErrors.length, 1);
loadingAddon = deferred();
const retry = delayed.start();
loadingAddon.resolve({});
assert.strictEqual(await retry, false);
assert.match(delayed.diagnostics().error, /missing readSnapshot/);

console.log("UXP addon keyboard bridge: asynchronous loading, cancellation, retries, focus and mouse edges passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
