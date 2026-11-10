// Smart paste engine (app_src/oneClick): bubble plans, connected chambers,
// layout and orchestration on synthetic bubbles with a simulated Photoshop
// text measurement. No Photoshop involved.
const assert = require("assert");
const load = require("./helpers/loadAppModule")();

const geometry = load("app_src/oneClick/geometry.js");
const bubblePlan = load("app_src/oneClick/bubblePlan.js");
const connected = load("app_src/oneClick/connected.js");
const { prepareSmartPaste, styleForKind, resolveStyleSizeForPage } = load("app_src/oneClick/smartPaste.js");
const { applyRefont, normalizeRefontRules, refontTextStyle } = load("app_src/oneClick/refont.js");
const { classifySelectionEvent, parseCepEventData, triggerSourceForTool } = load("app_src/oneClick/selectionEvent.js");
const { createPasteHistory, lineAfterHistoryMove } = load("app_src/oneClick/pasteHistory.js");
const { breakPointsFor, resolveHyphenationLanguage } = load("app_src/oneClick/hyphenation.js");
const { metricFromBounds, atlasMetrics, clearMetricCache } = load("app_src/oneClick/measureSpec.js");

const px = (value) => ({ _unit: "pixelsUnit", _value: value });
const point = (xy) => ({ horizontal: px(xy[0]), vertical: px(xy[1]) });

// actionJSON work path from Bézier nodes [anchor, forward, backward]
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
const polygonNodes = (poly) => poly.map((p) => [p, p, p]);

// Ellipse with four Bézier nodes
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

const star = (cx, cy, outer, inner, spikes) => {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? inner : outer;
    const t = (i / (spikes * 2)) * Math.PI * 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
};

const boundsOf = (poly) => {
  const b = geometry.box(poly);
  return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) };
};

