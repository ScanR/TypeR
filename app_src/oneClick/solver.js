// Line layout solver for the smart paste: a beam search over the line-break
// graph that fits measured text lines inside the bubble polygon, scored by
// size, silhouette (width profile), centring and margin comfort. Ported from
// MD TYPER's legacy-solver.js (frozen CEP solver), with the author's permission.
// Pure ES5: it runs in the CEP panel and in the UXP host.

/* eslint-disable no-var, prefer-const */
var _jointProfiles = {};
function _autoCleanBox(poly) {
  var l = Infinity,
    t = Infinity,
    r = -Infinity,
    b = -Infinity;
  for (var i = 0; i < poly.length; i++) {
    l = Math.min(l, poly[i][0]);
    t = Math.min(t, poly[i][1]);
    r = Math.max(r, poly[i][0]);
    b = Math.max(b, poly[i][1]);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}
function _jointIntersect(a, b) {
  var out = [],
    i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    var l = Math.max(a[i][0], b[j][0]),
      r = Math.min(a[i][1], b[j][1]);
    if (r > l) out.push([l, r]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}
function _jointScanIndex278(poly) {
  if (_jointProfiles._scanPoly === poly && _jointProfiles._scanIndex278)
    return _jointProfiles._scanIndex278;
  var b = _autoCleanBox(poly),
    step = Math.max(1, b.height / 128),
    count = Math.ceil(b.height / step) + 1,
    buckets = [],
    ys = [],
    i;
  for (i = 0; i < count; i++) buckets.push([]);
  for (i = 0; i < poly.length; i++) {
    var a = poly[i],
      z = poly[(i + 1) % poly.length];
    ys.push(a[1]);
    if (a[1] === z[1]) continue;
    var lo = Math.max(0, Math.floor((Math.min(a[1], z[1]) - b.top) / step)),
      hi = Math.min(count - 1, Math.floor((Math.max(a[1], z[1]) - b.top) / step));
    for (var k = lo; k <= hi; k++) buckets[k].push(i);
  }
  ys.sort(function (a, z) {
    return a - z;
  });
  var unique = [];
  for (i = 0; i < ys.length; i++) if (!i || ys[i] !== ys[i - 1]) unique.push(ys[i]);
  _jointProfiles._scanPoly = poly;
  _jointProfiles._scans = {};
  return (_jointProfiles._scanIndex278 = {
    top: b.top,
    step: step,
    buckets: buckets,
    ys: unique,
  });
}
function _jointScan(poly, y) {
  var index = _jointScanIndex278(poly),
    key = String(y),
    cached = _jointProfiles._scans[key];
  if (cached) return cached;
  var bucket = index.buckets[Math.floor((y - index.top) / index.step)] || [],
    xs = [],
    out = [];
  for (var j = 0; j < bucket.length; j++) {
    var i = bucket[j],
      a = poly[i],
      b = poly[(i + 1) % poly.length];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
      xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  }
  xs.sort(function (a, b) {
    return a - b;
  });
  for (j = 0; j + 1 < xs.length; j += 2) out.push([xs[j], xs[j + 1]]);
  _jointProfiles._scans[key] = out;
  return out;
}
// Exact intersections at the same vertex +/- epsilon samples as 2.7.78.
// A range tree reuses those intersections across glyph bands; no geometry,
// padding, search order, scoring, or containment tolerance is changed.
function _jointInset279(row, pad) {
  var inner = [];
  for (var j = 0; j < row.length; j++)
    if (row[j][1] - row[j][0] > 2 * pad) inner.push([row[j][0] + pad, row[j][1] - pad]);
  return inner;
}
function _jointVertexTree279(poly, index, pad) {
  if (index.tree279) return index.tree279;
  var ys = index.ys,
    n = 1;
  while (n < ys.length) n *= 2;
  var tree = [],
    i;
  for (i = 0; i < n; i++)
    tree[n + i] =
      i < ys.length
        ? _jointIntersect(_jointScan(poly, ys[i] - 0.00001), _jointScan(poly, ys[i] + 0.00001))
        : null;
  for (i = n - 1; i > 0; i--) {
    var a = tree[i * 2],
      b = tree[i * 2 + 1];
    if (a === null) tree[i] = b;
    else if (b === null) tree[i] = a;
    else tree[i] = _jointIntersect(a, b);
  }
  return (index.tree279 = { n: n, tree: tree });
}
function _jointLargeBand284(poly) {
  var c = _jointProfiles._largeBand284;
  if (!c || c.poly !== poly) {
    var b = _autoCleanBox(poly);
    c = _jointProfiles._largeBand284 = {
      poly: poly,
      box: b,
      yes: poly.length >= 200 && b.height >= 300,
    };
  }
  return c;
}
function _jointLazyBand284(poly, top, bottom, pad) {
  top -= pad;
  bottom += pad;
  var index = _jointScanIndex278(poly),
    ys = index.ys,
    lo = 0,
    hi = ys.length;
  var out = _jointIntersect(_jointScan(poly, top), _jointScan(poly, bottom));
  if (!out.length) return out;
  while (lo < hi) {
    var mid = Math.floor((lo + hi) / 2);
    if (ys[mid] <= top) lo = mid + 1;
    else hi = mid;
  }
  var first = lo;
  hi = ys.length;
  while (lo < hi) {
    mid = Math.floor((lo + hi) / 2);
    if (ys[mid] < bottom) lo = mid + 1;
    else hi = mid;
  }
  var rows = index.lazyRows284 || (index.lazyRows284 = {});
  for (var i = first; i < lo && out.length; i++) {
    var row = rows[i];
    if (!row) {
      row = _jointIntersect(_jointScan(poly, ys[i] - 0.00001), _jointScan(poly, ys[i] + 0.00001));
      rows[i] = row;
    }
    if (out.length === 1 && row.length === 1) {
      var left = Math.max(out[0][0], row[0][0]),
        right = Math.min(out[0][1], row[0][1]);
      if (right > left) {
        out[0][0] = left;
        out[0][1] = right;
      } else out = [];
    } else out = _jointIntersect(out, row);
  }
  return _jointInset279(out, pad);
}
function _jointBand(poly, top, bottom, pad) {
  if (_jointLargeBand284(poly).yes) return _jointLazyBand284(poly, top, bottom, pad);
  top -= pad;
  bottom += pad;
  var index = _jointScanIndex278(poly),
    vertices = index.ys,
    lo = 0,
    hi = vertices.length;
  var out = _jointIntersect(_jointScan(poly, top), _jointScan(poly, bottom));
  if (!out.length) return out;
  while (lo < hi) {
    var mid = Math.floor((lo + hi) / 2);
    if (vertices[mid] <= top) lo = mid + 1;
    else hi = mid;
  }
  var first = lo;
  hi = vertices.length;
  while (lo < hi) {
    mid = Math.floor((lo + hi) / 2);
    if (vertices[mid] < bottom) lo = mid + 1;
    else hi = mid;
  }
  if (first === lo) return _jointInset279(out, pad);
  var range = _jointVertexTree279(poly, index, pad),
    l = first + range.n,
    r = lo - 1 + range.n;
  while (l <= r && out.length) {
    if (l % 2) {
      out = _jointIntersect(out, range.tree[l]);
      l++;
    }
    if (!(r % 2)) {
      out = _jointIntersect(out, range.tree[r]);
      r--;
    }
    l = Math.floor(l / 2);
    r = Math.floor(r / 2);
  }
  // Horizontal erosion distributes over intersection. Apply padding once to
  // the final intervals; all vertical vertex samples above are unchanged.
  return _jointInset279(out, pad);
}

function _jointFitsBand(poly, m, size, baseline, axis, pad) {
  var large284 = _jointLargeBand284(poly);
  if (large284.yes) {
    var p284 = _jointProfiles._lazy284;
    if (!p284 || p284.poly !== poly) {
      var count284 = Math.ceil(large284.box.height) + 2,
        n284 = 1;
      while (n284 < count284) n284 *= 2;
      p284 = _jointProfiles._lazy284 = { poly: poly, top: large284.box.top, n: n284, ranges: {} };
    }
    var lo284 = Math.floor(baseline + m.top * size - p284.top),
      hi284 = Math.floor(baseline + m.bottom * size - p284.top);
    if (lo284 < 0 || hi284 >= p284.n) return false;
    var key284 = String(pad) + ":" + lo284 + ":" + hi284,
      runs284 = p284.ranges[key284];
    if (!runs284) {
      runs284 = _jointLazyBand284(poly, p284.top + lo284, p284.top + hi284 + 1, pad);
      p284.ranges[key284] = runs284;
    }
    var left284 = axis + m.left * size,
      right284 = axis + m.right * size;
    for (var ri284 = 0; ri284 < runs284.length; ri284++)
      if (left284 >= runs284[ri284][0] && right284 <= runs284[ri284][1]) return true;
    return false;
  }
  var key = String(axis),
    p = _jointProfiles[key];
  if (!p) {
    var b = _autoCleanBox(poly),
      step = 1,
      count = Math.ceil(b.height / step) + 2,
      n = 1;
    while (n < count) n *= 2;
    var left = [],
      right = [];
    for (var i = 0; i < n * 2; i++) {
      left.push(Infinity);
      right.push(-Infinity);
    }
    var bands = _jointProfiles._bands;
    if (!bands) {
      bands = [];
      for (i = 0; i < count; i++)
        bands.push(_jointBand(poly, b.top + i * step, b.top + (i + 1) * step, pad));
      _jointProfiles._bands = bands;
    }
    for (i = 0; i < count; i++) {
      var runs = bands[i];
      for (var j = 0; j < runs.length; j++)
        if (runs[j][0] <= axis && runs[j][1] >= axis) {
          left[n + i] = runs[j][0];
          right[n + i] = runs[j][1];
          break;
        }
    }
    for (i = n - 1; i > 0; i--) {
      left[i] = Math.max(left[i * 2], left[i * 2 + 1]);
      right[i] = Math.min(right[i * 2], right[i * 2 + 1]);
    }
    p = { top: b.top, n: n, left: left, right: right };
    _jointProfiles[key] = p;
  }
  var l = Math.floor(baseline + m.top * size - p.top),
    r = Math.floor(baseline + m.bottom * size - p.top);
  if (l < 0 || r >= p.n) return false;
  var cache279 = p.ranges279 || (p.ranges279 = {}),
    key279 = l + ":" + r,
    range279 = cache279[key279];
  if (range279)
    return axis + m.left * size >= range279[0] && axis + m.right * size <= range279[1];
  l += p.n;
  r += p.n;
  var low = -Infinity,
    high = Infinity;
  while (l <= r) {
    if (l % 2) {
      low = Math.max(low, p.left[l]);
      high = Math.min(high, p.right[l]);
      l++;
    }
    if (!(r % 2)) {
      low = Math.max(low, p.left[r]);
      high = Math.min(high, p.right[r]);
      r--;
    }
    l = Math.floor(l / 2);
    r = Math.floor(r / 2);
  }
  if ((p.rangeCount279 || 0) >= 4096) {
    p.ranges279 = {};
    p.rangeCount279 = 0;
    cache279 = p.ranges279;
  }
  cache279[key279] = [low, high];
  p.rangeCount279 = (p.rangeCount279 || 0) + 1;
  return axis + m.left * size >= low && axis + m.right * size <= high;
}
// Width profiles are preferences, not a replacement for native containment.
var _jointProfiles276 = {
  circle: [
    [55, 100, 55],
    [55, 85, 100, 65],
    [60, 85, 100, 85, 60],
    [40, 65, 90, 100, 70, 45],
    [35, 55, 75, 100, 80, 60, 40],
  ],
  oval: [
    [65, 100, 65],
    [65, 90, 100, 75],
    [65, 85, 100, 85, 65],
    [50, 70, 90, 100, 75, 55],
    [45, 60, 80, 100, 85, 65, 45],
  ],
  tall: [
    [50, 100, 50],
    [50, 80, 100, 65],
    [55, 80, 100, 80, 55],
    [35, 60, 85, 100, 70, 45],
    [30, 50, 70, 100, 75, 55, 35],
  ],
  wide: [
    [75, 100, 75],
    [75, 95, 100, 85],
    [70, 90, 100, 90, 70],
    [65, 80, 95, 100, 85, 70],
    [60, 75, 90, 100, 90, 75, 60],
  ],
  rectangle: [
    [80, 100, 80],
    [80, 95, 100, 90],
    [75, 90, 100, 90, 75],
    [70, 85, 95, 100, 90, 75],
    [70, 80, 90, 100, 90, 80, 70],
  ],
  shout: [
    [55, 100, 55],
    [55, 85, 100, 70],
    [60, 85, 100, 85, 60],
    [40, 65, 90, 100, 70, 45],
    [35, 55, 75, 100, 80, 60, 40],
  ],
};
function _jointProfile276(opts, selection, rows) {
  if (rows === 1) return [100];
  if (rows === 2) return [100, 100];
  var ratio = selection.width / Math.max(1, selection.height),
    kind;
  if (opts.kind === "narration") kind = ratio >= 0.85 && ratio <= 1.18 ? "wide" : "rectangle";
  else if (opts.kind === "shout") kind = "shout";
  else if (ratio < 0.82) kind = "tall";
  else if (ratio <= 1.18) kind = "circle";
  else if (ratio <= 1.65) kind = "oval";
  else kind = "wide";
  var table = _jointProfiles276[kind];
  if (rows <= 7) return table[rows - 3];
  var base = table[4],
    out = [],
    peak = Math.floor(rows / 2);
  for (var i = 0; i < rows; i++) {
    var at = i <= peak ? (i * 3) / peak : 3 + ((i - peak) * 3) / (rows - 1 - peak),
      lo = Math.floor(at),
      hi = Math.min(6, lo + 1);
    out.push(base[lo] + (base[hi] - base[lo]) * (at - lo));
  }
  return out;
}
function _jointShapeValid276(lines, detachedTerminal) {
  var n = lines.length;
  if (n === 1) return true;
  // Score two-line balance softly when words cannot be split.
  if (n === 2) return true;
  var a = Math.floor((n - 1) / 2),
    b = Math.ceil((n - 1) / 2),
    middle = 0,
    peak = 0;
  for (var i = 0; i < n; i++) {
    var m = lines[i].edge.metric,
      w = m.right - m.left;
    peak = Math.max(peak, w);
    if (i >= a && i <= b) middle = Math.max(middle, w);
  }
  if (peak > middle + 0.000001) return false;
  // A central peak alone can accept a thin stack suddenly flaring into one
  // very wide line. Require a gradual shoulder and a substantial inner body.
  for (var q280 = 0; q280 < n; q280++) {
    var qm280 = lines[q280].edge.metric,
      qw280 = qm280.right - qm280.left;
    if (n >= 4 && q280 > 0 && q280 < n - 1 && qw280 < peak * 0.45) return false;
    if (n >= 4 && q280 > 1 && q280 < n - 1) {
      var pm280 = lines[q280 - 1].edge.metric;
      if (Math.abs(qw280 - (pm280.right - pm280.left)) > peak * 0.48) return false;
    }
  }
  // Small word-width deviations are allowed; conspicuous reversals are not.
  var tolerance = peak * 0.15;
  for (i = 1; i < n; i++) {
    var before = lines[i - 1].edge.metric,
      after = lines[i].edge.metric,
      delta = after.right - after.left - (before.right - before.left);
    if (i <= a && delta < -tolerance) return false;
    if (i > b && delta > tolerance) return false;
  }
  return true;
}
function _jointShapeAcc276(state, width, row, profile) {
  var target = profile[row] / 100,
    a = (state.shapeA || 0) + width * target,
    b = (state.shapeB || 0) + target * target,
    c = (state.shapeC || 0) + width * width;
  var turns = state.shapeTurns || 0,
    n = profile.length;
  if (row && n >= 3) {
    var previous = state.lastWidth,
      scale = Math.max(0.1, previous, width),
      delta = (width - previous) / scale,
      peak = Math.floor(n / 2);
    if (
      (row <= Math.floor((n - 1) / 2) && delta < 0) ||
      (row > Math.ceil((n - 1) / 2) && delta > 0)
    )
      turns += 2 * delta * delta;
    if (row > 1) {
      var valley =
        Math.max(0, Math.min(state.priorWidth, width) - previous) /
        Math.max(0.1, state.priorWidth, width);
      turns += 2 * valley * valley;
    }
  }
  // Least-squares profile fit removes absolute size from the shape decision.
  var loss = Math.max(0, c - (a * a) / Math.max(0.000001, b)) / Math.max(0.000001, c) + turns;
  return {
    shapeA: a,
    shapeB: b,
    shapeC: c,
    shapeTurns: turns,
    lastWidth: width,
    priorWidth: state.lastWidth || 0,
    loss: loss,
  };
}
function _jointShapeAccScratch276(state, width, row, profile, out) {
  var target = profile[row] / 100,
    a = (state.shapeA || 0) + width * target,
    b = (state.shapeB || 0) + target * target,
    c = (state.shapeC || 0) + width * width;
  var turns = state.shapeTurns || 0,
    n = profile.length;
  if (row && n >= 3) {
    var previous = state.lastWidth,
      scale = Math.max(0.1, previous, width),
      delta = (width - previous) / scale,
      peak = Math.floor(n / 2);
    if (
      (row <= Math.floor((n - 1) / 2) && delta < 0) ||
      (row > Math.ceil((n - 1) / 2) && delta > 0)
    )
      turns += 2 * delta * delta;
    if (row > 1) {
      var valley =
        Math.max(0, Math.min(state.priorWidth, width) - previous) /
        Math.max(0.1, state.priorWidth, width);
      turns += 2 * valley * valley;
    }
  }
  // Least-squares profile fit removes absolute size from the shape decision.
  var loss = Math.max(0, c - (a * a) / Math.max(0.000001, b)) / Math.max(0.000001, c) + turns;
  out.shapeA = a;
  out.shapeB = b;
  out.shapeC = c;
  out.shapeTurns = turns;
  out.lastWidth = width;
  out.priorWidth = state.lastWidth || 0;
  out.loss = loss;
  return out;
}
// 2.7.80: shape validity wins, but small ratio differences must not buy tiny text.
function _jointShapeUpper276(size, variant) {
  return -1000 + 100 * Math.log(Math.max(1, size)) - (variant.insertion ? 6 : 0);
}
function _jointShapeScore276(loss, size, variant, displacement, matched, comfort) {
  // A tolerance band treats naturally balanced word widths as equivalent.
  // Among valid silhouettes the total ratio preference is bounded: by itself
  // it cannot justify reducing size by more than exp(.18), approximately 20%.
  // Containment, readability, central peak and reversal checks remain separate.
  var ratioPenalty = Math.min(18, 300 * Math.max(0, loss - 0.02));
  return (
    _jointShapeUpper276(size, variant) -
    ratioPenalty -
    displacement * 20 -
    (comfort || 0) -
    (matched === false ? 1000000 : 0)
  );
}

function _jointShapeScoreCachedUpper276(loss, shapeUpper, displacement, matched, comfort) {
  // A tolerance band treats naturally balanced word widths as equivalent.
  // Among valid silhouettes the total ratio preference is bounded: by itself
  // it cannot justify reducing size by more than exp(.18), approximately 20%.
  // Containment, readability, central peak and reversal checks remain separate.
  var ratioPenalty = Math.min(18, 300 * Math.max(0, loss - 0.02));
  return (
    shapeUpper -
    ratioPenalty -
    displacement * 20 -
    (comfort || 0) -
    (matched === false ? 1000000 : 0)
  );
}

function _jointPointSegment297(x, y, a) {
  var dx = a.x2 - a.x1,
    dy = a.y2 - a.y1,
    t = ((x - a.x1) * dx + (y - a.y1) * dy) / Math.max(0.000000001, dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  dx = x - (a.x1 + t * dx);
  dy = y - (a.y1 + t * dy);
  return dx * dx + dy * dy;
}
function _jointInkClearance297(lines, size, axis, poly, selection) {
  // Score measured glyph bounds against the actual chamber boundary.
  if (!lines || !lines.length || !poly || poly.length < 3) return 0.24;
  var cache = _jointProfiles._inkSegments297,
    sw = Math.max(1, selection.width),
    sh = Math.max(1, selection.height);
  if (!cache || cache.poly !== poly || cache.sw !== sw || cache.sh !== sh) {
    var seg = [];
    for (var pi = 0; pi < poly.length; pi++) {
      var a = poly[pi],
        b = poly[(pi + 1) % poly.length],
        x1 = a[0] / sw,
        y1 = a[1] / sh,
        x2 = b[0] / sw,
        y2 = b[1] / sh;
      seg.push({
        x1: x1,
        y1: y1,
        x2: x2,
        y2: y2,
        left: Math.min(x1, x2),
        right: Math.max(x1, x2),
        top: Math.min(y1, y2),
        bottom: Math.max(y1, y2),
      });
    }
    cache = _jointProfiles._inkSegments297 = { poly: poly, sw: sw, sh: sh, segments: seg };
  }
  var best = 0.24 * 0.24;
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li],
      m = line.edge.metric,
      left = (axis + m.left * size) / sw,
      right = (axis + m.right * size) / sw,
      top = (line.baseline + m.top * size) / sh,
      bottom = (line.baseline + m.bottom * size) / sh;
    for (var si = 0; si < cache.segments.length; si++) {
      var s = cache.segments[si],
        bx = Math.max(0, left - s.right, s.left - right),
        by = Math.max(0, top - s.bottom, s.top - bottom);
      if (bx * bx + by * by >= best) continue;
      var dx = Math.max(left - s.x1, 0, s.x1 - right),
        dy = Math.max(top - s.y1, 0, s.y1 - bottom);
      best = Math.min(best, dx * dx + dy * dy);
      dx = Math.max(left - s.x2, 0, s.x2 - right);
      dy = Math.max(top - s.y2, 0, s.y2 - bottom);
      best = Math.min(best, dx * dx + dy * dy);
      best = Math.min(
        best,
        _jointPointSegment297(left, top, s),
        _jointPointSegment297(right, top, s),
        _jointPointSegment297(left, bottom, s),
        _jointPointSegment297(right, bottom, s),
      );
      if (best < 0.00000001) return 0;
    }
  }
  return Math.sqrt(best);
}
function _jointComfort293(top, bottom, peak, size, selection, opts, lines, axis, poly) {
  var clearance = _jointInkClearance297(lines, size, axis, poly, selection),
    target = opts.profileWords >= 16 ? 0.09 : opts.profileWords >= 9 ? 0.105 : 0.145;
  if (Math.min(selection.width, selection.height) < 95) target = Math.min(target, 0.105);
  else if (Math.min(selection.width, selection.height) < 150) target = Math.min(target, 0.125);
  var shortage = Math.max(0, target - clearance),
    marginPenalty = Math.min(42, (45 * shortage * shortage) / 0.01);
  var width = (peak * size) / Math.max(1, selection.width),
    height = (bottom - top) / Math.max(1, selection.height);
  var overWidth = Math.max(0, (width - 0.75) / 0.2),
    overHeight = Math.max(0, (height - 0.7) / 0.2);
  return marginPenalty + Math.min(22, 20 * overWidth * overWidth + 12 * overHeight * overHeight);
}

// Width ratios alone cannot distinguish a flat caption from a bubble-shaped
// block. A broad aspect band prefers using the body's height without forcing
// short labels to stack. This is a scoring term in the existing search only.
function _jointBlock277(top, bottom, peak, size, selection, opts, lines, axis, poly) {
  var comfort = _jointComfort293(top, bottom, peak, size, selection, opts, lines, axis, poly);
  if (!(opts.profileWords > 2)) return { loss: 0, matched: true, comfort: comfort };
  var body = selection.height / Math.max(1, selection.width),
    aspect = (bottom - top) / Math.max(0.01, peak * size),
    low = body * 0.5,
    high = body * 1.25;
  var delta = 0;
  if (aspect < low) delta = Math.log(low / Math.max(0.001, aspect));
  else if (aspect > high) delta = Math.log(aspect / high);
  return {
    loss: 0.15 * delta * delta,
    matched: aspect >= low * 0.9 && aspect <= high * 1.1,
    comfort: comfort,
  };
}
function _jointEllipsis277(candidate) {
  var lines = candidate.lines,
    n = lines.length,
    last = lines[n - 1].edge;
  if (n >= 2 && last.flags & 1)
    return { lines: lines.slice(0, n - 1), penalty: 0, detached: true };
  return { lines: lines, penalty: 0, detached: false };
}

function _jointRescore276(candidate, selection, opts, poly) {
  var ellipsis = _jointEllipsis277(candidate),
    shapeLines = ellipsis.lines,
    profile = _jointProfile276(opts, selection, shapeLines.length),
    state = {},
    peak = 0;
  candidate.ellipsisDetached = ellipsis.detached;
  for (var i = 0; i < shapeLines.length; i++) {
    var m = shapeLines[i].edge.metric;
    state = _jointShapeAcc276(state, m.right - m.left, i, profile);
    peak = Math.max(peak, m.right - m.left);
  }
  var displacement =
    Math.abs((candidate.top + candidate.bottom) / 2 - selection.yMid) / selection.height +
    Math.abs(candidate.axis - selection.xMid) / selection.width;
  var block = _jointBlock277(
      candidate.top,
      candidate.bottom,
      peak,
      candidate.size,
      selection,
      opts,
      candidate.lines,
      candidate.axis,
      poly,
    ),
    shapeValid = _jointShapeValid276(shapeLines, ellipsis.detached);
  candidate.blockMatched = block.matched;
  candidate.comfortPenalty = block.comfort;
  candidate.penalty =
    candidate.size -
    _jointShapeScore276(
      state.loss + block.loss,
      candidate.size,
      candidate.variant,
      displacement,
      shapeValid && block.matched,
      block.comfort,
    ) +
    ellipsis.penalty;
  candidate.silhouetteMatched = shapeValid;
  candidate.silhouetteProfile = profile;
  return candidate;
}

function _jointRank(candidate) {
  return candidate.size - candidate.penalty;
}
function _jointFitsExactBand(poly, m, size, baseline, axis, pad) {
  var runs = _jointBand(poly, baseline + m.top * size, baseline + m.bottom * size, pad),
    left = axis + m.left * size,
    right = axis + m.right * size;
  for (var i = 0; i < runs.length; i++)
    if (left >= runs[i][0] && right <= runs[i][1]) return true;
  return false;
}
function _jointChooseHyphen(plain, candidates) {
  var baseline = plain ? plain.size : 0,
    best = plain;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (plain && c.variant && c.variant.insertion && c.variant.insertion.fallbackOnly) continue;
    if (!best || _jointRank(c) > _jointRank(best)) best = c;
  }
  return best;
}
function _jointCenterLines(lines, top, bottom, center, poly, size, axis, pad, exact) {
  // The first baseline is only a search seed. Once all actual glyph bands
  // are known, center their combined ink before comparing layouts. Keep the
  // original feasible placement if neither bounded adjustment fits.
  var delta = center - (top + bottom) / 2;
  if (Math.abs(delta) < 0.000001) return { lines: lines, top: top, bottom: bottom };
  for (var attempt = 0; attempt < 2; attempt++) {
    var shift = delta * (attempt === 0 ? 1 : 0.5),
      valid = true;
    for (var i = 0; i < lines.length; i++)
      if (
        !(exact ? _jointFitsExactBand : _jointFitsBand)(
          poly,
          lines[i].edge.metric,
          size,
          lines[i].baseline + shift,
          axis,
          pad,
        )
      ) {
        valid = false;
        break;
      }
    if (valid) {
      var moved = [];
      for (i = 0; i < lines.length; i++)
        moved.push({ edge: lines[i].edge, baseline: lines[i].baseline + shift });
      return { lines: moved, top: top + shift, bottom: bottom + shift };
    }
  }
  return { lines: lines, top: top, bottom: bottom };
}
// The five block centres miss a fit whose vertical window is narrower than
// their 5% step. A retry scans the same +-10% band in steps of a tenth of the
// text size (one pixel at least), nearest the middle first.
function _jointFineCentres(size, selection) {
  var height = Math.max(1, selection.height),
    step = Math.max(1, size * 0.1) / height,
    out = [0];
  for (var k = 1; k * step <= 0.1 + 0.000001; k++) out.push(-k * step, k * step);
  return out;
}
// Beam search keeps multiple break histories at each source position. Leading
// and glyph bands belong to each native measured line, not to a generic oval.
function _jointSearch(variant, poly, selection, opts) {
  // Band and profile caches belong to one polygon and padding: start fresh
  // when a search runs on another chamber (they were reset only by solve())
  if (_jointProfiles._searchPoly !== poly || _jointProfiles._searchPad !== opts.pad) {
    _jointProfiles = { _searchPoly: poly, _searchPad: opts.pad };
  }
  var edges = variant.edges,
    byNode = [],
    i;
  for (i = 0; i < variant.nodes; i++) byNode.push([]);
  for (i = 0; i < edges.length; i++) byNode[edges[i].from].push(edges[i]);
  var hasEllipsis277 = false;
  for (i = 0; i < edges.length; i++)
    if (edges[i].flags & 1 && edges[i].to === variant.nodes - 1) hasEllipsis277 = true;
  var cx = selection.xMid,
    cy = selection.yMid,
    positions = [0, -0.05, 0.05, -0.1, 0.1],
    best = null,
    operations = 0,
    profiles281 = {},
    shapeScratch276 = {};
  var upper = opts.max;
  for (i = 0; i < edges.length; i++)
    if (edges[i].to === edges[i].from + 1)
      upper = Math.min(
        upper,
        (selection.width - 2 * opts.pad) / (edges[i].metric.right - edges[i].metric.left),
      );
  if (upper < opts.min - 0.001) return null;
  // Establish a readable placement before spending the refinement budget.
  // Testing the exact minimum also avoids gaps between descending size steps.
  var maxWidth279 = _autoCleanBox(poly).width - 2 * opts.pad;
  var preferred280 = Math.max(opts.min, upper * 0.82),
    sizes = [preferred280];
  if (preferred280 > opts.min + 0.001) sizes.push(opts.min);
  for (var sz = upper; sz > opts.min + 0.001; sz -= opts.step)
    if (Math.abs(sz - preferred280) > 0.001) sizes.push(sz);
  for (var zi = 0; zi < sizes.length; zi++) {
    var size = sizes[zi],
      shapeUpper276 = undefined;
    // No placement at this size can beat the verified incumbent.
    if (best) {
      shapeUpper276 = _jointShapeUpper276(size, variant);
      if (shapeUpper276 <= _jointRank(best)) continue;
    }
    // Necessary width-only reachability bounds prune impossible row counts.
    // They never accept a placement; full glyph-band checks still decide it.
    var minLines = [],
      maxWidth = maxWidth279,
      futureWidth = maxWidth / size,
      shapeWidthTolerance279 = futureWidth * 0.15,
      beamWidthDenominator279 = Math.max(1, maxWidth);
    for (i = 0; i < variant.nodes; i++) minLines[i] = Infinity;
    minLines[variant.nodes - 1] = 0;
    for (i = variant.nodes - 2; i >= 0; i--)
      for (var ei = 0; ei < byNode[i].length; ei++) {
        var re = byNode[i][ei];
        if ((re.metric.right - re.metric.left) * size <= maxWidth)
          minLines[i] = Math.min(minLines[i], 1 + minLines[re.to]);
      }
    for (var px = 0; px < positions.length; px++) {
      var axis = cx + positions[px] * selection.width;
      // Horizontal displacement and the split penalty cannot disappear
      // during optical centering. Skip only a provably inferior axis.
      if (best && _jointRank(best) >= shapeUpper276) continue;
      var centres = opts.fineCentres ? _jointFineCentres(size, selection) : positions;
      for (var py = 0; py < centres.length; py++) {
        var center = cy + centres[py] * selection.height;
        // Try plausible line counts, hence first-baseline positions.
        for (
          var rows = Math.max(1, minLines[0]);
          rows <=
          Math.min(16, variant.nodes - 1, Math.ceil(selection.height / (size * opts.leading)));
          rows++
        ) {
          var profile =
            profiles281[rows] || (profiles281[rows] = _jointProfile276(opts, selection, rows));
          var centerLower279 = Math.floor((rows - 1) / 2),
            centerUpper279 = Math.ceil((rows - 1) / 2);
          var first = center - ((rows - 1) * opts.leading * size) / 2 + opts.ascent * size * 0.42,
            states = [
              {
                node: 0,
                baseline: first,
                lineTail: null,
                penalty: 0,
                peakWidth: 0,
                middleWidth: 0,
                top: Infinity,
                bottom: -Infinity,
              },
            ];
          for (var row = 0; row < rows && states.length; row++) {
            var next = [];
            for (var st = 0; st < states.length; st++) {
              var state = states[st],
                choices = byNode[state.node];
              for (var j = 0; j < choices.length; j++) {
                if (
                  ++operations % 1024 === 0 &&
                  opts.deadline &&
                  new Date().getTime() > opts.deadline
                ) {
                  opts.exhausted = true;
                  return best;
                }
                var e = choices[j],
                  last = e.to === variant.nodes - 1;
                if (last !== (row === rows - 1)) continue;
                if (variant.nodes - 1 - e.to < rows - row - 1) continue;
                if (minLines[e.to] > rows - row - 1) continue;
                var m = e.metric,
                  w = m.right - m.left,
                  shapePeak = Math.max(state.peakWidth || 0, w),
                  shapeMiddle = state.middleWidth || 0,
                  shapeImpossible = !!state.shapeImpossible;
                if (row >= centerLower279 && row <= centerUpper279)
                  shapeMiddle = Math.max(shapeMiddle, w);
                if (rows >= 3 && row >= centerUpper279 && shapePeak > shapeMiddle + 0.000001)
                  shapeImpossible = true;
                if (rows >= 3 && row > 0) {
                  if (row <= centerLower279 && w < state.lastWidth - shapeWidthTolerance279)
                    shapeImpossible = true;
                  if (row > centerUpper279 && w > state.lastWidth + shapeMiddle * 0.15)
                    shapeImpossible = true;
                }
                if (w * size > maxWidth) continue;
                var shape = _jointShapeAccScratch276(state, w, row, profile, shapeScratch276),
                  lossBound =
                    Math.max(0, shape.shapeC - (shape.shapeA * shape.shapeA) / shape.shapeB) /
                      Math.max(
                        0.000001,
                        shape.shapeC + (rows - row - 1) * futureWidth * futureWidth,
                      ) +
                    shape.shapeTurns;
                if (
                  !hasEllipsis277 &&
                  best &&
                  _jointShapeScoreCachedUpper276(lossBound, shapeUpper276, 0, !shapeImpossible) <=
                    _jointRank(best)
                )
                  continue;
                if (!_jointFitsBand(poly, m, size, state.baseline, axis, opts.pad)) continue;
                var top = Math.min(state.top, state.baseline + m.top * size),
                  bottom = Math.max(state.bottom, state.baseline + m.bottom * size);
                var line = { edge: e, baseline: state.baseline },
                  lines = null,
                  penalty = shape.loss + (!hasEllipsis277 && shapeImpossible ? 1000 : 0);
                // Shape, not singleton-word grammar, determines prefix ranking.
                if (e.flags & 4 && !(hasEllipsis277 && last && e.flags & 1)) continue;
                if (last) {
                  lines = new Array(row + 1);
                  lines[row] = line;
                  var tail = state.lineTail;
                  for (var prefix = row - 1; prefix >= 0; prefix--) {
                    lines[prefix] = tail.line;
                    tail = tail.previous;
                  }
                  var centered = _jointCenterLines(
                    lines,
                    top,
                    bottom,
                    center,
                    poly,
                    size,
                    axis,
                    opts.pad,
                  );
                  lines = centered.lines;
                  top = centered.top;
                  bottom = centered.bottom;
                  var displacement =
                      Math.abs((top + bottom) / 2 - cy) / selection.height +
                      Math.abs(axis - cx) / selection.width,
                    peak = 0,
                    middle = 0,
                    widths = [];
                  for (var li = 0; li < lines.length; li++) {
                    var lm = lines[li].edge.metric,
                      lw = lm.right - lm.left;
                    widths.push(lw);
                    peak = Math.max(peak, lw);
                    if (li > 0 && li < lines.length - 1) middle = Math.max(middle, lw);
                  }
                  var block = _jointBlock277(
                    top,
                    bottom,
                    peak,
                    size,
                    selection,
                    opts,
                    lines,
                    axis,
                    poly,
                  );
                  if (shapeUpper276 === undefined)
                    shapeUpper276 = _jointShapeUpper276(size, variant);
                  penalty =
                    size -
                    _jointShapeScoreCachedUpper276(
                      shape.loss + block.loss,
                      shapeUpper276,
                      displacement,
                      _jointShapeValid276(lines) && block.matched,
                      block.comfort,
                    );
                  var c = {
                    size: size,
                    axis: axis,
                    lines: lines,
                    top: top,
                    bottom: bottom,
                    penalty: penalty,
                    variant: variant,
                  };
                  if (hasEllipsis277) _jointRescore276(c, selection, opts, poly);
                  if (!best || _jointRank(c) > _jointRank(best)) best = c;
                } else
                  next.push({
                    node: e.to,
                    baseline: state.baseline + e.leading * size,
                    lineTail: { line: line, previous: state.lineTail },
                    penalty: penalty,
                    peakWidth: shapePeak,
                    middleWidth: shapeMiddle,
                    shapeImpossible: shapeImpossible,
                    shapeA: shape.shapeA,
                    shapeB: shape.shapeB,
                    shapeC: shape.shapeC,
                    shapeTurns: shape.shapeTurns,
                    lastWidth: w,
                    priorWidth: state.lastWidth || 0,
                    top: top,
                    bottom: bottom,
                  });
              }
            }
            var unique = {},
              reduced = [];
            for (var q = 0; q < next.length; q++) {
              var nk =
                next[q].node +
                ":" +
                Math.round(next[q].baseline * 10) +
                ":" +
                Math.round(((next[q].lastWidth * size) / beamWidthDenominator279) * 8);
              if (!unique[nk] || next[q].penalty < unique[nk].penalty) unique[nk] = next[q];
            }
            for (var nk in unique) if (unique.hasOwnProperty(nk)) reduced.push(unique[nk]);
            reduced.sort(function (a, b) {
              return a.penalty - b.penalty;
            });
            states = reduced.slice(0, 18);
          }
        }
      }
    }
    // An ideal profile is the upper bound; only prune a provably inferior size.
    if (
      best &&
      zi > 1 &&
      (zi + 1 === sizes.length || _jointShapeUpper276(sizes[zi + 1], variant) <= _jointRank(best))
    )
      break;
  }
  return best;
}

