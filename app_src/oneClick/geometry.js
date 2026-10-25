// Bubble geometry for the smart paste. Ported from MD TYPER (frozen CEP
// host.jsx geometry, with the author's permission): outline flattening,
// containment, the tail-free "body" of a bubble, the connected-bubble neck
// finder, the shape classifier and the cleanup validator.
//
// Pure functions: polygons are [[x, y], ...] in document pixels. The cleanup
// validator may read pixels through an optional synchronous sampler
// (UXP, local crop); without one it relies on the fill given by the host.

const BEZIER_WEIGHTS = [];
for (let step = 0; step < 8; step++) {
  const t = step / 8;
  const u = 1 - t;
  BEZIER_WEIGHTS.push([u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]);
}

// Small identity caches: the same polygon or contour is queried many times
// during one paste (containment, cuts, layout). Bounded, never semantic.
const caches = { flat: [], inside: [], simplify: [] };
const remember = (list, entry, limit) => {
  list.push(entry);
  if (list.length > limit) list.shift();
};

export const clearGeometryCaches = () => {
  caches.flat = [];
  caches.inside = [];
  caches.simplify = [];
};

export const signedArea = (p) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
};
export const area = (p) => Math.abs(signedArea(p));

export const box = (points) => {
  const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (let i = 0; i < points.length; i++) {
    b.left = Math.min(b.left, points[i][0]);
    b.top = Math.min(b.top, points[i][1]);
    b.right = Math.max(b.right, points[i][0]);
    b.bottom = Math.max(b.bottom, points[i][1]);
  }
  b.width = b.right - b.left;
  b.height = b.bottom - b.top;
  return b;
};

// Even-odd containment. Large polygons get a row-bucket index.
const containsSlow = (p, q) => {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > q.y !== p[j][1] > q.y &&
        q.x < ((p[j][0] - p[i][0]) * (q.y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
};

export const contains = (p, q) => {
  if (p.length < 64) return containsSlow(p, q);
  let index = null;
  for (let k = 0; k < caches.inside.length; k++) {
    if (caches.inside[k].poly === p) { index = caches.inside[k]; break; }
  }
  if (!index) {
    const b = box(p);
    const step = Math.max(1, b.height / 128);
    const buckets = [];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const low = Math.min(p[i][1], p[j][1]);
      const high = Math.max(p[i][1], p[j][1]);
      if (low === high) continue;
      for (let k = Math.floor((low - b.top) / step); k <= Math.floor((high - b.top) / step); k++) {
        if (!buckets[k]) buckets[k] = [];
        buckets[k].push(i);
      }
    }
    index = { poly: p, bounds: b, step, buckets };
    remember(caches.inside, index, 512);
  }
  const b = index.bounds;
  if (q.x < b.left || q.x > b.right || q.y < b.top || q.y > b.bottom) return false;
  const edges = index.buckets[Math.floor((q.y - b.top) / index.step)] || [];
  let inside = false;
  for (let k = 0; k < edges.length; k++) {
    const i = edges[k];
    const j = (i + p.length - 1) % p.length;
    if (p[i][1] > q.y !== p[j][1] > q.y &&
        q.x < ((p[j][0] - p[i][0]) * (q.y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
};

// A contour is a list of Bézier nodes [anchor, leftDirection, rightDirection]
// (Photoshop's forward/backward handles). Eight samples per segment.
export const flatten = (nodes) => {
  for (let k = 0; k < caches.flat.length; k++) if (caches.flat[k].nodes === nodes) return caches.flat[k].points;
  const points = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const next = nodes[(i + 1) % nodes.length];
    const a = node[0];
    const b = node[1];
    const c = next[2];
    const d = next[0];
    for (let j = 0; j < 8; j++) {
      const w = BEZIER_WEIGHTS[j];
      points.push([
        w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0],
        w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1],
      ]);
    }
  }
  remember(caches.flat, { nodes, points }, 512);
  return points;
};

// A straight polygon as a contour (every handle on its anchor)
export const polygonContour = (poly) => poly.map((point) => [point, point, point]);

// Clip a polygon to one side of the line a-b (side +1 or -1)
export const clipToSide = (p, a, b, side) => {
  const d = (v) => side * ((b[0] - a[0]) * (v[1] - a[1]) - (b[1] - a[1]) * (v[0] - a[0]));
  const result = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const u = p[j];
    const v = p[i];
    const du = d(u);
    const dv = d(v);
    if (du >= 0 !== dv >= 0) {
      const t = du / (du - dv);
      result.push([u[0] + t * (v[0] - u[0]), u[1] + t * (v[1] - u[1])]);
    }
    if (dv >= 0) result.push(v);
  }
  return result;
};

const clipBothSides = (p, a, b) => {
  const one = [];
  const two = [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const u = p[j];
    const v = p[i];
    const cu = dx * (u[1] - a[1]) - dy * (u[0] - a[0]);
    const cv = dx * (v[1] - a[1]) - dy * (v[0] - a[0]);
    if (cu >= 0 !== cv >= 0) {
      const t = cu / (cu - cv);
      one.push([u[0] + t * (v[0] - u[0]), u[1] + t * (v[1] - u[1])]);
    }
    if (cv >= 0) one.push(v);
    if (-cu >= 0 !== -cv >= 0) {
      const t = -cu / (-cu + cv);
      two.push([u[0] + t * (v[0] - u[0]), u[1] + t * (v[1] - u[1])]);
    }
    if (-cv >= 0) two.push(v);
  }
  return [one, two];
};

// Clip a polygon to an axis-aligned rectangle
export const clipToRect = (poly, r) => {
  const clip = (points, axis, value, keepGreater) => {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const av = axis ? a[1] : a[0];
      const bv = axis ? b[1] : b[0];
      const ain = keepGreater ? av >= value : av <= value;
      const bin = keepGreater ? bv >= value : bv <= value;
      if (ain !== bin) {
        const t = (value - av) / (bv - av);
        out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
      if (bin) out.push(b);
    }
    return out;
  };
  let out = clip(poly, 0, r.left, true);
  out = clip(out, 0, r.right, false);
  out = clip(out, 1, r.top, true);
  return clip(out, 1, r.bottom, false);
};

// Douglas-Peucker on a closed polygon
const simplifyUncached = (points, tolerance) => {
  if (points.length < 3) return points.slice(0);
  const count = points.length;
  const mid = Math.floor(count / 2);
  const keep = [];
  const stack = [[mid, count], [0, mid]];
  const square = tolerance * tolerance;
  keep[0] = keep[mid] = keep[count] = true;
  while (stack.length) {
    const range = stack.pop();
    const from = range[0];
    const to = range[1];
    if (to - from < 2) continue;
    const a = points[from];
    const b = points[to === count ? 0 : to];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const den = dx * dx + dy * dy;
    let max = 0;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const px = points[i][0] - a[0];
      const py = points[i][1] - a[1];
      let t = den ? (px * dx + py * dy) / den : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const x = px - t * dx;
      const y = py - t * dy;
      const d = x * x + y * y;
      if (d > max) { max = d; index = i; }
    }
    if (max > square) {
      keep[index] = true;
      stack.push([index, to], [from, index]);
    }
  }
  const out = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(points[i]);
  return out;
};

