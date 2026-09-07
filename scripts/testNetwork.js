const assert = require('assert');
const { fetchBody } = require('./helpers/loadAppModule')()('app_src/network.js');
(async () => {
  await assert.rejects(fetchBody('mock', {}, 'json', 10, () => new Promise(() => {})), /requestTimeout/);
  await assert.rejects(fetchBody('mock', {}, 'json', 10, async () => ({ ok: true, json: () => new Promise(() => {}) })), /requestTimeout/);
  await assert.rejects(fetchBody('mock', {}, 'json', 100, async () => ({ ok: false, status: 429 })), /rateLimited/);
  assert.deepStrictEqual(await fetchBody('mock', {}, 'json', 100, async () => ({ ok: true, json: async () => ({ ok: 1 }) })), { ok: 1 });
  console.log('Network timeout tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
