const assert = require('assert');
const { createStartupLoader } = require('../uxp-src/host/startupFiles');

const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ answers }) {
  let clock = 0;
  const timers = new Map();
  let nextTimer = 1;
  const reports = [];
  const calls = [];
  const loader = createStartupLoader({
    load: step => {
      const index = calls.length;
      step('folders');
      return new Promise((resolve, reject) => calls.push({ index, resolve, reject, step }));
    },
    report: text => reports.push(text),
    describe: () => 'keyboard addon loading',
    now: () => clock,
    setTimer: (callback, ms) => { const id = nextTimer++; timers.set(id, { callback, at: clock + ms }); return id; },
    clearTimer: id => timers.delete(id),
    slowMs: 5000,
    restartMs: 15000,
  });
  const advance = ms => {
    clock += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.callback(); }
  };
  return { loader, calls, reports, advance, answers };
}

(async () => {
  // Requests every second share one reading
  {
    const h = harness({});
    const results = [];
    for (let i = 0; i < 5; i++) { h.loader.get().then(value => results.push(value)); h.advance(900); }
    await flush();
    assert.strictEqual(h.calls.length, 1, 'requests within the restart delay share one reading');
    h.calls[0].resolve({ files: 1 });
    await flush();
    assert.deepStrictEqual(results, [{ files: 1 }, { files: 1 }, { files: 1 }, { files: 1 }, { files: 1 }]);
    assert.deepStrictEqual(await h.loader.get(), { files: 1 }, 'a later request gets the files read');
    assert.strictEqual(h.calls.length, 1);
    assert.strictEqual(h.reports.length, 0, 'a fast reading writes nothing to the log');
  }

  // A reading that never answers: logged with its step, then started again
  {
    const h = harness({});
    const results = [];
    h.loader.get().then(value => results.push(value));
    await flush();
    h.advance(5000);
    assert.strictEqual(h.reports.length, 1);
    assert.match(h.reports[0], /still not read after 5000 ms/);
    assert.match(h.reports[0], /folders for 5000 ms \(waiting\)/);
    assert.match(h.reports[0], /keyboard addon loading/);
    for (let i = 0; i < 9; i++) { h.loader.get().then(value => results.push(value)); h.advance(1000); }
    await flush();
    assert.strictEqual(h.calls.length, 1, 'no new reading before the restart delay');
    h.advance(1000);
    h.loader.get().then(value => results.push(value));
    await flush();
    assert.strictEqual(h.calls.length, 2, 'a reading started 15 s ago is started again');
    assert(h.reports.some(text => /reading them again \(attempt 2\)/.test(text)));
    h.calls[1].resolve({ files: 2 });
    await flush();
    assert.strictEqual(results.length, 11, 'the second reading answers every waiting request');
    assert(results.every(value => value.files === 2));
    assert(h.reports.some(text => /panel files read in \d+ ms, attempt 2/.test(text)));
    // The first reading finishing late changes nothing
    h.calls[0].resolve({ files: 1 });
    await flush();
    assert.deepStrictEqual(await h.loader.get(), { files: 2 });
    h.loader.answered();
    assert.match(h.loader.summary(), /init requests 12; answers 1/);
    assert.match(h.loader.summary(), /attempt 1: start 0 ms, folders 15000 ms; attempt 2/);
  }

  // A failure is reported to the requests once no other reading can answer
  {
    const h = harness({});
    let failure = null;
    h.loader.get().catch(error => { failure = error; });
    await flush();
    h.advance(15000);
    h.loader.get().catch(() => {});
    await flush();
    assert.strictEqual(h.calls.length, 2);
    h.calls[0].reject(new Error('disk'));
    await flush();
    assert.strictEqual(failure, null, 'the second reading may still answer');
    h.calls[1].reject(new Error('disk again'));
    await flush();
    assert(failure && /disk/.test(failure.message));
    // The next request starts over
    const next = h.loader.get();
    await flush();
    assert.strictEqual(h.calls.length, 3);
    h.calls[2].resolve({ files: 3 });
    assert.deepStrictEqual(await next, { files: 3 });
  }

  // The summary names a reading still waiting and no answer
  {
    const h = harness({});
    h.loader.get();
    await flush();
    h.advance(60000);
    const summary = h.loader.summary();
    assert.match(summary, /init requests 1; answers 0;/);
    assert.match(summary, /folders for 60000 ms \(waiting\)/);
  }

  console.log('UXP startup files tests passed');
})().catch(error => { console.error(error); process.exit(1); });