export const simplify = (points, tolerance) => {
  for (let i = 0; i < caches.simplify.length; i++) {
    const entry = caches.simplify[i];
    if (entry.points === points && entry.tolerance === tolerance) return entry.result;
  }
  const result = simplifyUncached(points, tolerance);
  remember(caches.simplify, { points, tolerance, result }, 16);
  return result;
};

// The bubble "body": the box of the polygon eroded by 14% of its short side,
// grown back, so a narrow tail does not pull the text off centre. The centre
// is the centroid of the eroded core.
export const bodyBounds = (poly, b = box(poly)) => {
  const step = Math.max(1, Math.max(b.width, b.height) / 128);
  const w = Math.ceil(b.width / step) + 3;
  const h = Math.ceil(b.height / step) + 3;
  let r = Math.max(2, (Math.min(b.width, b.height) * 0.14) / step);
  const root2 = 1.41421356;
  const crossRows = [];
  for (let y = 0; y < h; y++) crossRows[y] = [];
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j];
    const z = poly[(j + 1) % poly.length];
    if (a[1] === z[1]) continue;
    const from = Math.max(0, Math.floor((Math.min(a[1], z[1]) - b.top) / step + 0.5) - 1);
    const to = Math.min(h - 1, Math.ceil((Math.max(a[1], z[1]) - b.top) / step + 0.5) + 1);
    for (let y = from; y <= to; y++) {
      const scan = b.top + (y - 0.5) * step;
      if ((a[1] <= scan && z[1] > scan) || (z[1] <= scan && a[1] > scan)) {
        crossRows[y].push(a[0] + ((scan - a[1]) * (z[0] - a[0])) / (z[1] - a[1]));
      }
    }
  }
  const rows = [];
  for (let y = 0; y < h; y++) {
    const cross = crossRows[y];
    const runs = [];
    cross.sort((p, q) => p - q);
    for (let j = 0; j + 1 < cross.length; j += 2) {
      let left = Math.max(0, Math.ceil((cross[j] - b.left) / step + 0.5));
      let right = Math.min(w - 1, Math.ceil((cross[j + 1] - b.left) / step + 0.5) - 1);
      while (left <= right && b.left + (left - 0.5) * step < cross[j]) left++;
      while (left > 0 && b.left + (left - 1 - 0.5) * step >= cross[j]) left--;
      while (right >= left && b.left + (right - 0.5) * step >= cross[j + 1]) right--;
      while (right + 1 < w && b.left + (right + 1 - 0.5) * step < cross[j + 1]) right++;
      if (left <= right) {
        if (runs.length && left <= runs[runs.length - 1][1] + 1) runs[runs.length - 1][1] = right;
        else runs.push([left, right]);
      }
    }
    rows.push(runs);
  }
  const offsets = [];
  for (let dy = 0; dy < r; dy++) {
    let dx = 0;
    while (Math.max(dx, dy) + (root2 - 1) * Math.min(dx, dy) < r) dx++;
    offsets.push(dx - 1);
  }
  let l = Infinity;
  let t = Infinity;
  let rr = -Infinity;
  let bb = -Infinity;
  let coreArea = 0;
  let coreX = 0;
  let coreY = 0;
  for (let y = 1; y < h - 1; y++) {
    let available = [[1, w - 2]];
    for (let dy = -(offsets.length - 1); dy < offsets.length && available.length; dy++) {
      const row = y + dy;
      const shrink = offsets[Math.abs(dy)];
      const source = row >= 0 && row < h ? rows[row] : [];
      const next = [];
      let ai = 0;
      let si = 0;
      while (ai < available.length && si < source.length) {
        const low = Math.max(available[ai][0], source[si][0] + shrink);
        const high = Math.min(available[ai][1], source[si][1] - shrink);
        if (low <= high) next.push([low, high]);
        if (available[ai][1] < source[si][1] - shrink) ai++;
        else si++;
      }
      available = next;
    }
    if (available.length) {
      for (let run = 0; run < available.length; run++) {
        const count = available[run][1] - available[run][0] + 1;
        coreArea += count;
        coreX += (available[run][0] + available[run][1]) * 0.5 * count;
        coreY += y * count;
      }
      if (available[0][0] < l) l = available[0][0];
      if (available[available.length - 1][1] > rr) rr = available[available.length - 1][1];
      if (y < t) t = y;
      if (y > bb) bb = y;
    }
  }
  if (!isFinite(l)) {
    l = 0;
    rr = w - 2;
    t = 0;
    bb = h - 2;
    r = 0;
  }
  const out = {
    left: Math.max(b.left, b.left + (l - 0.5 - r) * step),
    top: Math.max(b.top, b.top + (t - 0.5 - r) * step),
    right: Math.min(b.right, b.left + (rr - 0.5 + r) * step),
    bottom: Math.min(b.bottom, b.top + (bb - 0.5 + r) * step),
  };
  out.width = out.right - out.left;
  out.height = out.bottom - out.top;
  out.xMid = (out.left + out.right) / 2;
  out.yMid = (out.top + out.bottom) / 2;
  if (coreArea > 0) {
    out.xMid = b.left + (coreX / coreArea - 0.5) * step;
    out.yMid = b.top + (coreY / coreArea - 0.5) * step;
  }
  return out;
};

