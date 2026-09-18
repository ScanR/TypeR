const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const styles = require('./text-style');

const textLayer = (id, options = {}) => ({
  id,
  name: options.name || `Calque ${id}`,
  kind: 'text',
  visible: options.visible !== false,
  bounds: options.bounds || {top: 100, left: 100, right: 400, bottom: 220},
  text: options.text || '',
  point: !!options.point,
  wraps: options.wraps ?? null,
  size: options.size || 20,
  font: options.font || 'ArialMT',
  effects: options.effects || null,
});
const pixelLayer = (id) => ({id, name: `Image ${id}`, kind: 'pixel', visible: true, bounds: {top: 0, left: 0, right: 100, bottom: 100}});
const groupLayer = (id, name, layers) => ({id, name, kind: 'group', visible: true, layers});

const strokeEffect = {frameFX: {enabled: true, size: {_unit: 'pixelsUnit', _value: 2}, opacity: {_unit: 'percentUnit', _value: 100}, color: {_obj: 'RGBColor', red: 255, grain: 255, blue: 255}}};

// Stand-in for the Photoshop UXP API: enough of the document/layer model for
// the host modules to run their actionJSON, with a switch to fail a command.
function fakePhotoshop(options = {}) {
  const operations = [];
  const suspends = [];
  const commits = [];
  const opened = options.opened || {};
  const files = options.files || {};
  const bubble = options.bubble || null;
  const fail = options.fail || (() => false);
  let nextId = 900;

  const ps = {
    app: {
      documents: [],
      activeDocument: null,
      fonts: options.fonts || [{name: 'Arial', postScriptName: 'ArialMT', family: 'Arial', style: 'Regular'}],
      open: async entry => {
        if (options.failOpen) throw new Error('Fichier illisible');
        const doc = addDocument(entry.name, structuredClone(opened[entry.name] || []));
        ps.app.activeDocument = doc;
        return doc;
      },
    },
    constants: {LayerKind: {TEXT: 'text', GROUP: 'group'}, SaveOptions: {DONOTSAVECHANGES: 'doNotSaveChanges'}},
    action: {batchPlay: async descriptors => descriptors.map(handle)},
    core: {
      executeAsModal: async (callback, settings) => callback({
        hostControl: {
          suspendHistory: async request => {suspends.push({...request, command: settings && settings.commandName}); return suspends.length;},
          resumeHistory: async (id, commit) => {commits.push(commit);},
        },
      }),
    },
  };

  function addDocument(name, layers = []) {
    const doc = {
      id: ++nextId,
      name,
      title: name,
      width: 1000,
      height: 1000,
      resolution: 300,
      layers,
      activeLayers: layers.length ? [layers[0]] : [],
      selection: {bounds: null, deselect: async () => { doc.selection.bounds = null; }},
    };
    doc.close = async () => {
      ps.app.documents.splice(ps.app.documents.indexOf(doc), 1);
      if (ps.app.activeDocument === doc) ps.app.activeDocument = ps.app.documents[0] || null;
    };
    ps.app.documents.push(doc);
    ps.app.activeDocument = doc;
    return doc;
  }

  function find(doc, id) {
    let found = null;
    const visit = list => {
      for (const layer of list) {
        if (layer.id === id) found = layer;
        if (layer.layers) visit(layer.layers);
      }
    };
    visit(doc.layers);
    return found;
  }

  function parentOf(doc, layer) {
    const visit = list => {
      if (list.includes(layer)) return list;
      for (const item of list) if (item.layers) { const found = visit(item.layers); if (found) return found; }
      return null;
    };
    return visit(doc.layers);
  }

  const activeLayer = doc => doc.activeLayers[doc.activeLayers.length - 1];

  function textDescriptor(layer) {
    return {
      _obj: 'textLayer',
      textKey: layer.text,
      textShape: [{_obj: 'textShape', textType: {_enum: 'textType', _value: layer.point ? 'point' : 'box'}, bounds: {_obj: 'rectangle', top: 0, left: 0, right: 200, bottom: 100}}],
      antiAlias: {_enum: 'antiAliasType', _value: 'antiAliasSmooth'},
      textStyleRange: [{from: 0, to: layer.text.length, textStyle: {
        fontPostScriptName: layer.font,
        size: {_unit: 'pointsUnit', _value: layer.size},
        syntheticBold: false,
        syntheticItalic: false,
        color: {_obj: 'RGBColor', red: 0, grain: 0, blue: 0},
      }}],
      paragraphStyleRange: [{from: 0, to: layer.text.length, paragraphStyle: {alignment: {_enum: 'alignmentType', _value: 'center'}, hyphenate: false}}],
    };
  }

  function describe(layer) {
    if (!layer) return {};
    return {
      _obj: 'layer',
      layerID: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      bounds: {top: layer.bounds.top, left: layer.bounds.left, right: layer.bounds.right, bottom: layer.bounds.bottom},
      textKey: layer.kind === 'text' ? textDescriptor(layer) : undefined,
      layerEffects: layer.effects || undefined,
    };
  }

  function handle(descriptor) {
    operations.push(descriptor);
    if (fail(descriptor)) return {_obj: 'error', message: 'Commande refusée', result: 1};
    const doc = ps.app.activeDocument;
    const target = (descriptor._target || [])[0] || {};
    if (descriptor._obj === 'get') {
      if (target._property === 'selection') return doc.selection.bounds ? {selection: {...doc.selection.bounds}} : {};
      return describe(target._id != null ? find(doc, target._id) : activeLayer(doc));
    }
    if (descriptor._obj === 'select') {
      const layer = find(doc, target._id);
      doc.activeLayers = target.selectionModifier ? doc.activeLayers.filter(item => item.id !== layer.id).concat([layer]) : [layer];
      return {};
    }
    if (descriptor._obj === 'duplicate') {
      if (target._ref === 'document') {
        const source = ps.app.documents.find(item => item.id === target._id);
        addDocument(descriptor.name || `${source.name} copy`, structuredClone(source.layers));
        return {};
      }
      const source = target._id != null ? find(doc, target._id) : activeLayer(doc);
      const parent = parentOf(doc, source);
      const copy = {...source, id: ++nextId, bounds: {...source.bounds}};
      parent.splice(parent.indexOf(source) + 1, 0, copy);
      doc.activeLayers = [copy];
      return {};
    }
    if (descriptor._obj === 'delete') {
      const layer = target._id != null ? find(doc, target._id) : activeLayer(doc);
      const parent = parentOf(doc, layer);
      parent.splice(parent.indexOf(layer), 1);
      doc.activeLayers = doc.activeLayers.filter(item => item.id !== layer.id);
      return {};
    }
    if (descriptor._obj === 'set') {
      if (target._property === 'textType') {
        const layer = activeLayer(doc);
        const kind = descriptor.to._value;
        // A box layer only materializes its automatic wraps once it is point text
        if (kind === 'point' && !layer.point && layer.wraps != null) layer.text = layer.wraps;
        layer.point = kind === 'point';
        return {};
      }
      if (target._ref === 'textLayer') {
        // A box re-fit sends the shape alone: only the text-bearing sets reflow
        if (descriptor.to.textKey !== undefined) activeLayer(doc).text = descriptor.to.textKey;
        return {};
      }
      if (target._property === 'selection' || target._property === 'frameSelect') {
        const to = descriptor.to || {};
        // An older Photoshop refuses the frame selection the wand is recorded
        // against; the plugin then has to spell it the plain way
        if (to._obj === 'paint' && target._property === 'frameSelect' && options.oldWand) return {_obj: 'error', message: 'Commande refusée', result: 1};
        if (to._obj === 'paint') doc.selection.bounds = bubble ? {...bubble} : null;
        if (to._value === 'none') doc.selection.bounds = null;
        return {};
      }
    }
    return {};
  }

  const initial = options.documents || [{name: 'document.psd', layers: options.layers || []}];
  for (const item of initial) addDocument(item.name || 'document.psd', item.layers || []);

  return {
    ps,
    files,
    operations,
    suspends,
    commits,
    documents: ps.app.documents,
    get doc() { return ps.app.documents[ps.app.documents.length - 1]; },
    uxp: {storage: {localFileSystem: {getEntryForPersistentToken: async token => files[token] || null}}},
  };
}

