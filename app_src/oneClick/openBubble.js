// Open bubbles: a Magic Wand click that leaks into the page (the bubble's
// outline has a gap). Ported from MD TYPER's uxp-open.js, open-mask-solver.js
// and open-ink-filter.js (main route only), with the author's permission.
//
// The UXP host isolates the clicked chamber with Photoshop: the leaking
// selection is intersected with a square around the click and contracted
// (the gaps close), the smallest compact "core" contour around the click
// is grown back (the "prior" outline), then a pixel solver finds the
// chamber in a local crop. The CEP host reads no pixels: an open bubble
// falls back to the classic paste there.

import { area, bodyBounds, box, contains, convexHull, fillTone, flatten, polygonContour, shapeKind, simplify } from "./geometry";
import { subpathsFromDescriptor } from "./bubblePlan";

// The selection spans the page: the wand leaked out of the bubble
export const isPageLeak = (bounds, width, height) => {
  if (!bounds || !(width > 0) || !(height > 0)) return false;
  const sw = bounds.right - bounds.left;
  const sh = bounds.bottom - bounds.top;
  return (sw >= width * 0.94 && sh >= Math.min(width * 0.7, height * 0.6)) || (sh >= height * 0.96 && sw >= width * 0.6);
};

// Contraction radius and the square kept around the click
export const openRecoveryFrame = (page, click) => {
  const reach = page.width * 1.1;
  return {
    radius: Math.max(2, Math.min(32, Math.round(page.width / 25))),
    crop: {
      left: Math.max(0, click.x - reach),
      top: Math.max(0, click.y - reach),
      right: Math.min(page.width, click.x + reach),
      bottom: Math.min(page.height, click.y + reach),
    },
  };
};

const contoursAround = (raw, resolution, click) => {
  const out = [];
  const subpaths = subpathsFromDescriptor(raw, resolution);
  for (let i = 0; i < subpaths.length; i++) {
    const sub = subpaths[i];
    if (!sub.closed || sub.contour.length < 3) continue;
    const polygon = flatten(sub.contour);
    if (contains(polygon, click)) out.push({ contour: sub.contour, polygon });
  }
  return out;
};

// The smallest compact contour around the click in the contracted selection
export const coreFromPath = (raw, resolution, click, frame, page) => {
  let best = null;
  let bestArea = Infinity;
  const { crop, radius } = frame;
  const items = contoursAround(raw, resolution, click);
  for (let i = 0; i < items.length; i++) {
    const poly = simplify(items[i].polygon, 0.35);
    const b = box(poly);
    const size = area(poly);
    if (b.width < 30 || b.height < 30 || size > page.width * page.height * 0.7 || size / (b.width * b.height) < 0.5) continue;
    if ((crop.left > 0 && b.left < crop.left + radius + 3) || (crop.top > 0 && b.top < crop.top + radius + 3) ||
        (crop.right < page.width && b.right > crop.right - radius - 3) || (crop.bottom < page.height && b.bottom > crop.bottom - radius - 3)) continue;
    if ((b.left < 2 && b.right > page.width - 2) || (b.top < 2 && b.bottom > page.height - 2)) continue;
    if (size / Math.max(1, area(convexHull(poly))) < 0.75) continue;
    if (size < bestArea) {
      best = poly;
      bestArea = size;
    }
  }
  return best;
};

// The largest contour around the click once the core is grown back
export const priorFromPath = (raw, resolution, click) => {
  let best = null;
  let bestArea = 0;
  const items = contoursAround(raw, resolution, click);
  for (let i = 0; i < items.length; i++) {
    const size = area(items[i].polygon);
    if (size > bestArea) {
      best = items[i];
      bestArea = size;
    }
  }
  return best;
};