// Neck finder for connected bubbles: the narrowest chord between two concave
// points of the outline that splits it in two substantial chambers. Returns
// null (no neck), { ambiguous: true, ambiguousNeck } (click on the neck) or
// { points, neck: [a, b], score }.
const NECK_WIDTH_RATIO = 0.75;

export const findCut = (contours, click, bounds, openRecovery) => {
  let polygon = null;
  let polygonArea = 0;
  const minDim = Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top);
  let cutTolerance = Math.max(0.7, minDim * 0.003);
  if (openRecovery) cutTolerance = Math.min(4, Math.max(cutTolerance, minDim * 0.008));
  const chamberBody = (points, partArea) => {
    const b = box(points);
    return b.width >= minDim * 0.35 && b.height >= minDim * 0.35 && partArea / (b.width * b.height) >= 0.45;
  };
  for (let n = 0; n < contours.length; n++) {
    const p = simplify(flatten(contours[n]), cutTolerance);
    const size = area(p);
    // Lettering holes are ignored: only an enclosing outline owns the click
    if (size > polygonArea && containsSlow(p, click)) {
      polygon = p;
      polygonArea = size;
    }
  }
  if (!polygon || polygon.length > 256 || polygonArea < 400) return null;
  const sign = signedArea(polygon) > 0 ? 1 : -1;
  const reflex = [];
  const rootArea = Math.sqrt(polygonArea);
  const offsets = [0, 0.75, -0.75];
  const distances = [];
  let best = null;
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i + polygon.length - 1) % polygon.length];
    const v = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    const cross = (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]);
    if (cross * sign < -0.01) reflex.push(i);
  }
  for (let x = 0; x < reflex.length; x++) {
    for (let y = x + 1; y < reflex.length; y++) {
      const originalA = polygon[reflex[x]];
      const originalB = polygon[reflex[y]];
      const dx = originalB[0] - originalA[0];
      const dy = originalB[1] - originalA[1];
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 3 || length > rootArea * 0.72) continue;
      // Tiny parallel offsets disambiguate a neck meeting a straight edge
      for (let offsetIndex = 0; offsetIndex < 3; offsetIndex++) {
        const shift = offsets[offsetIndex];
        const a = [originalA[0] - (dy * shift) / length, originalA[1] + (dx * shift) / length];
        const b = [originalB[0] - (dy * shift) / length, originalB[1] + (dx * shift) / length];
        if (!contains(polygon, { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 })) continue;
        let firstSign = 0;
        let lastSign = 0;
        let crossings = 0;
        let remote = false;
        const near = length * 0.1;
        for (let i = 0; i < polygon.length; i++) {
          const d = dx * (polygon[i][1] - a[1]) - dy * (polygon[i][0] - a[0]);
          distances[i] = d;
          if (Math.abs(d) > near) {
            const currentSign = d > 0 ? 1 : -1;
            if (!firstSign) firstSign = currentSign;
            else if (currentSign !== lastSign) crossings++;
            lastSign = currentSign;
          } else {
            const projection = ((polygon[i][0] - a[0]) * dx + (polygon[i][1] - a[1]) * dy) / length;
            if (projection < -2 || projection > length + 2) { remote = true; break; }
          }
        }
        if (remote) continue;
        for (let i = 0; i < polygon.length; i++) {
          const k = (i + 1) % polygon.length;
          const di = distances[i];
          const dk = distances[k];
          if (di * dk < 0) {
            const f = di / (di - dk);
            const ix = polygon[i][0] + f * (polygon[k][0] - polygon[i][0]);
            const iy = polygon[i][1] + f * (polygon[k][1] - polygon[i][1]);
            const projection = ((ix - a[0]) * dx + (iy - a[1]) * dy) / length;
            if (projection < -2 || projection > length + 2) { remote = true; break; }
          }
        }
        if (remote) continue;
        if (firstSign && lastSign !== firstSign) crossings++;
        if (crossings !== 2) continue;
        const halves = clipBothSides(polygon, a, b);
        const areaOne = area(halves[0]);
        const areaTwo = area(halves[1]);
        const small = Math.min(areaOne, areaTwo);
        if (small < polygonArea * 0.15 || Math.abs(areaOne + areaTwo - polygonArea) > polygonArea * 0.01) continue;
        // A real neck is much narrower than both chambers measured along
        // it; a cloud's scalloped outline pinches only slightly (TypeR)
        const along = (half) => {
          let low = Infinity;
          let high = -Infinity;
          for (let k = 0; k < half.length; k++) {
            const t = ((half[k][0] - a[0]) * dx + (half[k][1] - a[1]) * dy) / length;
            if (t < low) low = t;
            if (t > high) high = t;
          }
          return high - low;
        };
        if (length > NECK_WIDTH_RATIO * Math.min(along(halves[0]), along(halves[1]))) continue;
        const score = length / Math.sqrt(small);
        // A broad seam is admitted only between two compact chambers
        if (score > 0.95 || length > rootArea * 0.65) {
          if (score > 1.18 || small < polygonArea * 0.25) continue;
          if (!chamberBody(halves[0], areaOne) || !chamberBody(halves[1], areaTwo)) continue;
        }
        if (best && score >= best.score) continue;
        best = { a, b, score };
      }
    }
  }
  if (!best) return null;
  const dx = best.b[0] - best.a[0];
  const dy = best.b[1] - best.a[1];
  const side = dx * (click.y - best.a[1]) - dy * (click.x - best.a[0]);
  if (Math.abs(side) / Math.sqrt(dx * dx + dy * dy) < Math.max(3, minDim * 0.025)) return { ambiguous: true, ambiguousNeck: [best.a, best.b] };
  const pad = 2;
  const frame = [
    [bounds.left - pad, bounds.top - pad],
    [bounds.right + pad, bounds.top - pad],
    [bounds.right + pad, bounds.bottom + pad],
    [bounds.left - pad, bounds.bottom + pad],
  ];
  return { points: clipToSide(frame, best.a, best.b, side > 0 ? 1 : -1), neck: [best.a, best.b], score: best.score };
};