function load(options = {}) {
  const fake = fakePhotoshop(options);
  const native = {exports: {}};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/photoshop.js`, 'utf8'), {
    require: name => (name === 'photoshop' ? fake.ps : styles),
    module: native,
    console,
  });
  const shaper = {exports: {}};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/textshaper.js`, 'utf8'), {
    require: name => {
      if (name === 'photoshop') return fake.ps;
      if (name === './photoshop') return native.exports;
      if (name === './text-style') return styles;
      if (name === 'uxp') return fake.uxp;
      throw new Error(`Unexpected require: ${name}`);
    },
    module: shaper,
    console,
  });
  return {...fake, native: native.exports, methods: shaper.exports.methods};
}

test('rendered lines report a missing document', async () => {
  const host = load({documents: []});
  assert.deepEqual(JSON.parse(await host.methods.getRenderedTextLines()), {error: 'layer'});
});

test('rendered lines report a non-text layer', async () => {
  const host = load({layers: [pixelLayer(1)]});
  assert.deepEqual(JSON.parse(await host.methods.getRenderedTextLines()), {error: 'layer'});
});

test('rendered lines of point text are its manual returns', async () => {
  const host = load({layers: [textLayer(1, {text: 'Bonjour\rSilicon', point: true})]});
  assert.deepEqual(JSON.parse(await host.methods.getRenderedTextLines()), {text: 'Bonjour\rSilicon'});
  assert.equal(host.operations.length, 1);
});

