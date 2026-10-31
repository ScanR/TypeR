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
const { metricFromBounds, atlasMetrics } = load("app_src/oneClick/measureSpec.js");

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

  // Too much text for a tiny bubble: no placement (the panel falls back)
  const tiny = ellipseNodes(300, 300, 45, 35);
  const tinyInput = { source: "wand", click: { x: 300, y: 300 }, selectionBounds: boundsOf(geometry.flatten(tiny)), rawPath: pathOf([tiny]), fill: white };
  await assert.rejects(prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Une phrase beaucoup trop longue pour une si petite bulle de rien du tout.")], roleStyles: {}, settings: { hyphenation: "off" },
  }, adapterFor(tinyInput)), (error) => error.code === "noPlacement");

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
  // Without a click the first chamber in reading order gets the line (RTL: right)
  const rtl = await prepareSmartPaste({
    trigger: { source: "lasso" }, lines: [line("Droite d'abord."), line("Puis gauche.")], roleStyles: {}, settings: { distribute: true, direction: "rtl" },
  }, adapterFor({ ...doubleInput, click: null }));
  assert.strictEqual(rtl.consumed, 2);
  assert.ok(rtl.sessions[0].text.axis > rtl.sessions[1].text.axis, "RTL reading order");

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

  // A forced split (a second click in a bubble that got one line) cuts the
  // double bubbles every gate misses: clipped by the panel frame with an
  // almost flat notch; a plain oval stays whole
  const clipped = [[1029,1057], [1030,1228], [1027,1247], [972,1277], [957,1282], [941,1285], [924,1284], [905,1278], [894,1271], [873,1252], [864,1246], [852,1254], [826,1260], [825,1262], [827,1282], [824,1280], [815,1262], [798,1262], [782,1259], [768,1254], [755,1248], [744,1239], [735,1228], [728,1215], [723,1201], [722,1193], [723,1186], [732,1158], [733,1150], [730,1134], [716,1101], [714,1084], [717,1076], [736,1057]];
  const flatNotch = [[1001,1033], [1003,1174], [1001,1202], [998,1225], [993,1241], [966,1251], [951,1259], [920,1245], [908,1254], [888,1275], [879,1283], [840,1291], [846,1315], [844,1313], [835,1302], [829,1289], [785,1288], [777,1283], [738,1242], [719,1216], [719,1180], [714,1101], [711,1079], [712,1069], [714,1061], [751,1033]];
  for (const [poly, clicks, neckX] of [[clipped, [{ x: 780, y: 1150 }, { x: 950, y: 1150 }], [864, 864]], [flatNotch, [{ x: 800, y: 1150 }, { x: 960, y: 1150 }], [920, 920]]]) {
    for (const click of clicks) {
      const input = realInput(poly, click);
      assert.strictEqual(bubblePlan.buildPlan(input, {}).connected, false, "not double without the second click");
      const plan = bubblePlan.buildPlan(input, { forceSplit: true });
      assert.ok(plan.connected, "forced neck");
      assert.deepStrictEqual(plan.neck.map((p) => Math.round(p[0])).sort((a, b) => a - b), neckX);
      const chambers = connected.chambersFor(input, plan, bubblePlan.subpathsFromDescriptor(input.rawPath, 72), 3, { forceSplit: true });
      assert.strictEqual(chambers.length, 2);
      assert.ok(geometry.contains(chambers[0].cleanPolygon, click), "the clicked chamber first");
    }
  }
  const plainOval = geometry.flatten(ellipseNodes(500, 500, 160, 120));
  assert.strictEqual(bubblePlan.buildPlan(realInput(plainOval, { x: 500, y: 500 }), { forceSplit: true }).connected, false, "an oval has no neck to force");
  const forcedPair = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Toi, à gauche."), line("Et moi, à droite !")], roleStyles: {}, settings: { distribute: true, forceSplit: true },
  }, adapterFor(realInput(clipped, { x: 780, y: 1150 })));
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
  const tripleInput = { source: "wand", click: { x: 300, y: 400 }, selectionBounds: boundsOf(tripleOutline), rawPath: pathOf([polygonNodes(tripleOutline)]), fill: white };
  const triple = await prepareSmartPaste({
    trigger: { source: "wand" }, lines: [line("Un."), line("Deux."), line("Trois.")], roleStyles: {}, settings: { distribute: true },
  }, adapterFor(tripleInput));
  assert.strictEqual(triple.consumed, 3, "three chambers");
  assert.ok(triple.sessions[0].text.axis < triple.sessions[1].text.axis && triple.sessions[1].text.axis < triple.sessions[2].text.axis);

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
  assert.strictEqual(breakPointsFor("off"), null);
  assert.ok(breakPointsFor("en")("extraordinary").length > 0);
  assert.ok(breakPointsFor("fr")("malheureusement").length > 0);

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

  console.log("smart paste engine tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
