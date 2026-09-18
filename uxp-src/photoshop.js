const ps = require('photoshop');
const {clone, number, fromActionJSON, makeTextDescriptor, bounds} = require('./text-style');
const target = () => [{_ref: 'layer', _enum: 'ordinal', _value: 'targetEnum'}];
const px = (value) => ({_unit: 'pixelsUnit', _value: value});
// The marquee of a detected bubble is parked in this channel while it is
// opened, and always removed again before the command returns.
const TEMP_CHANNEL = '__TyperSelectionTemp__';
const OPEN_RATIO = 0.1;
const MIN_OPEN_RADIUS = 4;
let monitoring = false;
let lastSelection = '';
let pending = Promise.resolve();
let changing = false;

async function play(descriptor) {
  const [result] = await ps.action.batchPlay([{...descriptor, _options: {dialogOptions: 'dontDisplay'}}], {});
  if (result?._obj === 'error') {
    const detail = result.message || `erreur ${result.result}`;
    throw new Error(`Photoshop ${descriptor._obj}: ${detail}`);
  }
  return result;
}

function document() {
  if (!ps.app.documents.length) throw new Error('Ouvrez un document dans Photoshop.');
  return ps.app.activeDocument;
}

async function getLayer() {
  const result = await play({_obj: 'get', _target: target()});
  if (!result.textKey) throw new Error('Sélectionnez un calque de texte.');
  return result;
}

function selection() {
  try {
    if (!ps.app.documents.length) return null;
    const doc = ps.app.activeDocument;
    const rect = bounds(doc.selection && doc.selection.bounds);
    return rect ? {...rect, documentId: doc.id} : null;
  } catch (_) {
    return null;
  }
}

async function readSelection() {
  const immediate = selection();
  if (immediate) return immediate;
  if (!ps.app.documents.length) return null;
  const doc = ps.app.activeDocument;
  try {
    const [result] = await ps.action.batchPlay([{
      _obj: 'get',
      _target: [{_property: 'selection'}, {_ref: 'document', _id: doc.id}],
      _options: {dialogOptions: 'dontDisplay'},
    }], {});
    const rect = bounds(result && result.selection);
    return rect ? {...rect, documentId: doc.id} : null;
  } catch (_) {
    return null;
  }
}

// Every modifying command is serialized and has one undo step. A failure rolls
// the whole operation back, including any temporary channels or partial batch.
function mutate(name, callback) {
  const expectedDocument = document().id;
  const run = () => ps.core.executeAsModal(async (context) => {
    const doc = document();
    if (doc.id !== expectedDocument) throw new Error('Le document actif a changé. Relancez la commande.');
    const history = await context.hostControl.suspendHistory({documentID: doc.id, name});
    let success = false;
    changing = true;
    try {
      const result = await callback(doc, context);
      success = true;
      return result;
    } finally {
      try { await context.hostControl.resumeHistory(history, success); }
      finally { changing = false; lastSelection = JSON.stringify(selection()); }
    }
  }, {commandName: name});
  const task = pending.then(run, run);
  pending = task.catch(() => {});
  return task;
}

function checkSelection(rect, documentId) {
  if (!rect) throw new Error('Sélectionnez une bulle ou une zone de texte.');
  if (rect.documentId !== undefined && rect.documentId !== documentId) throw new Error('Cette sélection appartient à une autre page. Videz les sélections et recommencez.');
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) || rect.width * rect.height < 200) throw new Error('La zone sélectionnée est trop petite ou invalide.');
  return rect;
}

function cancelled(error) {
  const text = String(error && error.message || error || '');
  return text.includes('-128') || /cancel|annul/i.test(text) || /not available/i.test(text);
}

function inset(rect, amount) {
  if (!rect || !amount) return rect;
  const delta = Math.abs(amount);
  if (amount < 0) {
    if (rect.width <= delta * 2 || rect.height <= delta * 2) return null;
    return bounds({top: rect.top + delta, left: rect.left + delta, right: rect.right - delta, bottom: rect.bottom - delta});
  }
  return bounds({
    top: Math.max(rect.top - delta, 0),
    left: Math.max(rect.left - delta, 0),
    right: rect.right + delta,
    bottom: rect.bottom + delta,
  });
}