test('rendered lines of box text come from a throwaway copy and leave no history', async () => {
  const host = load({layers: [textLayer(1, {text: 'Bonjour Silicon', wraps: 'Bonjour\rSilicon'})]});
  assert.deepEqual(JSON.parse(await host.methods.getRenderedTextLines()), {text: 'Bonjour\rSilicon'});
  assert.equal(host.doc.layers.length, 1, 'the copy is deleted');
  assert.equal(host.doc.activeLayers[0].id, 1, 'the original layer is selected again');
  assert.deepEqual(host.commits, [false], 'the suspended state is reverted, never committed');
  assert.equal(host.suspends.length, 1);
});

test('a failed rendered read returns empty text instead of breaking the panel', async () => {
  const host = load({
    layers: [textLayer(1, {text: 'Bonjour Silicon', wraps: 'Bonjour\rSilicon'})],
    fail: descriptor => descriptor._obj === 'duplicate',
  });
  assert.deepEqual(JSON.parse(await host.methods.getRenderedTextLines()), {text: ''});
  assert.deepEqual(host.commits, [false]);
});

test('page lines report a missing document', async () => {
  const host = load({documents: []});
  assert.deepEqual(JSON.parse(await host.methods.getAllRenderedTextLines({scanBubbles: false})), {error: 'document'});
});

test('page lines are empty without any text layer', async () => {
  const host = load({layers: [pixelLayer(1)]});
  assert.deepEqual(JSON.parse(await host.methods.getAllRenderedTextLines({scanBubbles: false})), {entries: []});
  assert.equal(host.suspends.length, 1, 'the batch runs in one history state');
});

test('page lines keep document order, skip hidden layers and read nested boxes', async () => {
  const host = load({layers: [
    textLayer(1, {text: 'Premier', point: true}),
    textLayer(2, {text: 'Cache', point: true, visible: false}),
    groupLayer(9, 'Groupe', [textLayer(3, {text: 'Bulle serrée', wraps: 'Bulle\rserrée'})]),
  ]});
  const data = JSON.parse(await host.methods.getAllRenderedTextLines({scanBubbles: false}));
  assert.deepEqual(data, {entries: [{text: 'Premier', bubble: null}, {text: 'Bulle\rserrée', bubble: null}]});
  assert.equal(host.doc.layers.length, 3, 'no duplicate layer left behind');
  assert.equal(host.doc.activeLayers[0].id, 1, 'the initial selection is restored');
});