export const convexHull = (points) => {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [];
  const upper = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < p.length; i++) {
    while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p[i]) <= 0) lower.pop();
    lower.push(p[i]);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

// A wavy caption still has four long sides
const isWarpedCaption = (poly, polyArea, hullArea, boxArea, dim) => {
  if (polyArea / hullArea < 0.91 || polyArea / boxArea < 0.82) return false;
  const hull = simplify(convexHull(poly), dim * 0.02);
  let largest = 0;
  if (hull.length <= 24) {
    for (let a = 0; a < hull.length - 3; a++) {
      for (let b = a + 1; b < hull.length - 2; b++) {
        for (let c = b + 1; c < hull.length - 1; c++) {
          for (let d = c + 1; d < hull.length; d++) {
            largest = Math.max(largest, area([hull[a], hull[b], hull[c], hull[d]]));
          }
        }
      }
    }
    if (largest / area(hull) > 0.86) return true;
  }
  const coarse = simplify(poly, dim * 0.025);
  if (coarse.length > 14) return false;
  let corners = 0;
  for (let i = 0; i < coarse.length; i++) {
    const a = coarse[(i + coarse.length - 1) % coarse.length];
    const b = coarse[i];
    const c = coarse[(i + 1) % coarse.length];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const angle = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    if (angle > Math.PI * 0.28 && angle < Math.PI * 0.75 &&
        Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy)) > dim * dim * 0.04) corners++;
  }
  return corners === 4;
};