// The local crop the pixel solver reads
export const localTicket = (page, click, priorBounds) => {
  const minimumReach = Math.min(priorBounds.width, priorBounds.height) < page.width * 0.2 &&
    Math.max(priorBounds.width, priorBounds.height) > page.width * 0.35 ? 900 : 320;
  const estimate = Math.max(priorBounds.width, priorBounds.height);
  const reach = Math.min(1000, Math.max(minimumReach, Math.ceil(estimate * 0.85)));
  const crop = {
    left: Math.max(0, Math.floor(click.x - reach)),
    top: Math.max(0, Math.floor(click.y - reach)),
    right: Math.min(page.width, Math.ceil(click.x + reach)),
    bottom: Math.min(page.height, Math.ceil(click.y + reach)),
  };
  const stride = Math.max(3, Math.ceil((2 * reach) / 650));
  const gw = Math.ceil((crop.right - crop.left) / stride);
  const gh = Math.ceil((crop.bottom - crop.top) / stride);
  if (gw < 20 || gh < 20 || gw * gh > 500000) return null;
  return { width: page.width, height: page.height, crop, stride, click };
};

const containsPoint = (poly, point) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > point.y !== b[1] > point.y && point.x < ((b[0] - a[0]) * (point.y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

// Chamber solver: distance to the opposite ink on a grid, then a flood fill
// from the click for growing radii; the first fill that stays off the crop
// border wins. ticket.channels and bytes come from the local crop.
export const solveOpenMask = (ticket, bytes) => {
  if (!ticket || !bytes || !ticket.crop || !ticket.click) return null;
  const channels = ticket.channels;
  const stride = ticket.stride;
  if ((channels !== 1 && channels !== 3 && channels !== 4) || stride < 2 || stride > 16) return null;
  const { left, top, right, bottom } = ticket.crop;
  if (right - left < 60 || bottom - top < 60 || bytes.length !== (right - left) * (bottom - top) * channels) return null;
  const gw = Math.ceil((right - left) / stride);
  const gh = Math.ceil((bottom - top) / stride);
  const count = gw * gh;
  if (count > 500000 || count < 400) return null;
  const rgbAt = (x, y) => {
    const at = ((y - top) * (right - left) + (x - left)) * channels;
    const r = bytes[at];
    return [r, channels === 1 ? r : bytes[at + 1], channels === 1 ? r : bytes[at + 2]];
  };
  const clickX = Math.floor(ticket.click.x);
  const clickY = Math.floor(ticket.click.y);
  if (clickX < left || clickX >= right || clickY < top || clickY >= bottom) return null;
  const clickRgb = rgbAt(clickX, clickY);
  const clickLevel = (clickRgb[0] * 54 + clickRgb[1] * 183 + clickRgb[2] * 19) / 256;
  const spread = Math.max(clickRgb[0], clickRgb[1], clickRgb[2]) - Math.min(clickRgb[0], clickRgb[1], clickRgb[2]);
  const white = clickLevel >= 225 && spread <= 18;
  const black = clickLevel <= 30 && spread <= 18;
  if (!white && !black) return null;
  const dist = new Uint16Array(count);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const rgb = rgbAt(left + x * stride, top + y * stride);
      const level = (rgb[0] * 54 + rgb[1] * 183 + rgb[2] * 19) / 256;
      dist[y * gw + x] = (white ? level < 145 : level > 105) ? 0 : 10000;
    }
  }
  // Two raster passes: square-dilation distance of the opposite ink
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
      if (y) {
        if (dist[i - gw] + 1 < d) d = dist[i - gw] + 1;
        if (x && dist[i - gw - 1] + 1 < d) d = dist[i - gw - 1] + 1;
        if (x + 1 < gw && dist[i - gw + 1] + 1 < d) d = dist[i - gw + 1] + 1;
      }
      dist[i] = d;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x + 1 < gw && dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
      if (y + 1 < gh) {
        if (dist[i + gw] + 1 < d) d = dist[i + gw] + 1;
        if (x && dist[i + gw - 1] + 1 < d) d = dist[i + gw - 1] + 1;
        if (x + 1 < gw && dist[i + gw + 1] + 1 < d) d = dist[i + gw + 1] + 1;
      }
      dist[i] = d;
    }
  }
  const sx = Math.round((ticket.click.x - left) / stride);
  const sy = Math.round((ticket.click.y - top) / stride);
  const seen = new Uint8Array(count);
  const queue = new Int32Array(count);
  const physical = [6, 9, 12, 15, 18, 24, 30, 36, 45, 54];
  const tried = {};
  for (let ri = 0; ri < physical.length; ri++) {
    const radius = Math.ceil(physical[ri] / stride);
    if (tried[radius]) continue;
    tried[radius] = true;
    let seed = -1;
    let seedScore = Infinity;
    for (let dy = -9; dy <= 9; dy++) {
      for (let dx = -9; dx <= 9; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || x >= gw || y < 0 || y >= gh) continue;
        const i = y * gw + x;
        if (dist[i] <= radius) continue;
        const score = dx * dx + dy * dy;
        if (score < seedScore) {
          seed = i;
          seedScore = score;
        }
      }
    }
    if (seed < 0) continue;
    seen.fill(0);
    const rowMin = new Int16Array(gh).fill(32767);
    const rowMax = new Int16Array(gh).fill(-1);
    let minX = gw;
    let maxX = -1;
    let minY = gh;
    let maxY = -1;
    let head = 0;
    let tail = 1;
    let touched = false;
    queue[0] = seed;
    seen[seed] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % gw;
      const y = Math.floor(i / gw);
      if (x <= 1 || x >= gw - 2 || y <= 1 || y >= gh - 2) {
        touched = true;
        break;
      }
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const next = [i - 1, i + 1, i - gw, i + gw];
      for (let k = 0; k < 4; k++) {
        const n = next[k];
        if (!seen[n] && dist[n] > radius) {
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (touched || tail < 80 || (maxX - minX) * stride < 25 || (maxY - minY) * stride < 25 ||
        tail / ((maxX - minX + 1) * (maxY - minY + 1)) < 0.28) continue;
    const poly = [];
    for (let y = minY; y <= maxY; y++) if (rowMin[y] !== 32767) poly.push([left + rowMin[y] * stride, top + y * stride]);
    for (let y = maxY; y >= minY; y--) if (rowMax[y] !== -1) poly.push([left + rowMax[y] * stride, top + y * stride]);
    if (poly.length < 6 || !containsPoint(poly, ticket.click)) continue;
    const color = [[], [], []];
    const sampleStep = Math.max(1, Math.floor(tail / 100));
    for (let qi = 0; qi < tail; qi += sampleStep) {
      const i = queue[qi];
      const rgb = rgbAt(left + (i % gw) * stride, top + Math.floor(i / gw) * stride);
      if ((white && (rgb[0] < 240 || rgb[1] < 240 || rgb[2] < 240)) || (black && (rgb[0] > 15 || rgb[1] > 15 || rgb[2] > 15))) continue;
      color[0].push(rgb[0]);
      color[1].push(rgb[1]);
      color[2].push(rgb[2]);
    }
    if (color[0].length < Math.min(20, (tail / sampleStep) * 0.55)) continue;
    for (let c = 0; c < 3; c++) color[c].sort((a, b) => a - b);
    const mid = (list) => list[Math.floor(list.length / 2)];
    return { polygon: poly, rgb: { red: mid(color[0]), green: mid(color[1]), blue: mid(color[2]) }, radiusPx: radius * stride };
  }
  return null;
};

