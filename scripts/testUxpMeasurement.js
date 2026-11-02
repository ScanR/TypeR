const assert = require('assert');
const fs = require('fs');
const path = require('path');
const createLoader = require('./helpers/loadAppModule');
const copy = value => JSON.parse(JSON.stringify(value));

// Exercise the real modal/history wrapper and JAM conversion against an
// action simulator that stops on errors, converts text and restores history.
const sim = { calls: [], writes: [], layers: [], active: 1, modal: false, failure: null, omitBounds: false };
const doc = { id: 10, width: 1000, height: 1400, resolution: 72 };
const current = () => sim.layers.find(layer => layer.id === sim.active);
const bounds = { left: 480, top: 680, right: 520, bottom: 705 };
const shape = text => {
  const leading = text.textStyleRange[0].textStyle.leading;
  const step = leading._value * (leading._unit === 'pixelsUnit' ? 1 : doc.resolution / 72);
  const rows = text.textKey.replace(/\r$/, '').split('\r');
  const xy = (x, y) => ({ horizontal: { _unit: 'pixelsUnit', _value: x }, vertical: { _unit: 'pixelsUnit', _value: y } });
  return { pathContents: { pathComponents: [{ subpathListKey: rows.map((_, row) => ({
    points: [[480, 680], [520, 680], [520, 705], [480, 705]].map(([x, y]) => ({ anchor: xy(x, y + row * step) })),
  })) }] } };
};
const execute = command => {
  const target = command._target[0];
  const kind = command._obj === 'make' && target._ref === 'contentLayer' ? 'convert' : command._obj;
  if (sim.failure === kind) {
    sim.failure = null;
    return { _obj: 'error', result: -1, message: 'Injected ' + kind + ' failure' };
  }
  if (kind === 'make') {
    const layer = { id: ++sim.nextId, kind: 'text', text: copy(command.using) };
    sim.layers.push(layer);
    sim.active = layer.id;
  } else if (kind === 'set' || kind === 'convert' || kind === 'delete') {
    sim.writes.push(sim.active);
    assert.ok(sim.active > 1, 'Never modify the user layer');
    if (kind === 'set') {
      assert.strictEqual(current().kind, 'text');
      current().text = copy(command.to);
    } else if (kind === 'convert') current().kind = 'shape';
    else { sim.layers.pop(); sim.active = sim.layers[sim.layers.length - 1].id; }
  } else if (kind === 'get') {
    if (target._ref === 'path') return shape(current().text);
    if (sim.omitBounds && target._property === 'boundsNoEffects') return {};
    return { [target._property]: bounds };
  } else assert.fail('Unexpected command ' + kind);
  return {};
};
const ps = {
  app: { documents: [doc], activeDocument: doc }, constants: { LayerKind: {} },
  action: { batchPlay(commands, options) {
    assert.ok(sim.modal, 'Measurements must stay modal');
    assert.strictEqual(options.synchronousExecution, true);
    sim.calls.push(copy(commands));
    const results = [];
    for (const command of commands) {
      assert.strictEqual(command._options.dialogOptions, 'silent');
      const result = execute(command);
      results.push(result);
      if (result._obj === 'error' && !options.continueOnError) break;
    }
    if (sim.truncate) { sim.truncate = false; results.pop(); }
    return results;
  } },
  core: { async executeAsModal(fn) {
    sim.modal = true;
    try {
      return await fn({ hostControl: {
        async suspendHistory({ documentID }) {
          assert.strictEqual(documentID, doc.id);
          sim.snapshot = copy({ layers: sim.layers, active: sim.active });
          return 7;
        },
        async resumeHistory(id, commit) {
          assert.strictEqual(id, 7);
          assert.strictEqual(commit, false, 'Measurement must always roll back');
          Object.assign(sim, sim.snapshot);
          sim.rollbacks++;
        },
      } });
    } finally { sim.modal = false; }
  } },
};
const filename = path.resolve(__dirname, '../uxp-src/host/photoshop.js');
const port = { exports: {} };
new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(name => {
  if (name === 'photoshop') return ps;
  if (name === 'uxp') return { storage: { localFileSystem: {} } };
  return require(path.resolve(path.dirname(filename), name));
}, port, port.exports);
const load = createLoader({ photoshop: ps, './photoshop': port.exports });
const smart = load('uxp-src/host/smartPaste.js');
const { atlasParams, atlasMetrics, lineParams, measureEdges, clearMetricCache } = load('app_src/oneClick/measureSpec.js');
const style = { typeUnit: 'pixelsUnit', layerText: {
  textStyleRange: [{ textStyle: { size: 20, fontPostScriptName: 'ArialMT' } }],
  paragraphStyleRange: [{ paragraphStyle: { alignment: 'center' } }],
} };
const edges = ['one', 'two', 'three'].map(text => ({ key: text, text, spec: {
  ranges: [{ from: 0, to: text.length, textStyle: style.layerText.textStyleRange[0].textStyle }], kerning: [],
} }));
const reset = () => Object.assign(sim, { calls: [], writes: [], layers: [{ id: 1, kind: 'pixel', name: 'User layer' }], active: 1, nextId: 1, rollbacks: 0, failure: null, omitBounds: false, truncate: false });
const measure = async requests => {
  const before = copy(sim.layers);
  try { return await smart._internals.measureRequests(requests); }
  finally {
    assert.deepStrictEqual(sim.layers, before, 'Success and failure must preserve user layers');
    assert.strictEqual(sim.active, 1);
    assert.ok(sim.writes.every(id => id > 1));
  }
};

