const ps = require('photoshop');
const {play, mutate, readSelection, liveSelection, readStroke, magicWandAt, getLayer, px, target} = require('./photoshop');
const {number, bounds, fromActionJSON} = require('./text-style');

const hasDocument = () => ps.app.documents.length > 0;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const sampleCount = (value, fallback) => Math.min(31, Math.max(5, parseInt(value, 10) || fallback));
// mutate() rolls back only when its callback throws: the scan result leaves
// through this marker, so a scan keeps neither a history entry nor a stray
// selection, channel or work path in the document.
const ROLLED_BACK = 'TypeR scan rollback';

async function scanned(name, callback) {
  let value = null;
  try {
    await mutate(name, async (doc) => {
      value = await callback(doc);
      throw new Error(ROLLED_BACK);
    });
  } catch (error) {
    if (!String((error && error.message) || error || '').includes(ROLLED_BACK)) throw error;
  }
  return value;
}

async function attempt(getter) {
  try { return await getter(); } catch (_) { return null; }
}

// Property reads instead of one full layer descriptor: the panel polls these on
// every Photoshop event, and a descriptor drags the whole text payload along.
async function layerProperty(property) {
  const result = await attempt(() => play({_obj: 'get', _target: [{_property: property}, ...target()]}));
  return (result && result[property]) || null;
}

async function targetLayerId() {
  const value = number(await layerProperty('layerID'));
  return Number.isFinite(value) ? value : null;
}

async function targetLayerBounds() {
  return bounds(await layerProperty('bounds'));
}

async function historyIndex() {
  const result = await attempt(() => play({_obj: 'get', _target: [{_ref: 'historyState', _enum: 'ordinal', _value: 'targetEnum'}]}));
  const value = number(result && result.itemIndex);
  return Number.isFinite(value) ? value - 1 : null;
}

// The shared reader adds the document id the centring code needs; the scan
// results are built from the bare rectangle.
const liveBounds = async (doc) => bounds(await liveSelection(doc));

function textPayload(layer, layerId) {
  const text = layer.textKey || {};
  const size = text.textStyleRange?.[0]?.textStyle?.size;
  return {
    layerId,
    bounds: bounds(layer.boundsNoEffects || layer.bounds),
    textType: text.textShape?.[0]?.textType?._value === 'point' ? 'point' : 'paragraph',
    textProps: {layerText: fromActionJSON(text), typeUnit: size?._unit || 'pointsUnit'},
    stroke: readStroke(layer),
  };
}

// Identity and history index are cheap reads: a signature the panel already
// holds stops the text payload from being read again on the next poll.
async function activeLayer(data) {
  if (!hasDocument()) return {error: 'layer', signature: ''};
  const layers = Array.from(ps.app.activeDocument.activeLayers || []);
  if (!layers.length || layers[0].kind !== ps.constants.LayerKind.TEXT) return {error: 'layer', signature: ''};
  const layerId = await targetLayerId();
  const index = await historyIndex();
  const signature = `${layerId}:${index}`;
  if (layerId !== null && index !== null && data.signature === signature) return {unchanged: true, signature};
  const layer = await attempt(getLayer);
  return layer ? {...textPayload(layer, layerId), signature} : {error: 'layer', signature};
}

// Several paths can live in the document, and the outline is normalized against
// its own bounding box: only the path the wand just produced is read, through
// the target reference, so no path enumeration is needed.
async function pathPolygons() {
  const point = (unit) => unit ? [number(unit.horizontal), number(unit.vertical)] : null;
  let descriptor = null;
  try {
    descriptor = await play({_obj: 'get', _target: [{_ref: 'path', _enum: 'ordinal', _value: 'targetEnum'}]});
  } catch (error) {
    return {error: `path:${error.message || error}`};
  }
  const polygons = [];
  for (const component of descriptor.pathContents?.pathComponents || []) {
    for (const subpath of component.subpathListKey || []) {
      const points = subpath.points || [];
      if (points.length < 3) continue;
      // On noisy outlines (a wand that caught screentone) the point count
      // explodes: there the anchors alone are dense enough, so the curves are
      // not flattened.
      const steps = points.length > 500 ? 1 : 6;
      const polygon = [];
      for (let index = 0; index < points.length; index++) {
        const from = point(points[index].anchor) || [0, 0];
        const control1 = point(points[index].forward) || from;
        const next = points[(index + 1) % points.length];
        const to = point(next.anchor) || [0, 0];
        const control2 = point(next.backward) || to;
        const straight = control1[0] === from[0] && control1[1] === from[1] && control2[0] === to[0] && control2[1] === to[1];
        const count = straight ? 1 : steps;
        for (let step = 0; step < count; step++) {
          const u = step / count;
          const v = 1 - u;
          polygon.push([0, 1].map(axis => v * v * v * from[axis] + 3 * v * v * u * control1[axis] + 3 * v * u * u * control2[axis] + u * u * u * to[axis]));
        }
      }
      if (polygon.length >= 3) polygons.push(polygon);
    }
  }
  return polygons.length ? {polygons} : {error: 'noPolygons'};
}

