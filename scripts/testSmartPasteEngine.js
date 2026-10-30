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

  // Rectangle: a narration box
  const rect = { left: 100, top: 100, right: 500, bottom: 260 };
  const narration = style("narration", 22, "Caption");
  const box = await prepareSmartPaste({
    trigger: { source: "rectangle" }, lines: [line("Pendant ce temps, à l'autre bout de la ville...")], roleStyles: { narration }, settings: {},
  }, adapterFor({ source: "rectangle", click: null, selectionBounds: rect, rawPath: null, fill: white }));
  assert.strictEqual(box.sessions[0].plan.kind, "narration");
  assert.strictEqual(box.sessions[0].role, "narration");
  linesInside(box.sessions[0]);

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
