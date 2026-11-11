// Smart paste layout: measure the translation's words natively, search the
// best lines inside the bubble polygon, verify the chosen lines with exact
// native measurements, and compose the Photoshop text parameters. Ported
// from MD TYPER's production/layout.js, with the author's permission.
//
// Size policy (TypeR): the style size is a ceiling. The search first tries
// the exact style size, then the largest size that fits down to minScale of
// it (rounded down to a step of the style's unit), then (when enabled) allows
// one hyphen in a long word. "fixed" keeps one exact size.

import { compileGraph, composeText, probesForGraph } from "./textGraph";
import { measureEdges } from "./measureSpec";
import { solve, solverInternals } from "./solver";
import { box, clipToSide, simplify } from "./geometry";

export class NoPlacementError extends Error {
  constructor(message) {
    super(message || "No readable placement fits this bubble");
    this.name = "NoPlacementError";
    this.code = "noPlacement";
  }
}

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

// Multi-word lines are first estimated from their words and a measured space
const estimateLineMetrics = (graph, probes, spaces, cache) => {
  let space = 0.3;
  for (let i = 0; i < spaces.length; i++) {
    const sm = cache.get(spaces[i].key);
    const xm = cache.get(probes[i].key);
    if (!sm || !xm) throw new Error("Missing native font probe");
    const gap = Math.max(0.05, sm.right - sm.left - 2 * (xm.right - xm.left));
    space = i === 0 ? gap : Math.max(space, gap);
  }
  const estimated = {};
  for (let v = 0; v < graph.variants.length; v++) {
    const variant = graph.variants[v];
    const singles = {};
    for (let i = 0; i < variant.edges.length; i++) {
      const edge = variant.edges[i];
      if (edge.to === edge.from + 1) singles[edge.from] = edge;
    }
    for (let i = 0; i < variant.edges.length; i++) {
      const edge = variant.edges[i];
      if (cache.has(edge.key)) continue;
      let width = 0;
      let top = Infinity;
      let bottom = -Infinity;
      for (let n = edge.from; n < edge.to; n++) {
        const atomic = singles[n];
        // Adjacent authored spaces: an empty segment, its gap still counts
        if (!atomic) {
          if (n > edge.from) width += space;
          continue;
        }
        const metric = cache.get(atomic.key);
        if (!metric) throw new Error("Missing word measurement");
        width += metric.right - metric.left + (n > edge.from ? space : 0);
        top = Math.min(top, metric.top);
        bottom = Math.max(bottom, metric.bottom);
      }
      cache.set(edge.key, { left: -width / 2, right: width / 2, top, bottom });
      estimated[edge.key] = true;
    }
  }
  return estimated;
};

// Room kept between the text and the neck of a connected bubble
const NECK_GAP = 2;

// The padding keeps the text off the bubble's line. A neck is no line, only
// the limit between two chambers: it is moved out so that the padding leaves
// NECK_GAP there, or the neck would push the text off the chamber's centre.
const layoutPolygon = (plan, pad) => {
  const necks = plan.necks || (plan.neck ? [plan.neck] : []);
  if (!necks.length || !plan.outline || !plan.click || pad <= NECK_GAP) return plan.cleanPolygon;
  let out = plan.outline;
  for (let i = 0; i < necks.length; i++) {
    const a = necks[i][0];
    const b = necks[i][1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!(length > 0)) return plan.cleanPolygon;
    const side = dx * (plan.click.y - a[1]) - dy * (plan.click.x - a[0]) > 0 ? 1 : -1;
    // The search erodes the polygon by a square of the padding
    const nx = -dy / length;
    const ny = dx / length;
    const shift = (pad - NECK_GAP) * (Math.abs(nx) + Math.abs(ny)) * side;
    out = clipToSide(out, [a[0] - nx * shift, a[1] - ny * shift], [b[0] - nx * shift, b[1] - ny * shift], side);
    if (out.length < 3) return plan.cleanPolygon;
  }
  return simplify(out, 0.3);
};

// The style's stroke is drawn outside the glyphs after the text is placed
// (_setLayerStroke, always outside): its width is ink the margin must hold.
// The same tests as the hosts, which draw 3 px when the size is missing.
export const strokeWidth = (stroke) => {
  if (!stroke || stroke.enabled === false) return 0;
  const size = Number(stroke.size);
  if (size <= 0 && stroke.enabled !== true) return 0;
  return size > 0 ? size : 3;
};