// Half-open rule so a scanline crossing a vertex counts it exactly once.
function scanlineSpan(polygons, y) {
  let left = null;
  let right = null;
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index++) {
      const from = polygon[index];
      const to = polygon[(index + 1) % polygon.length];
      if ((from[1] <= y && to[1] > y) || (to[1] <= y && from[1] > y)) {
        const x = from[0] + ((y - from[1]) / (to[1] - from[1])) * (to[0] - from[0]);
        if (left === null || x < left) left = x;
        if (right === null || x > right) right = x;
      }
    }
  }
  return left === null ? null : {left, right};
}

function pathRows(polygons, count) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const point of polygon) {
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;
  const sliceHeight = height / count;
  const rows = [];
  let covered = 0;
  for (let index = 0; index < count; index++) {
    const y = index / (count - 1);
    const yMid = minY + height * y;
    let left = null;
    let right = null;
    // The reference's pixel sampler measured the widest extent inside each
    // band: three scanlines per band keep that behaviour.
    for (const offset of [-sliceHeight / 2, 0, sliceHeight / 2]) {
      let scanY = yMid + offset;
      if (scanY <= minY) scanY = minY + height * 0.002;
      if (scanY >= maxY) scanY = maxY - height * 0.002;
      const span = scanlineSpan(polygons, scanY);
      if (!span) continue;
      if (left === null || span.left < left) left = span.left;
      if (right === null || span.right > right) right = span.right;
    }
    if (left !== null && right > left) {
      covered++;
      rows.push({y, left: clamp01((left - minX) / width), right: clamp01((right - minX) / width), width: clamp01((right - left) / width)});
    } else {
      rows.push({y, left: 0.5, right: 0.5, width: 0});
    }
  }
  return covered ? rows : null;
}

function boundsRows(count) {
  return Array.from({length: count}, (_, index) => ({y: index / (count - 1), left: 0, right: 1, width: 1}));
}

// One make-work-path call replaces the reference's 21 rect-and-channel sampling
// loop; the conversion consumes the selection, and the scan's rollback brings it
// back, so no temporary channel is needed on this side.
async function selectionShape(bounds, count) {
  let polygons = null;
  try {
    await play({_obj: 'make', _target: [{_ref: 'path'}], from: {_ref: 'channel', _property: 'selection'}, tolerance: px(2)});
    polygons = await pathPolygons();
  } catch (error) {
    polygons = {error: `make:${error.message || error}`};
  }
  const rows = polygons.polygons && pathRows(polygons.polygons, count);
  if (rows) return {scan: 'path', bounds, rows, fallback: false};
  return {bounds, rows: boundsRows(count), fallback: true, scanError: polygons.error || 'emptyRows'};
}

// The wand itself is shared (photoshop.js): no spelling of it has been run
// against a real Photoshop yet, so it must not be guessed in two places.
function magicWand(text, tolerance) {
  return magicWandAt((text ? text.left : 0) - 5, text ? text.yMid : 0, tolerance);
}

// Never over-contract a small selection: at least 2px are kept per side.
function clampContract(rect, amount) {
  if (!rect || amount >= 0) return amount;
  const limit = Math.floor(Math.min(rect.width, rect.height) / 2 - 1);
  return limit <= 0 ? 0 : -Math.min(Math.abs(amount), limit);
}