// A fragmented chamber (lettering cut it): whiten the short, dense ink
// components (the letters) and solve again
const filterLetterInk = (ticket, source) => {
  const { crop, channels } = ticket;
  const width = crop.right - crop.left;
  const height = crop.bottom - crop.top;
  const count = width * height;
  const bytes = Uint8Array.from(source);
  const dark = new Uint8Array(count);
  for (let i = 0, at = 0; i < count; i++, at += channels) {
    const red = bytes[at];
    const green = channels === 1 ? red : bytes[at + 1];
    const blue = channels === 1 ? red : bytes[at + 2];
    if ((red * 54 + green * 183 + blue * 19) / 256 < 145) dark[i] = 1;
  }
  const rx = ticket.width;
  const ry = Math.max(900, Math.min(ticket.height, Math.round(ticket.width * 0.8)));
  const cw = Math.min(ticket.width, Math.ceil(ticket.click.x + rx)) - Math.max(0, Math.floor(ticket.click.x - rx));
  const ch = Math.min(ticket.height, Math.ceil(ticket.click.y + ry)) - Math.max(0, Math.floor(ticket.click.y - ry));
  const outlineStride = Math.max(4, Math.ceil(Math.sqrt((cw * ch) / 40000)));
  const minSpan = Math.max(18, (Math.min(ticket.width, ticket.height) * 0.075) / outlineStride) * outlineStride;
  const queue = new Int32Array(count);
  let removed = 0;
  for (let start = 0; start < count; start++) {
    if (dark[start] !== 1) continue;
    let head = 0;
    let tail = 1;
    let l = width;
    let t = height;
    let r = -1;
    let b = -1;
    queue[0] = start;
    dark[start] = 2;
    while (head < tail) {
      const at = queue[head++];
      const x = at % width;
      const y = (at / width) | 0;
      if (x < l) l = x;
      if (x > r) r = x;
      if (y < t) t = y;
      if (y > b) b = y;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const next = ny * width + nx;
          if (dark[next] === 1) {
            dark[next] = 2;
            queue[tail++] = next;
          }
        }
      }
    }
    const spanX = r - l + 1;
    const spanY = b - t + 1;
    if (tail >= 20 && Math.max(spanX, spanY) >= minSpan && tail / (spanX * spanY) <= 0.62) continue;
    removed++;
    for (let i = 0; i < tail; i++) {
      const at = queue[i] * channels;
      for (let c = 0; c < Math.min(channels, 3); c++) bytes[at + c] = 255;
    }
  }
  return { bytes, removed };
};