// Classify an outline: "shout" (repeated sharp peaks and deep valleys),
// "narration" (four square corners or a wavy caption), "regular" (smooth) or
// "unknown". Only reads the outline.
export const shapeKind = (points) => {
  if (!points || points.length < 3 || points.length > 4096) return "unknown";
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const v = points[i];
    if (!v || !isFinite(v[0]) || !isFinite(v[1])) return "unknown";
    left = Math.min(left, v[0]);
    right = Math.max(right, v[0]);
    top = Math.min(top, v[1]);
    bottom = Math.max(bottom, v[1]);
  }
  const dim = Math.min(right - left, bottom - top);
  if (dim < 8) return "unknown";
  const p = simplify(points, dim * 0.004);
  const hull = convexHull(p);
  const polyArea = area(p);
  const hullArea = area(hull);
  if (!polyArea || !hullArea) return "unknown";
  let boxArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cs = Math.cos(angle);
    const sn = Math.sin(angle);
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let j = 0; j < hull.length; j++) {
      const x = hull[j][0] * cs + hull[j][1] * sn;
      const y = -hull[j][0] * sn + hull[j][1] * cs;
      xmin = Math.min(xmin, x);
      xmax = Math.max(xmax, x);
      ymin = Math.min(ymin, y);
      ymax = Math.max(ymax, y);
    }
    boxArea = Math.min(boxArea, (xmax - xmin) * (ymax - ymin));
  }
  const sign = signedArea(p) > 0 ? 1 : -1;
  let sharp = 0;
  let concave = 0;
  let negativeTurn = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[(i + p.length - 1) % p.length];
    const b = p[i];
    const c = p[(i + 1) % p.length];
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const turn = Math.atan2(sign * (ux * vy - uy * vx), ux * vx + uy * vy);
    if (turn < 0) negativeTurn -= turn;
    if (turn > Math.PI * 0.3) sharp++;
    if (turn < -Math.PI * 0.17) concave++;
  }
  if (sharp >= 5 && negativeTurn > Math.PI * 1.5 && polyArea / hullArea < 0.91) return "shout";
  if ((sharp >= 4 && polyArea / boxArea > 0.93 && polyArea / hullArea > 0.965) ||
      isWarpedCaption(points, polyArea, hullArea, boxArea, dim)) return "narration";
  // A long capsule fills its box but has no square corners: still speech
  if (sharp <= 2 && concave <= 3 && polyArea / hullArea > 0.84 && polyArea / boxArea > 0.57) return "regular";
  return "unknown";
};

