// Bubble plans for the smart paste. Ported from MD TYPER's closed-plan.js
// (with the author's permission), without its thought-bubble detection.
//
// A plan is built from what the host captured:
//   input = {
//     documentId, width, height, resolution,
//     source: "wand" | "rectangle" | "lasso",
//     click: { x, y } | null,          // the wand click, when known
//     selectionBounds: { left, top, right, bottom },
//     rawPath,                         // work path of the selection, actionJSON
//     fill: { fill: 0 | 255, rgb } | null, // tone of the selected pixels
//     sample,                          // optional sync (point) => rgb (UXP)
//     direction,                       // "rtl" picks the right chamber first
//   }
// and holds everything the layout and the paste need: the outline polygon,
// its tail-free body, the bubble kind, the neck of a connected bubble, the
// cleanup polygon and the text colour.

import {
  area, bodyBounds, box, clipToSide, contains, findCut, flatten, forcedCut, planCleanup, polygonContour, shapeKind, simplify, fillTone,
} from "./geometry";

const PATH_COMPONENT_LIMIT = 512;
const PATH_POINT_LIMIT = 4096;

const coordinate = (value, resolution) => {
  if (!value || !value.horizontal || !value.vertical) throw new Error("Unsupported path coordinate");
  const number = (unit) => {
    const raw = unit && typeof unit === "object" ? unit._value : unit;
    const kind = unit && typeof unit === "object" ? unit._unit : "pixelsUnit";
    const scale = kind === "pixelsUnit" ? 1 : kind === "distanceUnit" ? resolution / 72 : NaN;
    const result = raw * scale;
    if (!isFinite(result)) throw new Error("Unsupported path unit");
    return result;
  };
  return [number(value.horizontal), number(value.vertical)];
};

// Work path actionJSON -> [{ closed, contour: [[anchor, forward, backward]] }]
export const subpathsFromDescriptor = (raw, resolution) => {
  const components = raw && raw.pathContents && raw.pathContents.pathComponents;
  if (!Array.isArray(components) || components.length > PATH_COMPONENT_LIMIT) {
    throw new Error("Unsupported path components");
  }
  const out = [];
  let pointTotal = 0;
  for (let c = 0; c < components.length; c++) {
    const subpaths = components[c].subpathListKey || [];
    for (let s = 0; s < subpaths.length; s++) {
      const sub = subpaths[s];
      const points = sub.points || [];
      pointTotal += points.length;
      if (out.length >= PATH_COMPONENT_LIMIT || pointTotal > PATH_POINT_LIMIT) throw new Error("Path safety budget exceeded");
      out.push({
        closed: !!sub.closedSubpath,
        contour: points.map((point) => {
          const anchor = coordinate(point.anchor, resolution);
          return [
            anchor,
            point.forward ? coordinate(point.forward, resolution) : anchor.slice(),
            point.backward ? coordinate(point.backward, resolution) : anchor.slice(),
          ];
        }),
      });
    }
  }
  return out;
};

// Closed subpaths whose outline contains the point (the bubble, not the holes)
export const contoursAt = (subpaths, point) => {
  const contours = [];
  for (let i = 0; i < subpaths.length; i++) {
    const sub = subpaths[i];
    if (!sub.closed || sub.contour.length < 3 || sub.contour.length > 1024) continue;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    // Test the hull of every Bézier control before the flattened outline
    for (let n = 0; n < sub.contour.length; n++) {
      for (let k = 0; k < 3; k++) {
        const xy = sub.contour[n][k];
        left = Math.min(left, xy[0]);
        top = Math.min(top, xy[1]);
        right = Math.max(right, xy[0]);
        bottom = Math.max(bottom, xy[1]);
      }
    }
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) continue;
    if (contains(flatten(sub.contour), point)) contours.push(sub.contour);
  }
  return contours;
};

const largestClosed = (subpaths) => {
  let best = null;
  let bestArea = 0;
  for (let i = 0; i < subpaths.length; i++) {
    const sub = subpaths[i];
    if (!sub.closed || sub.contour.length < 3) continue;
    const size = area(flatten(sub.contour));
    if (size > bestArea) {
      best = sub.contour;
      bestArea = size;
    }
  }
  return best;
};