export const solveOpenChamber = (ticket, bytes, prior) => {
  const mask = solveOpenMask(ticket, bytes);
  if (!mask || !prior || mask.rgb.red < 240 || mask.rgb.green < 240 || mask.rgb.blue < 240) return mask;
  const priorBox = box(prior.polygon);
  const oldBox = box(mask.polygon);
  const narrowPrior = Math.min(priorBox.width, priorBox.height) < ticket.width * 0.2 && Math.max(priorBox.width, priorBox.height) > ticket.width * 0.35;
  const fragmentRatio = Math.min(oldBox.width / priorBox.width, oldBox.height / priorBox.height);
  if (priorBox.width <= 0 || priorBox.height <= 0 || (fragmentRatio >= 0.18 && !narrowPrior)) return mask;
  const filtered = filterLetterInk(ticket, bytes);
  if (!filtered.removed) return mask;
  const candidate = solveOpenMask(ticket, filtered.bytes);
  if (!candidate) return mask;
  const candidateBox = box(candidate.polygon);
  const cropArea = (ticket.crop.right - ticket.crop.left) * (ticket.crop.bottom - ticket.crop.top);
  if (candidateBox.width * candidateBox.height < oldBox.width * oldBox.height * 2 || candidateBox.width * candidateBox.height > cropArea * 0.45) return mask;
  if (!narrowPrior && contains(prior.polygon, ticket.click) &&
      (candidateBox.left < priorBox.left - 5 || candidateBox.top < priorBox.top - 5 || candidateBox.right > priorBox.right + 5 || candidateBox.bottom > priorBox.bottom + 5)) return mask;
  return candidate;
};

// The plan of an open chamber (same shape as bubblePlan's)
export const openPlan = (input, mask, prior, options = {}) => {
  const poly = mask && mask.polygon;
  if (!Array.isArray(poly) || poly.length < 6 || poly.length > 2000 || !mask.rgb) throw new Error("Invalid open chamber mask");
  const b = box(poly);
  const size = area(poly);
  if (b.width < 24 || b.height < 24 || size < 500 || size > input.width * input.height * 0.65 || !contains(poly, input.click)) {
    throw new Error("Invalid open chamber size");
  }
  const rgb = mask.rgb;
  const white = rgb.red >= 240 && rgb.green >= 240 && rgb.blue >= 240;
  const black = rgb.red <= 15 && rgb.green <= 15 && rgb.blue <= 15;
  if (!white && !black) throw new Error("Open chamber is not solid white or black");
  const margin = Math.max(5, Math.ceil(Math.min(b.width, b.height) * 0.06));
  const selection = { left: b.left + margin, top: b.top + margin, right: b.right - margin, bottom: b.bottom - margin };
  selection.width = selection.right - selection.left;
  selection.height = selection.bottom - selection.top;
  selection.xMid = (selection.left + selection.right) / 2;
  selection.yMid = (selection.top + selection.bottom) / 2;
  if (selection.width < 24 || selection.height < 24) throw new Error("Open chamber is too small for text");
  let kind = shapeKind(prior.polygon);
  if (kind === "unknown") kind = "regular";
  selection.bubbleKind = kind;
  return {
    documentId: input.documentId,
    source: "wand",
    open: true,
    click: { x: input.click.x, y: input.click.y },
    selectionBounds: { ...input.selectionBounds },
    kind,
    connected: false,
    neck: null,
    contour: prior.contour,
    cleanPolygon: poly,
    cleanupPolygon: options.autoClean ? poly : null,
    cleanupInset: 5,
    centerOnly: false,
    autoClean: !!options.autoClean,
    cleanupSkipped: null,
    fill: Math.round((rgb.red + rgb.green + rgb.blue) / 3),
    fillRGB: rgb,
    textColor: black ? { red: 255, green: 255, blue: 255 } : null,
    selection,
  };
};

