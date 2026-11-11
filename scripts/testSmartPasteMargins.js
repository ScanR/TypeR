// Smart paste margins and sizes (app_src/oneClick/layout.js): the user's
// padding gives way one step at a time, the base margin last before the text
// overflows; a style's stroke counts as ink; a shrunk size is rounded down to
// a step of the style's unit; a size preset scales every run and the leading.
// Synthetic bubbles and a simulated Photoshop measurement, as in
// testSmartPasteEngine.js.
const assert = require("assert");
const load = require("./helpers/loadAppModule")();

const geometry = load("app_src/oneClick/geometry.js");
const { prepareSmartPaste, resolveStyleSizeForPage } = load("app_src/oneClick/smartPaste.js");
const { marginSteps, strokeWidth, roundedSize } = load("app_src/oneClick/layout.js");
const { clearMetricCache } = load("app_src/oneClick/measureSpec.js");

const px = (value) => ({ _unit: "pixelsUnit", _value: value });
const point = (xy) => ({ horizontal: px(xy[0]), vertical: px(xy[1]) });
const pathOf = (contours) => ({
  pathContents: {
    pathComponents: [{
      subpathListKey: contours.map((nodes) => ({
        closedSubpath: true,
        points: nodes.map((n) => ({ anchor: point(n[0]), forward: point(n[1]), backward: point(n[2]) })),
      })),
    }],
  },
});
const ellipseNodes = (cx, cy, rx, ry) => {
  const k = 0.5522847498;
  return [
    [[cx + rx, cy], [cx + rx, cy + ry * k], [cx + rx, cy - ry * k]],
    [[cx, cy + ry], [cx - rx * k, cy + ry], [cx + rx * k, cy + ry]],
    [[cx - rx, cy], [cx - rx, cy - ry * k], [cx - rx, cy + ry * k]],
    [[cx, cy - ry], [cx + rx * k, cy - ry], [cx - rx * k, cy - ry]],
  ];
};
// Union outline of two overlapping circles (a double bubble)
const peanut = (a, b, r) => {
  const pts = [];
  const inside = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < r * r - 1e-6;
  for (const [c, other] of [[a, b], [b, a]]) {
    for (let i = 0; i < 180; i++) {
      const t = (i / 180) * Math.PI * 2;
      const p = [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
      if (!inside(p, other)) pts.push(p);
    }
  }
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  return pts;
};
const boundsOf = (poly) => {
  const b = geometry.box(poly);
  return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) };
};

