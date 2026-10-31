// Smart paste layout: measure the translation's words natively, search the
// best lines inside the bubble polygon, verify the chosen lines with exact
// native measurements, and compose the Photoshop text parameters. Ported
// from MD TYPER's production/layout.js, with the author's permission.
//
// Size policy (TypeR): the style size is a ceiling. The search first tries
// the exact style size, then the largest size that fits down to minScale of
// it, then (when enabled) allows one hyphen in a long word. "fixed" keeps one
// exact size.

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
  const borderPad = data.noMargin ? 0 : Math.max(2, dim * 0.035, Number(data.padding) || 0);
  const pad = borderPad + 0.75;
  const poly = layoutPolygon(plan, pad);
  const geometricMax = Math.max(0.1, (selection.height - 2 * borderPad) / Math.max(0.05, minXHeight));
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

// The chosen lines with exact metrics: still inside the polygon? Then
// re-centre and re-score them
const verifyPackedChoice = (graph, model, choice, exact) => {
  if (!choice) return null;
  const variant = graph.variants[choice.variant];
  if (!variant) return null;
  const opts = model.opts;
  let top = Infinity;
  let bottom = -Infinity;
  let valid = true;
  const lines = [];
  for (let i = 0; i < choice.lines.length; i++) {
    const item = choice.lines[i];
    const edge = variant.edges[item.edge];
    const metric = edge && exact.get(edge.key);
    if (!metric) return null;
    const modelEdge = model.variants[choice.variant].edges[item.edge];
    modelEdge.metric = metric;
    const inkTop = item.baseline + metric.top * choice.size;
    const inkBottom = item.baseline + metric.bottom * choice.size;
    top = Math.min(top, inkTop);
    bottom = Math.max(bottom, inkBottom);
    const safe = item.safe;
    const proven = safe && safe.pad >= opts.pad && inkTop >= safe.top && inkBottom <= safe.bottom &&
      choice.axis + metric.left * choice.size >= safe.left && choice.axis + metric.right * choice.size <= safe.right;
    if (!proven && !solverInternals.fitsExactBand(model.poly, metric, choice.size, item.baseline, choice.axis, opts.pad)) valid = false;
    lines.push({ edge: modelEdge, baseline: item.baseline, safe });
  }
  if (!valid) return null;
  const centered = solverInternals.centerLines(lines, top, bottom, model.selection.yMid, model.poly, choice.size, choice.axis, opts.pad, true);
  const candidate = {
    size: choice.size,
    axis: choice.axis,
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

// One search pass between sizes.min and sizes.max (pixels); fine scans the
// block centre in small steps instead of 5% ones
const searchPass = async (graph, plan, data, sizes, cache, probes, estimated, measure, fine) => {
  const model = solverModel(graph, plan, cache, probes, sizes, data);
  if (fine) model.opts.fineCentres = true;
  const solved = solve({ id: 1, models: [model] }).plans[0];
  let exact = new Map();
  cache.forEach((value, key) => { if (!estimated[key]) exact.set(key, value); });
  let plain = solved && solved.plain;
  if (!plain) {
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
//   useAtlas, resolveRunStyle, breakPoints (null = no hyphenation),
//   sizePolicy: { maxPx, minScale, fixed } }
export const planText = async (plan, payload, context) => {
  const started = now();
  const page = context.page;
  const dpi = page.resolution;
  const policy = context.sizePolicy || {};
  const timing = { measure: 0, solve: 0 };
  const measure = async (edges, cache) => {
    const mark = now();
    const result = await measureEdges(edges, { textProps: graphRef.graph.data.style.textProps, baseSize: graphRef.graph.baseSize, dpi, page, useAtlas: context.useAtlas }, context.measure, cache);
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
    const stylePx = (graph.baseSize * dpi) / 72;
    const maxPx = policy.maxPx > 0 ? policy.maxPx : policy.smallest ? stylePx * (policy.minScale || 0.75) : stylePx;
    // Native measurements outlive a pass: later sizes reuse them
    const known = new Map();
    const fitAt = async (size) => {
      const sizes = { min: size, max: size };
      let pass = null;
      // The coarse block centres first, then the fine scan of the same band
      for (let fine = 0; fine < 2 && !(pass && pass.best); fine++) {
        const seeded = new Map(cache);
        const guessed = {};
        known.forEach((value, key) => seeded.set(key, value));
        Object.keys(estimated).forEach((key) => { if (!known.has(key)) guessed[key] = true; });
        const mark = now();
        pass = await searchPass(graph, plan, payload, sizes, seeded, probes, guessed, measure, fine === 1);
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
    const minPx = maxPx * (policy.minScale || 0.85);
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

// How far the text may leave a chamber, as a share of its largest side
const OVERFLOW_STEPS = [0.1, 0.25, 0.5, 1, 2];

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

// A bubble too small for the user's padding at the smallest size: a tighter
// margin beats the classic paste, which ignores the bubble and the smaller size.
export const planBubbleText = async (plan, payload, context) => {
  const measure = rememberedMeasure(context.measure);
  const steps = [payload, { ...payload, padding: 0 }, { ...payload, padding: 0, noMargin: true }];
  for (let i = 0; i < steps.length; i++) {
    try {
      return await planText(plan, steps[i], { ...context, measure });
    } catch (error) {
      if (!(error instanceof NoPlacementError)) throw error;
    }
  }
  throw new NoPlacementError();
};

// A chamber of a connected bubble is small and takes its line whatever
// happens. The style size comes before the user's padding, the padding before
// a smaller size. Then no margin at all, then overflowing as little as
// possible at the smallest size the policy allows, on the chamber's centre.
export const planChamberText = async (plan, payload, context) => {
  const measure = rememberedMeasure(context.measure);
  const bare = { ...payload, padding: 0, noMargin: true };
  const smallest = { ...context.sizePolicy, smallest: true };
  const steps = [
    { plan, payload, breakPoints: null, sizePolicy: { ...context.sizePolicy, fixed: true } },
    { plan, payload: { ...payload, padding: 0 } },
    { plan, payload: bare },
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