// Simulated native measurement: letters 0.55 em, spaces 0.3 em
const CHAR = (ch) => (ch === " " ? 0.3 : /[.,;:!'’]/.test(ch) ? 0.25 : /[A-Z]/.test(ch) ? 0.68 : 0.55);
const makeMeasure = (page) => async (requests) => requests.map((request) => {
  const lt = request.params.layerText;
  const sizePt = lt.textStyleRange[0].textStyle.size;
  const sizePx = (sizePt * page.resolution) / 72;
  const rows = lt.textKey.split("\r").filter((row, index, all) => index < all.length - 1);
  const rowMetric = (row, index) => {
    const w = row.split("").reduce((sum, ch) => sum + CHAR(ch), 0) * sizePx;
    const cx = page.width / 2;
    const cy = page.height / 2 + index * 256;
    return { left: cx - w / 2, right: cx + w / 2, top: cy - 0.72 * sizePx, bottom: cy + 0.06 * sizePx };
  };
  if (request.kind === "atlas") {
    return { metrics: rows.map((row, i) => {
      const b = rowMetric(row, i);
      return { left: (b.left - page.width / 2 - 1) / 64, right: (b.right - page.width / 2 + 1) / 64, top: (b.top - (page.height / 2 + i * 256) - 1) / 64, bottom: (b.bottom - (page.height / 2 + i * 256) + 1) / 64 };
    }) };
  }
  return { bounds: rowMetric(rows[0], 0) };
});

const style = (id, size, font = "AnimeAce") => ({
  id,
  textProps: {
    layerText: {
      textGridding: "none",
      orientation: "horizontal",
      antiAlias: "antiAliasSmooth",
      textStyleRange: [{ from: 0, to: 100, textStyle: { fontPostScriptName: font, fontName: font, fontStyleName: "Regular", size, autoLeading: true, color: { red: 0, green: 0, blue: 0 } } }],
      paragraphStyleRange: [{ from: 0, to: 100, paragraphStyle: { alignment: "center", autoLeadingPercentage: 1.2 } }],
    },
    typeUnit: "pixelsUnit",
  },
  stroke: { enabled: true, size: 3, color: { r: 255, g: 255, b: 255 } },
});

const page = { width: 1200, height: 1700, resolution: 72 };
const white = { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };
const black = { fill: 0, rgb: { red: 0, green: 0, blue: 0 } };

const adapterFor = (input) => ({
  capture: async () => ({ ...page, documentId: 7, ...input }),
  measure: makeMeasure(page),
  useAtlas: true,
});

// Every composed line sits inside the bubble polygon
const linesInside = (session) => {
  const lt = session.text.params.layerText;
  const lines = lt.textKey.split("\r");
  assert.ok(lines.length >= 1);
  const size = session.text.size;
  const axis = (lt.textClickPoint.horizontal / 100) * page.width;
  let baseline = (lt.textClickPoint.vertical / 100) * page.height;
  const poly = session.plan.cleanPolygon;
  for (const line of lines) {
    const w = line.split("").reduce((sum, ch) => sum + CHAR(ch), 0) * size;
    for (const x of [axis - w / 2, axis + w / 2]) {
      for (const y of [baseline - 0.72 * size, baseline + 0.06 * size]) {
        assert.ok(geometry.contains(poly, { x, y }), `"${line}" leaves the bubble at ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
    baseline += size * 1.2;
  }
};

(async () => {
  // Geometry basics
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.strictEqual(geometry.area(square), 10000);
  assert.ok(geometry.contains(square, { x: 50, y: 50 }));
  assert.ok(!geometry.contains(square, { x: 150, y: 50 }));
  assert.strictEqual(geometry.shapeKind(geometry.flatten(ellipseNodes(300, 300, 200, 150))), "regular");
  assert.strictEqual(geometry.shapeKind(star(300, 300, 220, 150, 14)), "shout");
  assert.strictEqual(geometry.shapeKind(square.map(([x, y]) => [x * 4, y * 3])), "narration");
  // A bubble cut by the panel frame (real outline, page 105-09): two square corners, the rest is round
  const frameCut = [[113, 374], [199, 372], [240, 376], [247, 407], [252, 457], [253, 544], [244, 576], [258, 589], [240, 584], [221, 627], [166, 645], [153, 647], [142, 643], [125, 632], [113, 620]];
  assert.notStrictEqual(geometry.shapeKind(frameCut), "narration");
  // A caption's sides may be barely bent, not visibly curved
  const bentCaption = (bend) => [[0, 0], [100, bend * 0.7], [200, bend], [300, bend * 0.7], [400, 0], [400 + bend * 0.5, 150], [400, 300], [300, 300 + bend * 0.7], [200, 300 + bend], [100, 300 + bend * 0.7], [0, 300], [-bend * 0.5, 150]];
  assert.strictEqual(geometry.shapeKind(bentCaption(6)), "narration");
  assert.notStrictEqual(geometry.shapeKind(bentCaption(30)), "narration");

  // Single oval bubble
  const oval = ellipseNodes(600, 500, 260, 190);
  const ovalInput = { source: "wand", click: { x: 600, y: 500 }, selectionBounds: boundsOf(geometry.flatten(oval)), rawPath: pathOf([oval]), fill: white };
  const ovalPlan = bubblePlan.buildPlan({ ...page, documentId: 7, ...ovalInput }, {});
  assert.strictEqual(ovalPlan.kind, "regular");
  assert.strictEqual(ovalPlan.connected, false);
  assert.strictEqual(ovalPlan.textColor, null, "a white bubble keeps the style colour");
  const line = (text, s = style("regular", 24)) => ({ text, richTextRuns: null, style: s, styleLocked: false });
  const single = await prepareSmartPaste({
    trigger: { source: "wand", x: 600, y: 500 },
    lines: [line("Je ne pensais vraiment pas te revoir ici, après tout ce temps passé loin de la ville.")],
    roleStyles: {},
    settings: { distribute: true, hyphenation: "fr", minScale: 0.7 },
  }, adapterFor(ovalInput));
  assert.strictEqual(single.consumed, 1);
  const lines = single.sessions[0].text.params.layerText.textKey.split("\r");
  assert.ok(lines.length >= 3, "a long line is broken over several lines: " + JSON.stringify(lines));
  assert.ok(single.sessions[0].text.size <= 24 + 1e-6, "the style size is a ceiling");
  assert.strictEqual(single.sessions[0].text.tier, "exact", "the style size fits this bubble");
  assert.strictEqual(single.sessions[0].text.params.layerText.paragraphStyleRange[0].paragraphStyle.alignment, "center");
  linesInside(single.sessions[0]);

  // A small bubble shrinks the text, never below 70%
  const small = ellipseNodes(300, 300, 95, 70);
  const smallInput = { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(geometry.flatten(small)), rawPath: pathOf([small]), fill: white };
  const shrunk = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Attends-moi devant la porte du magasin.")], roleStyles: {}, settings: { hyphenation: "off", minScale: 0.7 },
  }, adapterFor(smallInput));
  assert.ok(shrunk.sessions[0].text.size < 24 && shrunk.sessions[0].text.size >= 24 * 0.7 - 1e-6, "shrunk size " + shrunk.sessions[0].text.size);
  assert.strictEqual(shrunk.sessions[0].text.tier, "range");
  linesInside(shrunk.sessions[0]);

  // Too much text for a tiny bubble: it overflows the bubble at the smallest
  // size, on its centre, instead of leaving it to the classic paste
  const tiny = ellipseNodes(300, 300, 45, 35);
  const tinyInput = { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(geometry.flatten(tiny)), rawPath: pathOf([tiny]), fill: white };
  const overflowed = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Une phrase beaucoup trop longue pour une si petite bulle de rien du tout.")], roleStyles: {}, settings: { hyphenation: "off" },
  }, adapterFor(tinyInput));
  assert.strictEqual(overflowed.consumed, 1);
  assert.ok(Math.abs(overflowed.sessions[0].text.size - 24 * 0.75) < 1e-6, "the smallest size: " + overflowed.sessions[0].text.size);
  const overflowAxis = overflowed.sessions[0].text.axis;
  assert.ok(Math.abs(overflowAxis - 300) < 20, "centred on the bubble: " + overflowAxis);

  // Lean measurement (the Legacy panel): the same placements, without the
  // exhaustive measurement of every candidate line, and a text too long for
  // the smallest size is refused before the size ladder
  const counting = (input) => {
    // Words measured for the tests above are cached across pastes: a cold start
    clearMetricCache();
    const stats = { calls: 0, lines: 0 };
    const measure = makeMeasure(page);
    const adapter = {
      ...adapterFor(input),
      measure: async (requests) => {
        stats.calls++;
        requests.forEach((request) => { stats.lines += request.kind === "atlas" ? request.count : 1; });
        return measure(requests);
      },
    };
    return { stats, adapter };
  };
  const shrinkRequest = { trigger: { source: "wand" }, lines: [line("Attends-moi devant la porte du magasin.")], roleStyles: {}, settings: { hyphenation: "off", minScale: 0.7 } };
  const full = counting(smallInput);
  const fullShrink = await prepareSmartPaste(shrinkRequest, full.adapter);
  const lean = counting(smallInput);
  const leanShrink = await prepareSmartPaste(shrinkRequest, { ...lean.adapter, leanMeasure: true });
  assert.strictEqual(leanShrink.sessions[0].text.size, fullShrink.sessions[0].text.size, "the lean search finds the same size");
  assert.strictEqual(leanShrink.sessions[0].text.params.layerText.textKey, fullShrink.sessions[0].text.params.layerText.textKey, "and the same lines");
  assert.ok(lean.stats.lines < full.stats.lines, "with fewer lines measured: " + lean.stats.lines + " < " + full.stats.lines);
  linesInside(leanShrink.sessions[0]);
  const refused = counting(tinyInput);
  const leanOverflow = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Une phrase beaucoup trop longue pour une si petite bulle de rien du tout.")], roleStyles: {}, settings: { hyphenation: "off" },
  }, { ...refused.adapter, leanMeasure: true });
  assert.strictEqual(leanOverflow.sessions[0].text.params.layerText.textKey, overflowed.sessions[0].text.params.layerText.textKey, "the lean search overflows the same way");
  // Minimum size 100%: the style size or nothing, no ladder
  const noShrink = counting(smallInput);
  const kept100 = await prepareSmartPaste({ ...shrinkRequest, settings: { hyphenation: "off", minScale: 1 } }, { ...noShrink.adapter, leanMeasure: true });
  assert.ok(Math.abs(kept100.sessions[0].text.size - 24) < 1e-6, "no shrinking at 100%: " + kept100.sessions[0].text.size);

  // The style size fits only in a vertical window between the coarse block
  // centres: the fine retry finds it instead of shrinking the text
  const narrow = ellipseNodes(300, 300, 95, 70);
  const narrowInput = { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(geometry.flatten(narrow)), rawPath: pathOf([narrow]), fill: white };
  const kept22 = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Je ne pensais vraiment pas te revoir ici.", style("regular", 22))], roleStyles: {}, settings: { hyphenation: "off", minScale: 0.7 },
  }, adapterFor(narrowInput));
  assert.strictEqual(kept22.sessions[0].text.tier, "exact", "the style size fits this bubble");
  assert.ok(Math.abs(kept22.sessions[0].text.size - 22) < 1e-6, "kept size " + kept22.sessions[0].text.size);
  linesInside(kept22.sessions[0]);

  // Photoshop honours a style's unit: 22 px is 22 pixels on a 300 ppi page
  // too, where 22 pt is 91.67 pixels. The measurement below does the same,
  // for the sizes and for the row advance of an atlas.
  const page300 = { ...page, resolution: 300 };
  const unitMeasure = async (requests) => requests.map((request) => {
    const lt = request.params.layerText;
    const unitPx = request.params.typeUnit === "pixelsUnit" ? 1 : page300.resolution / 72;
    const first = lt.textStyleRange[0].textStyle;
    const sizePx = first.size * unitPx;
    const rows = lt.textKey.split("\r").filter((row, index, all) => index < all.length - 1);
    const box = (row, index) => {
      const w = row.split("").reduce((sum, ch) => sum + CHAR(ch), 0) * sizePx;
      const cy = page300.height / 2 + index * (request.kind === "atlas" ? first.leading * unitPx : 0);
      return { left: page300.width / 2 - w / 2, right: page300.width / 2 + w / 2, top: cy - 0.72 * sizePx, bottom: cy + 0.06 * sizePx };
    };
    if (request.kind !== "atlas") return { bounds: box(rows[0], 0) };
    return { metrics: rows.map((row, i) => {
      const b = box(row, i);
      const cy = page300.height / 2 + i * 256;
      return { left: (b.left - page300.width / 2 - 1) / 64, right: (b.right - page300.width / 2 + 1) / 64, top: (b.top - cy - 1) / 64, bottom: (b.bottom - cy + 1) / 64 };
    }) };
  });
  const unitPaste = async (unit, input) => {
    clearMetricCache();
    const styled = style("regular", 22);
    styled.textProps.typeUnit = unit;
    return (await prepareSmartPaste({
      trigger: { source: "wand" }, lines: [line("Je ne pensais vraiment pas te revoir ici.", styled)], roleStyles: {}, settings: { hyphenation: "off", minScale: 0.7 },
    }, { capture: async () => ({ ...page300, documentId: 7, ...input }), measure: unitMeasure, useAtlas: true })).sessions[0];
  };
  const pixels300 = await unitPaste("pixelsUnit", narrowInput);
  assert.strictEqual(pixels300.text.tier, "exact", "a style in pixels is as large on a 300 ppi page as on a 72 ppi one");
  assert.ok(Math.abs(pixels300.text.size - 22) < 1e-6, "22 px stay 22 pixels: " + pixels300.text.size);
  assert.strictEqual(pixels300.text.params.layerText.textKey, kept22.sessions[0].text.params.layerText.textKey, "with the same lines");
  assert.ok(Math.abs(pixels300.text.params.layerText.textStyleRange[0].textStyle.size - 22) < 1e-6, "and the size is written in the style's unit");
  linesInside(pixels300);
  const scaledUp = ellipseNodes(600, 600, 95 * 300 / 72, 70 * 300 / 72);
  const points300 = await unitPaste("pointsUnit", { source: "wand", click: { x: 600, y: 600 }, selectionBounds: boundsOf(geometry.flatten(scaledUp)), rawPath: pathOf([scaledUp]), fill: white });
  assert.ok(Math.abs(points300.text.size - 22 * 300 / 72) < 1e-6, "22 pt are 91.67 pixels there: " + points300.text.size);
  assert.ok(Math.abs(points300.text.params.layerText.textStyleRange[0].textStyle.size - 22) < 1e-6);
  clearMetricCache();

  // A shrink stays as small as possible: the largest size that fits, not a
  // smaller one with a nicer silhouette (this one used to drop to 85%)
  const round = ellipseNodes(300, 300, 100, 100);
  const roundInput = { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(geometry.flatten(round)), rawPath: pathOf([round]), fill: white };
  const least = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Merci beaucoup pour tout ce que tu as fait pour nous.", style("regular", 26))], roleStyles: {}, settings: { hyphenation: "off", minScale: 0.85 },
  }, adapterFor(roundInput));
  assert.strictEqual(least.sessions[0].text.tier, "range");
  assert.ok(least.sessions[0].text.size >= 26 * 0.92 && least.sessions[0].text.size < 26, "least shrink " + least.sessions[0].text.size);
  linesInside(least.sessions[0]);

  // Keep size (Alt): one exact size
  const kept = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Bonjour.")], roleStyles: {}, settings: { keepSize: true },
  }, { ...adapterFor({ ...ovalInput, activeTextSize: 30 }) });
  assert.ok(Math.abs(kept.sessions[0].text.size - 30) < 1e-6, "keep size uses the active layer size");
  // The active layer is in Photoshop's type unit, the style in its own: 15 pt
  // on a 144 ppi page are 30 px for a style in pixels
  const keptUnit = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Bonjour.")], roleStyles: {}, settings: { keepSize: true },
  }, { ...adapterFor({ ...ovalInput, resolution: 144, activeTextSize: 15, activeTextUnit: "pointsUnit" }) });
  assert.ok(Math.abs(keptUnit.sessions[0].text.size - 30) < 1e-6, "the kept size is converted to the style's unit: " + keptUnit.sessions[0].text.size);
  assert.ok(Math.abs(keptUnit.sessions[0].text.params.layerText.textStyleRange[0].textStyle.size - 30) < 1e-6);

  // Punctuation only: the style's scale applies, and only to such a line
  const shouting = { ...style("regular", 24), punctuationOnlyScale: 3 };
  const pasteIn = (input, text, settings = {}) => prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line(text, shouting)], roleStyles: {}, settings: { hyphenation: "off", ...settings },
  }, adapterFor(input));
  assert.ok(Math.abs((await pasteIn(ovalInput, "?!")).sessions[0].text.size - 72) < 1e-6, "tripled in a large bubble");
  assert.ok(Math.abs((await pasteIn(ovalInput, "Bonjour.")).sessions[0].text.size - 24) < 1e-6, "text keeps the style size");
  const fistBubble = ellipseNodes(300, 300, 34, 34);
  const fistInput = { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(geometry.flatten(fistBubble)), rawPath: pathOf([fistBubble]), fill: white };
  const fittedPunctuation = (await pasteIn(fistInput, "?!!", { minScale: 0.85 })).sessions[0].text;
  assert.ok(fittedPunctuation.size < 72 && fittedPunctuation.size >= 24 * 0.85 - 1e-6, "a small bubble shrinks it, not below the style's minimum: " + fittedPunctuation.size);
  const keptPunctuation = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("!!", shouting)], roleStyles: {}, settings: { keepSize: true },
  }, adapterFor({ ...ovalInput, activeTextSize: 30 }));
  assert.ok(Math.abs(keptPunctuation.sessions[0].text.size - 30) < 1e-6, "keep size wins over the scale");

  // Black bubble: white text, no stroke
  const dark = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Silence.")], roleStyles: {}, settings: {},
  }, adapterFor({ ...ovalInput, fill: black }));
  assert.deepStrictEqual(dark.sessions[0].text.params.layerText.textStyleRange[0].textStyle.color, { red: 255, green: 255, blue: 255 });
  assert.strictEqual(dark.sessions[0].text.stroke, null);
  assert.ok(single.sessions[0].text.stroke, "a white bubble keeps the style stroke");

  // Shout bubble takes the shout style unless the line has a prefix style
  const spiky = star(600, 600, 300, 210, 14);
  const shoutInput = { source: "wand", click: { x: 600, y: 600 }, selectionBounds: boundsOf(spiky), rawPath: pathOf([polygonNodes(spiky)]), fill: white };
  const shoutStyle = style("shout", 30, "BadaBoom");
  const shout = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Arrête !")], roleStyles: { shout: shoutStyle, narration: null }, settings: {},
  }, adapterFor(shoutInput));
  assert.strictEqual(shout.sessions[0].plan.kind, "shout");
  assert.strictEqual(shout.sessions[0].role, "shout");
  assert.strictEqual(shout.sessions[0].text.params.layerText.textStyleRange[0].textStyle.fontPostScriptName, "BadaBoom");
  const locked = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [{ ...line("Arrête !"), styleLocked: true }], roleStyles: { shout: shoutStyle }, settings: {},
  }, adapterFor(shoutInput));
  assert.strictEqual(locked.sessions[0].role, null, "a prefix style is never replaced");
  assert.deepStrictEqual(styleForKind({ style: 1, styleLocked: false }, "regular", { shout: 2 }), { style: 1, role: null });

  // Rectangle: laid out like a narration box, but it keeps the line's style
  const rect = { left: 100, top: 100, right: 500, bottom: 260 };
  const narration = style("narration", 22, "Caption");
  const box = await prepareSmartPaste({
    trigger: { source: "rectangle" }, lines: [line("Pendant ce temps, à l'autre bout de la ville...")], roleStyles: { narration }, settings: {},
  }, adapterFor({ source: "rectangle", click: null, selectionBounds: rect, rawPath: null, fill: white }));
  assert.strictEqual(box.sessions[0].plan.kind, "narration");
  assert.strictEqual(box.sessions[0].role, null, "a rectangle never takes the narration style");
  assert.notStrictEqual(box.sessions[0].text.params.layerText.textStyleRange[0].textStyle.fontPostScriptName, "Caption");
  linesInside(box.sessions[0]);

  // Narration is detected on Magic Wand selections only
  const caption = [[100, 100], [500, 100], [500, 260], [100, 260]];
  const captionInput = { click: { x: 300, y: 180 }, selectionBounds: rect, rawPath: pathOf([polygonNodes(caption)]), fill: white };
  const wandBox = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Pendant ce temps, à l'autre bout de la ville...")], roleStyles: { narration }, settings: {},
  }, adapterFor({ ...captionInput, source: "wand" }));
  assert.strictEqual(wandBox.sessions[0].plan.kind, "narration");
  assert.strictEqual(wandBox.sessions[0].role, "narration");
  assert.strictEqual(wandBox.sessions[0].text.params.layerText.textStyleRange[0].textStyle.fontPostScriptName, "Caption");
  const lassoBox = await prepareSmartPaste({
    trigger: { source: "lasso" }, lines: [line("Pendant ce temps, à l'autre bout de la ville...")], roleStyles: { narration }, settings: {},
  }, adapterFor({ ...captionInput, source: "lasso", click: null }));
  assert.strictEqual(lassoBox.sessions[0].plan.kind, "narration");
  assert.strictEqual(lassoBox.sessions[0].role, null, "a lasso never takes the narration style");

  // A manual Paste in a square selection: the last selection's tool decides
  const squarePath = { pathContents: { pathComponents: [{ subpathListKey: [{ points: caption.map(([x, y]) => ({ anchor: { horizontal: x, vertical: y } })) }] }] } };
  assert.strictEqual(bubblePlan.captureSource({ source: "manual", lastSource: "wand" }, squarePath), "wand");
  assert.strictEqual(bubblePlan.captureSource({ source: "manual", lastSource: "rectangle" }, squarePath), "rectangle");
  assert.strictEqual(bubblePlan.captureSource({ source: "manual" }, squarePath), "rectangle");
  assert.strictEqual(bubblePlan.captureSource({ source: "rectangle" }, squarePath), "rectangle");

  // Double bubble: two lines, one per chamber, clicked chamber first
  const outline = peanut([400, 500], [640, 500], 160);
  const doubleInput = { source: "wand", click: { x: 330, y: 500 }, selectionBounds: boundsOf(outline), rawPath: pathOf([polygonNodes(outline)]), fill: white };
  const doublePlan = bubblePlan.buildPlan({ ...page, documentId: 7, ...doubleInput }, {});
  assert.ok(doublePlan.connected, "the neck is found");
  const subpaths = bubblePlan.subpathsFromDescriptor(doubleInput.rawPath, 72);
  const chambers = connected.chambersFor({ ...page, documentId: 7, ...doubleInput }, doublePlan, subpaths, 2, {});
  assert.strictEqual(chambers.length, 2);
  assert.ok(chambers[0].selection.xMid < chambers[1].selection.xMid);
  const pair = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Toi, à gauche."), line("Et moi, à droite !")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor(doubleInput));
  assert.strictEqual(pair.consumed, 2);
  assert.ok(pair.sessions[0].text.axis < pair.sessions[1].text.axis);
  pair.sessions.forEach(linesInside);
  const notDistributed = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Toi, à gauche."), line("Et moi, à droite !")], roleStyles: {}, settings: { distribute: false },
  }, adapterFor(doubleInput));
  assert.strictEqual(notDistributed.consumed, 1);
  // A click on the seam does not name a chamber: the one that reads first
  // takes the first line (right first in a manga, left first with "ltr"), and
  // both lines are pasted. It used to be refused, so the classic paste put one
  // line across the whole bubble.
  const seam = { x: 520, y: 500 };
  const seamInput = { ...doubleInput, click: seam };
  const seamPlan = bubblePlan.buildPlan({ ...page, documentId: 7, ...seamInput }, {});
  assert.ok(seamPlan.connected, "a click on the seam still finds the neck");
  assert.ok(seamPlan.click.x > 520, "the chamber that reads first in a manga");
  assert.ok(bubblePlan.buildPlan({ ...page, documentId: 7, ...seamInput, readingOrder: "ltr" }, {}).click.x < 520, "the left chamber first in a comic");
  for (const readingOrder of ["rtl", "ltr"]) {
    const onSeam = await prepareSmartPaste({
      trigger: { source: "wand" }, lines: [line("La première."), line("Et la deuxième !")], roleStyles: {}, settings: { distribute: true, readingOrder },
    }, adapterFor(seamInput));
    assert.strictEqual(onSeam.consumed, 2, "a click on the seam fills both chambers");
    assert.strictEqual(onSeam.sessions[0].text.axis > onSeam.sessions[1].text.axis, readingOrder === "rtl");
    onSeam.sessions.forEach(linesInside);
  }
  assert.throws(() => bubblePlan.buildBubblePlan({ ...page, documentId: 7, ...seamInput }, { subpaths, click: seam }), /Click farther inside one chamber/, "a chamber's own seed on the seam stays refused");
  // A click on the very edge of the selection, just outside its outline (the
  // work path follows the selection within 2 px), still pastes in the bubble
  const edgeClick = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Sur le bord.")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor({ ...ovalInput, click: { x: 600 + 261.5, y: 500 } }));
  assert.strictEqual(edgeClick.consumed, 1);
  linesInside(edgeClick.sessions[0]);
  // A selection heavier than the path budget (a bubble full of lettering or
  // screentone specks) keeps its longest outlines instead of being refused
  const specks = [];
  for (let i = 0; i < 700; i++) {
    const x = 420 + (i % 35) * 10;
    const y = 400 + Math.floor(i / 35) * 10;
    specks.push(polygonNodes([[x, y], [x + 4, y], [x + 4, y + 4], [x, y + 4]]));
  }
  const heavyPath = pathOf([oval, ...specks]);
  const heavy = bubblePlan.subpathsFromDescriptor(heavyPath, 72);
  assert.ok(heavy.length <= 512 && heavy.some((sub) => sub.contour.length === oval.length), "the bubble's outline is kept");
  const heavyPaste = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Malgré la trame.")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor({ ...ovalInput, rawPath: heavyPath }));
  assert.strictEqual(heavyPaste.consumed, 1);
  // A text set far too large for the bubble (a title style, a style in points
  // on a 600 dpi page) is placed on the bubble's centre at the smallest size
  const oversized = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Beaucoup trop grand pour cette bulle.", style("regular", 300))], roleStyles: {}, settings: { distribute: true },
  }, adapterFor({ ...ovalInput, selectionBounds: boundsOf(geometry.flatten(small)), rawPath: pathOf([small]), click: { x: 300, y: 300 } }));
  assert.strictEqual(oversized.consumed, 1, "never left to the classic paste");
  assert.ok(Math.abs(oversized.sessions[0].text.size - 225) < 1e-6, "at the smallest size");
  assert.ok(Math.abs(oversized.sessions[0].text.axis - 300) < 3 && Math.abs((oversized.sessions[0].text.top + oversized.sessions[0].text.bottom) / 2 - 300) < 3, "on the bubble's centre");

  // Spaces left around a line (by a formatting or refont marker) are no
  // reason to refuse it; its bold and italic runs follow
  const spaced = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [{ ...line("  Un mot en gras ici. \t"), richTextRuns: [{ text: "  Un mot en ", bold: false, italic: false }, { text: "gras", bold: true, italic: false }, { text: " ici. \t", bold: false, italic: true }] }], roleStyles: {}, settings: { distribute: true },
  }, adapterFor(ovalInput));
  assert.strictEqual(spaced.consumed, 1);
  assert.strictEqual(spaced.sessions[0].text.renderedText.replace(/\r/g, " "), "Un mot en gras ici.");
  assert.strictEqual(spaced.sessions[0].layerName, "Un mot en gras ici.");

  // The neck is no bubble line: a large padding does not push the text off the
  // chamber's centre, and the style size comes before the padding
  const keptCentre = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Toi, à gauche."), line("Et moi, à droite !")], roleStyles: {}, settings: { distribute: true, padding: 30 },
  }, adapterFor(doubleInput));
  keptCentre.sessions.forEach((session) => {
    assert.strictEqual(session.text.tier, "exact");
    assert.ok(Math.abs((session.text.top + session.text.bottom) / 2 - session.plan.selection.yMid) < 2, "centred in its chamber");
    assert.ok(Math.abs(session.text.axis - session.plan.selection.xMid) < 2, "centred in its chamber");
  });
  // A line too long for its chamber is pasted anyway, on the chamber's centre
  // A padding too large for the bubble gives way before the classic paste
  const roomy = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Merci beaucoup pour tout ce que tu as fait pour nous.", style("regular", 26))], roleStyles: {}, settings: { hyphenation: "off", minScale: 0.75, padding: 70 },
  }, adapterFor(roundInput));
  assert.ok(roomy.sessions[0].text.pad < 70, "the padding gave way: " + roomy.sessions[0].text.pad);
  assert.ok(roomy.sessions[0].text.size >= 26 * 0.75 - 1e-6, "the size stays above the minimum: " + roomy.sessions[0].text.size);
  // and at the smallest size allowed, and so is the one that opens the bubble
  const smallDouble = peanut([300, 300], [400, 300], 62);
  const smallInput2 = { source: "wand", click: { x: 270, y: 300 }, selectionBounds: boundsOf(smallDouble), rawPath: pathOf([polygonNodes(smallDouble)]), fill: white };
  const tooLong = "Une phrase beaucoup trop longue pour une si petite bulle de rien du tout, vraiment beaucoup trop longue.";
  for (const pairOfLines of [["Toi.", tooLong], [tooLong, "Toi."]]) {
    const anyway = await prepareSmartPaste({
      trigger: { source: "wand" }, lines: pairOfLines.map((text) => line(text)), roleStyles: {}, settings: { distribute: true, hyphenation: "off", minScale: 0.85 },
    }, adapterFor(smallInput2));
    assert.strictEqual(anyway.consumed, 2, "both chambers get their line");
    const long = anyway.sessions.find((session) => session.text.renderedText.length > 20);
    assert.ok(Math.abs(long.text.size - 24 * 0.85) < 0.01, "smallest size " + long.text.size);
    assert.ok(Math.abs((long.text.top + long.text.bottom) / 2 - long.plan.selection.yMid) < 2, "on the chamber's centre");
  }
  // Without a click the first chamber in reading order gets the line: the
  // right one in a manga whatever the text direction, the left one in a comic
  for (const direction of ["ltr", "rtl"]) {
    const unclicked = await prepareSmartPaste({
      trigger: { source: "lasso" }, lines: [line("Droite d'abord."), line("Puis gauche.")], roleStyles: {}, settings: { distribute: true, direction },
    }, adapterFor({ ...doubleInput, click: null }));
    assert.strictEqual(unclicked.consumed, 2);
    assert.ok(unclicked.sessions[0].text.axis > unclicked.sessions[1].text.axis, "manga reading order with " + direction + " text");
  }
  const unclickedComic = await prepareSmartPaste({
    trigger: { source: "lasso" }, lines: [line("Gauche d'abord."), line("Puis droite.")], roleStyles: {}, settings: { distribute: true, readingOrder: "ltr" },
  }, adapterFor({ ...doubleInput, click: null }));
  assert.ok(unclickedComic.sessions[0].text.axis < unclickedComic.sessions[1].text.axis, "comic reading order");

  // A tall single bubble with a shallow notch on each side (a hand-drawn
  // shout or rectangle) is not a double bubble: its pinch is too shallow
  const notched = [[900, 300], [1120, 300], [1120, 510], [1092, 525], [1120, 540], [1120, 750], [900, 750], [900, 540], [928, 525], [900, 510]];
  const notchedInput = { source: "wand", click: { x: 1010, y: 420 }, selectionBounds: boundsOf(notched), rawPath: pathOf([polygonNodes(notched)]), fill: white };
  assert.strictEqual(bubblePlan.buildPlan({ ...page, documentId: 7, ...notchedInput }, {}).connected, false, "shallow notches are no neck");
  const notchedPaste = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Une seule bulle."), line("La ligne suivante attend.")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor(notchedInput));
  assert.strictEqual(notchedPaste.consumed, 1);

  // Round lobes on real wand outlines: a small chamber on top of a large one
  // (wide neck), two side by side chambers with a tail on one of them (long
  // seam), and single bubbles with shallow dents: a cloud, a box pinched at
  // its waist, an angular shout
  const realPage = { width: 1114, height: 1600, resolution: 72 };
  const realInput = (poly, click) => ({ ...realPage, documentId: 7, source: "wand", click, selectionBounds: boundsOf(poly), rawPath: pathOf([polygonNodes(poly)]), fill: white });
  const lobes = [[582, 1174], [600, 1177], [615, 1185], [627, 1198], [636, 1214], [641, 1232], [643, 1251], [641, 1271], [636, 1291], [626, 1313], [612, 1331], [594, 1342], [598, 1357], [600, 1373], [600, 1408], [594, 1442], [585, 1470], [605, 1481], [581, 1478], [572, 1494], [560, 1509], [545, 1524], [528, 1536], [509, 1545], [488, 1550], [467, 1550], [444, 1545], [437, 1542], [423, 1532], [395, 1505], [422, 1282], [429, 1273], [437, 1265], [448, 1259], [460, 1255], [486, 1252], [515, 1254], [517, 1236], [521, 1221], [527, 1209], [534, 1200], [543, 1192], [554, 1186]];
  const tailed = [[929, 52], [955, 55], [991, 68], [1014, 78], [1030, 89], [1041, 101], [1048, 114], [1052, 131], [1054, 151], [1058, 247], [1057, 267], [1053, 285], [1039, 306], [1014, 332], [987, 356], [975, 364], [965, 368], [955, 369], [945, 368], [910, 355], [893, 354], [889, 365], [880, 376], [850, 396], [835, 404], [819, 405], [806, 403], [778, 393], [753, 379], [738, 367], [732, 354], [728, 321], [722, 307], [700, 314], [722, 299], [716, 223], [717, 193], [719, 181], [724, 171], [732, 161], [743, 150], [770, 129], [797, 115], [809, 112], [824, 113], [848, 121], [864, 99], [883, 81], [904, 65]];
  for (const [poly, click] of [[lobes, { x: 506, y: 1394 }], [lobes, { x: 585, y: 1250 }], [tailed, { x: 800, y: 280 }], [tailed, { x: 960, y: 180 }]]) {
    const input = realInput(poly, click);
    const plan = bubblePlan.buildPlan(input, {});
    assert.ok(plan.connected, "round lobes with a wide neck are connected");
    assert.strictEqual(connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 2, {}).length, 2);
  }
  const cloud = [[167, 419], [182, 420], [201, 428], [210, 435], [213, 440], [215, 452], [218, 455], [220, 454], [223, 448], [227, 443], [231, 445], [232, 452], [238, 450], [244, 442], [252, 437], [262, 434], [274, 435], [285, 437], [304, 446], [310, 452], [316, 467], [319, 486], [317, 505], [310, 520], [301, 526], [299, 530], [303, 536], [298, 545], [318, 566], [327, 582], [330, 596], [332, 612], [331, 629], [328, 645], [323, 660], [316, 673], [307, 682], [297, 686], [303, 701], [297, 705], [301, 715], [317, 738], [320, 754], [319, 764], [312, 782], [300, 795], [286, 802], [276, 803], [266, 803], [258, 811], [252, 813], [239, 802], [237, 803], [231, 814], [222, 823], [210, 830], [197, 835], [182, 837], [168, 836], [154, 833], [142, 826], [132, 815], [124, 798], [124, 785], [129, 773], [130, 768], [120, 765], [119, 759], [122, 751], [126, 745], [124, 741], [114, 736], [105, 729], [97, 720], [91, 709], [86, 696], [84, 683], [84, 670], [88, 656], [94, 648], [109, 636], [113, 627], [111, 625], [110, 622], [116, 617], [116, 614], [107, 608], [99, 600], [94, 591], [90, 580], [89, 569], [89, 558], [93, 547], [99, 536], [122, 514], [120, 510], [120, 503], [128, 488], [124, 484], [123, 476], [124, 462], [128, 450], [132, 444], [141, 434]];
  const pinched = [[376,105], [379,105], [373,141], [372,180], [375,218], [382,251], [372,375], [372,388], [375,414], [386,462], [353,460], [321,461], [276,467], [261,472], [250,481], [245,483], [250,450], [253,414], [254,336], [249,258], [240,191], [244,190], [250,186], [256,168], [278,159], [317,139]];
  const angularShout = [[972,101], [974,107], [980,119], [1003,142], [976,191], [964,224], [932,212], [916,206], [897,203], [895,182], [888,151], [895,141], [901,127], [904,111], [903,96]];
  for (const [poly, click, label] of [[cloud, { x: 219, y: 665 }, "a scalloped cloud"], [pinched, { x: 313, y: 293 }, "a box pinched at its waist"], [angularShout, { x: 945, y: 160 }, "an angular shout"]]) {
    assert.strictEqual(bubblePlan.buildPlan(realInput(poly, click), {}).connected, false, `${label} is no double bubble`);
  }

  // Dents: double bubbles whose neck the gates above reject (one clipped by
  // the panel frame, two offset boxes) are found because one cut removes
  // most of their dents
  const offsetBoxes = [[534, 374], [628, 374], [631, 381], [641, 397], [643, 408], [631, 486], [632, 496], [643, 498], [643, 500], [631, 502], [630, 525], [633, 563], [593, 589], [573, 608], [552, 593], [547, 595], [531, 620], [512, 643], [505, 642], [492, 645], [465, 662], [421, 635], [422, 424], [457, 397], [491, 411], [505, 414], [505, 404], [515, 400], [524, 393], [530, 384]];
  const dented = [[780,1178], [850,1176], [887,1177], [901,1179], [910,1183], [913,1194], [910,1266], [906,1286], [901,1294], [895,1302], [887,1309], [869,1316], [873,1332], [868,1327], [861,1317], [843,1329], [833,1334], [818,1334], [806,1333], [806,1335], [809,1376], [793,1398], [781,1432], [773,1438], [763,1442], [737,1443], [710,1438], [690,1430], [674,1221], [693,1211], [734,1194], [743,1193], [764,1197], [769,1189]];
  for (const [poly, click] of [[dented, { x: 740, y: 1300 }], [dented, { x: 860, y: 1250 }], [offsetBoxes, { x: 600, y: 450 }], [offsetBoxes, { x: 470, y: 600 }]]) {
    const input = realInput(poly, click);
    const plan = bubblePlan.buildPlan(input, {});
    assert.ok(plan.connected, "the dent cut finds the neck");
    assert.strictEqual(connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 2, {}).length, 2);
  }

  // Corners: overlapping ovals with shallow notches are found by their two
  // sharp corners. Single bubbles with hand-drawn notches have such corners
  // too, but shallower and farther apart. All labelled by a typesetter.
  const cornerDoubleBig = [[319,1059],[403,1059],[433,1078],[446,1059],[530,1059],[535,1065],[542,1081],[548,1112],[545,1144],[536,1169],[523,1189],[510,1198],[495,1204],[476,1204],[469,1229],[460,1250],[449,1269],[436,1282],[411,1301],[419,1322],[404,1305],[376,1313],[347,1313],[319,1304],[299,1293],[277,1272],[264,1251],[253,1225],[247,1198],[247,1166],[254,1135],[266,1109],[280,1088],[300,1070]];
  const cornerDoubleEven = [[946,1226],[1038,1226],[1051,1236],[1057,1246],[1078,1290],[1087,1349],[1083,1387],[1069,1441],[1052,1474],[1029,1492],[1009,1502],[986,1507],[970,1505],[946,1497],[927,1516],[903,1528],[866,1538],[845,1538],[815,1532],[793,1523],[768,1507],[749,1487],[736,1462],[727,1424],[726,1378],[732,1347],[709,1345],[733,1340],[743,1317],[753,1302],[770,1283],[793,1267],[809,1260],[839,1254],[877,1254],[907,1261],[923,1241]];
  for (const [poly, click] of [[cornerDoubleBig, { x: 367, y: 1191 }], [cornerDoubleBig, { x: 490, y: 1120 }], [cornerDoubleEven, { x: 860, y: 1382 }], [cornerDoubleEven, { x: 1000, y: 1350 }]]) {
    const input = realInput(poly, click);
    const plan = bubblePlan.buildPlan(input, {});
    assert.ok(plan.connected, "two sharp corners make a neck");
    assert.strictEqual(connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 2, {}).length, 2);
  }
  const notchedOval = [[250,1477],[280,1477],[292,1481],[307,1489],[321,1503],[334,1527],[344,1533],[353,1548],[360,1571],[365,1609],[363,1643],[358,1665],[352,1680],[338,1700],[333,1720],[325,1735],[308,1749],[284,1761],[273,1764],[254,1763],[237,1758],[226,1749],[222,1740],[202,1742],[195,1740],[178,1727],[164,1704],[158,1691],[155,1669],[148,1646],[146,1616],[148,1585],[153,1565],[160,1546],[172,1524],[187,1507],[202,1496],[211,1492],[223,1494],[235,1484]];
  const tallNotchedOval = [[212,1075],[224,1075],[236,1078],[254,1087],[271,1109],[286,1144],[299,1208],[305,1277],[305,1319],[303,1346],[298,1369],[298,1410],[294,1425],[287,1440],[266,1460],[258,1472],[254,1472],[237,1503],[220,1522],[204,1531],[188,1534],[180,1531],[162,1519],[128,1521],[116,1517],[104,1511],[86,1489],[74,1459],[64,1414],[64,1382],[60,1363],[55,1314],[53,1256],[56,1209],[63,1171],[72,1143],[81,1125],[98,1106],[113,1099],[127,1095],[145,1096],[166,1101],[189,1083]];
  const softWaist = [[535,60],[550,60],[566,65],[573,68],[587,84],[591,104],[583,147],[598,187],[600,202],[579,249],[560,276],[543,293],[532,299],[526,300],[509,296],[476,283],[447,263],[434,247],[432,237],[443,190],[441,138],[449,119],[483,86],[511,69]];
  const longChordBlob = [[284,431],[311,433],[322,438],[335,447],[340,457],[342,464],[352,464],[365,479],[369,489],[369,508],[371,488],[366,472],[385,468],[391,471],[397,479],[401,481],[368,521],[365,530],[340,558],[313,576],[290,583],[277,584],[270,582],[259,575],[247,549],[228,543],[219,536],[216,523],[216,505],[224,484],[233,469],[255,444],[273,435]];
  for (const [poly, click, label] of [[notchedOval, { x: 256, y: 1621 }, "an oval with hand-drawn notches"], [tallNotchedOval, { x: 179, y: 1259 }, "a tall oval with hand-drawn notches"], [softWaist, { x: 516, y: 204 }, "a blob with a soft waist"], [longChordBlob, { x: 290, y: 508 }, "a blob with one sharp corner"]]) {
    assert.strictEqual(bubblePlan.buildPlan(realInput(poly, click), {}).connected, false, `${label} is no double bubble`);
  }

  // Frame: a double bubble clipped by the panel frame has one corner only,
  // where its lobes meet, and its seam ends on the frame. Two real wand
  // outlines (the second with an almost flat notch) and two circles under a
  // frame; the first line stays in the clicked chamber
  const clipped = [[1029,1057], [1030,1228], [1027,1247], [972,1277], [957,1282], [941,1285], [924,1284], [905,1278], [894,1271], [873,1252], [864,1246], [852,1254], [826,1260], [825,1262], [827,1282], [824,1280], [815,1262], [798,1262], [782,1259], [768,1254], [755,1248], [744,1239], [735,1228], [728,1215], [723,1201], [722,1193], [723,1186], [732,1158], [733,1150], [730,1134], [716,1101], [714,1084], [717,1076], [736,1057]];
  const flatNotch = [[1001,1033], [1003,1174], [1001,1202], [998,1225], [993,1241], [966,1251], [951,1259], [920,1245], [908,1254], [888,1275], [879,1283], [840,1291], [846,1315], [844,1313], [835,1302], [829,1289], [785,1288], [777,1283], [738,1242], [719,1216], [719,1180], [714,1101], [711,1079], [712,1069], [714,1061], [751,1033]];
  const underFrame = [[668,427],[663,447],[655,466],[645,483],[633,499],[618,513],[603,525],[586,535],[568,542],[550,547],[525,550],[507,549],[484,546],[463,539],[445,530],[425,516],[410,502],[398,513],[384,525],[366,535],[352,541],[330,547],[307,550],[283,549],[264,546],[240,538],[223,529],[202,513],[187,499],[179,489],[172,477],[162,459],[156,440],[151,420],[150,400],[151,386],[152,373],[157,353],[167,330],[653,330],[663,353],[666,366],[669,380],[670,400],[669,414]];
  for (const [poly, clicks, neckX] of [[clipped, [{ x: 780, y: 1150 }, { x: 950, y: 1150 }], [864, 864]], [flatNotch, [{ x: 800, y: 1150 }, { x: 960, y: 1150 }], [920, 920]], [underFrame, [{ x: 300, y: 430 }, { x: 520, y: 430 }], [410, 410]]]) {
    for (const click of clicks) {
      const input = realInput(poly, click);
      const plan = bubblePlan.buildPlan(input, {});
      assert.ok(plan.connected, "a seam from the corner to the frame");
      plan.neck.map((p) => Math.round(p[0])).sort((a, b) => a - b).forEach((x, i) => assert.ok(Math.abs(x - neckX[i]) <= 1, "the seam runs straight to the frame"));
      const chambers = connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 3, {});
      assert.strictEqual(chambers.length, 2);
      assert.ok(geometry.contains(chambers[0].cleanPolygon, click), "the clicked chamber first");
    }
  }
  const framePair = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Toi, à gauche."), line("Et moi, à droite !"), line("La suivante attend.")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor(realInput(clipped, { x: 780, y: 1150 })));
  assert.strictEqual(framePair.consumed, 2, "one click fills both lobes of a double bubble under a frame");
  // A real one with a tail (stacked lobes against the right frame): the base
  // of the tail is no second corner
  const tailedUnderFrameDouble = [[290,1006],[290,1572],[271,1584],[263,1588],[252,1590],[238,1590],[210,1584],[193,1576],[180,1566],[171,1554],[165,1541],[161,1526],[153,1467],[153,1399],[141,1378],[142,1377],[154,1384],[156,1359],[160,1337],[167,1318],[177,1301],[176,1298],[155,1282],[137,1253],[124,1216],[115,1172],[112,1127],[114,1084],[122,1046],[137,1017],[146,1011],[162,1007],[205,1004]];
  for (const click of [{ x: 201, y: 1151 }, { x: 201, y: 1444 }]) {
    const input = realInput(tailedUnderFrameDouble, click);
    const plan = bubblePlan.buildPlan(input, {});
    assert.ok(plan.connected, "a tail does not hide the seam");
    plan.neck.forEach((point) => assert.ok(Math.abs(point[1] - 1300) <= 2, "the seam runs straight to the frame"));
    assert.strictEqual(connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 2, {}).length, 2);
  }
  // Single bubbles under a frame stay whole: a tail, a blade over the bubble
  // (a corner far sharper than two lobes meeting), a caption with a step, and
  // two real ones a hand or a head dents too little for a seam
  const tailedUnderFrame = [[679,551],[672,563],[665,575],[656,586],[646,596],[634,606],[622,615],[609,623],[580,636],[549,645],[517,649],[483,649],[488,648],[430,725],[452,646],[451,645],[420,636],[391,623],[378,615],[366,606],[354,596],[344,586],[335,575],[328,563],[321,551],[316,539],[313,526],[311,513],[310,500],[311,487],[313,474],[316,461],[321,449],[328,437],[339,420],[661,420],[672,437],[679,449],[684,461],[687,474],[689,487],[690,500],[689,513],[687,526],[684,539]];
  const bladeUnderFrame = [[679,551],[672,563],[665,575],[656,586],[646,596],[634,606],[622,615],[609,623],[580,636],[549,645],[533,648],[528,648],[520,540],[512,649],[500,650],[467,648],[451,645],[420,636],[391,623],[378,615],[366,606],[354,596],[344,586],[335,575],[328,563],[321,551],[316,539],[313,526],[311,513],[310,500],[311,487],[313,474],[316,461],[321,449],[328,437],[339,420],[661,420],[672,437],[679,449],[684,461],[687,474],[689,487],[690,500],[689,513],[687,526],[684,539]];
  const stepCaption = [[100, 100], [400, 100], [400, 220], [280, 220], [280, 360], [100, 360]];
  const dentedUnderFrame = [[765,407],[614,408],[600,405],[592,393],[586,378],[583,364],[582,342],[568,331],[577,330],[581,328],[572,277],[574,260],[584,259],[582,192],[585,150],[588,130],[594,113],[603,99],[607,95],[615,91],[642,84],[648,73],[661,62],[678,52],[692,47],[705,46],[718,48],[730,53],[741,60],[750,71],[758,83],[762,92],[765,116]];
  const dentedCaption = [[133,1228],[297,1227],[316,1230],[334,1266],[339,1280],[342,1295],[344,1326],[343,1386],[348,1426],[349,1451],[347,1476],[344,1501],[353,1503],[358,1512],[358,1522],[355,1527],[345,1532],[344,1556],[338,1590],[133,1590]];
  for (const [poly, click, label] of [[tailedUnderFrame, { x: 500, y: 520 }, "an oval with a tail under a frame"], [bladeUnderFrame, { x: 420, y: 520 }, "an oval under a frame with a blade over it"], [stepCaption, { x: 180, y: 300 }, "a caption with a step"], [dentedUnderFrame, { x: 667, y: 137 }, "a bubble under a frame with a shallow dent"], [dentedCaption, { x: 246, y: 1318 }, "a caption with a shallow dent"]]) {
    assert.strictEqual(bubblePlan.buildPlan(realInput(poly, click), {}).connected, false, `${label} is no double bubble`);
  }

  // A small bubble on the side of a large one (an aside): its part is under
  // 15% of the outline, but its neck is deep and short and it is a round lobe.
  // A real wand outline, then a small circle barely touching a large one. A
  // bump with a wide base (the same circle pushed in) is no chamber.
  const asideBubble = [[868,1094],[906,1098],[913,1100],[920,1104],[927,1110],[934,1120],[941,1138],[942,1155],[937,1170],[928,1183],[915,1193],[900,1200],[883,1202],[865,1200],[876,1239],[875,1278],[865,1316],[847,1351],[821,1381],[790,1402],[753,1414],[714,1414],[677,1403],[646,1385],[620,1360],[600,1329],[588,1295],[584,1257],[589,1217],[604,1175],[592,1175],[583,1172],[580,1160],[582,1153],[585,1147],[597,1138],[611,1135],[619,1137],[623,1150],[654,1127],[671,1117],[689,1108],[709,1102],[731,1100],[754,1102],[779,1110],[799,1121],[828,1142],[833,1124],[841,1112],[853,1102]];
  const smallOnLarge = [[660,400],[658,417],[652,430],[644,441],[632,451],[621,456],[611,459],[600,460],[591,459],[575,455],[555,441],[546,466],[534,488],[517,509],[498,527],[475,541],[451,552],[426,558],[400,560],[384,559],[368,557],[352,553],[341,549],[325,541],[311,533],[297,522],[287,513],[275,500],[267,489],[258,474],[252,462],[246,445],[243,432],[241,414],[240,400],[241,386],[243,368],[246,355],[252,338],[258,326],[267,311],[275,300],[287,287],[297,278],[311,267],[325,259],[341,251],[352,247],[368,243],[384,241],[400,240],[426,242],[451,248],[475,259],[498,273],[517,291],[534,312],[546,334],[555,359],[575,345],[591,341],[600,340],[611,341],[621,344],[632,349],[644,359],[652,370],[658,383]];
  for (const [poly, clicks] of [[asideBubble, [{ x: 725, y: 1270 }, { x: 891, y: 1139 }]], [smallOnLarge, [{ x: 380, y: 400 }, { x: 610, y: 400 }]]]) {
    for (const click of clicks) {
      const input = realInput(poly, click);
      const plan = bubblePlan.buildPlan(input, {});
      assert.ok(plan.connected, "a small round lobe on a deep neck is a chamber");
      const chambers = connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 2, {});
      assert.strictEqual(chambers.length, 2);
      assert.ok(geometry.contains(chambers[0].cleanPolygon, click), "the clicked chamber first");
    }
  }
  const asidePair = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Ça lui fait un effet, même à elle."), line("Eh bien,")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor(realInput(asideBubble, { x: 725, y: 1270 })));
  assert.strictEqual(asidePair.consumed, 2, "the aside takes the next line");
  const wideBump = [[630,400],[629,413],[625,425],[618,436],[611,443],[598,453],[583,459],[568,460],[557,459],[550,457],[539,480],[527,498],[510,516],[492,531],[470,544],[447,553],[424,558],[400,560],[382,559],[367,557],[352,553],[338,547],[323,540],[310,532],[297,522],[288,514],[276,502],[267,488],[258,474],[253,462],[247,446],[243,430],[241,413],[240,400],[241,387],[243,370],[247,354],[253,338],[258,326],[267,312],[276,298],[288,286],[297,278],[310,268],[323,260],[338,253],[352,247],[367,243],[382,241],[400,240],[424,242],[447,247],[470,256],[492,269],[510,284],[527,302],[539,320],[550,343],[557,341],[568,340],[583,341],[598,347],[611,357],[618,364],[625,375],[629,387]];
  assert.strictEqual(bubblePlan.buildPlan(realInput(wideBump, { x: 380, y: 400 }), {}).connected, false, "a bump with a wide base is no chamber");

  // A forced split (a second click in a bubble that got one line) cuts the
  // double bubbles every gate misses: here one under a frame whose tail keeps
  // the frame route away. The seam still runs straight from the corner to
  // the frame, not to a corner of the frame across a lobe. A plain oval
  // stays whole.
  const tailedDouble = [[843,762],[1026,762],[1035,761],[1039,758],[1040,754],[1038,750],[1035,748],[1032,749],[1029,754],[1028,764],[1029,926],[1027,969],[1021,988],[1013,993],[1002,992],[990,996],[967,1002],[928,1003],[905,997],[889,981],[884,981],[880,985],[867,1011],[853,1027],[832,1043],[811,1051],[788,1050],[757,1039],[745,1030],[739,1014],[735,1011],[728,1013],[706,1026],[731,1008],[717,995],[708,981],[701,965],[697,949],[700,910],[713,875],[711,861],[712,836],[721,813],[735,791],[750,779],[797,772],[819,772],[829,775],[831,774],[826,767],[834,763]];
  for (const click of [{ x: 800, y: 900 }, { x: 950, y: 880 }]) {
    const input = realInput(tailedDouble, click);
    assert.strictEqual(bubblePlan.buildPlan(input, {}).connected, false, "not double without the second click");
    const plan = bubblePlan.buildPlan(input, { forceSplit: true });
    assert.ok(plan.connected, "forced neck");
    plan.neck.map((p) => Math.round(p[0])).forEach((x) => assert.ok(Math.abs(x - 884) <= 2, "the forced seam runs straight to the frame"));
    const chambers = connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 3, { forceSplit: true });
    assert.strictEqual(chambers.length, 2);
    assert.ok(geometry.contains(chambers[0].cleanPolygon, click), "the clicked chamber first");
  }
  const plainOval = geometry.flatten(ellipseNodes(500, 500, 160, 120));
  assert.strictEqual(bubblePlan.buildPlan(realInput(plainOval, { x: 500, y: 500 }), { forceSplit: true }).connected, false, "an oval has no neck to force");
  const forcedPair = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Toi, à gauche."), line("Et moi, à droite !")], roleStyles: {}, settings: { distribute: true, forceSplit: true },
  }, adapterFor(realInput(tailedDouble, { x: 800, y: 900 })));
  assert.strictEqual(forcedPair.consumed, 2);

  // Triple bubble
  const tripleOutline = (() => {
    const centres = [[300, 400], [540, 400], [780, 400]];
    const r = 150;
    const pts = [];
    const inside = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < r * r - 1e-6;
    for (const c of centres) {
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        const p = [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
        if (!centres.some((o) => o !== c && inside(p, o))) pts.push(p);
      }
    }
    // order along the outline: upper arc left to right, lower arc right to left
    const upper = pts.filter((p) => p[1] <= 400).sort((a, b) => a[0] - b[0]);
    const lower = pts.filter((p) => p[1] > 400).sort((a, b) => b[0] - a[0]);
    return upper.concat(lower);
  })();
  // Clicked in the right chamber, the lines follow the manga order, right to
  // left, even with French (left-to-right) text
  const tripleInput = { source: "wand", click: { x: 780, y: 400 }, selectionBounds: boundsOf(tripleOutline), rawPath: pathOf([polygonNodes(tripleOutline)]), fill: white };
  const triple = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Un."), line("Deux."), line("Trois.")], roleStyles: {}, settings: { distribute: true, direction: "ltr" },
  }, adapterFor(tripleInput));
  assert.strictEqual(triple.consumed, 3, "three chambers");
  assert.ok(triple.sessions[0].text.axis > triple.sessions[1].text.axis && triple.sessions[1].text.axis > triple.sessions[2].text.axis, "right to left");
  // Clicked in the left chamber: that one first, then the others right to left
  const tripleFromLeft = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Un."), line("Deux."), line("Trois.")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor({ ...tripleInput, click: { x: 300, y: 400 } }));
  assert.deepStrictEqual(tripleFromLeft.sessions.map((s) => Math.round(s.plan.selection.xMid / 240)), [1, 3, 2], "clicked chamber, then right, then middle");
  // A comic or a manhwa reads left to right
  const comic = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Un."), line("Deux."), line("Trois.")], roleStyles: {}, settings: { distribute: true, readingOrder: "ltr" },
  }, adapterFor({ ...tripleInput, click: { x: 300, y: 400 } }));
  assert.deepStrictEqual(comic.sessions.map((s) => Math.round(s.plan.selection.xMid / 240)), [1, 2, 3], "comic: left to right");

  // Size presets by page width
  const preset = { ...style("p", 20), autoSizeByPageWidth: true, sizePresets: [20, 26], sizePresetMinWidths: [0, 1000], sizePresetDefaultIndex: 0 };
  assert.strictEqual(resolveStyleSizeForPage(JSON.parse(JSON.stringify(preset)), 1200).textProps.layerText.textStyleRange[0].textStyle.size, 26);
  assert.strictEqual(resolveStyleSizeForPage(JSON.parse(JSON.stringify(preset)), 800).textProps.layerText.textStyleRange[0].textStyle.size, 20);

  // Conditional refont
  const rules = normalizeRefontRules([{ open: "\"", close: "\"", styleId: "s2" }, { open: "", close: "x" }]);
  assert.strictEqual(rules.length, 1);
  const refont = applyRefont({ text: 'Il a dit "non" hier', richTextRuns: null }, [{ ...rules[0], textStyle: { fontPostScriptName: "Other" } }]);
  assert.strictEqual(refont.text, "Il a dit non hier");
  assert.deepStrictEqual(refont.richTextRuns.map((r) => r.text), ["Il a dit ", "non", " hier"]);
  assert.strictEqual(refont.richTextRuns[1].textStyle.fontPostScriptName, "Other");
  const kept2 = applyRefont({ text: "a «b» c", richTextRuns: [{ text: "a «b» c", bold: true, italic: false }] }, [{ open: "«", close: "»", keepMarkers: true, textStyle: { fontPostScriptName: "Q" } }]);
  assert.strictEqual(kept2.text, "a «b» c");
  assert.deepStrictEqual(kept2.richTextRuns.map((r) => [r.text, r.bold, !!r.textStyle]), [["a ", true, false], ["«b»", true, true], [" c", true, false]]);
  assert.deepStrictEqual(refontTextStyle(style("x", 12, "F")), { fontPostScriptName: "F", fontName: "F", fontStyleName: "Regular", color: { red: 0, green: 0, blue: 0 } });

  // Selection events
  assert.deepStrictEqual(classifySelectionEvent({ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _obj: "paint", horizontal: px(10), vertical: px(20) }, tolerance: 32, contiguous: true }), { source: "wand", x: 10, y: 20, options: { tolerance: 32, contiguous: true } });
  assert.strictEqual(classifySelectionEvent({ _target: [{ _ref: "channel", _property: "selection" }], to: { _obj: "paint", horizontal: px(10), vertical: px(20) } }), null, "a restored selection never triggers");
  assert.deepStrictEqual(classifySelectionEvent({ null: { _ref: "channel", _property: "selection" }, to: { _obj: "rectangle", left: px(1), top: px(2), right: px(50), bottom: px(60) } }, "marqueeRectTool"), { source: "rectangle", left: 1, top: 2, right: 50, bottom: 60 });
  assert.strictEqual(classifySelectionEvent({ null: { _ref: "channel", _property: "selection" }, to: { _obj: "rectangle", left: px(1), top: px(2), right: px(3), bottom: px(60) } }, "marqueeRectTool"), null);
  assert.deepStrictEqual(classifySelectionEvent({ null: { _ref: "channel", _property: "selection" }, to: { _obj: "polygon" } }), { source: "lasso" });
  assert.strictEqual(classifySelectionEvent({ null: { _ref: "layer" }, to: { _obj: "paint" } }), null);
  assert.deepStrictEqual(parseCepEventData('ver1,{"eventID":1,"eventData":{"a":2}}'), { eventID: 1, eventData: { a: 2 } });
  assert.strictEqual(parseCepEventData(""), null);
  assert.strictEqual(triggerSourceForTool("magicWandTool"), "wand");
  assert.strictEqual(triggerSourceForTool("moveTool"), null);

  // Undo sync
  const history = createPasteHistory();
  assert.ok(history.register({ documentId: 1, before: "a", after: "b", lineBefore: 4, lineAfter: 6 }));
  assert.deepStrictEqual(history.observe({ documentId: 1, current: "a", states: ["x", "a", "b"] }), [{ direction: "undo", lineBefore: 4, lineAfter: 6, documentId: 1 }]);
  assert.deepStrictEqual(history.observe({ documentId: 1, current: "a", states: ["x", "a", "b"] }), [], "no repeated move");
  assert.deepStrictEqual(history.observe({ documentId: 1, current: "b", states: ["x", "a", "b"] }).map((c) => c.direction), ["redo"]);
  assert.deepStrictEqual(history.observe({ documentId: 1, current: "x", states: ["x", "a", "b"] }).map((c) => c.direction), ["undo"]);
  assert.deepStrictEqual(history.observe({ documentId: 2, current: "b", states: ["b"] }), [], "another document");
  assert.strictEqual(lineAfterHistoryMove({ direction: "undo", lineBefore: 4, lineAfter: 6 }, 6), 4);
  assert.strictEqual(lineAfterHistoryMove({ direction: "undo", lineBefore: 4, lineAfter: 6 }, 9), null, "a line moved by hand stays");

  // Hyphenation
  assert.strictEqual(resolveHyphenationLanguage("auto", "fr_FR"), "fr");
  assert.strictEqual(resolveHyphenationLanguage("auto", "en_US"), "en");
  assert.strictEqual(resolveHyphenationLanguage("auto", "en_US", "Il y a quelqu’un. Je ne sais pas qui."), "fr", "the script decides");
  assert.strictEqual(resolveHyphenationLanguage("auto", "fr_FR", "I don't know what you are doing."), "en", "the script decides");
  assert.strictEqual(resolveHyphenationLanguage("auto", "fr_FR", "Bonjour"), "fr", "the interface settles a script too short to tell");
  assert.strictEqual(resolveHyphenationLanguage("en", "fr_FR", "Il y a quelqu’un."), "en", "a chosen language stays");
  assert.strictEqual(breakPointsFor("off"), null);
  assert.ok(breakPointsFor("en")("extraordinary").length > 0);
  assert.ok(breakPointsFor("fr")("malheureusement").length > 0);
  assert.deepStrictEqual(breakPointsFor("fr")("quelqu’un"), [4], "a word breaks away from its apostrophe");
  assert.ok(!breakPointsFor("fr")("l’amitiés").some((at) => at < 4), "never right after an elision");
  assert.ok(breakPointsFor("en")("neighbor's").length > 0);
  assert.deepStrictEqual(breakPointsFor("en")("cafétérias"), [], "not English letters");

  // Measurement metrics
  assert.deepStrictEqual(metricFromBounds({ left: 568, right: 632, top: 818, bottom: 858 }, { width: 1200, height: 1700 }), { left: -0.515625, right: 0.515625, top: -0.515625, bottom: 0.140625 });
  assert.strictEqual(atlasMetrics({ pathContents: { pathComponents: [] } }, 1, page), null);

  // Open bubble: a ring with a 10 px gap on a white page; the solver bridges
  // the gap and returns the chamber around the click
  const open = load("app_src/oneClick/openBubble.js");
  assert.strictEqual(open.isPageLeak({ left: 0, top: 0, right: 1190, bottom: 1500 }, 1200, 1700), true);
  assert.strictEqual(open.isPageLeak({ left: 100, top: 100, right: 500, bottom: 400 }, 1200, 1700), false);
  const W = 700;
  const H = 700;
  const pixels = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = ((x - 350) / 200) ** 2 + ((y - 350) / 140) ** 2;
      const ring = e > 0.96 && e < 1.04;
      const gap = x > 545 && Math.abs(y - 350) < 5;
      if (ring && !gap) pixels[y * W + x] = 0;
    }
  }
  const ticket = { width: W, height: H, crop: { left: 0, top: 0, right: W, bottom: H }, stride: 3, click: { x: 350, y: 350 }, channels: 1 };
  const mask = open.solveOpenMask(ticket, pixels);
  assert.ok(mask, "the open chamber is found");
  const maskBox = geometry.box(mask.polygon);
  assert.ok(maskBox.left > 140 && maskBox.right < 560 && maskBox.top > 200 && maskBox.bottom < 500, "the chamber stays inside the ring: " + JSON.stringify(maskBox));
  assert.deepStrictEqual(mask.rgb, { red: 255, green: 255, blue: 255 });
  const openInput = { documentId: 7, width: W, height: H, click: { x: 350, y: 350 }, selectionBounds: { left: 0, top: 0, right: W, bottom: H } };
  const prior = { polygon: mask.polygon, contour: geometry.polygonContour(mask.polygon) };
  const plan = open.openPlan(openInput, mask, prior, { autoClean: true });
  assert.strictEqual(plan.open, true);
  assert.strictEqual(plan.autoClean, true);
  assert.strictEqual(plan.textColor, null);

  // Local region: a leaking click no chamber is isolated around. The hosts
  // read the outline of the selection inside a disc around the click.
  const spot = { x: 600, y: 800 };
  const disc = open.localWindow(page, spot);
  assert.strictEqual(disc.radius, 216, "18% of the page's width");
  assert.strictEqual(open.localWindow({ width: 4096, height: 2896, resolution: 72 }, spot).radius, 375, "a spread counts as one page");
  assert.ok(open.localWindow(page, { x: 20, y: 30 }).polygon.every((p) => p[0] >= 0 && p[1] >= 0), "the disc stays in the page");
  // The bare page: the whole disc, around the click
  const bare = open.localRegion(pathOf([polygonNodes(disc.polygon)]), page, spot);
  assert.ok(bare && bare.open, "nothing closes the region: it is open");
  const bareBox = geometry.box(bare.polygon);
  assert.ok(bareBox.width > disc.radius * 1.7 && bareBox.height > disc.radius * 1.7 && bareBox.width <= disc.radius * 2 + 8, "the disc: " + JSON.stringify(bareBox));
  assert.ok(Math.abs((bareBox.left + bareBox.right) / 2 - spot.x) < 8 && Math.abs((bareBox.top + bareBox.bottom) / 2 - spot.y) < 8, "centred on the click");
  // A bubble open on a 40 px gap (wider than the recovery closes with its
  // pixels): the opening closes it, the region is the bubble
  const arc = (rx, ry, from, to, steps) => {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      out.push([spot.x + rx * Math.cos(t), spot.y + ry * Math.sin(t)]);
    }
    return out;
  };
  const gapOf = (half) => Math.asin(half / 100);
  const ringOf = (half) => arc(150, 106, gapOf(half), 2 * Math.PI - gapOf(half), 90).concat(arc(144, 100, 2 * Math.PI - gapOf(half), gapOf(half), 90));
  const gapped = open.localRegion(pathOf([polygonNodes(disc.polygon), polygonNodes(ringOf(20))]), page, spot);
  assert.ok(gapped && !gapped.open, "the gap is closed");
  const gappedBox = geometry.box(gapped.polygon);
  // (it bulges into the gap by less than the opening's radius)
  assert.ok(gappedBox.left >= spot.x - 150 && gappedBox.right <= spot.x + 150 + 16 && gappedBox.top >= spot.y - 106 && gappedBox.bottom <= spot.y + 106, "inside the bubble: " + JSON.stringify(gappedBox));
  assert.ok(gappedBox.width > 250 && gappedBox.height > 170, "the whole bubble: " + JSON.stringify(gappedBox));
  assert.ok(geometry.contains(gapped.polygon, spot));
  // A gap no opening closes (half the bubble is missing): the region around
  // the click all the same, never across the outline
  const halfRing = arc(150, 106, Math.PI / 2, (3 * Math.PI) / 2, 60).concat(arc(144, 100, (3 * Math.PI) / 2, Math.PI / 2, 60));
  const wide = open.localRegion(pathOf([polygonNodes(disc.polygon), polygonNodes(halfRing)]), page, spot);
  assert.ok(wide && wide.open && geometry.contains(wide.polygon, spot));
  assert.ok(geometry.box(wide.polygon).left >= spot.x - 146, "the outline bounds the region: " + JSON.stringify(geometry.box(wide.polygon)));
  // A click that is not in the selection (a stale one): no region
  assert.strictEqual(open.localRegion(pathOf([polygonNodes(star(900, 300, 60, 60, 12))]), page, spot), null);
  assert.strictEqual(open.localRegion({ pathContents: { pathComponents: [] } }, page, spot), null);
  // Its plan: a regular bubble, never cleaned, white text on black
  const leakInput = { documentId: 7, click: spot, selectionBounds: { left: 0, top: 0, right: 1200, bottom: 1700 } };
  const localPlan = open.localPlan(leakInput, gapped, white, { autoClean: true });
  assert.strictEqual(localPlan.open, true);
  assert.strictEqual(localPlan.source, "wand");
  assert.strictEqual(localPlan.connected, false);
  assert.strictEqual(localPlan.autoClean, false);
  assert.strictEqual(localPlan.cleanupPolygon, null);
  assert.ok(/^Auto Clean /.test(localPlan.cleanupSkipped));
  assert.strictEqual(localPlan.textColor, null);
  assert.strictEqual(open.localPlan(leakInput, bare, null).kind, "regular", "an open region is no shape of the drawing");
  assert.deepStrictEqual(open.localPlan(leakInput, bare, black).textColor, { red: 255, green: 255, blue: 255 });
  assert.throws(() => open.localPlan(leakInput, null, white));
  assert.ok(open.discRegion(page, spot).open);
  // The paste: the text is laid out in the region instead of falling back
  const leaking = { source: "wand", click: spot, selectionBounds: leakInput.selectionBounds, rawPath: null, fill: null };
  const local = await prepareSmartPaste({
    trigger: { source: "wand", x: spot.x, y: spot.y },
    lines: [line("Je ne pensais pas te revoir ici."), line("Une autre ligne.")],
    roleStyles: {},
    settings: { distribute: true, hyphenation: "fr", minScale: 0.7 },
  }, adapterFor({ ...leaking, openPlan: localPlan }));
  assert.strictEqual(local.consumed, 1, "a local region takes one line");
  assert.strictEqual(local.open, true, "the result says the selection leaks: its next click is another text");
  linesInside(local.sessions[0]);
  await assert.rejects(prepareSmartPaste({ trigger: { source: "manual" }, lines: [line("Texte.")], roleStyles: {}, settings: {} }, adapterFor(leaking)), (error) => error.code === "openBubble",
    "a leak without a click still falls back");
  // The click of a leak: the trigger's own, or the last wand click of a manual Paste
  assert.deepStrictEqual(bubblePlan.leakClick({ source: "wand", x: 5, y: 6 }, 72), { x: 5, y: 6 });
  assert.deepStrictEqual(bubblePlan.leakClick({ source: "manual", lastSource: "wand", lastClick: { x: 36, y: 72, unit: "distanceUnit" } }, 144), { x: 72, y: 144 });
  assert.strictEqual(bubblePlan.leakClick({ source: "manual", lastSource: "wand" }, 72), null);
  assert.strictEqual(bubblePlan.leakClick({ source: "manual", lastSource: "rectangle", lastClick: { x: 1, y: 1 } }, 72), null);
  assert.strictEqual(bubblePlan.triggerClick({ source: "manual", lastSource: "wand", lastClick: { x: 1, y: 1 } }, 72), null, "a closed bubble ignores it");

  console.log("smart paste engine tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