function documentSize(doc) {
  return {width: number(doc.width), height: number(doc.height)};
}

function usableBubble(rect, doc) {
  if (!rect) return null;
  const {width, height} = documentSize(doc);
  if (width && height && rect.width * rect.height > width * height * 0.45) return null;
  if (rect.width * rect.height < 200) return null;
  return rect;
}

// The single place the wand is spelled. Photoshop records it against the frame
// selection; older builds only answer to the plain selection channel, and no
// spelling has been run against a real Photoshop yet, so every caller shares
// this one rather than keeping its own guess.
async function magicWandAt(x, y, tolerance = 20) {
  const to = {_obj: 'paint', horizontal: px(Math.max(x, 0)), vertical: px(Math.max(y, 0))};
  const options = {tolerance, merged: true, antiAlias: true, contiguous: true};
  try { await play({_obj: 'set', _target: [{_ref: 'channel', _property: 'frameSelect'}], to, ...options}); }
  catch (_) { await play({_obj: 'set', _target: [{_ref: 'channel', _property: 'selection'}], to, ...options}); }
}

async function detectBubble(doc, layer) {
  const box = bounds(layer.boundsNoEffects || layer.bounds);
  if (!box) return null;
  const points = [
    [box.left - 5, box.yMid],
    [box.right + 5, box.yMid],
    [box.xMid, box.top - 5],
    [box.xMid, box.bottom + 5],
    [box.xMid, box.yMid],
  ];
  for (const [x, y] of points) {
    try {
      await magicWandAt(x, y);
      // The wand has just replaced the marquee: the DOM still holds the
      // document as it was when the modal opened, so only batchPlay sees it.
      const found = usableBubble(await liveSelection(doc), doc);
      if (found) return found;
    } catch (error) {
      console.error('TypeR wand', error.message || error);
    }
  }
  return null;
}

// Inside a modal session the DOM reports the document as it was when the
// session opened, so every selection read that follows a command of ours has
// to go back through batchPlay.
async function liveSelection(doc) {
  try {
    const [result] = await ps.action.batchPlay([{
      _obj: 'get',
      _target: [{_property: 'selection'}, {_ref: 'document', _id: doc.id}],
      _options: {dialogOptions: 'dontDisplay'},
    }], {});
    const rect = bounds(result && result.selection);
    return rect ? {...rect, documentId: doc.id} : null;
  } catch (_) {
    return null;
  }
}

async function dropChannel(name) {
  try { await play({_obj: 'delete', _target: [{_ref: 'channel', _name: name}]}); } catch (_) {}
}

async function loadChannel(name) {
  await play({_obj: 'set', _target: [{_ref: 'channel', _property: 'selection'}], to: {_ref: 'channel', _name: name}});
}

// Save Selection has two spellings across Photoshop versions; either one
// answers with an error result when the version does not know it.
async function saveChannel(name) {
  await dropChannel(name);
  const target = [{_ref: 'channel', _property: 'selection'}];
  const as = {_ref: 'channel', _enum: 'channel', _value: 'mask'};
  try { await play({_obj: 'store', _target: target, using: as, name}); }
  catch (_) { await play({_obj: 'save', _target: target, as, name}); }
}