/* ---------- Local region: a leaking click that isolates no chamber ---------- */

// The click still says where the text goes: a bubble open on a gap wider than
// the recovery closes, a bubble drawn with strokes that do not meet, or text
// set on the bare page. Both hosts read the outline of the selection inside a
// disc around the click (one work path), and the region is found here, on a
// grid: no pixels are needed, so the Legacy host takes this route too.

// Radius of that disc: a share of the page's width (of a single page when
// the document is a spread)
const LOCAL_REACH = 0.18;
const LOCAL_SIDES = 48;
// Opening radii tried, as shares of the recovery's contraction radius
const LOCAL_RADII = [0, 0.2, 0.4, 0.7, 1];
// An enclosed piece of ink this long (share of the disc's radius) is no speck
const LOCAL_HOLE = 0.25;

export const localWindow = (page, click) => {
  const radius = Math.round(Math.max(80, Math.min(page.width, page.height * 0.72) * LOCAL_REACH));
  const polygon = [];
  for (let i = 0; i < LOCAL_SIDES; i++) {
    const angle = (i / LOCAL_SIDES) * 2 * Math.PI;
    polygon.push([
      Math.max(0, Math.min(page.width, Math.round(click.x + radius * Math.cos(angle)))),
      Math.max(0, Math.min(page.height, Math.round(click.y + radius * Math.sin(angle)))),
    ]);
  }
  return { radius, polygon };
};

// 3-4 chamfer distance to the zero cells, in place. The grid's border counts
// as zero unless it is free (the distance to a set inside the grid).
const chamfer = (dist, gw, gh, freeBorder) => {
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!dist[i]) continue;
      const edge = !x || !y || x === gw - 1 || y === gh - 1;
      if (edge && !freeBorder) {
        dist[i] = 3;
        continue;
      }
      let d = dist[i];
      if (x && dist[i - 1] + 3 < d) d = dist[i - 1] + 3;
      if (y) {
        if (dist[i - gw] + 3 < d) d = dist[i - gw] + 3;
        if (x && dist[i - gw - 1] + 4 < d) d = dist[i - gw - 1] + 4;
        if (x + 1 < gw && dist[i - gw + 1] + 4 < d) d = dist[i - gw + 1] + 4;
      }
      dist[i] = d;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const i = y * gw + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x + 1 < gw && dist[i + 1] + 3 < d) d = dist[i + 1] + 3;
      if (y + 1 < gh) {
        if (dist[i + gw] + 3 < d) d = dist[i + gw] + 3;
        if (x && dist[i + gw - 1] + 4 < d) d = dist[i + gw - 1] + 4;
        if (x + 1 < gw && dist[i + gw + 1] + 4 < d) d = dist[i + gw + 1] + 4;
      }
      dist[i] = d;
    }
  }
};