function solve(batch) {
  var began = Date.now(),
    plans = [];
  for (var n = 0; n < batch.models.length; n++) {
    var m = batch.models[n],
      opts = Object.assign({}, m.opts);
    _jointProfiles = {};
    opts.deadline = Date.now() + 2500;
    var plain = _jointSearch(m.variants[0], m.poly, m.selection, opts),
      plainExhausted = !!opts.exhausted,
      alternatives = [];
    // Keep the immutable readable minimum; silhouette has priority over size.
    if (opts.max >= opts.min)
      for (var i = 1; i < m.variants.length; i++) {
        var variant = m.variants[i];
        if (plain && variant.insertion && variant.insertion.fallbackOnly) continue;
        // This score is an absolute upper bound. The native search
        // already uses it; apply the same exact pruning in the panel.
        if (plain && _jointShapeUpper276(opts.max, variant) <= _jointRank(plain)) continue;
        opts.deadline = Date.now() + 750;
        var c = _jointSearch(variant, m.poly, m.selection, opts);
        if (c) alternatives.push(c);
      }
    alternatives.sort(function (a, b) {
      return _jointRank(b) - _jointRank(a);
    });
    function pack(c) {
      if (!c) return null;
      return {
        variant: m.variants.indexOf(c.variant),
        size: c.size,
        axis: c.axis,
        penalty: c.penalty,
        lines: c.lines.map(function (l) {
          var metric = l.edge.metric,
            top = l.baseline + metric.top * c.size,
            bottom = l.baseline + metric.bottom * c.size;
          // This wider exact band proves containment whenever the native
          // glyph band falls inside it. Otherwise Photoshop checks the
          // original polygon at the native glyph bounds.
          var proofPad = opts.pad + 0.001,
            runs = _jointBand(m.poly, top - 2, bottom + 2, proofPad),
            safe = null;
          for (var ri = 0; ri < runs.length; ri++)
            if (
              c.axis + metric.left * c.size >= runs[ri][0] &&
              c.axis + metric.right * c.size <= runs[ri][1]
            ) {
              safe = {
                top: top - 2,
                bottom: bottom + 2,
                left: runs[ri][0],
                right: runs[ri][1],
                pad: proofPad,
              };
              break;
            }
          return { edge: c.variant.edges.indexOf(l.edge), baseline: l.baseline, safe: safe };
        }),
      };
    }
    plans.push({
      plain: pack(plain),
      plainExhausted: plainExhausted,
      alternatives: alternatives.slice(0, 4).map(pack),
    });
  }
  return { id: batch.id, plans: plans, searchMs: Date.now() - began };
}
export const solverInternals = {
  search: _jointSearch,
  rank: _jointRank,
  rescore: _jointRescore276,
  fitsExactBand: _jointFitsExactBand,
  centerLines: _jointCenterLines,
  band: _jointBand,
};
export { solve };