test('page lines never sacrifice a drawn selection to a bubble scan', async () => {
  const host = load({layers: [textLayer(1, {text: 'Premier', point: true})], bubble: {top: 50, left: 50, right: 650, bottom: 450}});
  host.doc.selection.bounds = {top: 10, left: 10, right: 110, bottom: 110};
  const data = JSON.parse(await host.methods.getAllRenderedTextLines({scanBubbles: true}));
  assert.deepEqual(data.entries[0].bubble, null);
  assert.equal(host.operations.some(operation => operation.to && operation.to._obj === 'paint'), false, 'the wand never runs');
});

test('page lines report the bubble box around each layer and clear the wand selection', async () => {
  const host = load({layers: [textLayer(1, {text: 'Premier', point: true})], bubble: {top: 50, left: 50, right: 650, bottom: 450}});
  const data = JSON.parse(await host.methods.getAllRenderedTextLines({scanBubbles: true}));
  assert.deepEqual(data.entries, [{text: 'Premier', bubble: {rows: [], width: 600, height: 400}}]);
  assert.equal(host.doc.selection.bounds, null);
});

test('a build that refuses the frame selection still scans through the plain channel', async () => {
  const host = load({layers: [textLayer(1, {text: 'Premier', point: true})], bubble: {top: 50, left: 50, right: 650, bottom: 450}, oldWand: true});
  const data = JSON.parse(await host.methods.getAllRenderedTextLines({scanBubbles: true}));
  assert.deepEqual(data.entries[0].bubble, {rows: [], width: 600, height: 400});
  const wand = host.operations.filter(operation => operation.to && operation.to._obj === 'paint');
  assert.deepEqual(wand.map(operation => operation._target[0]._property), ['frameSelect', 'selection']);
});

test('the lean apply rewrites the text, keeps geometry and leaves the stroke alone', async () => {
  const host = load({layers: [textLayer(1, {text: 'Ancien', effects: strokeEffect})]});
  await host.methods.setTextShapeRLayerText({text: 'Nouveau\rTexte', style: styles.defaultStyle()});
  assert.equal(host.doc.layers[0].text, 'Nouveau\rTexte');
  assert.deepEqual(host.doc.layers[0].effects, strokeEffect);
  assert.equal(host.operations.some(operation => operation._obj === 'move'), true);
  assert.deepEqual(host.commits, [true], 'an apply is committed');
  // A frame narrower than the new line would soft-wrap it: the text lands on
  // point text, which never wraps, and the box rebuilt around it is refitted
  const kinds = host.operations.filter(operation => operation._target[0]._property === 'textType').map(operation => operation.to._value);
  assert.deepEqual(kinds, ['point', 'box']);
  const set = host.operations.find(operation => operation._obj === 'set' && operation._target[0]._ref === 'textLayer');
  assert.equal(set.to.textShape, undefined, 'the retained frame is not carried over');
  assert.equal(host.doc.layers[0].point, false, 'the layer comes back as box text');
});

test('a Photoshop error during the lean apply is surfaced and rolled back', async () => {
  const host = load({
    layers: [textLayer(1, {text: 'Ancien'})],
    fail: descriptor => descriptor._obj === 'set' && descriptor._target[0]._ref === 'textLayer',
  });
  await assert.rejects(host.methods.setTextShapeRLayerText({text: 'Nouveau', style: styles.defaultStyle()}), /Commande refusée/);
  // The lean attempt then the full apply it falls back to: both rolled back
  assert.deepEqual(host.commits, [false, false]);
  assert.equal(host.doc.layers[0].point, false, 'the layer kind is restored');
});

test('a lean apply whose document goes away never rewrites another one', async () => {
  const host = load({layers: [textLayer(1, {text: 'Ancien'})]});
  const document = host.doc;
  const inner = host.ps.action.batchPlay;
  host.ps.action.batchPlay = async descriptors => {
    if (descriptors[0]._obj === 'set' && descriptors[0]._target[0]._ref === 'textLayer') {
      document.close();
      return [{_obj: 'error', message: 'Commande refusée', result: 1}];
    }
    return inner(descriptors);
  };
  await assert.rejects(host.methods.setTextShapeRLayerText({text: 'Nouveau', style: styles.defaultStyle()}), /Commande refusée/);
  assert.equal(host.documents.length, 0);
  assert.deepEqual(host.commits, [false], 'no full apply is attempted on a closed document');
});

