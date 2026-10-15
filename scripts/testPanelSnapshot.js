const assert = require("assert");
const load = require("./helpers/loadAppModule")();
const { createPanelSnapshotQueue } = load("app_src/components/previewBlock/panelSnapshot.js");

// Manual timers so the failsafe can be driven deterministically
const createClock = () => {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimer: (fn, delay) => { const id = nextId++; timers.set(id, { fn, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    run(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.fn();
      }
    },
  };
};

const setup = () => {
  const clock = createClock();
  const calls = [];
  const request = createPanelSnapshotQueue((script, callback) => calls.push({ script, callback }), {
    timeout: 15000, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  });
  return { clock, calls, request };
};

// Normal flow: concurrent requests share one host call
{
  const { clock, calls, request } = setup();
  const results = [];
  request("sig", (s) => results.push(["a", s]));
  request("", (s) => results.push(["b", s]));
  clock.run(0);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].script.includes('"signature":"sig"'));
  calls[0].callback(JSON.stringify({ layers: [{ id: 1 }] }));
  assert.deepStrictEqual(results.map((r) => r[0]), ["a", "b"]);
  assert.deepStrictEqual(results[0][1].layers, [{ id: 1 }]);
}

// A lost callback is released by the failsafe and its callers are retried
{
  const { clock, calls, request } = setup();
  const results = [];
  request("old", (s) => results.push(["lost", s]));
  clock.run(0);
  request("", (s) => results.push(["queued", s]));
  clock.run(0);
  assert.strictEqual(calls.length, 1, "queued requests wait for the in-flight one");
  clock.run(15000);
  clock.run(0);
  assert.strictEqual(calls.length, 2, "the failsafe unblocks the queue");
  assert.ok(calls[1].script.includes('"signature":"old"'));
  // The late answer of the released request is ignored
  calls[0].callback(JSON.stringify({ layers: [{ id: 9 }] }));
  assert.strictEqual(results.length, 0);
  calls[1].callback(JSON.stringify({ layers: [{ id: 2 }] }));
  assert.deepStrictEqual(results.map((r) => [r[0], r[1].layers[0].id]), [["lost", 2], ["queued", 2]]);
  // Answered requests clear their failsafe
  clock.run(15000);
  clock.run(0);
  assert.strictEqual(calls.length, 2);
}

// Malformed host output still answers callers with an empty snapshot
{
  const { clock, calls, request } = setup();
  let got = null;
  request("", (s) => { got = s; });
  clock.run(0);
  calls[0].callback("scriptError: boom");
  assert.deepStrictEqual(got, { activeLayer: null, selection: null, layers: [] });
}

console.log("panel snapshot queue tests passed");