// A morphological opening of the marquee (contract then expand by the same
// radius). The magic wand leaves every glyph it encloses as a hole, and the
// opening fills them: that is what makes the centring exact instead of an
// approximation of the bubble's bounding box. The radius follows the bubble
// size, halved while the result stays too small to be a bubble.
// Returns null when the marquee cannot be opened, so the caller can tell that
// apart from an opening that legitimately produced the same bounds.
async function openedSelection(doc, rect) {
  const shortest = Math.min(rect.width, rect.height);
  const maxRadius = Math.floor(shortest / 2 - 1);
  if (maxRadius <= 0) return null;
  const radius = Math.min(Math.max(MIN_OPEN_RADIUS, Math.round(shortest * OPEN_RATIO)), maxRadius);
  try {
    await saveChannel(TEMP_CHANNEL);
  } catch (error) {
    console.error('TypeR canal', error.message || error);
    return null;
  }
  try {
    let attempt = radius;
    while (attempt >= 1) {
      // Every retry starts from the untouched marquee: a failed contract can
      // leave the selection empty.
      if (attempt !== radius) await loadChannel(TEMP_CHANNEL);
      let candidate = null;
      try {
        await play({_obj: 'contract', by: px(attempt)});
        const contracted = await liveSelection(doc);
        if (contracted && contracted.width > 1 && contracted.height > 1) {
          await play({_obj: 'expand', by: px(attempt)});
          candidate = await liveSelection(doc);
        }
      } catch (error) {
        console.error('TypeR ouverture', error.message || error);
      }
      if (candidate && candidate.width * candidate.height >= 200) return candidate;
      attempt = Math.floor(attempt / 2);
    }
    return null;
  } finally {
    try { await loadChannel(TEMP_CHANNEL); } catch (_) {}
    await dropChannel(TEMP_CHANNEL);
  }
}

function adjustedBounds(rect, textSize) {
  const amount = Math.max(1, Math.min(500, Math.round(number(textSize) || 20)));
  let adjusted = inset(rect, amount) || rect;
  adjusted = inset(adjusted, -amount) || adjusted;
  for (let i = 0; i < 6; i++) adjusted = inset(adjusted, -5) || adjusted;
  for (let i = 0; i < 6; i++) adjusted = inset(adjusted, 5) || adjusted;
  return adjusted;
}

// `known` is the marquee the caller has just produced itself (the wand): the
// DOM cannot report it yet inside the modal session, so it is passed in.
async function adjustedSelection(doc, textSize, known) {
  let live = known || await readSelection();
  if (live) live = {...live, documentId: doc.id};
  const rect = checkSelection(live, doc.id);
  try {
    const opened = await openedSelection(doc, rect);
    if (opened) return checkSelection({...opened, documentId: doc.id}, doc.id);
  } catch (error) {
    console.error('TypeR centrage', error.message || error);
  }
  return checkSelection(adjustedBounds(rect, textSize), doc.id);
}