(async () => {
  reset();
  assert.deepStrictEqual(await measure([]), []);
  assert.strictEqual(sim.rollbacks, 0);
  const line = { kind: 'line', params: lineParams(edges[0], style, 20, 72) };
  const atlas = { kind: 'atlas', count: 3, params: atlasParams(edges, style, 20, 72) };
  assert.deepStrictEqual(await measure(Array(24).fill(line)), Array(24).fill({ bounds }));
  assert.strictEqual(sim.calls.length, 24, '24 lines need 24 native calls instead of 48');
  assert.strictEqual(sim.calls.flat().filter(c => c._obj === 'make').length, 1, 'Reuse the owned text layer');
  reset();
  const only = await measure([atlas]);
  assert.strictEqual(sim.calls.length, 1, 'An atlas needs one native call instead of four');
  assert.deepStrictEqual(sim.calls[0].map(c => c._obj), ['make', 'make', 'get']);
  assert.ok(atlasMetrics(only[0].path, 3, doc));
  reset();
  const mixed = await measure([line, atlas, line, atlas]);
  assert.ok(mixed[0].bounds && mixed[1].path && mixed[2].bounds && mixed[3].path);
  assert.deepStrictEqual(sim.calls.map(c => c[0]._obj), ['make', 'set', 'make', 'set']);
  assert.strictEqual(sim.calls.flat().filter(c => c._obj === 'delete').length, 1);
  assert.strictEqual(sim.rollbacks, 1);

  for (const dpi of [72, 144, 300, 600]) for (const unit of ['pixelsUnit', 'pointsUnit']) {
    reset();
    doc.resolution = dpi;
    const styled = { ...style, typeUnit: unit };
    const params = atlasParams(edges, styled, 20, dpi);
    const original = copy(params);
    const reply = await measure([{ kind: 'atlas', count: 3, params }]);
    assert.ok(atlasMetrics(reply[0].path, 3, doc), unit + ' atlas must keep separate rows at ' + dpi + ' dpi');
    assert.deepStrictEqual(params, original, 'Do not mutate the shared engine parameters');
  }
  doc.resolution = 72;
  for (const failure of ['make', 'convert', 'get', 'delete']) {
    reset();
    sim.failure = failure;
    const reply = await measure([atlas, line]);
    assert.strictEqual(reply[0], null, 'Failed atlas requests individual fallback');
    assert.deepStrictEqual(reply[1], { bounds });
  }
  for (const failure of ['make', 'set', 'get']) {
    reset();
    sim.failure = failure;
    await assert.rejects(measure([line, line]), /Injected/);
    assert.strictEqual(sim.rollbacks, 1);
  }
  reset();
  sim.truncate = true;
  await assert.rejects(measure([line]), /Incomplete/);
  reset();
  sim.omitBounds = true;
  assert.deepStrictEqual(await measure([line]), [{ bounds }], 'Retain the bounds fallback');
  reset();
  clearMetricCache();
  sim.failure = 'convert';
  const result = await measureEdges(edges, { textProps: style, baseSize: 20, dpi: 72, page: doc, useAtlas: true }, measure);
  assert.strictEqual(result.cache.size, 3, 'The real engine retries failed atlases individually');
  assert.strictEqual(sim.rollbacks, 2, 'Both the failed atlas and its fallback are rolled back');
  console.log('UXP measurements passed: batched calls, mixed requests, DPI, fallback and history restoration');
})().catch(error => { console.error(error); process.exitCode = 1; });