test('a payload without a captured style falls back to the classic apply', async () => {
  const host = load({layers: [textLayer(1, {text: 'Ancien'})]});
  assert.equal(await host.methods.setTextShapeRLayerText({text: 'Nouveau'}), '');
  assert.equal(host.doc.layers[0].text, 'Nouveau');
});

test('reloadUserFonts answers the same font list as getUserFonts', async () => {
  const host = load();
  assert.deepEqual(JSON.parse(await host.methods.reloadUserFonts()), JSON.parse(await host.native.methods.getUserFonts()));
  assert.deepEqual(JSON.parse(await host.methods.reloadUserFonts()), {fonts: [{name: 'Arial', postScriptName: 'ArialMT', family: 'Arial', style: 'Regular'}]});
});

test('font scans reject a missing or unusable path', async () => {
  const host = load();
  assert.deepEqual(JSON.parse(await host.methods.scanPsdFonts('')), {error: 'badPath'});
  assert.deepEqual(JSON.parse(await host.methods.scanPsdFonts('/tmp/planche.psd')), {error: 'badPath', file: '/tmp/planche.psd'});
  assert.deepEqual(JSON.parse(await host.methods.scanPsdFonts('psfile:perdu')), {error: 'badPath', file: 'psfile:perdu'});
});

test('font scans return per-layer runs, paragraph style and stroke, then close the file', async () => {
  const host = load({
    documents: [{name: 'document.psd', layers: [pixelLayer(1)]}],
    files: {ok: {name: 'planche.psd', nativePath: '/tmp/planche.psd'}},
    opened: {'planche.psd': [pixelLayer(1), textLayer(2, {name: 'Titre', text: 'Salut', effects: strokeEffect})]},
  });
  const previous = host.doc;
  assert.deepEqual(JSON.parse(await host.methods.scanPsdFonts('psfile:ok')), {
    file: '/tmp/planche.psd',
    layers: [{
      layerName: 'Titre',
      antiAlias: 'antiAliasSmooth',
      typeUnit: 'pointsUnit',
      paragraphStyle: {alignment: 'center', hyphenate: false},
      stroke: {enabled: true, position: 'outer', size: 2, opacity: 100, color: {r: 255, g: 255, b: 255}},
      runs: [{fontPostScriptName: 'ArialMT', size: 20, syntheticBold: false, syntheticItalic: false, color: {red: 0, green: 0, blue: 0}}],
    }],
  });
  assert.equal(host.ps.app.activeDocument, previous, 'the previous document is restored');
  assert.equal(host.documents.length, 1, 'the scanned PSD is closed');
});

test('a layer whose strokes are duplicated still reports its first stroke', async () => {
  // A duplicated stroke lives in a frameFXMulti list, never in frameFX
  const multi = [{enabled: true, size: {_unit: 'pixelsUnit', _value: 4}, opacity: {_unit: 'percentUnit', _value: 80}, color: {_obj: 'RGBColor', red: 0, grain: 0, blue: 0}}];
  const host = load({
    documents: [{name: 'planche.psd', layers: [textLayer(1, {name: 'Titre', text: 'Salut', effects: {frameFXMulti: multi}})]}],
    files: {ok: {name: 'planche.psd', nativePath: '/tmp/planche.psd'}},
  });
  const data = JSON.parse(await host.methods.scanPsdFonts('psfile:ok'));
  assert.deepEqual(data.layers[0].stroke, {enabled: true, position: 'outer', size: 4, opacity: 80, color: {r: 0, g: 0, b: 0}});
});

test('a font scan failure is reported instead of thrown', async () => {
  const host = load({files: {ok: {name: 'planche.psd', nativePath: '/tmp/planche.psd'}}, failOpen: true});
  const data = JSON.parse(await host.methods.scanPsdFonts('psfile:ok'));
  assert.equal(data.error, 'scanFailed');
  assert.equal(data.file, 'psfile:ok');
  assert.match(data.message, /Fichier illisible/);
});