// Fill classification of sampled colours: white (>= 240), black (<= 15)
const isWhite = (rgb) => rgb.red >= 240 && rgb.green >= 240 && rgb.blue >= 240;
const isBlack = (rgb) => rgb.red <= 15 && rgb.green <= 15 && rgb.blue <= 15;

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const medianRgb = (colors) => ({
  red: median(colors.map((c) => c.red)),
  green: median(colors.map((c) => c.green)),
  blue: median(colors.map((c) => c.blue)),
});

// Soft (fading) edges: a fine outline much longer than its coarse version
const softEdgeMeasure = (polygon, bounds) => {
  const dim = Math.min(bounds.width, bounds.height);
  const perimeter = (points) => {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
    }
    return sum;
  };
  const fine = simplify(polygon, Math.max(0.4, dim * 0.003));
  const coarse = simplify(polygon, Math.max(2, dim * 0.04));
  const coarsePerimeter = perimeter(coarse);
  return {
    fine: fine.length,
    coarse: coarse.length,
    ratio: perimeter(fine) / Math.max(1, coarsePerimeter),
    coarseHull: coarsePerimeter / Math.max(1, perimeter(convexHull(coarse))),
  };
};

// Eight probes just outside the outline: a dark, monochrome ring is a drawn
// border, not a fading edge
const closedInkRing = (sample, page, plan) => {
  const poly = plan.cleanPolygon;
  const b = plan.bounds;
  const points = [];
  const fractions = [0.25, 0.5, 0.75];
  const offset = Math.max(3, Math.min(b.width, b.height) * 0.014);
  for (let row = 0; row < 3; row++) {
    const y = b.top + b.height * fractions[row];
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const z = poly[(i + 1) % poly.length];
      if ((a[1] <= y && z[1] > y) || (z[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) * (z[0] - a[0])) / (z[1] - a[1]));
    }
    if (xs.length < 2) return false;
    xs.sort((p, q) => p - q);
    points.push([xs[0] - offset, y], [xs[xs.length - 1] + offset, y]);
  }
  const x = b.left + b.width * 0.5;
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const z = poly[(i + 1) % poly.length];
    if ((a[0] <= x && z[0] > x) || (z[0] <= x && a[0] > x)) ys.push(a[1] + ((x - a[0]) * (z[1] - a[1])) / (z[0] - a[0]));
  }
  if (ys.length < 2) return false;
  ys.sort((p, q) => p - q);
  points.push([x, ys[0] - offset], [x, ys[ys.length - 1] + offset]);
  let strong = 0;
  let evidence = 0;
  for (let i = 0; i < points.length; i++) {
    const q = points[i];
    if (q[0] < 0 || q[1] < 0 || q[0] >= page.width || q[1] >= page.height) return false;
    const color = sample(q);
    const lo = Math.min(color.red, color.green, color.blue);
    const hi = Math.max(color.red, color.green, color.blue);
    if (hi - lo > 15) return false;
    if (plan.fill >= 128) {
      if (hi > 160) return false;
      if (hi <= 64) strong++;
      evidence += hi;
    } else {
      if (lo < 95) return false;
      if (lo >= 191) strong++;
      evidence += 255 - lo;
    }
  }
  return strong >= 4 && evidence / points.length <= 72;
};

const softEdgeHasToneOutside = (sample, page, plan) => {
  const poly = simplify(plan.cleanPolygon, Math.max(0.4, Math.min(plan.bounds.width, plan.bounds.height) * 0.003));
  const stride = Math.max(1, Math.floor(poly.length / 40));
  const offset = Math.max(5, Math.min(plan.bounds.width, plan.bounds.height) * 0.06);
  let count = 0;
  let textured = 0;
  for (let i = 0; i < poly.length; i += stride) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.2) continue;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let x = mx - (dy / length) * offset;
    let y = my + (dx / length) * offset;
    if (contains(poly, { x, y })) {
      x = mx + (dy / length) * offset;
      y = my - (dx / length) * offset;
    }
    if (x < 2 || y < 2 || x >= page.width - 2 || y >= page.height - 2 || contains(poly, { x, y })) continue;
    let level = 0;
    for (let yy = -1; yy <= 1; yy += 2) {
      for (let xx = -1; xx <= 1; xx += 2) {
        const c = sample([Math.floor(x + xx), Math.floor(y + yy)]);
        level += (c.red + c.green + c.blue) / 12;
      }
    }
    count++;
    if (level > 24 && level < 231) textured++;
  }
  return count >= 16 && textured >= Math.max(6, count * 0.2);
};