// The margin kept without any padding: 3.5% of the bubble's smaller side
const baseMargin = (selection) => Math.max(2, Math.min(selection.width, selection.height) * 0.035);

const solverModel = (graph, plan, cache, probes, sizes, data) => {
  const selection = plan.selection;
  if (!selection || !plan.cleanPolygon) throw new Error("Bubble layout is incomplete");
  let maxLead = 0;
  let ascent = 0;
  let minXHeight = Infinity;
  for (let v = 0; v < graph.variants.length; v++) {
    const edges = graph.variants[v].edges;
    for (let i = 0; i < edges.length; i++) {
      const metric = cache.get(edges[i].key);
      if (!metric) throw new Error("Missing line metric");
      maxLead = Math.max(maxLead, edges[i].leading);
      ascent = Math.max(ascent, -metric.top);
    }
  }
  for (let i = 0; i < probes.length; i++) {
    const metric = cache.get(probes[i].key);
    if (!metric) throw new Error("Missing x-height metric");
    minXHeight = Math.min(minXHeight, metric.bottom - metric.top);
    if (/^[\s.,!?;:…-]+$/.test(graph.source)) ascent = Math.max(ascent, -metric.top);
  }
  const dim = Math.min(selection.width, selection.height);
  const marginScale = data.marginScale > 0 ? Math.min(1, data.marginScale) : 1;
  const borderPad = data.noMargin ? 0 : Math.max(baseMargin(selection) * marginScale, Number(data.padding) || 0);
  const stroke = strokeWidth(graph.stroke);
  const pad = borderPad + 0.75 + stroke;
  // The neck keeps NECK_GAP from the stroke, not from the bare glyphs
  const poly = layoutPolygon(plan, borderPad + 0.75);
  const geometricMax = Math.max(0.1, (selection.height - 2 * (borderPad + stroke)) / Math.max(0.05, minXHeight));
  const opts = {
    min: Math.max(0.1, sizes.min),
    max: Math.min(geometricMax, sizes.max),
    step: Math.max(0.75, dim / 100),
    leading: maxLead || 1.2,
    ascent: ascent || 0.8,
    pad,
    // A neck is no wall: a word may use the room it was moved out by
    wordRoom: poly === plan.cleanPolygon ? null : box(poly).width - 2 * pad,
    kind: plan.kind,
    connected: !!plan.connected,
    profileWords: (graph.source.match(/\S+/g) || []).length,
    deadline: Date.now() + 2500,
  };
  if (opts.max < opts.min) opts.max = opts.min;
  // No lone punctuation line under words, but "?!" on its own has no words
  const loneLineFlag = /^[\s.,!?;:]+$/.test(graph.source) ? 0 : 4;
  const variants = graph.variants.map((variant) => ({
    nodes: variant.nodes,
    insertion: variant.insertion,
    edges: variant.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      flags: (/^(\.{2,}|…+|-)$/.test(edge.text) ? 1 : 0) + (/(\.{2,}|…+|-)$/.test(edge.text) ? 2 : 0) + (/^[\s.,!?;:]+$/.test(edge.text) ? loneLineFlag : 0),
      leading: edge.leading,
      metric: cache.get(edge.key),
    })),
  }));
  return { variants, poly, selection, opts };
};

const packChoice = (candidate, variantIndex, model) => {
  if (!candidate) return null;
  const variant = model.variants[variantIndex];
  return {
    variant: variantIndex,
    size: candidate.size,
    axis: candidate.axis,
    penalty: candidate.penalty,
    lines: candidate.lines.map((line) => ({ edge: variant.edges.indexOf(line.edge), baseline: line.baseline, safe: line.safe || null })),
  };
};

// A line placed inside the band the search proved free (solve's "safe"):
// no polygon test needed
const provenSafe = (safe, metric, size, baseline, axis, pad) => !!(safe && safe.pad >= pad &&
  baseline + metric.top * size >= safe.top && baseline + metric.bottom * size <= safe.bottom &&
  axis + metric.left * size >= safe.left && axis + metric.right * size <= safe.right);