// Simulated native measurement: letters 0.55 em, spaces 0.3 em. The style's
// unit decides the pixel size, as in Photoshop.
const CHAR = (ch) => (ch === " " ? 0.3 : /[.,;:!'’]/.test(ch) ? 0.25 : /[A-Z]/.test(ch) ? 0.68 : 0.55);
const unitPx = (params, page) => (params.typeUnit === "pixelsUnit" ? 1 : params.typeUnit === "millimetersUnit" ? page.resolution / 25.4 : page.resolution / 72);
const makeMeasure = (page) => async (requests) => requests.map((request) => {
  const lt = request.params.layerText;
  const first = lt.textStyleRange[0].textStyle;
  const sizePx = first.size * unitPx(request.params, page);
  const rows = lt.textKey.split("\r").filter((row, index, all) => index < all.length - 1);
  const box = (row) => {
    const w = row.split("").reduce((sum, ch) => sum + CHAR(ch), 0) * sizePx;
    return { left: page.width / 2 - w / 2, right: page.width / 2 + w / 2, top: page.height / 2 - 0.72 * sizePx, bottom: page.height / 2 + 0.06 * sizePx };
  };
  if (request.kind !== "atlas") return { bounds: box(rows[0]) };
  return { metrics: rows.map((row) => {
    const b = box(row);
    return { left: (b.left - page.width / 2 - 1) / 64, right: (b.right - page.width / 2 + 1) / 64, top: (b.top - page.height / 2 - 1) / 64, bottom: (b.bottom - page.height / 2 + 1) / 64 };
  }) };
});

const style = (size, stroke = null, unit = "pixelsUnit", extra = {}) => ({
  id: "s",
  textProps: {
    layerText: {
      textGridding: "none",
      orientation: "horizontal",
      antiAlias: "antiAliasSmooth",
      textStyleRange: [{ from: 0, to: 100, textStyle: { fontPostScriptName: "AnimeAce", fontName: "AnimeAce", fontStyleName: "Regular", size, autoLeading: true, color: { red: 0, green: 0, blue: 0 }, ...extra } }],
      paragraphStyleRange: [{ from: 0, to: 100, paragraphStyle: { alignment: "center", autoLeadingPercentage: 1.2 } }],
    },
    typeUnit: unit,
  },
  stroke,
});
const strokeOf = (size) => ({ enabled: true, size, color: { r: 255, g: 255, b: 255 } });

const PAGE = { width: 1200, height: 1700, resolution: 72 };
const white = { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
const black = { fill: 0, rgb: { red: 0, green: 0, blue: 0 } };
const bubble = (rx, ry, fill = white) => {
  const nodes = ellipseNodes(300, 300, rx, ry);
  const poly = geometry.flatten(nodes);
  return { poly, input: { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(poly), rawPath: pathOf([nodes]), fill } };
};
const paste = (input, lines, settings, page = PAGE) => {
  clearMetricCache();
  return prepareSmartPaste({
    trigger: { source: "wand" },
    lines: lines.map(([text, s]) => ({ text, richTextRuns: null, style: s, styleLocked: false })),
    roleStyles: {},
    settings,
  }, { capture: async () => ({ ...page, documentId: 7, ...input }), measure: makeMeasure(page), useAtlas: true });
};

// The simulated ink of each composed line, and its smallest distance to the
// outline (negative outside)
const segmentDistance = (p, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
};
const gapToOutline = (session, poly, page = PAGE) => {
  const lt = session.text.params.layerText;
  const size = session.text.size;
  const axis = (lt.textClickPoint.horizontal / 100) * page.width;
  let baseline = (lt.textClickPoint.vertical / 100) * page.height;
  let gap = Infinity;
  for (const row of lt.textKey.split("\r")) {
    const w = row.split("").reduce((sum, ch) => sum + CHAR(ch), 0) * size;
    const corners = [];
    for (let i = 0; i <= 20; i++) {
      const x = axis - w / 2 + (w * i) / 20;
      corners.push([x, baseline - 0.72 * size], [x, baseline + 0.06 * size]);
    }
    for (const p of corners) {
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) d = Math.min(d, segmentDistance(p, poly[i], poly[(i + 1) % poly.length]));
      gap = Math.min(gap, geometry.contains(poly, { x: p[0], y: p[1] }) ? d : -d);
    }
    baseline += size * 1.2;
  }
  return gap;
};
// The margin a session was laid out with, without the 0.75 px hairline nor the stroke
const borderOf = (session, stroke = 0) => session.text.pad - 0.75 - stroke;
const isStep = (value, step) => Math.abs(value / step - Math.round(value / step)) < 1e-6;

const LONG = "Je ne pensais vraiment pas te revoir ici, après tout ce temps.";

(async () => {
  // The ladder of margins: two thirds and one third of the padding, the base
  // margin (3.5% of the bubble), half of it, none. Steps that free less than
  // half a pixel are skipped.
  const plan = { selection: { width: 200, height: 150 } };
  const borders = (padding) => marginSteps(plan, { text: "x", padding }).map((step) => (step.noMargin ? 0 : Math.max(5.25 * (step.marginScale || 1), step.padding)));
  assert.deepStrictEqual(borders(30), [30, 20, 10, 5.25, 2.625, 0]);
  assert.deepStrictEqual(borders(10), [10, 6.666666666666667, 5.25, 2.625, 0]);
  assert.deepStrictEqual(borders(0), [5.25, 2.625, 0], "no padding: the base margin first");
  assert.deepStrictEqual(borders(5), [5.25, 2.625, 0], "a padding under the base margin changes nothing");
  assert.strictEqual(marginSteps(plan, { text: "x", padding: 30 })[0].padding, 30, "the user's padding first, untouched");

  // A long line in a small bubble, minimum size 75%: the padding used to give
  // way at once (24 px against the outline's base margin, the text larger
  // than with a smaller padding); the text now shrinks first, then keeps a
  // third of the padding
  const small = bubble(130, 95);
  const shrunk = (await paste(small.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 0.75, padding: 30 })).sessions[0];
  assert.ok(borderOf(shrunk) >= 20 - 1e-6, "two thirds of the padding at least: " + borderOf(shrunk));
  assert.ok(shrunk.text.size < 24 && shrunk.text.size >= 18, "shrunk within the range: " + shrunk.text.size);
  assert.ok(gapToOutline(shrunk, small.poly) >= 20, "the ink keeps the margin: " + gapToOutline(shrunk, small.poly));
  // A larger padding never ends closer to the outline than a smaller one
  let previous = -Infinity;
  for (const padding of [0, 10, 20, 30, 40]) {
    const session = (await paste(small.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 0.75, padding })).sessions[0];
    assert.ok(borderOf(session) >= previous - 1e-6, `padding ${padding}: margin ${borderOf(session)} after ${previous}`);
    previous = borderOf(session);
  }
  // A text that fits with its padding is laid out as before: the style size
  const fits = (await paste(small.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 0.75, padding: 10 })).sessions[0];
  assert.strictEqual(fits.text.tier, "exact");
  assert.ok(Math.abs(borderOf(fits) - 10) < 1e-6);

  // Keep the style's size (minimum 100%): nothing to shrink, so the padding
  // goes down by steps and the base margin holds as long as it can
  const kept = (await paste(small.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 1, padding: 30 })).sessions[0];
  assert.strictEqual(kept.text.size, 24);
  assert.ok(Math.abs(borderOf(kept) - 10) < 1e-6, "a third of the padding, not the base margin: " + borderOf(kept));
  const tighter = bubble(120, 88);
  const half = (await paste(tighter.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 1, padding: 30 })).sessions[0];
  assert.strictEqual(half.text.size, 24);
  assert.ok(borderOf(half) > 2, "half the base margin before none: " + borderOf(half));
  // Too small even for that: no margin at all, the last step before overflowing
  const tight = bubble(112, 82);
  const none = (await paste(tight.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 1, padding: 30 })).sessions[0];
  assert.ok(Math.abs(borderOf(none)) < 1e-6);
  assert.ok(gapToOutline(none, tight.poly) > 0, "still inside the bubble");

  // A chamber of a double bubble shrinks before its padding gives way: it
  // used to keep the style size at the base margin, whatever the padding
  const outline = peanut([300, 300], [444, 300], 90);
  const double = { source: "wand", click: { x: 255, y: 300 }, selectionBounds: boundsOf(outline), rawPath: pathOf([outline.map((p) => [p, p, p])]), fill: white };
  const pair = await paste(double, [["Tu crois vraiment que je vais te laisser partir ?", style(24)], ["Oui.", style(24)]], { distribute: true, hyphenation: "off", minScale: 0.75, padding: 10 });
  assert.strictEqual(pair.consumed, 2);
  const chamber = pair.sessions[0];
  assert.ok(Math.abs(borderOf(chamber) - 10) < 1e-6, "the padding kept in the chamber: " + borderOf(chamber));
  assert.ok(chamber.text.size >= 18 - 1e-6 && chamber.text.size < 24, "shrunk instead: " + chamber.text.size);
  assert.ok(gapToOutline(chamber, outline) >= 10, "off the outline: " + gapToOutline(chamber, outline));
  assert.strictEqual(pair.sessions[1].text.size, 24, "a short line keeps the style size and its padding");
  assert.ok(Math.abs(borderOf(pair.sessions[1]) - 10) < 1e-6);

  // The stroke is ink: drawn outside the glyphs, it must keep the margin too
  assert.strictEqual(strokeWidth(null), 0);
  assert.strictEqual(strokeWidth({ enabled: false, size: 5 }), 0, "a stroke switched off");
  assert.strictEqual(strokeWidth({ size: 0 }), 0);
  assert.strictEqual(strokeWidth({ enabled: true, size: 0 }), 3, "the hosts draw 3 px then");
  assert.strictEqual(strokeWidth({ size: 4 }), 4, "older styles have no enabled flag");
  const bare = (await paste(small.input, [[LONG, style(24)]], { hyphenation: "off", minScale: 0.75, padding: 10 })).sessions[0];
  const stroked = (await paste(small.input, [[LONG, style(24, strokeOf(6))]], { hyphenation: "off", minScale: 0.75, padding: 10 })).sessions[0];
  assert.ok(Math.abs(stroked.text.pad - bare.text.pad - 6) < 1e-6, "the stroke widens the room kept: " + stroked.text.pad);
  assert.ok(stroked.text.size < bare.text.size, "so the stroked text is smaller here: " + stroked.text.size);
  assert.ok(gapToOutline(stroked, small.poly) >= 10 + 6, "the stroke's outer edge keeps the padding: " + gapToOutline(stroked, small.poly));
  // White text in a black bubble has no stroke: nothing to keep room for
  const dark = bubble(130, 95, black);
  const white0 = (await paste(dark.input, [[LONG, style(24, strokeOf(6))]], { hyphenation: "off", minScale: 0.75, padding: 10 })).sessions[0];
  assert.strictEqual(white0.text.stroke, null);
  assert.ok(Math.abs(white0.text.pad - bare.text.pad) < 1e-6);

  // A shrunk size is rounded down to half a unit of the style, and the text
  // still fits there; the leading follows the rounded size
  const leaded = style(24, null, "pixelsUnit", { autoLeading: false, leading: 30 });
  const sizes = [];
  for (const [rx, ry] of [[118, 86], [110, 80], [104, 76]]) {
    const b = bubble(rx, ry);
    const session = (await paste(b.input, [[LONG, leaded]], { hyphenation: "off", minScale: 0.7, padding: 10 })).sessions[0];
    assert.strictEqual(session.text.tier, "range");
    assert.ok(isStep(session.text.size, 0.5), "half a pixel: " + session.text.size);
    assert.ok(gapToOutline(session, b.poly) >= 10, "the rounded size still fits: " + gapToOutline(session, b.poly));
    const written = session.text.params.layerText.textStyleRange[0].textStyle;
    assert.ok(Math.abs(written.size - session.text.size) < 1e-9);
    assert.ok(Math.abs(written.leading / written.size - 30 / 24) < 1e-9, "the leading keeps its ratio");
    sizes.push(session.text.size);
  }
  assert.ok(sizes[0] > sizes[2], "smaller bubbles, smaller sizes: " + sizes);
  // In points on a 300 ppi page, half a point; in millimetres, a tenth
  const page300 = { ...PAGE, resolution: 300 };
  const big = bubble(118 * 300 / 72, 86 * 300 / 72);
  const pt = (await paste(big.input, [[LONG, style(24, null, "pointsUnit")]], { hyphenation: "off", minScale: 0.7, padding: 10 }, page300)).sessions[0];
  assert.strictEqual(pt.text.tier, "range");
  assert.ok(isStep(pt.text.params.layerText.textStyleRange[0].textStyle.size, 0.5), "half a point: " + pt.text.params.layerText.textStyleRange[0].textStyle.size);
  assert.ok(isStep(pt.text.size * 72 / 300, 0.5), "the same size in pixels: " + pt.text.size);
  assert.ok(gapToOutline(pt, big.poly, page300) >= 10);
  const mm = (await paste(big.input, [[LONG, style(8.5, null, "millimetersUnit")]], { hyphenation: "off", minScale: 0.7, padding: 10 }, page300)).sessions[0];
  assert.strictEqual(mm.text.tier, "range");
  assert.ok(isStep(mm.text.params.layerText.textStyleRange[0].textStyle.size, 0.1), "a tenth of a millimetre: " + mm.text.params.layerText.textStyleRange[0].textStyle.size);
  // The rounding itself, in the style's unit
  assert.strictEqual(roundedSize(23.76, { dpi: 72, data: { style: { textProps: { typeUnit: "pixelsUnit" } } } }), 23.5);
  assert.strictEqual(roundedSize(24, { dpi: 72, data: { style: { textProps: { typeUnit: "pixelsUnit" } } } }), 24, "a round size stays");
  assert.ok(Math.abs(roundedSize(23.9 * 300 / 72, { dpi: 300, data: { style: { textProps: { typeUnit: "pointsUnit" } } } }) - 23.5 * 300 / 72) < 1e-9);

  // Size presets by page width scale every run, with its leading
  const preset = style(20, null, "pointsUnit", { autoLeading: false, leading: 24, impliedLeading: 24, impliedFontSize: 20 });
  preset.textProps.layerText.textStyleRange.push({ from: 5, to: 9, textStyle: { size: 30, leading: 36, baselineShift: 2, fontPostScriptName: "Bold" } });
  Object.assign(preset, { autoSizeByPageWidth: true, sizePresets: [20, 26], sizePresetMinWidths: [0, 1000], sizePresetDefaultIndex: 0 });
  const wide = resolveStyleSizeForPage(JSON.parse(JSON.stringify(preset)), 1200).textProps.layerText.textStyleRange;
  const fields = (range) => ["size", "impliedFontSize", "leading", "impliedLeading", "baselineShift"].map((key) => (typeof range.textStyle[key] === "number" ? +range.textStyle[key].toFixed(6) : null));
  assert.deepStrictEqual(wide.map(fields), [[26, 26, 31.2, 31.2, null], [39, null, 46.8, null, 2.6]]);
  const narrow = resolveStyleSizeForPage(JSON.parse(JSON.stringify(preset)), 800).textProps.layerText.textStyleRange;
  assert.deepStrictEqual(narrow, preset.textProps.layerText.textStyleRange, "the default preset changes nothing");

  console.log("smart paste margin and size tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