const softEdgeCoreIsPlain = (sample, plan, inset) => {
  const b = plan.bounds;
  const step = Math.max(2, Math.min(b.width, b.height) / 45);
  const vertices = simplify(plan.cleanPolygon, Math.max(0.4, Math.min(b.width, b.height) * 0.003));
  const guard = inset + 2;
  let total = 0;
  let plain = 0;
  let gray = 0;
  let colored = 0;
  const deep = (x, y) => {
    if (!contains(vertices, { x, y })) return false;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const c = vertices[(i + 1) % vertices.length];
      let dx = c[0] - a[0];
      let dy = c[1] - a[1];
      const d = dx * dx + dy * dy;
      const t = d ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / d)) : 0;
      dx = x - a[0] - t * dx;
      dy = y - a[1] - t * dy;
      if (dx * dx + dy * dy < guard * guard) return false;
    }
    return true;
  };
  for (let y = b.top + guard; y < b.bottom - guard; y += step) {
    for (let x = b.left + guard; x < b.right - guard; x += step) {
      if (!deep(x, y)) continue;
      const c = sample([Math.floor(x), Math.floor(y)]);
      const lo = Math.min(c.red, c.green, c.blue);
      const hi = Math.max(c.red, c.green, c.blue);
      total++;
      if (hi - lo > 15) colored++;
      if (plan.fill >= 128 ? lo >= 240 : hi <= 15) plain++;
      else if (lo > 15 && hi < 240) gray++;
    }
  }
  return total >= 24 && plain / total >= 0.78 && gray / total <= 0.12 && colored / total <= 0.01;
};