// The chosen lines with exact metrics, their ink box centred again on the
// bubble's centre: all still inside the polygon there? Then re-score them
const verifyPackedChoice = (graph, model, choice, exact) => {
  if (!choice) return null;
  const variant = graph.variants[choice.variant];
  if (!variant) return null;
  const opts = model.opts;
  const lines = [];
  for (let i = 0; i < choice.lines.length; i++) {
    const item = choice.lines[i];
    const edge = variant.edges[item.edge];
    const metric = edge && exact.get(edge.key);
    if (!metric) return null;
    const modelEdge = model.variants[choice.variant].edges[item.edge];
    modelEdge.metric = metric;
    lines.push({ edge: modelEdge, baseline: item.baseline, safe: item.safe });
  }
  const ink = solverInternals.inkBox(lines, choice.size, choice.axis);
  const dy = model.selection.yMid - (ink.top + ink.bottom) / 2;
  const axis = choice.axis + model.selection.xMid - (ink.left + ink.right) / 2;
  const centered = { lines: [], top: ink.top + dy, bottom: ink.bottom + dy };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const baseline = line.baseline + dy;
    const metric = line.edge.metric;
    if (!provenSafe(line.safe, metric, choice.size, baseline, axis, opts.pad) &&
        !solverInternals.fitsExactBand(model.poly, metric, choice.size, baseline, axis, opts.pad)) return null;
    centered.lines.push({ edge: line.edge, baseline, safe: line.safe });
  }
  const candidate = {
    size: choice.size,
    axis,
    lines: centered.lines,
    top: centered.top,
    bottom: centered.bottom,
    penalty: choice.penalty,
    variant: model.variants[choice.variant],
  };
  solverInternals.rescore(candidate, model.selection, opts, model.poly);
  return {
    choice: {
      variant: choice.variant,
      size: candidate.size,
      axis: candidate.axis,
      penalty: candidate.penalty,
      lines: candidate.lines.map((line) => ({ edge: model.variants[choice.variant].edges.indexOf(line.edge), baseline: line.baseline, safe: line.safe })),
    },
    candidate,
  };
};

// Measure the chosen lines exactly; reflow at most three times
const verifyNativeChoice = async (graph, model, choice, exact, measure) => {
  if (!choice) return { verified: null, cache: exact };
  const variantIndex = choice.variant;
  const variant = graph.variants[variantIndex];
  if (!variant) return { verified: null, cache: exact };
  let cache = exact;
  for (let pass = 0; choice && pass < 3; pass++) {
    const lines = choice.lines.map((line) => variant.edges[line.edge]);
    cache = (await measure(lines, cache)).cache;
    const verified = verifyPackedChoice(graph, model, choice, cache);
    if (verified) return { verified, cache };
    const retry = model.variants[variantIndex];
    for (let i = 0; i < retry.edges.length; i++) {
      retry.edges[i].metric = cache.get(variant.edges[i].key) || retry.edges[i].metric;
      if (!retry.edges[i].metric) throw new Error("Font measurements expired");
    }
    const opts = { ...model.opts, max: choice.size, deadline: Date.now() + 1500 };
    choice = packChoice(solverInternals.search(retry, model.poly, model.selection, opts), variantIndex, model);
  }
  return { verified: null, cache };
};

// Estimated lines run a little wide: the widest space of the text and no
// kerning across words. A lean search narrows them by this much before giving
// up on a size, and the native verification measures the chosen lines exactly.
const ESTIMATE_SLACK = 0.03;

// The estimated search of variant 0 again, with the still-estimated lines
// narrowed by the slack (the exact ones keep their metrics)
const narrowedSearch = (graph, model, estimated) => {
  const variant = model.variants[0];
  const sources = graph.variants[0].edges;
  for (let i = 0; i < variant.edges.length; i++) {
    if (!estimated[sources[i].key]) continue;
    const m = variant.edges[i].metric;
    variant.edges[i].metric = { ...m, left: m.left * (1 - ESTIMATE_SLACK), right: m.right * (1 - ESTIMATE_SLACK) };
  }
  return packChoice(solverInternals.search(variant, model.poly, model.selection, { ...model.opts, deadline: Date.now() + 2500 }), 0, model);
};

// Could any lines fit at this size, by the estimates alone? No measurement:
// a probe before the size ladder, so that a text too long for the smallest
// size never pays the ladder (every size costs searches and round trips)
const estimatedFit = (graph, plan, data, size, cache, probes, estimated) => {
  for (let fine = 0; fine < 2; fine++) {
    const model = solverModel(graph, plan, cache, probes, { min: size, max: size }, data);
    if (fine) model.opts.fineCentres = true;
    const solved = solve({ id: 1, models: [model] }).plans[0];
    if (solved && (solved.plain || (solved.alternatives && solved.alternatives.length))) return true;
    if (narrowedSearch(graph, model, estimated)) return true;
  }
  return false;
};