test('a layer whose font data cannot be read does not abort the scan', async () => {
  const host = load({
    files: {ok: {name: 'planche.psd', nativePath: '/tmp/planche.psd'}},
    opened: {'planche.psd': [textLayer(2, {name: 'Titre', text: 'Salut'})]},
    fail: descriptor => descriptor._obj === 'get',
  });
  assert.deepEqual(JSON.parse(await host.methods.scanPsdFonts('psfile:ok')), {file: '/tmp/planche.psd', layers: []});
});

test('training scans need an open document when no path is given', async () => {
  const host = load({documents: []});
  assert.deepEqual(JSON.parse(await host.methods.scanTextShapeRTraining('')), {error: 'document'});
});

test('training scans list every text layer of a disposable copy', async () => {
  const host = load({layers: [
    textLayer(1, {name: 'Bulles', text: 'Bonjour Silicon', wraps: 'Bonjour\rSilicon'}),
    textLayer(2, {name: 'Point', text: 'Suite', point: true}),
    textLayer(3, {name: 'Cache', text: 'Secret', point: true, visible: false}),
    groupLayer(9, 'Groupe', [textLayer(4, {name: 'Note', text: 'Dernier', point: true})]),
  ]});
  const source = host.doc;
  assert.deepEqual(JSON.parse(await host.methods.scanTextShapeRTraining('')), {entries: [
    {layerId: 1, name: 'Bulles', layerPath: 'Bulles', visible: true, text: 'Bonjour\rSilicon'},
    {layerId: 2, name: 'Point', layerPath: 'Point', visible: true, text: 'Suite'},
    {layerId: 3, name: 'Cache', layerPath: 'Cache', visible: false, text: 'Secret'},
    {layerId: 4, name: 'Note', layerPath: 'Groupe / Note', visible: true, text: 'Dernier'},
  ]});
  assert.equal(host.documents.length, 1, 'the working copy is closed');
  assert.equal(host.ps.app.activeDocument, source);
  assert.equal(source.layers.length, 4, 'the source document is untouched');
  assert.equal(source.layers[0].text, 'Bonjour Silicon');
});

test('training scans refuse an unknown or non-PSD file', async () => {
  const host = load({
    files: {ok: {name: 'planche.psd', nativePath: '/tmp/planche.psd'}, txt: {name: 'notes.txt'}},
  });
  assert.deepEqual(JSON.parse(await host.methods.scanTextShapeRTraining('psfile:perdu')), {error: 'notFound', file: 'psfile:perdu'});
  assert.deepEqual(JSON.parse(await host.methods.scanTextShapeRTraining('psfile:txt')), {error: 'badPath'});
});

test('training scans open a PSD that is not in Photoshop', async () => {
  const host = load({
    documents: [{name: 'document.psd', layers: [pixelLayer(1)]}],
    files: {ok: {name: 'planche.psd', nativePath: '/tmp/planche.psd'}},
    opened: {'planche.psd': [textLayer(2, {name: 'Titre', text: 'Salut', point: true})]},
  });
  const previous = host.doc;
  assert.deepEqual(JSON.parse(await host.methods.scanTextShapeRTraining('psfile:ok')), {entries: [
    {layerId: 2, name: 'Titre', layerPath: 'Titre', visible: true, text: 'Salut'},
  ]});
  assert.equal(host.documents.length, 1, 'the scanned PSD is closed');
  assert.equal(host.ps.app.activeDocument, previous);
});

test('training scans report a layer that cannot be read', async () => {
  const host = load({
    layers: [textLayer(1, {name: 'Bulles', text: 'Bonjour', point: true})],
    fail: descriptor => descriptor._obj === 'get',
  });
  const data = JSON.parse(await host.methods.scanTextShapeRTraining(''));
  assert.deepEqual(data, {entries: [{layerId: 1, name: 'Bulles', layerPath: 'Bulles', visible: true, text: '', error: 'readFailed'}]});
});