// Holes of the marked cells (unmarked cells the grid's border cannot reach
// through unmarked ones): visit(queue, from, to) gets the cells of each
const eachHole = (cells, mark, queue, gw, gh, visit) => {
  const count = gw * gh;
  mark.fill(0);
  let head = 0;
  let tail = 0;
  const push = (i) => {
    if (cells[i] || mark[i]) return;
    mark[i] = 1;
    queue[tail++] = i;
  };
  const spread = () => {
    while (head < tail) {
      const i = queue[head++];
      const x = i % gw;
      if (x > 0) push(i - 1);
      if (x < gw - 1) push(i + 1);
      if (i >= gw) push(i - gw);
      if (i + gw < count) push(i + gw);
    }
  };
  for (let x = 0; x < gw; x++) {
    push(x);
    push((gh - 1) * gw + x);
  }
  for (let y = 0; y < gh; y++) {
    push(y * gw);
    push(y * gw + gw - 1);
  }
  spread();
  for (let start = 0; start < count; start++) {
    if (cells[start] || mark[start]) continue;
    const from = tail;
    push(start);
    spread();
    visit(queue, from, tail);
  }
};

// Keeps the marked cells the source sees: rays stopped by the first unmarked
// cell
const shade = (cells, mark, gw, gh, source) => {
  const count = gw * gh;
  mark.fill(0);
  const sx = (source % gw) + 0.5;
  const sy = Math.floor(source / gw) + 0.5;
  const rays = Math.ceil(2 * Math.PI * Math.hypot(gw, gh));
  for (let r = 0; r < rays; r++) {
    const dx = Math.cos((r / rays) * 2 * Math.PI) * 0.5;
    const dy = Math.sin((r / rays) * 2 * Math.PI) * 0.5;
    let x = sx;
    let y = sy;
    for (;;) {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh || !cells[cy * gw + cx]) break;
      mark[cy * gw + cx] = 1;
      x += dx;
      y += dy;
    }
  }
  for (let i = 0; i < count; i++) cells[i] = cells[i] && mark[i] ? 1 : 0;
};

// Outer border of the marked cells (4-connected walk along the cell edges)
const traceCells = (cells, gw, gh, startX, startY) => {
  const on = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && cells[y * gw + x] === 1;
  const points = [];
  let x = startX;
  let y = startY;
  let dx = 1;
  let dy = 0;
  let guard = 0;
  do {
    points.push([x, y]);
    x += dx;
    y += dy;
    const right = dx === 1 ? on(x, y) : dx === -1 ? on(x - 1, y - 1) : dy === 1 ? on(x - 1, y) : on(x, y - 1);
    const left = dx === 1 ? on(x, y - 1) : dx === -1 ? on(x - 1, y) : dy === 1 ? on(x, y) : on(x - 1, y - 1);
    if (left) {
      const k = dx;
      dx = dy;
      dy = -k;
    } else if (!right) {
      const k = dx;
      dx = -dy;
      dy = k;
    }
  } while ((x !== startX || y !== startY || dx !== 1 || dy !== 0) && ++guard < 400000);
  return points;
};