// The step a shrunk size is rounded down to, in the style's unit: half a point
// or half a pixel, a tenth of a millimetre
const sizeStep = (graph) => (graph.data.style.textProps.typeUnit === "millimetersUnit" ? 0.1 : 0.5);

// A size in pixels rounded down to that step of the style's unit
export const roundedSize = (sizePx, graph) => {
  const step = sizeStep(graph);
  const inUnit = (sizePx * 72) / graph.dpi;
  return (Math.floor(inUnit / step + 1e-6) * step * graph.dpi) / 72;
};

// One search pass between sizes.min and sizes.max (pixels); fine scans the
// block centre in small steps instead of 5% ones
const searchPass = async (graph, plan, data, sizes, cache, probes, estimated, measure, fine, lean) => {
  const model = solverModel(graph, plan, cache, probes, sizes, data);
  if (fine) model.opts.fineCentres = true;
  const solved = solve({ id: 1, models: [model] }).plans[0];
  let exact = new Map();
  cache.forEach((value, key) => { if (!estimated[key]) exact.set(key, value); });
  let plain = solved && solved.plain;
  if (!plain && lean) {
    // No estimated fit. Measuring every whole-word line (dozens to hundreds
    // of lines, one round trip per atlas or per line in the Legacy panel)
    // rescues only the lines the estimates ran wide on: search those with
    // the narrowed estimates instead, the verification below measures them.
    plain = narrowedSearch(graph, model, estimated);
  } else if (!plain) {
    // No estimated fit: measure every whole-word line and search again
    exact = (await measure(graph.variants[0].edges, exact)).cache;
    const variant = model.variants[0];
    for (let i = 0; i < variant.edges.length; i++) variant.edges[i].metric = exact.get(graph.variants[0].edges[i].key);
    plain = packChoice(solverInternals.search(variant, model.poly, model.selection, { ...model.opts, deadline: Date.now() + 2500 }), 0, model);
  }
  const check = await verifyNativeChoice(graph, model, plain, exact, measure);
  exact = check.cache;
  let best = check.verified;
  const alternatives = (solved && solved.alternatives) || [];
  for (let i = 0; i < Math.min(4, alternatives.length); i++) {
    const proposal = alternatives[i];
    const other = await verifyNativeChoice(graph, model, proposal, exact, measure);
    exact = other.cache;
    if (other.verified) {
      if (!best || solverInternals.rank(other.verified.candidate) > solverInternals.rank(best.candidate)) best = other.verified;
      const next = alternatives[i + 1];
      if (!next || solverInternals.rank(other.verified.candidate) >= next.size - next.penalty) break;
    }
  }
  return { best, model, exact };
};

