const assert = require('assert');
const load = require('./helpers/loadAppModule')();
const { fetchBody, isNetworkDisabled, setNetworkDisabled } = load('app_src/network.js');
const { EXPORTED_SETTINGS } = load('app_src/librarySerialization.js');

(async () => {
  assert.strictEqual(isNetworkDisabled(), false);
  await assert.rejects(fetchBody('mock', {}, 'json', 10, () => new Promise(() => {})), /requestTimeout/);
  await assert.rejects(fetchBody('mock', {}, 'json', 10, async () => ({ ok: true, json: () => new Promise(() => {}) })), /requestTimeout/);
  await assert.rejects(fetchBody('mock', {}, 'json', 100, async () => ({ ok: false, status: 429 })), /rateLimited/);
  assert.deepStrictEqual(await fetchBody('mock', {}, 'json', 100, async () => ({ ok: true, json: async () => ({ ok: 1 }) })), { ok: 1 });

  let calledWhenDisabled = false;
  setNetworkDisabled(true);
  assert.strictEqual(isNetworkDisabled(), true);
  await assert.rejects(
    fetchBody('https://example.com', {}, 'json', 100, async () => {
      calledWhenDisabled = true;
      return { ok: true, json: async () => ({ ok: 1 }) };
    }),
    /networkDisabled/
  );
  assert.strictEqual(calledWhenDisabled, false);

  setNetworkDisabled(false);
  assert.strictEqual(isNetworkDisabled(), false);
  assert.deepStrictEqual(await fetchBody('mock', {}, 'json', 100, async () => ({ ok: true, json: async () => ({ ok: 2 }) })), { ok: 2 });

  assert.ok(EXPORTED_SETTINGS.includes('disableNetwork'));
  console.log('Network timeout tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