async function setText(descriptor) {
  await play({_obj: 'set', _target: [{_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: descriptor});
}

async function moveTo(rect) {
  const layer = await getLayer();
  const current = bounds(layer.boundsNoEffects || layer.bounds);
  if (!current) throw new Error('Le texte ne tient pas dans la zone. Augmentez la zone ou réduisez la taille.');
  await play({_obj: 'move', _target: target(), to: {_obj: 'offset', horizontal: px(rect.xMid - current.xMid), vertical: px(rect.yMid - current.yMid)}});
}

async function strokeStyle(stroke) {
  if (!stroke) return;
  const layer = await getLayer();
  const effects = clone(layer.layerEffects || {_obj: 'layerEffects', scale: {_unit: 'percentUnit', _value: 100}});
  // Preserve unrelated effects (shadow, glow, etc.) on existing text layers.
  const enabled = stroke.enabled !== false && Number(stroke.size) > 0;
  const color = stroke.color || {r: 255, g: 255, b: 255};
  if (!enabled && !effects.frameFX) return;
  effects.frameFX = {
    _obj: 'frameFX', enabled, present: true, showInDialog: true,
    style: {_enum: 'frameStyle', _value: 'outsetFrame'},
    paintType: {_enum: 'frameFill', _value: 'solidColor'},
    mode: {_enum: 'blendMode', _value: 'normal'},
    opacity: {_unit: 'percentUnit', _value: stroke.opacity ?? 100},
    size: px(Math.max(1, Number(stroke.size) || 1)),
    color: {_obj: 'RGBColor', red: color.r ?? color.red, grain: color.g ?? color.green, blue: color.b ?? color.blue},
  };
  await play({_obj: 'set', _target: [{_ref: 'property', _property: 'layerEffects'}, ...target()], to: effects});
}

function readStroke(layer) {
  const effects = layer.layerEffects || {};
  // Recent Photoshop stores a duplicated stroke in a "frameFXMulti" list
  // instead of a single FrFX object (host.js _getLayerStroke): without this the
  // stroke of such a layer reads as absent and applying a style drops it.
  const effect = effects.frameFX || Array.from(effects.frameFXMulti || [])[0];
  if (!effect) return null;
  return {enabled: effect.enabled, position: 'outer', size: number(effect.size), opacity: number(effect.opacity), color: {r: effect.color?.red, g: effect.color?.green ?? effect.color?.grain, b: effect.color?.blue}};
}

function textBox(width, height, resolution) {
  return [{_obj: 'textShape', textType: {_enum: 'textType', _value: 'box'}, orientation: {_enum: 'orientation', _value: 'horizontal'}, bounds: {_obj: 'rectangle', top: 0, left: 0, right: width * 72 / resolution, bottom: height * 72 / resolution}}];
}

async function activateLayer(layer) {
  if (!layer || layer.id == null) return;
  await play({_obj: 'select', _target: [{_ref: 'layer', _id: layer.id}], makeVisible: false});
}

async function createInRect(doc, data, point, rect) {
  checkSelection(rect, doc.id);
  if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Aucun texte spécifié.');
  const text = data.text.replace(/\r\n|\n/g, '\r');
  const width = Math.max(10, rect.width * 0.9 - Math.max(0, data.padding || 0) * 2);
  const size = number(data.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle?.size) || 20;
  try { if (doc.selection && doc.selection.deselect) await doc.selection.deselect(); } catch (_) {}
  let createdLayer = null;
  if (typeof doc.createTextLayer === 'function') {
    try {
      createdLayer = await doc.createTextLayer({contents: text, fontSize: size, position: {x: rect.xMid, y: rect.yMid}});
    } catch (error) {
      console.error('TypeR createTextLayer', error.message || error);
    }
  }
  const descriptor = makeTextDescriptor(data);
  descriptor.textShape = textBox(width, rect.height, doc.resolution);
  descriptor.textClickPoint = {_obj: 'point', horizontal: px(rect.xMid), vertical: px(rect.yMid)};
  if (!createdLayer) {
    await play({_obj: 'make', _target: [{_ref: 'textLayer'}], using: {_obj: 'textLayer', textKey: text, textClickPoint: descriptor.textClickPoint, textShape: descriptor.textShape}});
    createdLayer = Array.from(doc.activeLayers || [])[0];
  }
  await activateLayer(createdLayer);
  try { await setText(descriptor); }
  catch (error) {
    console.error('TypeR setText', error.message || error);
    await setText({_obj: 'textLayer', textKey: text, textShape: descriptor.textShape});
  }
  if (point) {
    await play({_obj: 'set', _target: [{_ref: 'property', _property: 'textType'}, {_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: {_enum: 'textType', _value: 'point'}});
  }
  try { await strokeStyle(data.style?.stroke); } catch (error) { console.error('TypeR stroke', error.message || error); }
  await moveTo(rect);
}

// The layer's bounds report the rendered text, not the text frame around it,
// so the frame can be measured right after the text lands.
async function renderedExtent() {
  const layer = await getLayer();
  return bounds(layer.boundsNoEffects || layer.bounds);
}

// Points, like every textShape bound. The type engine's cost grows with the
// frame's pixel size, so the measuring frame is derived from the document and
// capped instead of being a huge fixed value.
function measureSpan(doc) {
  const {width, height} = documentSize(doc);
  const span = Math.min(20000, 2 * Math.max(width || 0, height || 0)) || 20000;
  return span * 72 / doc.resolution;
}

function sizeInPoints(descriptor, resolution, fallback = 20) {
  const size = descriptor.textStyleRange?.[0]?.textStyle?.size;
  const value = number(size);
  if (!Number.isFinite(value)) return fallback;
  return size?._unit === 'pixelsUnit' ? value * 72 / resolution : value;
}

// Box text re-flows inside its frame, so a font or text change that lays out
// bigger than the retained frame is clipped by it. Lay the text out in an
// oversized frame first and hug the frame around what Photoshop rendered; a
// style-only apply keeps the same line breaks and only needs the extra height.
async function fitTextBox(doc, shape, previous, size) {
  const rect = shape.bounds;
  const toPoints = (pixels) => pixels * 72 / doc.resolution;
  const before = rect && {...rect};
  let fitted = false;
  if (previous) {
    const measured = await renderedExtent();
    if (measured) {
      rect.right = previous.left + toPoints(measured.width) + Math.max(2, size * 0.4);
      rect.bottom = previous.top + toPoints(measured.height) + size + 2;
      fitted = true;
    } else {
      rect.right = previous.right;
      rect.bottom = previous.bottom;
    }
  }
  if (!fitted) {
    const measured = await renderedExtent();
    if (measured) rect.bottom = Math.max(rect.bottom, rect.top + toPoints(measured.height) + size + 2);
  }
  if (before && before.right === rect.right && before.bottom === rect.bottom) return;
  await setText({_obj: 'textLayer', textShape: [shape]});
}

async function forSelected(doc, callback) {
  const layers = Array.from(doc.activeLayers);
  if (!layers.length || layers.some(layer => layer.kind !== ps.constants.LayerKind.TEXT)) throw new Error('Sélectionnez uniquement des calques de texte.');
  for (const layer of layers) {
    await play({_obj: 'select', _target: [{_ref: 'layer', _id: layer.id}], makeVisible: false});
    await callback();
  }
  for (let i = 0; i < layers.length; i++) {
    await play({_obj: 'select', _target: [{_ref: 'layer', _id: layers[i].id}], ...(i ? {selectionModifier: {_enum: 'selectionModifierType', _value: 'addToSelection'}} : {}), makeVisible: false});
  }
}

const methods = {
  async getUserFonts() {
    return JSON.stringify({fonts: Array.from(ps.app.fonts).map(font => ({name: font.name, postScriptName: font.postScriptName, family: font.family, style: font.style}))});
  },
  async getActiveLayerText() {
    document();
    const layer = await getLayer();
    return JSON.stringify({textProps: {layerText: fromActionJSON(layer.textKey), typeUnit: layer.textKey.textStyleRange?.[0]?.textStyle?.size?._unit || 'pointsUnit'}, stroke: readStroke(layer)});
  },
  async getCurrentSelection() { return JSON.stringify(await readSelection() || {error: 'noSelection'}); },
  async getShortcutContext() {
    if (!ps.app.documents.length) return JSON.stringify({hasSelection: false, hasTextLayer: false});
    const layers = Array.from(ps.app.activeDocument.activeLayers || []);
    const hasTextLayer = layers.length > 0 && layers.every(layer => layer.kind === ps.constants.LayerKind.TEXT);
    return JSON.stringify({hasSelection: !!(await readSelection()), hasTextLayer});
  },
  async startSelectionMonitoring() { monitoring = true; lastSelection = ''; return ''; },
  async stopSelectionMonitoring() { monitoring = false; lastSelection = ''; return ''; },
  async getSelectionChanged() {
    if (!monitoring || changing) return JSON.stringify({noChange: true});
    const current = selection();
    const key = JSON.stringify(current);
    if (!current) { lastSelection = ''; return JSON.stringify({noChange: true}); }
    if (key === lastSelection) return JSON.stringify({noChange: true});
    lastSelection = key;
    return JSON.stringify({...current, shiftKey: false});
  },
  async createTextLayerInSelection(data, point) {
    return mutate('TypeR : insérer', async doc => {
      const rect = await adjustedSelection(doc, data.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle?.size);
      await createInRect(doc, data, point, rect);
      return '';
    });
  },
  async createTextLayersInStoredSelections(data, point) {
    return mutate('TypeR : insérer les bulles', async (doc, context) => {
      if (!data.selections?.length || !data.texts?.length) throw new Error('Aucune bulle enregistrée.');
      const indexes = data.selections.map((rect, index) => ({rect, index})).filter(item => item.rect.documentId === undefined || item.rect.documentId === doc.id);
      if (!indexes.length) throw new Error('Aucune sélection pour cette page. Recapturez les bulles.');
      for (const {rect, index} of indexes) {
        if (context.isCancelled) throw new Error('Insertion annulée.');
        checkSelection(rect, doc.id);
        await createInRect(doc, {text: data.texts[index], style: clone(data.styles?.[index] || data.styles?.[0] || null), padding: data.padding, direction: data.direction, richTextRuns: data.richTextRuns?.[index]}, point, rect);
      }
      return '';
    });
  },
  async setActiveLayerText(data) {
    return mutate('TypeR : appliquer le texte et le style', async doc => {
      await forSelected(doc, async () => {
        const layer = await getLayer();
        const oldBounds = bounds(layer.boundsNoEffects || layer.bounds);
        const descriptor = makeTextDescriptor(data, layer.textKey, 20, doc.resolution);
        const shape = descriptor.textShape?.[0];
        const rect = shape && shape.bounds;
        const isPoint = !shape || shape.textType?._value === 'point';
        const reflowing = !isPoint && rect && !!data.text;
        const retained = reflowing ? {...rect} : null;
        if (reflowing) {
          const span = measureSpan(doc);
          rect.right = rect.left + span;
          rect.bottom = rect.top + span;
        }
        await setText(descriptor);
        await strokeStyle(data.style?.stroke);
        if (!isPoint && rect) await fitTextBox(doc, shape, retained, sizeInPoints(descriptor, doc.resolution));
        if (oldBounds) await moveTo(oldBounds);
      });
      return '';
    });
  },
  async alignTextLayerToSelection(data = {}) {
    return mutate('TypeR : centrer', async doc => {
      const layer = await getLayer();
      let live = usableBubble(await readSelection(), doc);
      if (!live) {
        try { if (doc.selection && doc.selection.deselect) await doc.selection.deselect(); } catch (_) {}
        live = await detectBubble(doc, layer);
      }
      if (!live) throw new Error('Impossible de détecter la bulle. Faites une sélection autour du texte.');
      const rect = await adjustedSelection(doc, layer.textKey.textStyleRange?.[0]?.textStyle?.size, live);
      if (data.resizeTextBox && layer.textKey.textShape?.[0]?.textType?._value === 'box') {
        const width = Math.max(10, rect.width * 0.9 - (data.padding || 0) * 2);
        await setText({_obj: 'textLayer', textShape: textBox(width, rect.height, doc.resolution)});
        // The frame then hugs what Photoshop laid out (host's
        // _resizeTextBoxToContent): a frame taller than its text leaves the
        // outline sticking out of the bubble, since box text sits at its top.
        const measured = await renderedExtent();
        if (measured) {
          const size = number(layer.textKey.textStyleRange?.[0]?.textStyle?.size) || 20;
          await setText({_obj: 'textLayer', textShape: textBox(width, measured.height + size + 2, doc.resolution)});
        }
      }
      try { await doc.selection.deselect(); } catch (_) {}
      await moveTo(rect);
      console.log('TypeR align', Math.round(rect.width), 'x', Math.round(rect.height));
      return '';
    });
  },
  async changeActiveLayerTextSize(delta) {
    if (!Number.isFinite(delta)) throw new Error('Taille invalide.');
    return mutate('TypeR : taille du texte', async doc => {
      await forSelected(doc, async () => {
        const layer = await getLayer();
        const oldBounds = bounds(layer.boundsNoEffects || layer.bounds);
        const text = clone(layer.textKey);
        text._obj = 'textLayer';
        for (const range of text.textStyleRange || []) {
          const style = range.textStyle;
          if (!style.size) continue;
          style.size._value = Math.max(0.1, style.size._value + delta);
          if (!style.autoLeading && style.leading) style.leading._value = Math.max(0.1, style.leading._value + delta);
          delete style.impliedFontSize;
        }
        await setText(text);
        if (oldBounds) await moveTo(oldBounds);
      });
      return '';
    });
  },
};

// The helper exports are the shared vocabulary for the other host modules
// (preview, layers, textshaper): they must not re-implement history handling,
// selection reads or layer lookups.
module.exports = {methods, play, mutate, selection, readSelection, liveSelection, checkSelection, inset, usableBubble, textBox, strokeStyle, readStroke, magicWandAt, detectBubble, getLayer, document, px, target};