// A point inside the polygon, near its body centre
const interiorPoint = (polygon) => {
  const body = bodyBounds(polygon, box(polygon));
  const centre = { x: body.xMid, y: body.yMid };
  if (contains(polygon, centre)) return centre;
  const b = box(polygon);
  const fractions = [0.5, 0.35, 0.65, 0.2, 0.8];
  for (let y = 0; y < fractions.length; y++) {
    for (let x = 0; x < fractions.length; x++) {
      const point = { x: b.left + b.width * fractions[x], y: b.top + b.height * fractions[y] };
      if (contains(polygon, point)) return point;
    }
  }
  return null;
};

// Reading order of two points: top first, then right first in RTL (manga)
// and left first otherwise
const readsBefore = (a, b, direction, tolerance) => {
  if (Math.abs(a.y - b.y) > tolerance) return a.y < b.y;
  return direction === "rtl" ? a.x > b.x : a.x < b.x;
};

// Without a click (a lasso, or a CEP event without coordinates) the bubble is
// the largest closed outline of the selection, and a connected bubble starts
// with its first chamber in reading order
export const resolveClick = (input, subpaths) => {
  if (input.click && isFinite(input.click.x) && isFinite(input.click.y)) return input.click;
  const outline = largestClosed(subpaths);
  if (!outline) return null;
  const polygon = flatten(outline);
  const seed = interiorPoint(polygon);
  if (!seed) return null;
  const cut = findCut([outline], seed, input.selectionBounds, false);
  const neck = cut && (cut.neck || cut.ambiguousNeck);
  if (!neck) return seed;
  const a = neck[0];
  const b = neck[1];
  const sides = [1, -1].map((side) => interiorPoint(clipToSide(polygon, a, b, side))).filter(Boolean);
  if (!sides.length) return seed;
  const tolerance = Math.min(input.selectionBounds.bottom - input.selectionBounds.top, input.selectionBounds.right - input.selectionBounds.left) * 0.15;
  sides.sort((p, q) => (readsBefore(p, q, input.direction, tolerance) ? -1 : 1));
  return sides[0];
};

// Histogram of the selected pixels (mask >= 128): solid white or black when
// 90% of every channel is >= 240 or <= 15. Used by the UXP host, which has
// the selection mask and the local crop.
export const fillFromMask = (selectionBounds, selectionMask, sample) => {
  const w = selectionBounds.right - selectionBounds.left;
  const h = selectionBounds.bottom - selectionBounds.top;
  if (!selectionMask || selectionMask.length !== w * h) return null;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (selectionMask[y * w + x] < 128) continue;
      const rgb = sample([selectionBounds.left + x, selectionBounds.top + y]);
      hist[0][rgb.red]++;
      hist[1][rgb.green]++;
      hist[2][rgb.blue]++;
      total++;
    }
  }
  return fillFromHistograms(hist, total);
};

// Same rule from three 256-bin histograms (the CEP host reads them from
// Photoshop's channel histograms of the selection)
export const fillFromHistograms = (hist, total) => {
  if (!hist || hist.length < 1 || !(total >= 24)) return null;
  const channels = hist.length === 1 ? [hist[0], hist[0], hist[0]] : hist;
  let white = true;
  let black = true;
  for (let c = 0; c < 3; c++) {
    let w = 0;
    let b = 0;
    for (let i = 0; i < 256; i++) {
      if (i >= 240) w += channels[c][i];
      if (i <= 15) b += channels[c][i];
    }
    white = white && w / total >= 0.9;
    black = black && b / total >= 0.9;
  }
  if (!white && !black) return null;
  const values = channels.map((h) => {
    const start = white ? 240 : 0;
    const end = white ? 255 : 15;
    let sum = 0;
    let seen = 0;
    for (let i = start; i <= end; i++) sum += h[i];
    for (let i = start; i <= end; i++) {
      seen += h[i];
      if (seen >= sum / 2) return i;
    }
    return end;
  });
  return { fill: white ? 255 : 0, rgb: { red: values[0], green: values[1], blue: values[2] } };
};