// planText(plan, payload, context) -> { params, renderedText, size, stroke,
// candidate, model, hyphenated, timing }
// context = { page: { width, height, resolution }, measure (nativeMeasure),
//   useAtlas, leanMeasure, resolveRunStyle, breakPoints (null = no hyphenation),
//   sizePolicy: { maxPx, minScale, fixed } }
// leanMeasure (the Legacy panel, where every measurement is an ExtendScript
// round trip): no exhaustive measurement of the candidate lines, and a text
// too long for the smallest size is refused before the size ladder.
export const planText = async (plan, payload, context) => {
  const started = now();
  const page = context.page;
  const dpi = page.resolution;
  const policy = context.sizePolicy || {};
  const timing = { measure: 0, solve: 0 };
  const measure = async (edges, cache) => {
    const mark = now();
    const result = await measureEdges(edges, { textProps: graphRef.graph.data.style.textProps, baseSize: graphRef.graph.baseSize, dpi: graphRef.graph.dpi, page, useAtlas: context.useAtlas }, context.measure, cache);
    timing.measure += now() - mark;
    return result;
  };
  const graphRef = { graph: null };
  const tryGraph = async (allowHyphen, tiers) => {
    const graph = compileGraph(payload, {
      dpi,
      textColor: plan.textColor,
      resolveRunStyle: context.resolveRunStyle,
      allowHyphen,
      breakPoints: context.breakPoints,
    });
    if (allowHyphen && graph.variants.length < 2) return null;
    graphRef.graph = graph;
    const { probes, spaces } = probesForGraph(graph);
    const singles = [];
    for (let v = 0; v < graph.variants.length; v++) {
      const edges = graph.variants[v].edges;
      for (let i = 0; i < edges.length; i++) if (edges[i].to === edges[i].from + 1) singles.push(edges[i]);
    }
    const initial = await measure([...probes, ...spaces, ...singles], null);
    const cache = initial.cache;
    const estimated = estimateLineMetrics(graph, probes, spaces, cache);
    const stylePx = (graph.baseSize * graph.dpi) / 72;
    const maxPx = policy.maxPx > 0 ? policy.maxPx : policy.smallest ? stylePx * (policy.minScale || 0.75) : stylePx;
    // Native measurements outlive a pass: later sizes reuse them
    const known = new Map();
    const lean = !!context.leanMeasure;
    const seed = () => {
      const seeded = new Map(cache);
      const guessed = {};
      known.forEach((value, key) => seeded.set(key, value));
      Object.keys(estimated).forEach((key) => { if (!known.has(key)) guessed[key] = true; });
      return { seeded, guessed };
    };
    const fitAt = async (size) => {
      const sizes = { min: size, max: size };
      let pass = null;
      // The coarse block centres first, then the fine scan of the same band
      for (let fine = 0; fine < 2 && !(pass && pass.best); fine++) {
        const { seeded, guessed } = seed();
        const mark = now();
        pass = await searchPass(graph, plan, payload, sizes, seeded, probes, guessed, measure, fine === 1, lean);
        timing.solve += now() - mark;
        pass.exact.forEach((value, key) => known.set(key, value));
      }
      return pass.best ? pass : null;
    };
    const exact = await fitAt(maxPx);
    if (exact) return { graph, pass: exact, tier: "exact" };
    if (!tiers.includes("range")) return null;
    // The largest size that fits: step down 2% at a time, then halve the
    // last step down to half a percent. Shrinking the least keeps the sizes
    // of a page consistent, so a better silhouette never buys a smaller size.
    const minPx = maxPx * (policy.minScale || 0.75);
    // A minimum at the style size (the user wants no shrinking): no ladder
    if (!(minPx < maxPx - 0.001)) return null;
    if (lean) {
      // Nothing fits at the smallest size by the estimates: no size above it
      // can, and the ladder of paddings and hyphenation moves on at once
      const { seeded, guessed } = seed();
      const mark = now();
      const possible = estimatedFit(graph, plan, payload, minPx, seeded, probes, guessed);
      timing.solve += now() - mark;
      if (!possible) return null;
    }
    const step = maxPx * 0.02;
    const tolerance = Math.max(0.1, maxPx * 0.005);
    let failed = maxPx;
    let fitted = null;
    let fittedSize = 0;
    for (let size = maxPx - step; !fitted; size -= step) {
      const at = Math.max(size, minPx);
      fitted = await fitAt(at);
      if (fitted) fittedSize = at;
      else if (at <= minPx) return null;
      else failed = at;
    }
    while (failed - fittedSize > tolerance) {
      const middle = (failed + fittedSize) / 2;
      const pass = await fitAt(middle);
      if (pass) {
        fitted = pass;
        fittedSize = middle;
      } else failed = middle;
    }
    // A size the user would type: down to a step of the style's unit, so that
    // the bubbles of a page read 23.5 / 22 / 18.5 rather than 23.4 / 21.9 /
    // 18.7. Not below the minimum, and only if the text still fits there.
    const rounded = roundedSize(fittedSize, graph);
    if (rounded >= minPx - 0.001 && rounded < fittedSize - 0.001) {
      const pass = await fitAt(rounded);
      if (pass) return { graph, pass, tier: "range" };
    }
    return { graph, pass: fitted, tier: "range" };
  };
  const tiers = policy.fixed || policy.smallest ? ["exact"] : ["exact", "range"];
  let found = await tryGraph(false, tiers);
  let hyphenated = false;
  if (!found && typeof context.breakPoints === "function") {
    found = await tryGraph(true, tiers);
    hyphenated = !!found;
  }
  if (!found) throw new NoPlacementError();
  const { graph, pass } = found;
  const composed = composeText(graph, pass.best.choice, page);
  return {
    params: composed.params,
    renderedText: composed.renderedText,
    size: pass.best.choice.size,
    tier: found.tier,
    hyphenated: hyphenated && !!graph.variants[pass.best.choice.variant].insertion,
    stroke: graph.stroke,
    candidate: pass.best.candidate,
    pad: pass.model.opts.pad,
    timing: { ...timing, total: now() - started },
  };
};

