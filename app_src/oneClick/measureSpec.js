// Native text measurement, the pure half: the Photoshop text parameters
// that render one candidate line (or an atlas of lines) at a fixed 64 px
// size around the document centre, and the normalized metrics read back
// from the rendered bounds. The hosts only create the hidden layers and
// read their bounds. Ported from MD TYPER's uxp-measure.js, with the
// author's permission.

const clone = (value) => JSON.parse(JSON.stringify(value));

export const MEASURE_SIZE = 64;
export const ATLAS_STEP = 256;
export const ATLAS_MAX = 24;

const scaleStyle = (source, scale) => {
  const style = clone(source);
  const keys = ["size", "impliedFontSize", "leading", "baselineShift", "impliedBaselineShift"];
  for (let i = 0; i < keys.length; i++) if (typeof style[keys[i]] === "number") style[keys[i]] *= scale;
  delete style.noBreak;
  return style;
};

const centredParagraph = (layerText, length) => {
  const paragraph = clone(layerText.paragraphStyleRange[0].paragraphStyle);
  paragraph.alignment = "center";
  paragraph.hyphenate = false;
  paragraph.spaceBefore = 0;
  paragraph.spaceAfter = 0;
  paragraph.firstLineIndent = 0;
  paragraph.startIndent = 0;
  paragraph.endIndent = 0;
  return [{ from: 0, to: length, paragraphStyle: paragraph }];
};

// The atlas trick (vector outlines of up to 24 lines read in one go) needs
// plain glyphs: no synthetic faces, small baseline shifts and sizes
export const atlasCompatible = (edge, baseSize, dpi) => {
  if (edge.blank || !edge.spec || !edge.spec.ranges.length) return false;
  const scale = (MEASURE_SIZE * 72) / dpi / baseSize;
  for (let i = 0; i < edge.spec.ranges.length; i++) {
    const style = scaleStyle(edge.spec.ranges[i].textStyle, scale);
    if (style.syntheticBold || style.syntheticItalic || (Math.abs(style.baselineShift || 0) * dpi) / 72 > 32 || (style.size * dpi) / 72 > 96) return false;
  }
  return true;
};

// Point text parameters for one line at 64 px (the base size scaled)
export const lineParams = (edge, textProps, baseSize, dpi) => {
  const params = clone(textProps);
  const lt = params.layerText;
  const scale = (MEASURE_SIZE * 72) / dpi / baseSize;
  const ranges = edge.spec.ranges.map((item) => {
    const range = clone(item);
    range.textStyle = scaleStyle(range.textStyle, scale);
    return range;
  });
  ranges[ranges.length - 1].to++;
  lt.textKey = edge.text + "\r";
  lt.textStyleRange = ranges;
  lt.kerningRange = clone(edge.spec.kerning);
  lt.textClickPoint = { horizontal: 50, vertical: 50 };
  lt.textShape = [{ textType: "point", orientation: "horizontal" }];
  lt.paragraphStyleRange = centredParagraph(lt, edge.text.length + 1);
  delete lt.bounds;
  delete lt.boundingBox;
  return params;
};

// Point text parameters for an atlas: one line per 256 px row
export const atlasParams = (batch, textProps, baseSize, dpi) => {
  const params = clone(textProps);
  const lt = params.layerText;
  const scale = (MEASURE_SIZE * 72) / dpi / baseSize;
  let text = "";
  let offset = 0;
  const ranges = [];
  const kerning = [];
  for (let b = 0; b < batch.length; b++) {
    const edge = batch[b];
    for (let j = 0; j < edge.spec.ranges.length; j++) {
      const range = clone(edge.spec.ranges[j]);
      range.textStyle = scaleStyle(range.textStyle, scale);
      range.textStyle.autoLeading = false;
      range.textStyle.leading = (ATLAS_STEP * 72) / dpi;
      range.from += offset;
      range.to += offset;
      if (j === edge.spec.ranges.length - 1) range.to++;
      ranges.push(range);
    }
    for (let k = 0; k < edge.spec.kerning.length; k++) {
      const item = clone(edge.spec.kerning[k]);
      item.from += offset;
      item.to += offset;
      kerning.push(item);
    }
    text += edge.text + "\r";
    offset = text.length;
  }
  lt.textKey = text;
  lt.textStyleRange = ranges;
  lt.kerningRange = kerning;
  lt.textClickPoint = { horizontal: 50, vertical: 50 };
  lt.textShape = [{ textType: "point", orientation: "horizontal" }];
  lt.paragraphStyleRange = centredParagraph(lt, text.length);
  delete lt.bounds;
  delete lt.boundingBox;
  return params;
};