// Tone for a text-only paste when the cleanup was refused: the selection
// fill first, then a few clear samples of the chamber, black text by default
const fallbackTone = (input, polygon) => {
  if (input.fill) return input.fill;
  if (input.sample) {
    const b = box(polygon);
    const fractions = [0.18, 0.3, 0.42, 0.58, 0.7, 0.82];
    const white = [];
    const black = [];
    for (let y = 0; y < fractions.length; y++) {
      for (let x = 0; x < fractions.length; x++) {
        const point = [Math.floor(b.left + b.width * fractions[x]), Math.floor(b.top + b.height * fractions[y])];
        if (!contains(polygon, { x: point[0], y: point[1] })) continue;
        let rgb;
        try {
          rgb = input.sample(point);
        } catch (outside) {
          continue;
        }
        if (fillTone.isWhite(rgb)) white.push(rgb);
        else if (fillTone.isBlack(rgb)) black.push(rgb);
      }
    }
    if (white.length >= 3 && white.length >= black.length * 2 + 1) return { fill: 255, rgb: fillTone.medianRgb(white) };
    if (black.length >= 3 && black.length >= white.length * 2 + 1) return { fill: 0, rgb: fillTone.medianRgb(black) };
  }
  return { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
};

const textColorFor = (rgb) => (fillTone.isBlack(rgb) ? { red: 255, green: 255, blue: 255 } : null);

const finishPlan = (input, parts) => {
  const plan = {
    documentId: input.documentId,
    source: input.source || "wand",
    click: parts.click,
    selectionBounds: { ...input.selectionBounds },
    kind: parts.kind,
    connected: !!parts.neck,
    neck: parts.neck || null,
    contour: parts.contour,
    cleanPolygon: parts.cleanPolygon,
    cleanupPolygon: parts.cleanupPolygon,
    cleanupInset: parts.cleanupInset,
    centerOnly: !!parts.centerOnly,
    autoClean: !!parts.autoClean,
    cleanupSkipped: parts.cleanupSkipped || null,
    fill: parts.fill,
    fillRGB: parts.fillRGB,
    // White text on a black bubble; null keeps the style's own colour
    textColor: textColorFor(parts.fillRGB),
    selection: { ...parts.layoutBounds, bubbleKind: parts.kind },
  };
  return plan;
};

// Wand selection inside a closed bubble (or the chamber of a connected one)
export const buildBubblePlan = (input, options = {}) => {
  const autoClean = options.autoClean === true;
  const page = { width: input.width, height: input.height };
  const subpaths = options.subpaths || subpathsFromDescriptor(input.rawPath, input.resolution);
  const click = options.click || resolveClick(input, subpaths);
  if (!click) throw new Error("No closed bubble outline in the selection");
  const contours = contoursAt(subpaths, click);
  if (!contours.length) throw new Error("No closed bubble contour encloses the click");
  let contour = null;
  let polygon = null;
  let polygonArea = 0;
  for (let i = 0; i < contours.length; i++) {
    const flat = flatten(contours[i]);
    const size = area(flat);
    if (size > polygonArea && contains(flat, click)) {
      contour = contours[i];
      polygon = flat;
      polygonArea = size;
    }
  }
  if (!contour) throw new Error("Select the empty interior of a closed bubble");
  const fullBounds = box(polygon);
  if (fullBounds.width >= input.width * 0.98 && fullBounds.height >= input.height * 0.98) throw new Error("Page selection");
  let kind = shapeKind(polygon);
  let cut = findCut(contours, click, input.selectionBounds, false);
  // The user says the bubble is double: split it at its likeliest neck
  if (options.forceSplit && !(cut && cut.neck)) cut = forcedCut(contours, click, input.selectionBounds) || cut;
  if (cut && cut.ambiguous) throw new Error("Click farther inside one chamber");
  let chamber = polygon;
  if (cut && cut.neck) {
    const a = cut.neck[0];
    const b = cut.neck[1];
    const side = (b[0] - a[0]) * (click.y - a[1]) - (b[1] - a[1]) * (click.x - a[0]);
    chamber = clipToSide(chamber, a, b, side > 0 ? 1 : -1);
    kind = shapeKind(chamber);
  }
  if (kind === "unknown") kind = "regular";
  const cleanPolygon = simplify(chamber, 0.3);
  const layoutBounds = bodyBounds(chamber, box(chamber));
  let clean = planCleanup({
    page,
    click,
    bounds: box(cleanPolygon),
    polygon: cleanPolygon,
    subpaths,
    cleanEnabled: autoClean,
    // A connected chamber does not own the whole selection's histogram
    fill: cut && cut.neck && input.sample ? null : input.fill,
    sample: input.sample,
  });
  let cleanupSkipped = null;
  if (clean && typeof clean.skip === "string" && /^Auto Clean /.test(clean.skip)) {
    cleanupSkipped = clean.skip;
    const tone = fallbackTone(input, cleanPolygon);
    clean = { cleanPolygon, fill: tone.fill, fillRGB: tone.rgb, bounds: box(cleanPolygon), layoutBounds };
  }
  if (!clean || clean.skip) throw new Error((clean && clean.skip) || "Unsafe bubble plan");
  const rgb = clean.fillRGB || { red: clean.fill, green: clean.fill, blue: clean.fill };
  const solid = fillTone.isWhite(rgb) || fillTone.isBlack(rgb);
  if (autoClean && !cleanupSkipped && !solid) cleanupSkipped = "Auto Clean supports solid white or black interiors only.";
  const black = fillTone.isBlack(rgb);
  const cleanupInset = Math.max(clean.cleanupInset || 3, black ? 5 : 3);
  const selected = box(cleanPolygon);
  const edges = (selected.left <= 2 ? 1 : 0) + (selected.top <= 2 ? 1 : 0) +
    (selected.right >= input.width - 2 ? 1 : 0) + (selected.bottom >= input.height - 2 ? 1 : 0);
  if (autoClean && !cleanupSkipped && (selected.width < 24 || selected.height < 24)) cleanupSkipped = "Auto Clean skipped a tiny area.";
  if (autoClean && !cleanupSkipped && (edges >= 3 || area(cleanPolygon) >= input.width * input.height * 0.7)) {
    cleanupSkipped = "Auto Clean skipped an open, page-spanning, or oversized selection.";
  }
  const effectiveClean = autoClean && !cleanupSkipped;
  return finishPlan(input, {
    click: { x: click.x, y: click.y },
    kind,
    neck: cut && cut.neck ? cut.neck : null,
    contour,
    cleanPolygon,
    cleanupPolygon: effectiveClean ? clean.cleanupPolygon || cleanPolygon : null,
    cleanupInset,
    centerOnly: clean.centerOnly,
    autoClean: effectiveClean,
    cleanupSkipped,
    fill: clean.fill,
    fillRGB: rgb,
    layoutBounds,
  });
};

const rectPolygon = (b) => [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];

// A rectangle marquee is laid out like a narration box: the text fills the
// rectangle (it keeps the line's style, see styleForKind)
export const buildRectanglePlan = (input, options = {}) => {
  const b = input.selectionBounds;
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  if (!(width >= 8) || !(height >= 8)) throw new Error("The rectangle is too small");
  const polygon = rectPolygon(b);
  const tone = input.fill || { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
  const solid = !!input.fill;
  const autoClean = options.autoClean === true && solid;
  const layoutBounds = { ...box(polygon), xMid: (b.left + b.right) / 2, yMid: (b.top + b.bottom) / 2 };
  return finishPlan(input, {
    click: input.click || { x: layoutBounds.xMid, y: layoutBounds.yMid },
    kind: "narration",
    neck: null,
    contour: polygonContour(polygon),
    cleanPolygon: polygon,
    cleanupPolygon: autoClean ? polygon : null,
    cleanupInset: fillTone.isBlack(tone.rgb) ? 5 : 3,
    autoClean,
    cleanupSkipped: options.autoClean === true && !solid ? "Auto Clean supports solid white or black interiors only." : null,
    fill: tone.fill,
    fillRGB: tone.rgb,
    layoutBounds,
  });
};

// A lasso is the user's own outline: its largest closed subpath, classified
// like a bubble, never split
export const buildLassoPlan = (input, options = {}) => {
  const subpaths = options.subpaths || subpathsFromDescriptor(input.rawPath, input.resolution);
  const contour = largestClosed(subpaths);
  if (!contour) throw new Error("No closed outline in the lasso selection");
  const polygon = simplify(flatten(contour), 0.3);
  if (area(polygon) < 400) throw new Error("The lasso selection is too small");
  let kind = shapeKind(polygon);
  if (kind === "unknown") kind = "regular";
  const click = interiorPoint(polygon);
  if (!click) throw new Error("The lasso selection has no usable interior");
  const tone = input.fill || { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
  const solid = !!input.fill;
  const autoClean = options.autoClean === true && solid;
  return finishPlan(input, {
    click,
    kind,
    neck: null,
    contour,
    cleanPolygon: polygon,
    cleanupPolygon: autoClean ? polygon : null,
    cleanupInset: fillTone.isBlack(tone.rgb) ? 5 : 3,
    autoClean,
    cleanupSkipped: options.autoClean === true && !solid ? "Auto Clean supports solid white or black interiors only." : null,
    fill: tone.fill,
    fillRGB: tone.rgb,
    layoutBounds: bodyBounds(polygon, box(polygon)),
  });
};

export const buildPlan = (input, options = {}) => {
  if (input.source === "rectangle") return buildRectanglePlan(input, options);
  if (input.source === "lasso") return buildLassoPlan(input, options);
  return buildBubblePlan(input, options);
};

// The click of a trigger in document pixels (a Wand event may report points)
export const triggerClick = (trigger, resolution) => {
  if (!trigger || trigger.source !== "wand" || !isFinite(trigger.x) || !isFinite(trigger.y)) return null;
  const scale = trigger.unit === "distanceUnit" ? (resolution || 72) / 72 : 1;
  return { x: trigger.x * scale, y: trigger.y * scale };
};

const unitNumber = (value) => (value !== null && typeof value === "object" && "_value" in value ? value._value : value);

// A selection outline made of four straight, axis-aligned sides: a marquee
export const isAxisRectangle = (rawPath) => {
  const components = rawPath && rawPath.pathContents && rawPath.pathContents.pathComponents;
  if (!components || components.length !== 1) return false;
  const subs = components[0].subpathListKey || [];
  if (subs.length !== 1 || !subs[0].points || subs[0].points.length !== 4) return false;
  const xs = {};
  const ys = {};
  for (let i = 0; i < subs[0].points.length; i++) {
    const point = subs[0].points[i];
    const same = (a, b) => !a || !b || (unitNumber(a.horizontal) === unitNumber(b.horizontal) && unitNumber(a.vertical) === unitNumber(b.vertical));
    if (!same(point.forward, point.anchor) || !same(point.backward, point.anchor)) return false;
    xs[Math.round(unitNumber(point.anchor.horizontal) * 100)] = true;
    ys[Math.round(unitNumber(point.anchor.vertical) * 100)] = true;
  }
  return Object.keys(xs).length === 2 && Object.keys(ys).length === 2;
};

// The source of a capture: the trigger's, or for a manual Paste a rectangle
// when the selection is one, the wand route otherwise. A Magic Wand click in a
// square box gives a marquee's outline: the user's last selection tells them apart.
export const captureSource = (trigger, rawPath) => {
  const source = trigger && trigger.source;
  if (source === "wand" || source === "rectangle" || source === "lasso") return source;
  if (!rawPath || !isAxisRectangle(rawPath)) return "wand";
  return trigger && trigger.lastSource === "wand" ? "wand" : "rectangle";
};