// How far the text may leave a chamber, as a share of its largest side. The
// last steps are far beyond any bubble: a text set much too large for it (a
// title style, a style in points on a 600 dpi page) is still placed on its
// centre instead of going to the classic paste.
const OVERFLOW_STEPS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];

const overflowPlan = (plan, ratio) => {
  const b = plan.selection;
  const grow = Math.max(b.width, b.height) * ratio;
  const left = b.xMid - b.width / 2 - grow;
  const top = b.yMid - b.height / 2 - grow;
  const right = b.xMid + b.width / 2 + grow;
  const bottom = b.yMid + b.height / 2 + grow;
  return {
    ...plan,
    neck: null,
    necks: null,
    cleanPolygon: [[left, top], [right, top], [right, bottom], [left, bottom]],
    selection: { ...b, left, top, right, bottom, width: right - left, height: bottom - top },
  };
};

// The ladders below try the same text several times: measure each request once
const rememberedMeasure = (nativeMeasure) => {
  const known = new Map();
  return async (requests) => {
    const keys = requests.map((request) => JSON.stringify(request.params));
    const missing = requests.filter((request, i) => !known.has(keys[i]));
    if (missing.length) {
      const replies = await nativeMeasure(missing);
      missing.forEach((request, i) => known.set(JSON.stringify(request.params), replies[i]));
    }
    return keys.map((key) => known.get(key));
  };
};

// The margins tried one after the other when the text does not fit, from
// the user's padding down to none: two thirds and one third of the padding,
// the base margin alone (3.5% of the bubble), half of it, then a hair's
// breadth. Each one gets the whole size range and the hyphenation before the
// next one is tried, so the text gives up as little of its margin as it can:
// a larger padding never ends closer to the line than a smaller one. A step
// that would not free at least half a pixel is skipped.
export const marginSteps = (plan, payload) => {
  const base = baseMargin(plan.selection);
  const padding = Number(payload.padding) || 0;
  const candidates = [
    {},
    { padding: (padding * 2) / 3 },
    { padding: padding / 3 },
    { padding: 0 },
    { padding: 0, marginScale: 0.5 },
    { padding: 0, noMargin: true },
  ];
  const steps = [];
  let last = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const step = { ...payload, ...candidates[i] };
    const border = step.noMargin ? 0 : Math.max(base * (step.marginScale || 1), Number(step.padding) || 0);
    if (i && border > last - 0.5) continue;
    steps.push(step);
    last = border;
  }
  return steps;
};

// A bubble too small for the user's padding at the smallest size: a tighter
// margin beats the classic paste, which ignores the bubble and the smaller size.
// A text too long for the bubble even without margin overflows it as little as
// possible at the smallest size, on the bubble's centre: the classic paste would
// overflow it too, at the style size.
//
// A chamber of a connected bubble takes its line whatever happens, on the same
// ladder: the style size first, then a smaller size, the hyphenation, and only
// then a smaller margin. Its padding used to give way before any shrinking,
// which set a long line right against the outline of a small chamber.
const planWithFallbacks = async (plan, payload, context) => {
  const measure = rememberedMeasure(context.measure);
  const bare = { ...payload, padding: 0, noMargin: true };
  const smallest = { ...context.sizePolicy, smallest: true };
  const steps = [
    ...marginSteps(plan, payload).map((margin) => ({ plan, payload: margin })),
    ...OVERFLOW_STEPS.map((ratio) => ({ plan: overflowPlan(plan, ratio), payload: bare, sizePolicy: smallest })),
  ];
  for (let i = 0; i < steps.length; i++) {
    try {
      return await planText(steps[i].plan, steps[i].payload, { ...context, measure, ...steps[i] });
    } catch (error) {
      if (!(error instanceof NoPlacementError)) throw error;
    }
  }
  throw new NoPlacementError();
};

export const planBubbleText = planWithFallbacks;
export const planChamberText = planWithFallbacks;