// Rendered bounds of a 64 px line -> metric relative to the centred
// baseline, per pixel of base size (one pixel of margin on each side)
export const metricFromBounds = (bounds, page) => {
  if (!bounds || !(bounds.right > bounds.left && bounds.bottom > bounds.top)) {
    throw new Error("The selected font did not render a measurable line.");
  }
  const x = page.width / 2;
  const y = page.height / 2;
  return {
    left: (bounds.left - x - 1) / MEASURE_SIZE,
    right: (bounds.right - x + 1) / MEASURE_SIZE,
    top: (bounds.top - y - 1) / MEASURE_SIZE,
    bottom: (bounds.bottom - y + 1) / MEASURE_SIZE,
  };
};

const pathPixel = (unit, resolution) => {
  if (unit._unit === "pixelsUnit") return unit._value;
  if (unit._unit === "distanceUnit") return (unit._value * resolution) / 72;
  return NaN;
};

// Vector mask of a converted atlas -> one metric per row, or null when a
// glyph strays out of its row
export const atlasMetrics = (rawPath, count, page) => {
  const components = rawPath && rawPath.pathContents && rawPath.pathContents.pathComponents;
  if (!Array.isArray(components)) return null;
  const cx = page.width / 2;
  const cy = page.height / 2;
  const bounds = [];
  for (let i = 0; i < count; i++) bounds.push({ left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
  const keys = ["anchor", "forward", "backward"];
  for (let ci = 0; ci < components.length; ci++) {
    const subs = components[ci].subpathListKey || [];
    for (let si = 0; si < subs.length; si++) {
      const points = subs[si].points || [];
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (let pi = 0; pi < points.length; pi++) {
        for (let ki = 0; ki < 3; ki++) {
          const value = points[pi][keys[ki]];
          if (!value || !value.horizontal || !value.vertical) continue;
          const x = pathPixel(value.horizontal, page.resolution);
          const y = pathPixel(value.vertical, page.resolution);
          if (!isFinite(x) || !isFinite(y)) return null;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      if (!isFinite(left)) continue;
      const row = Math.floor(((top + bottom) / 2 - cy + ATLAS_STEP / 2) / ATLAS_STEP);
      if (row < 0 || row >= count || top < cy + row * ATLAS_STEP - ATLAS_STEP / 2 || bottom > cy + row * ATLAS_STEP + ATLAS_STEP / 2) return null;
      const result = bounds[row];
      if (left < result.left) result.left = left;
      if (right > result.right) result.right = right;
      if (top < result.top) result.top = top;
      if (bottom > result.bottom) result.bottom = bottom;
    }
  }
  if (bounds.some((b) => !(b.right > b.left && b.bottom > b.top))) return null;
  return bounds.map((b, i) => ({
    left: (b.left - cx - 1) / MEASURE_SIZE,
    right: (b.right - cx + 1) / MEASURE_SIZE,
    top: (b.top - (cy + i * ATLAS_STEP) - 1) / MEASURE_SIZE,
    bottom: (b.bottom - (cy + i * ATLAS_STEP) + 1) / MEASURE_SIZE,
  }));
};

// Split pending edges into atlases (3 to 24 compatible lines) and singles
export const partitionForMeasure = (edges, baseSize, dpi, useAtlas) => {
  const vector = [];
  const individual = [];
  for (let i = 0; i < edges.length; i++) (useAtlas && atlasCompatible(edges[i], baseSize, dpi) ? vector : individual).push(edges[i]);
  const atlas = [];
  for (let i = 0; i < vector.length; i += ATLAS_MAX) {
    const slice = vector.slice(i, i + ATLAS_MAX);
    if (slice.length >= 3) atlas.push(slice);
    else individual.push(...slice);
  }
  return { atlas, individual };
};

// Shared metric cache (LRU) across pastes: words repeat from bubble to bubble
const sharedCache = new Map();
const SHARED_LIMIT = 4096;
export const cachedMetric = (key) => {
  const metric = sharedCache.get(key);
  if (metric) {
    sharedCache.delete(key);
    sharedCache.set(key, metric);
  }
  return metric;
};
export const rememberMetric = (key, metric) => {
  if (sharedCache.has(key)) sharedCache.delete(key);
  sharedCache.set(key, metric);
  if (sharedCache.size > SHARED_LIMIT) sharedCache.delete(sharedCache.keys().next().value);
};
export const clearMetricCache = () => sharedCache.clear();

// measureEdges(edges, context, nativeMeasure): fills a Map key -> metric.
// nativeMeasure(requests) receives [{ key, kind: "line" | "atlas", params,
// count }] and resolves to [{ key, bounds } | { key, metrics: [...] } | null].
export const measureEdges = async (edges, context, nativeMeasure, cache) => {
  const out = cache || new Map();
  const pending = [];
  const seen = {};
  let cacheHits = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.blank) {
      out.set(edge.key, { left: 0, right: 0, top: 0, bottom: 0 });
      continue;
    }
    if (!out.has(edge.key)) {
      const hit = cachedMetric(edge.key);
      if (hit) {
        out.set(edge.key, hit);
        cacheHits++;
      }
    }
    if (!seen[edge.key] && !out.has(edge.key)) {
      seen[edge.key] = true;
      pending.push(edge);
    }
  }
  if (!pending.length) return { cache: out, cacheHits, measured: 0 };
  const { textProps, baseSize, dpi, page, useAtlas } = context;
  let partition = partitionForMeasure(pending, baseSize, dpi, useAtlas);
  const requests = [];
  for (let i = 0; i < partition.atlas.length; i++) {
    requests.push({ key: "atlas" + i, kind: "atlas", count: partition.atlas[i].length, params: atlasParams(partition.atlas[i], textProps, baseSize, dpi), edges: partition.atlas[i] });
  }
  for (let i = 0; i < partition.individual.length; i++) {
    const edge = partition.individual[i];
    requests.push({ key: edge.key, kind: "line", params: lineParams(edge, textProps, baseSize, dpi), edges: [edge] });
  }
  const replies = await nativeMeasure(requests.map((r) => ({ key: r.key, kind: r.kind, count: r.count, params: r.params })));
  const retry = [];
  for (let i = 0; i < requests.length; i++) {
    const request = requests[i];
    const reply = replies && replies[i];
    if (request.kind === "atlas") {
      const metrics = reply && (reply.metrics || (reply.path ? atlasMetrics(reply.path, request.count, page) : null));
      if (metrics && metrics.length === request.edges.length) {
        for (let k = 0; k < request.edges.length; k++) out.set(request.edges[k].key, metrics[k]);
      } else retry.push(...request.edges);
    } else if (reply && reply.bounds) {
      out.set(request.key, metricFromBounds(reply.bounds, page));
    } else {
      throw new Error("Photoshop did not measure a text line.");
    }
  }
  // An atlas that failed (a glyph out of its row) is measured line by line
  if (retry.length) {
    partition = { atlas: [], individual: retry };
    const singles = retry.map((edge) => ({ key: edge.key, kind: "line", params: lineParams(edge, textProps, baseSize, dpi) }));
    const again = await nativeMeasure(singles);
    for (let i = 0; i < singles.length; i++) {
      if (!again || !again[i] || !again[i].bounds) throw new Error("Photoshop did not measure a text line.");
      out.set(singles[i].key, metricFromBounds(again[i].bounds, page));
    }
  }
  for (let i = 0; i < pending.length; i++) if (out.has(pending[i].key)) rememberMetric(pending[i].key, out.get(pending[i].key));
  return { cache: out, cacheHits, measured: pending.length };
};