// The region of the click in the selection's outline inside the disc (raw:
// the work path of the selection intersected with localWindow's polygon).
// The selection is opened (eroded, then grown back from the part around the
// click) at growing radii: the first radius that closes the region inside
// the disc is a bubble and wins; when none does (bare page, wide gap), the
// widest opening is kept, the cleanest body around the click.
export const localRegion = (raw, page, click) => {
  let subpaths;
  try {
    subpaths = subpathsFromDescriptor(raw, page.resolution);
  } catch (error) {
    return null;
  }
  const polygons = [];
  for (let i = 0; i < subpaths.length; i++) {
    if (subpaths[i].closed && subpaths[i].contour.length >= 3) polygons.push(flatten(subpaths[i].contour));
  }
  if (!polygons.length) return null;
  const reach = localWindow(page, click).radius;
  const stride = Math.max(2, Math.ceil((2 * reach) / 280));
  const left = Math.floor(click.x - reach) - 2 * stride;
  const top = Math.floor(click.y - reach) - 2 * stride;
  const gw = Math.ceil((2 * reach) / stride) + 5;
  const gh = gw;
  const count = gw * gh;
  // Even-odd fill of the outline (holes are subpaths too)
  const inside = new Uint8Array(count);
  const rows = [];
  for (let y = 0; y < gh; y++) rows.push([]);
  for (let p = 0; p < polygons.length; p++) {
    const poly = polygons[p];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a[1] === b[1]) continue;
      const from = Math.max(0, Math.ceil((Math.min(a[1], b[1]) - top) / stride - 0.5));
      const to = Math.min(gh - 1, Math.floor((Math.max(a[1], b[1]) - top) / stride - 0.5));
      for (let y = from; y <= to; y++) {
        const scan = top + (y + 0.5) * stride;
        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) rows[y].push(a[0] + ((scan - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
  }
  for (let y = 0; y < gh; y++) {
    const xs = rows[y].sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - left) / stride - 0.5));
      const to = Math.min(gw - 1, Math.floor((xs[k + 1] - left) / stride - 0.5));
      for (let x = from; x <= to; x++) inside[y * gw + x] = 1;
    }
  }
  // Ink the selection encloses: the long pieces (a drawing, another bubble)
  // are told from letters and specks here, before the opening merges the
  // letters of a line into one piece
  const queue = new Int32Array(count);
  const seen = new Uint8Array(count);
  const longInk = new Uint8Array(count);
  const long = (reach * LOCAL_HOLE) / stride;
  eachHole(inside, seen, queue, gw, gh, (cells, from, to) => {
    let minX = gw;
    let maxX = -1;
    let minY = gh;
    let maxY = -1;
    for (let q = from; q < to; q++) {
      const x = cells[q] % gw;
      const y = (cells[q] - x) / gw;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (Math.max(maxX - minX, maxY - minY) + 1 < long) return;
    for (let q = from; q < to; q++) longInk[cells[q]] = 1;
  });
  // Distance to the outside, in thirds of a cell (3-4 chamfer, close to a
  // disc: an opening by a square would square the region's corners)
  const dist = new Uint16Array(count);
  for (let i = 0; i < count; i++) dist[i] = inside[i] ? 30000 : 0;
  chamfer(dist, gw, gh);
  const cx = Math.max(1, Math.min(gw - 2, Math.round((click.x - left) / stride - 0.5)));
  const cy = Math.max(1, Math.min(gh - 2, Math.round((click.y - top) / stride - 0.5)));
  // The click's cell, or the closest selected one when it sits on a line
  let origin = -1;
  let originScore = Infinity;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const i = (cy + dy) * gw + cx + dx;
      if (cx + dx < 0 || cy + dy < 0 || cx + dx >= gw || cy + dy >= gh || !inside[i] || dx * dx + dy * dy >= originScore) continue;
      originScore = dx * dx + dy * dy;
      origin = i;
    }
  }
  if (origin < 0) return null;
  const contraction = openRecoveryFrame(page, click).radius;
  const grown = new Uint8Array(count);
  const back = new Uint16Array(count);
  const tried = {};
  let fallback = null;
  for (let r = 0; r < LOCAL_RADII.length; r++) {
    const radius = Math.round((contraction * LOCAL_RADII[r]) / stride);
    if (tried[radius]) continue;
    tried[radius] = true;
    // The nearest cell around the click that survives the erosion, reached
    // through the selection (never across a line)
    let seed = -1;
    let head = 0;
    let tail = 1;
    seen.fill(0);
    queue[0] = origin;
    seen[origin] = 1;
    const limit = radius + 2;
    while (head < tail && seed < 0) {
      const i = queue[head++];
      if (dist[i] > radius * 3) {
        seed = i;
        break;
      }
      const x = i % gw;
      const y = (i - x) / gw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (seen[n] || !inside[n] || Math.max(Math.abs(nx - (origin % gw)), Math.abs(ny - Math.floor(origin / gw))) > limit) continue;
          seen[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    if (seed < 0) continue;
    // The eroded part around the seed, then grown back inside the selection
    grown.fill(0);
    head = 0;
    tail = 1;
    queue[0] = seed;
    grown[seed] = 1;
    while (head < tail) {
      const i = queue[head++];
      const next = [i - 1, i + 1, i - gw, i + gw];
      for (let k = 0; k < 4; k++) {
        const n = next[k];
        if (n >= 0 && n < count && !grown[n] && dist[n] > radius * 3) {
          grown[n] = 1;
          queue[tail++] = n;
        }
      }
    }
    // Grown back by the same radius: the opening never leaves the selection
    if (radius) {
      for (let i = 0; i < count; i++) back[i] = grown[i] ? 0 : 30000;
      chamfer(back, gw, gh, true);
      for (let i = 0; i < count; i++) {
        if (!grown[i] && inside[i] && back[i] <= radius * 3) {
          grown[i] = 1;
          queue[tail++] = i;
        }
      }
    }
    // Ink the region encloses: letters and specks are covered, as in a closed
    // bubble (its outline alone is read); a long piece and what lies behind
    // it, seen from the click, are left out
    const source = grown[origin] ? origin : seed;
    let blocked = false;
    eachHole(grown, seen, queue, gw, gh, (cells, from, to) => {
      for (let q = from; q < to; q++) {
        if (longInk[cells[q]]) {
          blocked = true;
          return;
        }
      }
      for (let q = from; q < to; q++) grown[cells[q]] = 1;
    });
    if (blocked) {
      shade(grown, seen, gw, gh, source);
      // Only the part still joined to the click
      seen.fill(0);
      head = 0;
      tail = 1;
      queue[0] = source;
      seen[source] = 1;
      while (head < tail) {
        const i = queue[head++];
        const x = i % gw;
        if (x > 0 && grown[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
        if (x < gw - 1 && grown[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
        if (i >= gw && grown[i - gw] && !seen[i - gw]) { seen[i - gw] = 1; queue[tail++] = i - gw; }
        if (i + gw < count && grown[i + gw] && !seen[i + gw]) { seen[i + gw] = 1; queue[tail++] = i + gw; }
      }
      for (let i = 0; i < count; i++) grown[i] = seen[i];
    }
    let minX = gw;
    let maxX = -1;
    let minY = gh;
    let maxY = -1;
    let open = false;
    let first = -1;
    let size = 0;
    for (let i = 0; i < count; i++) {
      if (!grown[i]) continue;
      size++;
      const x = i % gw;
      const y = (i - x) / gw;
      if (first < 0) first = i;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // On the disc's arc (the page's edge is no leak)
      if (Math.hypot(left + (x + 0.5) * stride - click.x, top + (y + 0.5) * stride - click.y) >= reach - 2.5 * stride) open = true;
    }
    if ((maxX - minX + 1) * stride < 24 || (maxY - minY + 1) * stride < 24 || size * stride * stride < 500) continue;
    const border = traceCells(grown, gw, gh, first % gw, Math.floor(first / gw));
    const polygon = simplify(border.map((point) => [left + point[0] * stride, top + point[1] * stride]), stride * 0.75);
    if (polygon.length < 4) continue;
    const region = { polygon, open, radius: radius * stride };
    if (!open) return region;
    fallback = region;
  }
  return fallback;
};

// The plan of a local region (same shape as bubblePlan's). tone: the fill
// around the click ({ fill, rgb }), white when unknown. A region closed
// inside the disc is a bubble and keeps its shape's kind; an open one is
// no outline of the drawing, so it is laid out as a regular bubble.
export const localPlan = (input, region, tone, options = {}) => {
  const polygon = region && region.polygon;
  if (!Array.isArray(polygon) || polygon.length < 4) throw new Error("Invalid local region");
  const rgb = (tone && tone.rgb) || { red: 255, green: 255, blue: 255 };
  const black = fillTone.isBlack(rgb);
  let kind = region.open ? "regular" : shapeKind(polygon);
  if (kind === "unknown") kind = "regular";
  return {
    documentId: input.documentId,
    source: "wand",
    open: true,
    local: true,
    click: { x: input.click.x, y: input.click.y },
    selectionBounds: { ...input.selectionBounds },
    kind,
    connected: false,
    neck: null,
    contour: polygonContour(polygon),
    cleanPolygon: polygon,
    cleanupPolygon: null,
    cleanupInset: black ? 5 : 3,
    centerOnly: false,
    autoClean: false,
    cleanupSkipped: options.autoClean ? "Auto Clean skipped an open, page-spanning, or oversized selection." : null,
    fill: tone && isFinite(tone.fill) ? tone.fill : Math.round((rgb.red + rgb.green + rgb.blue) / 3),
    fillRGB: rgb,
    textColor: black ? { red: 255, green: 255, blue: 255 } : null,
    selection: { ...bodyBounds(polygon, box(polygon)), bubbleKind: kind },
  };
};

// The disc itself: the region of a click nothing else could read
export const discRegion = (page, click) => ({ polygon: localWindow(page, click).polygon, open: true, radius: 0 });