// Cleanup validator. p = { page: {width, height}, click, bounds (selection),
// polygon (chamber outline), contour, subpaths (all work path subpaths, for
// lettering holes), cleanEnabled, fill: {fill, rgb} | null, sample (optional) }.
// Returns { skip: reason } or { cleanPolygon, fill, fillRGB, bounds,
// layoutBounds, centerOnly?, cleanupInset? }. A reason starting with
// "Auto Clean" refuses only the cleanup; the text can still be placed.
export const planCleanup = (p) => {
  const polygon = p.polygon;
  const polyArea = area(polygon);
  if (!contains(polygon, p.click)) return { skip: "Select the empty interior of a closed bubble." };
  const b = box(polygon);
  const pageW = p.page.width;
  const pageH = p.page.height;
  if (!p.cleanEnabled) {
    if (b.width >= pageW * 0.98 && b.height >= pageH * 0.98) {
      return { skip: "The selection leaked across the page." };
    }
    const bodyOnly = bodyBounds(polygon, b);
    if (!isFinite(bodyOnly.width) || !isFinite(bodyOnly.height) || bodyOnly.width < 4 || bodyOnly.height < 4) {
      return { skip: "Could not reconstruct a usable bubble interior." };
    }
    const tone = p.fill && p.fill.fill === 0 ? 0 : 255;
    return {
      cleanPolygon: polygon,
      fill: tone,
      fillRGB: (p.fill && p.fill.rgb) || { red: tone, green: tone, blue: tone },
      bounds: b,
      layoutBounds: bodyOnly,
    };
  }
  const edgeCount = (b.left < 2 ? 1 : 0) + (b.top < 2 ? 1 : 0) + (b.right > pageW - 2 ? 1 : 0) + (b.bottom > pageH - 2 ? 1 : 0);
  // The canvas may close a clipped bubble on one side or two adjacent sides
  const oppositeEdges = (b.left < 2 && b.right > pageW - 2) || (b.top < 2 && b.bottom > pageH - 2);
  const safeClipped = edgeCount <= 2 && !oppositeEdges && polyArea < pageW * pageH * 0.7 && polyArea / (b.width * b.height) > 0.6;
  if ((edgeCount && !safeClipped) || b.width < 24 || b.height < 24 || polyArea > pageW * pageH * 0.98) {
    return { skip: "Auto Clean skipped an open, page-spanning, or oversized selection." };
  }
  if (Math.abs(b.left - p.bounds.left) > 4 || Math.abs(b.top - p.bounds.top) > 4 ||
      Math.abs(b.right - p.bounds.right) > 4 || Math.abs(b.bottom - p.bounds.bottom) > 4) {
    return { skip: "Auto Clean needs one complete bubble selection." };
  }
  // Lettering holes: closed subpaths strictly inside the outline
  const holes = [];
  let holeArea = 0;
  const subpaths = p.subpaths || [];
  for (let i = 0; i < subpaths.length; i++) {
    const sub = subpaths[i];
    if (!sub.closed || sub.contour.length < 3) continue;
    const points = flatten(sub.contour);
    const partArea = area(points);
    if (partArea >= polyArea * 0.98) continue;
    const hole = box(points);
    if (hole.left >= b.left + 2 && hole.top >= b.top + 2 && hole.right <= b.right - 2 && hole.bottom <= b.bottom - 2 &&
        contains(polygon, { x: points[0][0], y: points[0][1] })) {
      if (partArea > polyArea * 0.18) return { skip: "Auto Clean skipped a large interior shape." };
      holes.push(points);
      holeArea += partArea;
    }
  }
  if (holeArea > polyArea * 0.4) return { skip: "Auto Clean could not separate lettering from artwork." };
  let fill;
  let fillRGB;
  if (p.fill) {
    fillRGB = p.fill.rgb;
    fill = Math.round((fillRGB.red + fillRGB.green + fillRGB.blue) / 3);
  } else if (p.sample) {
    const clearPoint = (point) => {
      const q = { x: point[0], y: point[1] };
      if (!contains(polygon, q)) return false;
      for (let k = 0; k < holes.length; k++) if (contains(holes[k], q)) return false;
      return true;
    };
    const samples = [[Math.floor(p.click.x), Math.floor(p.click.y)]];
    const fractions = [0.2, 0.8, 0.5, 0.35, 0.65];
    for (let y = 0; y < fractions.length && samples.length < 12; y++) {
      for (let x = 0; x < fractions.length && samples.length < 12; x++) {
        const point = [Math.floor(b.left + b.width * fractions[x]), Math.floor(b.top + b.height * fractions[y])];
        if (clearPoint(point)) samples.push(point);
      }
    }
    if (samples.length < 8) return { skip: "Auto Clean needs more clear background around the text." };
    const white = [];
    const black = [];
    try {
      for (let i = 0; i < samples.length; i++) {
        const rgb = p.sample(samples[i]);
        if (isWhite(rgb)) white.push(rgb);
        else if (isBlack(rgb)) black.push(rgb);
      }
    } catch (unavailable) {
      return { skip: "Auto Clean could not read this bubble background." };
    }
    const majority = Math.ceil(samples.length * 0.55);
    let colors;
    if (white.length >= 5 && white.length >= majority && white.length >= black.length * 2 + 1) colors = white;
    else if (black.length >= 5 && black.length >= majority && black.length >= white.length * 2 + 1) colors = black;
    else return { skip: "Auto Clean supports solid white or black interiors only." };
    fillRGB = medianRgb(colors);
    fill = Math.round((fillRGB.red + fillRGB.green + fillRGB.blue) / 3);
  } else {
    return { skip: "Auto Clean could not read this bubble background." };
  }
  const body = bodyBounds(polygon, b);
  if (polygon.length < 3 || body.width < 24 || body.height < 24) {
    return { skip: "Auto Clean could not reconstruct the usable bubble interior." };
  }
  const plan = { cleanPolygon: polygon, fill, fillRGB, bounds: b, layoutBounds: body };
  // Fading edges: only paint the plain centre (needs pixels)
  if (p.sample) {
    const edge = softEdgeMeasure(polygon, b);
    if (edge.fine < 50 || edge.fine < edge.coarse * 4 || edge.ratio < 1.11 || edge.coarseHull > 1.14) return plan;
    // A crisp scalloped outline crosses the broad threshold but stays well
    // below a genuinely soft edge
    if (edge.ratio < 1.2) return plan;
    if (closedInkRing(p.sample, p.page, plan)) return plan;
    if (!softEdgeHasToneOutside(p.sample, p.page, plan)) return plan;
    const inset = Math.max(10, Math.ceil(Math.min(b.width, b.height) * 0.18));
    if (!softEdgeCoreIsPlain(p.sample, plan, inset)) {
      return { skip: "Auto Clean skipped a fading bubble with texture in its centre." };
    }
    plan.centerOnly = true;
    plan.cleanupInset = inset;
  }
  return plan;
};

export const fillTone = { isWhite, isBlack, medianRgb };