async function bubbleShape(doc, layer, tolerance, count) {
  try {
    const text = bounds(layer.boundsNoEffects || layer.bounds);
    await magicWand(text, tolerance);
    const found = await liveBounds(doc);
    if (!found || found.width * found.height < 200) return {error: 'noBubble'};
    // A wand escaping the bubble (open outline, plain page background) grabs a
    // huge area: reject implausible bubbles instead of shaping to the page.
    if (text && text.width > 0 && text.height > 0 && (found.width * found.height) / (text.width * text.height) > 60) return {error: 'noBubble'};
    // Close the text holes and smooth the outline before sampling.
    const smooth = Math.max(4, Math.round((number(layer.textKey?.textStyleRange?.[0]?.textStyle?.size) || 20) / 2));
    await play({_obj: 'expand', by: px(smooth)});
    const expanded = await liveBounds(doc);
    const contract = clampContract(expanded, -smooth);
    if (contract !== 0) await play({_obj: 'contract', by: px(Math.abs(contract))});
    return selectionShape((await liveBounds(doc)) || expanded || found, count);
  } catch (error) {
    // The wand or a geometry command failed: there is nothing to sample, and
    // the rollback undoes whatever reached the document.
    console.error('TypeR bubble scan', error.message || error);
    return {error: 'shape'};
  }
}

const methods = {
  async getTypeRPanelSnapshot(data) {
    const requested = data || {};
    const active = await activeLayer(requested);
    const live = await readSelection();
    const layers = hasDocument()
      ? Array.from(ps.app.activeDocument.activeLayers || []).filter(layer => layer.kind === ps.constants.LayerKind.TEXT).map(layer => ({id: layer.id}))
      : [];
    return JSON.stringify({activeLayer: active, selection: live, layers});
  },
  async getActiveTextLayerGeometry() {
    if (!hasDocument()) return JSON.stringify({error: 'layer', signature: ''});
    const layerId = await targetLayerId();
    const index = await historyIndex();
    const rect = await targetLayerBounds();
    if (layerId === null || !rect) return JSON.stringify({error: 'layer', signature: ''});
    return JSON.stringify({layerId, bounds: rect, signature: `${layerId}:${index}`});
  },
  async getCurrentSelectionShape(data) {
    if (!hasDocument()) return JSON.stringify({error: 'doc'});
    const rect = await readSelection();
    if (!rect) return JSON.stringify({error: 'noSelection'});
    const count = sampleCount(data && data.samples, 17);
    let shape = null;
    try {
      shape = await scanned('TypeR : scan de forme', () => selectionShape(rect, count));
    } catch (error) {
      // The modal scope is refused while Photoshop shows a dialog or another
      // plugin holds it: the panel retries a transient answer instead of
      // caching a plain rectangle for the rest of the session.
      console.error('TypeR shape scan', error.message || error);
      return JSON.stringify({error: 'historyBusy'});
    }
    shape = shape || {bounds: rect, rows: boundsRows(count), fallback: true};
    // scan/scanError lead the object so they survive the debug log preview cap
    const out = {scan: shape.scan || 'legacy'};
    if (out.scan === 'legacy' && shape.scanError) out.scanError = shape.scanError;
    out.bounds = shape.bounds;
    out.rows = shape.rows;
    out.fallback = shape.fallback;
    return JSON.stringify(out);
  },
  async getActiveLayerBubbleShape(data) {
    if (!hasDocument()) return JSON.stringify({error: 'doc'});
    const layer = await attempt(getLayer);
    if (!layer) return JSON.stringify({error: 'layer'});
    if (await readSelection()) return JSON.stringify({error: 'hasSelection'});
    // With several layers targeted the wand origin is ambiguous, and the user is
    // probably lining up a batch: leave the selection alone.
    if (Array.from(ps.app.activeDocument.activeLayers || []).length > 1) return JSON.stringify({error: 'multi'});
    const tolerance = parseInt(data && data.tolerance, 10) || 20;
    const count = sampleCount(data && data.samples, 21);
    let result = null;
    try {
      result = await scanned('TypeR : scan de bulle', doc => bubbleShape(doc, layer, tolerance, count));
    } catch (error) {
      console.error('TypeR bubble scan', error.message || error);
      return JSON.stringify({error: 'historyBusy'});
    }
    if (!result) return JSON.stringify({error: 'shape'});
    if (result.error) return JSON.stringify({error: result.error});
    // scan/scanError lead the object so they survive the debug log preview cap
    const out = {scan: result.scan || 'legacy'};
    if (out.scan === 'legacy' && result.scanError) out.scanError = result.scanError;
    out.bounds = result.bounds;
    out.rows = result.rows;
    out.fallback = result.fallback;
    return JSON.stringify(out);
  },
  async selectLayerById(id) {
    const layerId = parseInt(id, 10);
    if (isNaN(layerId)) return 'error';
    try {
      await play({_obj: 'select', _target: [{_ref: 'layer', _id: layerId}], makeVisible: false});
      return '';
    } catch (error) {
      console.error('TypeR select', error.message || error);
      return 'error';
    }
  },
};

module.exports = {methods};
