const ps = require('photoshop');
const {clone, number, fromActionJSON, makeTextDescriptor, defaultStyle, bounds} = require('./text-style');
const target = () => [{_ref: 'layer', _enum: 'ordinal', _value: 'targetEnum'}];
const px = (value) => ({_unit: 'pixelsUnit', _value: value});
const OPEN_RATIO = 0.1;
const MIN_OPEN_RADIUS = 4;
let monitoring = false;
let lastSelection = '';
let pending = Promise.resolve();
let changing = false;

// Which command failed is the whole diagnosis: several different commands named
// 'set' run in one session — the text, its shape, the marquee — and the bare
// name made a failure report that did not say which of them Photoshop refused.
// The target's property is the part that tells them apart.
function describe(descriptor) {
  const reference = descriptor._target && descriptor._target[0];
  const name = reference && (reference._property || reference._name || reference._ref);
  return name && name !== descriptor._obj ? `${descriptor._obj} ${name}` : String(descriptor._obj);
}

async function play(descriptor) {
  const [result] = await ps.action.batchPlay([{...descriptor, _options: {dialogOptions: 'dontDisplay'}}], {});
  if (result?._obj === 'error') {
    const detail = result.message || `erreur ${result.result}`;
    throw new Error(`Photoshop ${describe(descriptor)}: ${detail}`);
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
  return ps.app.documents.length ? liveSelection(ps.app.activeDocument) : null;
}

// Every modifying command is serialized and has one undo step. A failure rolls
// the whole operation back, including whatever part of a batch already ran.
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

// The single place the wand is spelled: `selection` is the property name
// Photoshop resolves for the document's selection channel, measured in the
// panel. The frame-selection name the ScriptListener records is not a name the
// JSON layer knows — trying it first raised "The command "Set" is not
// currently available" before the second spelling even ran, and no command may
// be sent speculatively: Photoshop alerts on the failed attempt itself.
async function magicWandAt(x, y, tolerance = 20) {
  const to = {_obj: 'paint', horizontal: px(Math.max(x, 0)), vertical: px(Math.max(y, 0))};
  await play({_obj: 'set', _target: [{_ref: 'channel', _property: 'selection'}], to, tolerance, merged: true, antiAlias: true, contiguous: true});
}

// A wand probe can land in the wrong place: in a neighbouring bubble, in a
// merged double bubble, or in the flat background behind a borderless bubble.
// A candidate counts as the bubble of a text only when it contains the centre
// of that text, is not absurdly larger than the text, and does not also hold
// the centre of a text that must be kept out (the other half of a double bubble).
function containsPoint(rect, x, y, tolerance = 0) {
  return x >= rect.left - tolerance && x <= rect.right + tolerance && y >= rect.top - tolerance && y <= rect.bottom + tolerance;
}

function containsBox(rect, box, tolerance = 2) {
  return box.left >= rect.left - tolerance && box.right <= rect.right + tolerance && box.top >= rect.top - tolerance && box.bottom <= rect.bottom + tolerance;
}

// The reference area pads the text by a few line heights, so a one-word text
// in a large bubble still qualifies while the page background does not.
const MAX_BUBBLE_RATIO = 40;

function bubbleCandidateValid(rect, box, doc, exclude = [], sizePixels = 20) {
  if (!usableBubble(rect, doc) || !box) return false;
  if (!containsPoint(rect, box.xMid, box.yMid, 1)) return false;
  const pad = 4 * (sizePixels > 0 ? sizePixels : 20);
  const reference = (box.width + pad) * (box.height + pad);
  if (rect.width * rect.height > reference * MAX_BUBBLE_RATIO) return false;
  return !exclude.some(other => containsPoint(rect, other.xMid, other.yMid));
}

function probePoints(box, margin) {
  return [
    [box.left - margin, box.yMid],
    [box.right + margin, box.yMid],
    [box.xMid, box.top - margin],
    [box.xMid, box.bottom + margin],
    [box.xMid, box.yMid],
  ];
}

function probeMargin(size) {
  return Math.max(5, Math.min(40, Math.round((number(size) || 20) * 0.25)));
}

// Returns the bubble marquee, with a `rearm` that puts that exact marquee back:
// the opening retries on it after a failed contraction, and nothing else can
// restore a wand selection (see openedSelection). Probing stops at the first
// candidate that holds the whole text, which is the bubble itself; otherwise
// the smallest valid candidate wins, so a probe that leaked into the page
// background or a neighbouring bubble no longer drags the text sideways.
async function detectBubble(doc, layer, options = {}) {
  const {best} = await probeBubble(doc, layer, options);
  return best;
}

// The probing itself. `loose` is what the same probes would have chosen with
// nothing excluded: when every candidate held another text's centre, that is
// the merged double bubble, found without probing a second time. Only `best`
// is left as the live marquee; `loose` has to be re-armed before use.
async function probeBubble(doc, layer, options = {}) {
  const box = options.box || bounds(layer.boundsNoEffects || layer.bounds);
  if (!box) return {best: null, loose: null};
  const size = layer.textKey?.textStyleRange?.[0]?.textStyle?.size;
  const sizePixels = displayedSize(layer.textKey, doc.resolution || 72).pixels;
  const exclude = options.exclude || [];
  const pick = (current, candidate) => {
    if (current && current.whole) return current;
    if (containsBox(candidate, box)) return {...candidate, whole: true};
    return !current || candidate.width * candidate.height < current.width * current.height ? candidate : current;
  };
  let best = null;
  let loose = null;
  for (const [x, y] of probePoints(box, probeMargin(Number.isFinite(sizePixels) ? sizePixels : size))) {
    try {
      await magicWandAt(x, y);
      // The wand has just replaced the marquee: the DOM still holds the
      // document as it was when the modal opened, so only batchPlay sees it.
      const found = await liveSelection(doc);
      if (!found || !bubbleCandidateValid(found, box, doc, [], sizePixels)) continue;
      const candidate = {...found, rearm: () => magicWandAt(x, y)};
      loose = pick(loose, candidate);
      if (exclude.some(other => containsPoint(found, other.xMid, other.yMid))) continue;
      best = pick(best, candidate);
      if (best.whole) break;
    } catch (error) {
      console.error('TypeR wand', error.message || error);
    }
  }
  // The marquee left behind is the last probe's, not necessarily the winner's.
  if (best && !sameRect(best, await liveSelection(doc))) {
    try { await best.rearm(); } catch (error) { console.error('TypeR réarmement', error.message || error); }
  }
  const strip = found => found && (({whole, ...rest}) => rest)(found);
  return {best: strip(best), loose: strip(loose)};
}

function sameRect(a, b) {
  return !!(a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);
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

// A morphological opening of the marquee (contract then expand by the same
// radius). The magic wand leaves every glyph it encloses as a hole, and the
// opening fills them: that is what makes the centring exact instead of an
// approximation of the bubble's bounding box. The radius follows the bubble
// size, halved while the result stays too small to be a bubble.
//
// The reference parked the marquee in a temporary channel and loaded it back
// between attempts. UXP has no channel API, and the actionJSON pair that stood
// in for it was not a Photoshop command: it raised "The command "<unknown>" is
// not currently available", then fell through to a bare `save`, which is Save
// As on the user's document. A retry re-runs the command that produced the
// marquee instead (`rearm`), so the opening touches no channel and cannot
// reach the user's files. A marquee nothing can put back — a selection the
// user drew — is simply attempted once, and the caller falls back to the plain
// bounds if that fails.
//
// Returns null when the marquee cannot be opened, so the caller can tell that
// apart from an opening that legitimately produced the same bounds.
async function openedSelection(doc, rect, rearm) {
  const shortest = Math.min(rect.width, rect.height);
  const maxRadius = Math.floor(shortest / 2 - 1);
  if (maxRadius <= 0) return null;
  const radius = Math.min(Math.max(MIN_OPEN_RADIUS, Math.round(shortest * OPEN_RATIO)), maxRadius);
  let attempt = radius;
  while (attempt >= 1) {
    // Every retry starts from the untouched marquee: a failed contract can
    // leave the selection empty.
    if (attempt !== radius) {
      if (!rearm) return null;
      try { await rearm(); }
      catch (error) {
        console.error('TypeR réarmement', error.message || error);
        return null;
      }
    }
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
// DOM cannot report it yet inside the modal session, so it is passed in, along
// with the `rearm` the wand attached to it when there is one.
async function adjustedSelection(doc, textSize, known) {
  let live = known || await readSelection();
  if (live) live = {...live, documentId: doc.id};
  const rect = checkSelection(live, doc.id);
  try {
    const opened = await openedSelection(doc, rect, live && live.rearm);
    if (opened) return checkSelection({...opened, documentId: doc.id}, doc.id);
  } catch (error) {
    console.error('TypeR centrage', error.message || error);
  }
  return checkSelection(adjustedBounds(rect, textSize), doc.id);
}

async function setText(descriptor) {
  await play({_obj: 'set', _target: [{_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: descriptor});
}

// Point text and box text are swapped by setting the layer's text-shape
// property, which is what the reference's _changeToPointText does. `textType`
// is the name both sides of the bridge use for it: the reference's text helper
// resolves that same string to an enumerated property for this key, and the
// shapes the panel reads back carry it too.
async function setTextShapeType(value) {
  await play({_obj: 'set', _target: [{_ref: 'property', _property: 'textType'}, {_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: {_enum: 'textType', _value: value}});
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
  if (layer && layer.id != null) await selectLayer(layer.id);
}

// "Keep the text size" (host.js _overrideStyleTextSize): every range of the
// style takes `size`, a {value, unit} pair, converted to the style's type unit.
function overrideStyleSize(style, size, resolution = 72) {
  if (!size || !(size.value > 0)) return style;
  const output = clone(style && style.textProps && style.textProps.layerText ? style : {...(style || {}), textProps: defaultStyle().textProps});
  const typeUnit = output.textProps.typeUnit || 'pointsUnit';
  let value = size.value;
  if (size.unit === 'pointsUnit' && typeUnit === 'pixelsUnit') value *= resolution / 72;
  if (size.unit === 'pixelsUnit' && typeUnit === 'pointsUnit') value *= 72 / resolution;
  for (const range of output.textProps.layerText.textStyleRange || []) {
    if (!range || !range.textStyle) continue;
    range.textStyle.size = value;
    delete range.textStyle.impliedFontSize;
  }
  return output;
}

// The size a paste keeps: what the active text layer displays, since the new
// layer has no transform to scale a stored size by. Null when the active layer
// is not text, which the panel reports as "sizeSource".
async function activeTextSize(doc) {
  let layer = null;
  try { layer = await play({_obj: 'get', _target: target()}); } catch (_) { return null; }
  if (!layer || !layer.textKey) return null;
  const size = displayedSize(layer.textKey, doc.resolution || 72);
  return Number.isFinite(size.value) ? {value: size.value, unit: size.unit} : null;
}

// The same option on an existing layer keeps that layer's own stored size: its
// transform is kept too, so the displayed size does not change.
function keepLayerSize(data, textKey, resolution) {
  if (!data || !data.preserveActiveTextSize || !data.style || !textKey) return data;
  const size = textKey.textStyleRange?.[0]?.textStyle?.size;
  const value = number(size);
  if (!Number.isFinite(value) || value <= 0) return data;
  return {...data, style: overrideStyleSize(data.style, {value, unit: size._unit || 'pointsUnit'}, resolution)};
}

const SIZE_SOURCE = 'sizeSource';

// Resolves the "keep the text size" option before anything is created: a
// paste without a text layer to copy the size from changes nothing.
async function pasteSize(doc, data) {
  if (!data.preserveActiveTextSize) return null;
  const size = await activeTextSize(doc);
  if (!size) throw Object.assign(new Error('Sélectionnez un calque de texte pour garder sa taille.'), {code: SIZE_SOURCE});
  return size;
}

// The panel shows its own alert for this one result, so it is answered as the
// reference's bare string rather than as a script error.
async function sizeSourceResult(task) {
  try { return await task; }
  catch (error) {
    if (error && error.code === SIZE_SOURCE) return SIZE_SOURCE;
    throw error;
  }
}

async function createInRect(doc, data, point, rect) {
  checkSelection(rect, doc.id);
  if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('Aucun texte spécifié.');
  const text = data.text.replace(/\r\n|\n/g, '\r');
  const width = Math.max(10, rect.width * 0.9 - Math.max(0, data.padding || 0) * 2);
  const size = number(data.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle?.size) || 20;
  await deselect(doc);
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
  if (point) await setTextShapeType('point');
  try { await strokeStyle(data.style?.stroke); } catch (error) { console.error('TypeR stroke', error.message || error); }
  await moveTo(rect);
  if (createdLayer && createdLayer.id != null) return createdLayer.id;
  const info = await getLayer();
  return info.layerID;
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
    await selectLayer(layer.id);
    await callback();
  }
  await reselect(layers.map(layer => layer.id));
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
    return sizeSourceResult(mutate('TypeR : insérer', async doc => {
      const size = await pasteSize(doc, data);
      const pasted = size ? {...data, style: overrideStyleSize(data.style, size, doc.resolution)} : data;
      const rect = await adjustedSelection(doc, pasted.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle?.size);
      const id = await createInRect(doc, pasted, point, rect);
      await autoCenter(doc, [id], data);
      return '';
    }));
  },
  // One text per stored selection, as the reference pairs them: the panel
  // stops its list of texts at the first selection it has no line for, so the
  // selections past the last text get nothing, and an empty text leaves its
  // selection empty. Every selection is checked before the first layer lands.
  async createTextLayersInStoredSelections(data, point) {
    return sizeSourceResult(mutate('TypeR : insérer les bulles', async (doc, context) => {
      const size = await pasteSize(doc, data);
      const texts = data.texts || [];
      if (!data.selections?.length || !texts.length) throw new Error('Aucune bulle enregistrée.');
      const styles = data.styles || [];
      const count = Math.min(texts.length, data.selections.length);
      const jobs = [];
      for (let i = 0; i < count; i++) {
        const rect = data.selections[i];
        if (!rect || (rect.documentId !== undefined && rect.documentId !== doc.id)) continue;
        jobs.push({rect, i});
      }
      if (!jobs.length) throw new Error('Aucune sélection pour cette page. Recapturez les bulles.');
      const filled = jobs.filter(({i}) => typeof texts[i] === 'string' && texts[i].trim());
      if (!filled.length) throw new Error('Aucun texte spécifié.');
      for (const {rect} of filled) checkSelection(rect, doc.id);
      const ids = [];
      for (const {rect, i} of filled) {
        if (context.isCancelled) throw new Error('Insertion annulée.');
        const base = clone(styles[i] || styles[styles.length - 1] || null);
        const style = size ? overrideStyleSize(base, size, doc.resolution) : base;
        const mode = data.pointModes?.[i];
        const pointText = mode === undefined || mode === null ? point : !!mode;
        ids.push(await createInRect(doc, {text: texts[i], style, padding: data.padding, direction: data.direction, richTextRuns: data.richTextRuns?.[i]}, pointText, rect));
      }
      await autoCenter(doc, ids, data);
      return '';
    }));
  },
  async setActiveLayerText(data) {
    return mutate('TypeR : appliquer le texte et le style', async doc => {
      await forSelected(doc, async () => {
        const layer = await getLayer();
        const oldBounds = bounds(layer.boundsNoEffects || layer.bounds);
        const descriptor = makeTextDescriptor(keepLayerSize(data, layer.textKey, doc.resolution), layer.textKey, 20, doc.resolution);
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
      // A marquee the user drew is read once, before any wand replaces it, and
      // opened once: every selected layer whose centre it holds is centred in it.
      const user = usableBubble(await readSelection(), doc);
      let userRect = null;
      let cleared = false;
      const rectFor = async (layer, box) => {
        const size = layer.textKey.textStyleRange?.[0]?.textStyle?.size;
        if (user && box && containsPoint(user, box.xMid, box.yMid, 1)) {
          if (!userRect) userRect = await adjustedSelection(doc, size, user);
          return userRect;
        }
        if (user && !cleared) {
          // A later layer may still sit in the user's marquee, and its opening
          // needs the live marquee the wand is about to replace: it is opened
          // now when other layers follow. Clearing it used to drop it, so those
          // layers were wanded instead.
          if (!userRect && Array.from(doc.activeLayers || []).length > 1) userRect = await adjustedSelection(doc, size, user);
          await deselect(doc);
          cleared = true;
        }
        const live = await detectBubble(doc, layer);
        if (!live) throw new Error('Impossible de détecter la bulle. Faites une sélection autour du texte.');
        return adjustedSelection(doc, size, live);
      };
      if (!user) await deselect(doc);
      let last = null;
      await forTextLayers(doc, async () => {
        const layer = await getLayer();
        const box = bounds(layer.boundsNoEffects || layer.bounds);
        const rect = await rectFor(layer, box);
        await placeInRect(doc, layer, rect, data);
        last = rect;
      });
      await deselect(doc);
      if (last) console.log('TypeR align', Math.round(last.width), 'x', Math.round(last.height));
      return '';
    });
  },
  // Double (or chained) bubbles: one text per lobe. Each text first gets its
  // own wand probe, which is accepted only if it does not reach another
  // text's centre — two touching bubbles are then centred independently. When
  // the lobes are merged into one shape, that shape is cut between the texts
  // and each text is centred on its own part of it.
  async alignTextLayersToDoubleBubble(data = {}) {
    return mutate('TypeR : centrer double bulle', async doc => {
      const layers = Array.from(doc.activeLayers || []);
      if (layers.length < 2 || layers.some(layer => layer.kind !== ps.constants.LayerKind.TEXT)) {
        throw new Error('Sélectionnez les calques de texte de chaque partie de la bulle (au moins 2).');
      }
      const user = usableBubble(await readSelection(), doc);
      const items = [];
      for (const layer of layers) {
        await selectLayer(layer.id);
        const info = await getLayer();
        const box = bounds(info.boundsNoEffects || info.bounds);
        if (!box) throw new Error('Un des calques de texte est vide.');
        items.push({id: layer.id, info, box, rect: null});
      }
      const size = items[0].info.textKey.textStyleRange?.[0]?.textStyle?.size;
      const union = unionRect(items.map(item => item.box));
      let merged = null;
      if (user && items.every(item => containsPoint(user, item.box.xMid, item.box.yMid, 1))) {
        merged = {rect: await adjustedSelection(doc, size, user), rearm: null};
      } else {
        await deselect(doc);
        for (const item of items) {
          const exclude = items.filter(other => other !== item).map(other => other.box);
          const live = await detectBubble(doc, item.info, {exclude});
          if (live) item.rect = await adjustedSelection(doc, size, live);
        }
        if (items.some(item => !item.rect)) {
          const live = await detectBubble(doc, items[0].info, {box: union});
          if (!live) throw new Error('Impossible de détecter la double bulle. Faites une sélection autour des deux bulles.');
          merged = {rect: await adjustedSelection(doc, size, live), rearm: live.rearm};
        }
      }
      if (merged) {
        const lobes = splitBubble(merged.rect, items.map(item => item.box));
        for (let i = 0; i < items.length; i++) {
          items[i].rect = (merged.rearm && await tightLobe(doc, merged.rearm, lobes[i], items[i].box)) || lobes[i];
        }
      }
      await deselect(doc);
      for (const item of items) {
        await selectLayer(item.id);
        await placeInRect(doc, await getLayer(), item.rect, data);
      }
      await reselect(items.map(item => item.id));
      return '';
    });
  },
  async changeActiveLayerTextSize(delta) {
    if (!Number.isFinite(delta) || !delta) throw new Error('Taille invalide.');
    return mutate('TypeR : taille du texte', async doc => {
      await forSelected(doc, async () => {
        const layer = await getLayer();
        await resizeText(layer, delta, doc.resolution);
      });
      return '';
    });
  },
};

async function deselect(doc) {
  try { if (doc.selection && doc.selection.deselect) await doc.selection.deselect(); } catch (_) {}
}

async function selectLayer(id) {
  await play({_obj: 'select', _target: [{_ref: 'layer', _id: id}], makeVisible: false});
}

async function reselect(ids) {
  for (let i = 0; i < ids.length; i++) {
    await play({_obj: 'select', _target: [{_ref: 'layer', _id: ids[i]}], ...(i ? {selectionModifier: {_enum: 'selectionModifierType', _value: 'addToSelection'}} : {}), makeVisible: false});
  }
}

// Like forSelected, but with nothing reported as selected (the DOM can lag
// behind a layer the user has just clicked) it works on the target layer.
async function forTextLayers(doc, callback) {
  const layers = Array.from(doc.activeLayers || []);
  if (!layers.length) return callback();
  return forSelected(doc, callback);
}

// Centres a text layer on `rect`, resizing a box first when asked. Point
// text has no frame to resize: it is only moved (the reference skipped it too).
async function placeInRect(doc, layer, rect, data = {}) {
  if (data.resizeTextBox && layer.textKey.textShape?.[0]?.textType?._value === 'box') {
    const width = Math.max(10, rect.width * 0.9 - (data.padding || 0) * 2);
    await setText({_obj: 'textLayer', textShape: textBox(width, rect.height, doc.resolution)});
    // The frame then hugs what Photoshop laid out (host's
    // _resizeTextBoxToContent): a frame taller than its text leaves the
    // outline sticking out of the bubble, since box text sits at its top.
    const measured = await renderedExtent();
    if (measured) {
      const size = displayedSize(layer.textKey, doc.resolution).pixels || 20;
      await setText({_obj: 'textLayer', textShape: textBox(width, measured.height + size + 2, doc.resolution)});
    }
  }
  await moveTo(rect);
}

// Visible text layers of the document other than `skip`, with their bounds.
// Only used to recognise the other half of a double bubble, so the DOM's
// view (frozen when the modal opened) is good enough: those layers predate it.
// A locked one still counts as the other half, but is never moved.
function textNeighbours(doc, skip) {
  const found = [];
  const walk = (layers, visible) => {
    for (const layer of layers) {
      const shown = visible && layer.visible !== false;
      if (layer.layers && layer.layers.length) walk(Array.from(layer.layers), shown);
      else if (shown && layer.kind === ps.constants.LayerKind.TEXT && skip.indexOf(layer.id) === -1) {
        const box = bounds(layer.boundsNoEffects || layer.bounds);
        if (box) found.push({id: layer.id, box, neighbour: true, locked: !!(layer.allLocked || layer.positionLocked)});
      }
    }
  };
  try { walk(Array.from(doc.layers || []), true); }
  catch (error) { console.error('TypeR calques voisins', error.message || error); }
  return found;
}

const AUTO_CENTER_MODES = ['single', 'multi'];

// Centring right after a paste, inside the paste's own undo step. The paste
// put the text on the middle of the marquee the user drew, which is rarely
// the middle of the bubble; this re-detects the bubble around each new text.
// "single" centres each text in the bubble found around it, like the Centre
// command. "multi" also recognises double bubbles: a text whose bubble holds
// another text (pasted with it, or already on the page) shares it, and the
// bubble is cut between them as the double-bubble command does. A text whose
// bubble cannot be found keeps the paste position: auto-centring never fails
// a paste.
async function autoCenter(doc, ids, data = {}) {
  const mode = data.autoCenter;
  if (AUTO_CENTER_MODES.indexOf(mode) === -1) return;
  const created = ids.filter(id => id != null);
  if (!created.length) return;
  const sizeOf = info => info.textKey?.textStyleRange?.[0]?.textStyle?.size;
  try {
    const items = [];
    for (const id of created) {
      await selectLayer(id);
      const info = await getLayer();
      const box = bounds(info.boundsNoEffects || info.bounds);
      if (box) items.push({id, info, box, rect: null});
    }
    await deselect(doc);
    const neighbours = mode === 'multi' ? textNeighbours(doc, created) : [];
    for (const item of items) {
      const exclude = mode === 'multi'
        ? items.filter(other => other !== item).map(other => other.box).concat(neighbours.map(other => other.box))
        : [];
      const {best, loose} = await probeBubble(doc, item.info, {exclude});
      if (best) item.rect = await adjustedSelection(doc, sizeOf(item.info), best);
      else item.merged = loose;
    }
    const moves = [];
    if (mode === 'multi') {
      for (const item of items) {
        if (item.rect || !item.merged) continue;
        // The probes already found the shared bubble: one wand puts it back,
        // where re-detecting it cost five wands and five reads.
        const merged = item.merged;
        try { await merged.rearm(); } catch (error) { console.error('TypeR réarmement', error.message || error); continue; }
        const inside = other => containsPoint(merged, other.box.xMid, other.box.yMid, 1);
        const group = [item]
          .concat(items.filter(other => other !== item && !other.rect && inside(other)))
          .concat(neighbours.filter(other => !other.rect && inside(other)));
        const rect = await adjustedSelection(doc, sizeOf(item.info), merged);
        if (group.length === 1) { item.rect = rect; continue; }
        const lobes = splitBubble(rect, group.map(member => member.box));
        for (let i = 0; i < group.length; i++) {
          group[i].rect = (merged.rearm && await tightLobe(doc, merged.rearm, lobes[i], group[i].box)) || lobes[i];
          if (group[i].neighbour && !group[i].locked) moves.push(group[i]);
        }
      }
    }
    await deselect(doc);
    // One layer that cannot be placed leaves the others centred.
    let placed = 0;
    for (const item of items.concat(moves)) {
      if (!item.rect) continue;
      try {
        await selectLayer(item.id);
        await placeInRect(doc, await getLayer(), item.rect, data);
        placed++;
      } catch (error) {
        console.error('TypeR auto-centrage', item.id, error.message || error);
      }
    }
    console.log('TypeR auto-centrage', mode, placed + '/' + (items.length + moves.length));
  } catch (error) {
    console.error('TypeR auto-centrage', error.message || error);
  }
  await deselect(doc);
  try { await reselect(created); } catch (_) {}
}

function unionRect(rects) {
  return bounds({
    left: Math.min(...rects.map(rect => rect.left)),
    top: Math.min(...rects.map(rect => rect.top)),
    right: Math.max(...rects.map(rect => rect.right)),
    bottom: Math.max(...rects.map(rect => rect.bottom)),
  });
}

// Cuts a merged bubble into one part per text. An axis is cut only where the
// texts are apart along it: two bubbles stacked vertically are cut
// horizontally, diagonal ones on both axes. The cut sits in the middle of
// the gap between neighbouring texts.
function splitBubble(rect, boxes) {
  const separated = (lo, hi) => {
    const order = boxes.map((box, index) => ({box, index})).sort((a, b) => (a.box[lo] + a.box[hi]) - (b.box[lo] + b.box[hi]));
    for (let i = 1; i < order.length; i++) if (order[i].box[lo] < order[i - 1].box[hi]) return null;
    return order;
  };
  const cuts = (order, lo, hi) => {
    const limits = boxes.map(() => [rect[lo], rect[hi]]);
    for (let i = 1; i < order.length; i++) {
      const cut = (order[i - 1].box[hi] + order[i].box[lo]) / 2;
      limits[order[i - 1].index][1] = cut;
      limits[order[i].index][0] = cut;
    }
    return limits;
  };
  let byX = separated('left', 'right');
  let byY = separated('top', 'bottom');
  if (!byX && !byY) {
    // Overlapping texts: fall back on the axis their centres are furthest apart.
    const spreadX = Math.max(...boxes.map(box => box.xMid)) - Math.min(...boxes.map(box => box.xMid));
    const spreadY = Math.max(...boxes.map(box => box.yMid)) - Math.min(...boxes.map(box => box.yMid));
    const byCentre = (mid) => boxes.map((box, index) => ({box: {...box, lo: box[mid], hi: box[mid]}, index})).sort((a, b) => a.box.lo - b.box.lo);
    const centreCuts = (mid, lo, hi) => {
      const order = byCentre(mid);
      const limits = boxes.map(() => [rect[lo], rect[hi]]);
      for (let i = 1; i < order.length; i++) {
        const cut = (order[i - 1].box.lo + order[i].box.lo) / 2;
        limits[order[i - 1].index][1] = cut;
        limits[order[i].index][0] = cut;
      }
      return limits;
    };
    if (spreadX >= spreadY) {
      const xs = centreCuts('xMid', 'left', 'right');
      return boxes.map((_, i) => bounds({left: xs[i][0], right: xs[i][1], top: rect.top, bottom: rect.bottom}));
    }
    const ys = centreCuts('yMid', 'top', 'bottom');
    return boxes.map((_, i) => bounds({left: rect.left, right: rect.right, top: ys[i][0], bottom: ys[i][1]}));
  }
  const xs = byX ? cuts(byX, 'left', 'right') : boxes.map(() => [rect.left, rect.right]);
  const ys = byY ? cuts(byY, 'top', 'bottom') : boxes.map(() => [rect.top, rect.bottom]);
  return boxes.map((_, i) => bounds({left: xs[i][0], right: xs[i][1], top: ys[i][0], bottom: ys[i][1]}) || rect);
}

// The rectangular cut gives the lobe's extent along the cut axis only: a
// round lobe is narrower than the merged shape across it. Intersecting the
// wand marquee with the cut measures the lobe's real extent. Any failure keeps
// the rectangular cut.
async function tightLobe(doc, rearm, lobe, box) {
  if (!lobe) return null;
  try {
    await rearm();
    await play({_obj: 'intersectWith', _target: [{_ref: 'channel', _property: 'selection'}], to: {_obj: 'rectangle', top: px(lobe.top), left: px(lobe.left), bottom: px(lobe.bottom), right: px(lobe.right)}});
    const tight = await liveSelection(doc);
    if (tight && usableBubble(tight, doc) && containsPoint(tight, box.xMid, box.yMid, 1)) return tight;
  } catch (error) {
    console.error('TypeR double bulle', error.message || error);
  }
  return null;
}

// The size Photoshop shows is the stored size times the layer's transform
// scale: a text pasted small and scaled up, or the reverse, stores a size that
// can be several times off what the user reads. Increments are meant on the
// displayed size, so the stored one changes by the same ratio.
function transformScale(textKey) {
  const t = textKey && textKey.transform;
  if (!t) return 1;
  const sx = Math.hypot(number(t.xx) || 0, number(t.xy) || 0);
  const sy = Math.hypot(number(t.yx) || 0, number(t.yy) || 0);
  const scale = sy || sx;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function displayedSize(textKey, resolution = 72) {
  const style = textKey?.textStyleRange?.[0]?.textStyle || {};
  const base = number(style.size);
  const implied = number(style.impliedFontSize);
  const unit = style.size?._unit || 'pointsUnit';
  let value = Number.isFinite(implied) && implied > 0 ? implied : (Number.isFinite(base) ? base * transformScale(textKey) : NaN);
  if (!Number.isFinite(value) || value <= 0) return {value: NaN, unit, pixels: NaN};
  const pixels = unit === 'pixelsUnit' ? value : value * resolution / 72;
  return {value, unit, pixels};
}

const MIN_DISPLAYED_SIZE = 1;

async function resizeText(layer, delta, resolution = 72) {
  const textKey = layer.textKey;
  const ranges = Array.from(textKey.textStyleRange || []).filter(range => range.textStyle && range.textStyle.size);
  if (!ranges.length) return;
  const oldBounds = bounds(layer.boundsNoEffects || layer.bounds);
  const first = ranges[0].textStyle;
  const base = number(first.size);
  const shown = displayedSize(textKey).value;
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(shown)) return;
  const nextShown = Math.max(MIN_DISPLAYED_SIZE, shown + delta);
  const ratio = nextShown / shown;
  if (Math.abs(ratio - 1) < 1e-6) return;
  // A size read back as a bare number has no unit of its own: it is in points,
  // as displayedSize assumes, and a write must never carry an undefined unit.
  const unitOf = size => (size && size._unit) || 'pointsUnit';
  const unit = unitOf(first.size);
  const uniform = ranges.every(range => number(range.textStyle.size) === base && unitOf(range.textStyle.size) === unit);
  let done = false;
  if (uniform) {
    // The reference's fast path: only the size property changes, so the
    // text, its runs, its transform and its frame are left to Photoshop.
    const style = {_obj: 'textStyle', size: {_unit: unit, _value: base * ratio}};
    const leadings = ranges.map(range => range.textStyle);
    if (leadings.every(item => !item.autoLeading && item.leading && number(item.leading) === number(first.leading))) {
      style.leading = {_unit: first.leading._unit || unit, _value: number(first.leading) * ratio};
    }
    try {
      await play({_obj: 'set', _target: [{_ref: 'property', _property: 'textStyle'}, {_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: style});
      done = true;
    } catch (error) {
      console.error('TypeR taille', error.message || error);
    }
  }
  // Box text keeps its line breaks: the frame scales with the text. Without
  // it a larger text overflows the frame and vanishes, and its bounds (which
  // the recentring reads) collapse onto what is left. A purely proportional
  // frame is not enough: glyph widths do not scale exactly (hinting, kerning,
  // rounding), so a line that filled its frame re-wraps one word early and the
  // bubble shape breaks. The frame therefore gets a little horizontal slack,
  // too small to pull a word back up, and one spare line of height, which
  // stays empty and never moves the text (the recentring reads the rendered
  // bounds, not the frame).
  const shape = textKey.textShape?.[0];
  const scaledShape = shape && shape.textType?._value === 'box' && shape.bounds ? clone(shape) : null;
  if (scaledShape) {
    const b = scaledShape.bounds;
    for (const key of ['top', 'left', 'right', 'bottom']) {
      const value = number(b[key]);
      if (Number.isFinite(value)) b[key] = value * ratio;
    }
    const sizePoints = unit === 'pixelsUnit' ? base * ratio * 72 / (resolution || 72) : base * ratio;
    if (Number.isFinite(number(b.right))) b.right = number(b.right) + Math.max(2, sizePoints * 0.3);
    if (Number.isFinite(number(b.bottom))) b.bottom = number(b.bottom) + sizePoints * 1.2;
  }
  if (!done) {
    // Mixed sizes keep their proportions: every run scales by the same ratio.
    const text = clone(textKey);
    text._obj = 'textLayer';
    for (const range of text.textStyleRange || []) {
      const style = range.textStyle;
      if (!style || !style.size) continue;
      style.size = {_unit: unitOf(style.size), _value: Math.max(0.1, number(style.size) * ratio)};
      if (!style.autoLeading && style.leading) style.leading = {_unit: unitOf(style.leading), _value: Math.max(0.1, number(style.leading) * ratio)};
      delete style.impliedFontSize;
      delete style.impliedLeading;
      delete style.impliedBaselineShift;
    }
    for (const key of ['bounds', 'boundingBox']) delete text[key];
    if (scaledShape) text.textShape = [scaledShape];
    await setText(text);
  }
  // Read back what Photoshop now displays. Whatever it made of the stored
  // size (transform, unit, a rounding), a result off the target is corrected
  // once by the observed ratio, so repeated increments can never drift or
  // collapse to the minimum. This runs before the frame is set so the frame
  // matches the final size.
  if (uniform && done) {
    try {
      const after = await getLayer();
      const now = displayedSize(after.textKey).value;
      const stored = number(after.textKey.textStyleRange?.[0]?.textStyle?.size);
      if (Number.isFinite(now) && now > 0 && Number.isFinite(stored) && Math.abs(now - nextShown) > 0.05 && nextShown / now > 0.5 && nextShown / now < 2) {
        await play({_obj: 'set', _target: [{_ref: 'property', _property: 'textStyle'}, {_ref: 'textLayer', _enum: 'ordinal', _value: 'targetEnum'}], to: {_obj: 'textStyle', size: {_unit: unit, _value: stored * nextShown / now}}});
      }
    } catch (error) {
      console.error('TypeR taille (vérification)', error.message || error);
    }
  }
  if (done && scaledShape) {
    try { await setText({_obj: 'textLayer', textShape: [scaledShape]}); }
    catch (error) { console.error('TypeR cadre', error.message || error); }
  }
  if (oldBounds) await moveTo(oldBounds);
}

// The helper exports are the shared vocabulary for the other host modules
// (preview, layers, textshaper): they must not re-implement history handling,
// selection reads or layer lookups.
module.exports = {methods, overrideStyleSize, keepLayerSize, splitBubble, bubbleCandidateValid, displayedSize, play, mutate, selection, readSelection, liveSelection, checkSelection, inset, usableBubble, textBox, strokeStyle, readStroke, magicWandAt, detectBubble, setTextShapeType, getLayer, document, px, target, setText, moveTo, selectLayer, reselect, deselect};
