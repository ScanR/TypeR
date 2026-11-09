// UXP panel: the init request to the plugin host. An answer that comes after
// the next request was sent must still start the panel (Photoshop's start,
// "the plugin host does not answer" while the host answered every request).
const assert = require("assert");
const createLoader = require("./helpers/loadAppModule");

const { requestInit, INIT_DEADLINE_MS } = createLoader()("uxp-src/web/initRequest.js");

// A fake clock: timers run in time order when the clock moves
function createClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: time + delay, callback });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        await new Promise((resolve) => setImmediate(resolve));
        let next = null;
        for (const [id, timer] of timers) if (timer.at <= end && (!next || timer.at < next[1].at)) next = [id, timer];
        if (!next) break;
        timers.delete(next[0]);
        time = next[1].at;
        next[1].callback();
      }
      time = end;
      await new Promise((resolve) => setImmediate(resolve));
    },
    pending: () => timers.size,
  };
}

// A host that answers every request after `latency` ms (null: never)
function createHost(clock, latency, result = { files: {} }) {
  const host = { requests: 0, readies: 0 };
  host.notify = (type) => { if (type === "ready") host.readies++; };
  host.request = (method) => {
    assert.strictEqual(method, "init");
    host.requests++;
    if (latency === null) return new Promise(() => {});
    return new Promise((resolve) => clock.setTimer(() => resolve(result), latency));
  };
  return host;
}

async function settle(promise) {
  let state = { done: false };
  promise.then((value) => { state = { done: true, value }; }, (error) => { state = { done: true, error }; });
  await new Promise((resolve) => setImmediate(resolve));
  return () => state;
}

(async () => {
  // Every answer takes 1.4 s: the first one starts the panel
  {
    const clock = createClock();
    const payload = { files: { storage: "{}" } };
    const host = createHost(clock, 1400, payload);
    const state = await settle(requestInit({ request: host.request, notify: host.notify, setTimer: clock.setTimer, clearTimer: clock.clearTimer }));
    await clock.advance(1399);
    assert.strictEqual(state().done, false);
    await clock.advance(1);
    assert.deepStrictEqual(state(), { done: true, value: payload });
    assert.strictEqual(host.requests, 2, "a second request went out at 1 s");
    assert.strictEqual(clock.pending(), 1, "only the second answer's own timer is left");
  }

  // Answers slower than every retry interval still start the panel
  {
    const clock = createClock();
    const host = createHost(clock, 7000);
    const state = await settle(requestInit({ request: host.request, notify: host.notify, setTimer: clock.setTimer, clearTimer: clock.clearTimer }));
    await clock.advance(7000);
    assert.strictEqual(state().done, true);
    assert.ok(!state().error);
  }

  // A host that never answers: a few requests, spaced out, then init-timeout
  {
    const clock = createClock();
    const host = createHost(clock, null);
    const state = await settle(requestInit({ request: host.request, notify: host.notify, setTimer: clock.setTimer, clearTimer: clock.clearTimer }));
    await clock.advance(INIT_DEADLINE_MS - 1);
    assert.strictEqual(state().done, false);
    await clock.advance(1);
    const { error } = state();
    assert.ok(error, "the request fails at the deadline");
    assert.strictEqual(error.reason, "init-timeout");
    assert.match(error.message, /the plugin host does not answer/);
    assert.strictEqual(host.requests, 16, "5 requests a second apart, then one every 5 s");
    assert.strictEqual(host.readies, host.requests);
    assert.strictEqual(clock.pending(), 0);
  }

  // A host that rejects init fails at once, with its own message
  {
    const clock = createClock();
    const state = await settle(requestInit({
      request: () => Promise.reject(new Error("storage unreadable")), notify: () => {},
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    }));
    await clock.advance(0);
    assert.strictEqual(state().error.message, "storage unreadable");
    assert.strictEqual(clock.pending(), 0);
  }

  // A bridge that throws (no host yet) is a failed request too
  {
    const clock = createClock();
    const state = await settle(requestInit({
      request: () => { throw new Error("TypeR: the plugin host is not reachable"); }, notify: () => {},
      setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    }));
    await clock.advance(0);
    assert.match(state().error.message, /not reachable/);
  }

  console.log("UXP init request tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
