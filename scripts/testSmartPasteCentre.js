// Smart paste and Align agree: the centre of a pasted text's ink box sits on
// the point Align centres it on (app_src/oneClick/alignPlan.js for a chamber,
// the opened selection of host.js for a single bubble), every line inside the
// outline there. Synthetic bubbles, a simulated measurement whose ink is not
// centred on its line (side bearings, "?" and "…" at the end). No Photoshop.
const assert = require("assert");
const load = require("./helpers/loadAppModule")();

const geometry = load("app_src/oneClick/geometry.js");
const bubblePlan = load("app_src/oneClick/bubblePlan.js");
const { prepareSmartPaste } = load("app_src/oneClick/smartPaste.js");
const { planAlignment } = load("app_src/oneClick/alignPlan.js");
const { clearMetricCache } = load("app_src/oneClick/measureSpec.js");

const px = (value) => ({ _unit: "pixelsUnit", _value: value });
const point = (xy) => ({ horizontal: px(xy[0]), vertical: px(xy[1]) });
const pathOf = (poly) => ({
  pathContents: { pathComponents: [{ subpathListKey: [{ closedSubpath: true, points: poly.map((p) => ({ anchor: point(p), forward: point(p), backward: point(p) })) }] }] },
});
const ellipse = (cx, cy, rx, ry, n = 240) => {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([cx + rx * Math.cos((i / n) * Math.PI * 2), cy + ry * Math.sin((i / n) * Math.PI * 2)]);
  return pts;
};
// Union outline of circles in a row (double, triple)
const circles = (centres, r) => {
  const inside = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < r * r - 1e-6;
  const pts = [];
  for (const c of centres) {
    for (let i = 0; i < 180; i++) {
      const t = (i / 180) * Math.PI * 2;
      const p = [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
      if (!centres.some((o) => o !== c && inside(p, o))) pts.push(p);
    }
  }
  const y = centres[0][1];
  return pts.filter((p) => p[1] <= y).sort((a, b) => a[0] - b[0]).concat(pts.filter((p) => p[1] > y).sort((a, b) => b[0] - a[0]));
};
// An oval with a tail pointing down and to the right
const tailed = () => {
  const oval = ellipse(400, 300, 170, 120, 200).filter((p) => !(p[0] > 440 && p[0] < 470 && p[1] > 380));
  const tip = [[470, 414], [540, 520], [440, 418]];
  const all = oval.concat(tip);
  return all.sort((p, q) => Math.atan2(p[1] - 300, p[0] - 400) - Math.atan2(q[1] - 300, q[0] - 400));
};
const boundsOf = (poly) => {
  const b = geometry.box(poly);
  return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) };
};

// Simulated Photoshop: the advance of a line is centred on the paragraph's
// axis, its ink is not (bearings at both ends, punctuation is narrow ink)
const CHAR = (ch) => (ch === " " ? 0.3 : /[.,;:!'’]/.test(ch) ? 0.25 : ch === "…" ? 0.8 : /[A-Z]/.test(ch) ? 0.68 : 0.55);
const BEARING = (ch) => (/[.,…]/.test(ch) ? 0.12 : /[?!]/.test(ch) ? 0.06 : 0.03);
const ink = (row, sizePx) => {
  const chars = row.split("");
  const w = chars.reduce((sum, ch) => sum + CHAR(ch), 0) * sizePx;
  return { left: -w / 2 + BEARING(chars[0]) * sizePx, right: w / 2 - BEARING(chars[chars.length - 1]) * sizePx, top: -0.72 * sizePx, bottom: (/[gjpqyç,]/.test(row) ? 0.22 : 0.06) * sizePx };
};
const page = { width: 1200, height: 1700, resolution: 72 };
const measure = async (requests) => requests.map((request) => {
  const lt = request.params.layerText;
  const sizePx = lt.textStyleRange[0].textStyle.size;
  const rows = lt.textKey.split("\r").filter((row, index, all) => index < all.length - 1);
  const at = (row, i) => {
    const b = ink(row, sizePx);
    const cx = page.width / 2;
    const cy = page.height / 2 + i * 256;
    return { left: cx + b.left, right: cx + b.right, top: cy + b.top, bottom: cy + b.bottom };
  };
  if (request.kind === "atlas") {
    return { metrics: rows.map((row, i) => {
      const b = at(row, i);
      const cy = page.height / 2 + i * 256;
      return { left: (b.left - page.width / 2 - 1) / 64, right: (b.right - page.width / 2 + 1) / 64, top: (b.top - cy - 1) / 64, bottom: (b.bottom - cy + 1) / 64 };
    }) };
  }
  return { bounds: at(rows[0], 0) };
});
const style = (size) => ({
  id: "s",
  textProps: {
    layerText: {
      textGridding: "none", orientation: "horizontal", antiAlias: "antiAliasSmooth",
      textStyleRange: [{ from: 0, to: 100, textStyle: { fontPostScriptName: "A", fontName: "A", fontStyleName: "Regular", size, autoLeading: true, color: { red: 0, green: 0, blue: 0 } } }],
      paragraphStyleRange: [{ from: 0, to: 100, paragraphStyle: { alignment: "center", autoLeadingPercentage: 1.2 } }],
    },
    typeUnit: "pixelsUnit",
  },
});
const white = { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };

// The ink box Photoshop would draw for a session (the simulated measurement,
// one pixel of margin around each line as metricFromBounds keeps)
const inkBox = (session) => {
  const lt = session.text.params.layerText;
  const size = session.text.size;
  const axis = (lt.textClickPoint.horizontal / 100) * page.width;
  let baseline = (lt.textClickPoint.vertical / 100) * page.height;
  const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, lines: [] };
  for (const row of lt.textKey.split("\r")) {
    const b = ink(row, size);
    const line = { left: axis + b.left - 1, right: axis + b.right + 1, top: baseline + b.top - 1, bottom: baseline + b.bottom + 1 };
    box.lines.push(line);
    box.left = Math.min(box.left, line.left);
    box.right = Math.max(box.right, line.right);
    box.top = Math.min(box.top, line.top);
    box.bottom = Math.max(box.bottom, line.bottom);
    baseline += size * 1.2;
  }
  return box;
};
const centreOf = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
const inside = (session, box) => box.lines.forEach((line) => {
  for (const x of [line.left, line.right]) for (const y of [line.top, line.bottom]) {
    assert.ok(geometry.contains(session.plan.cleanPolygon, { x, y }), "a line leaves the outline at " + x.toFixed(1) + "," + y.toFixed(1));
  }
});

const paste = async (poly, click, texts, settings = {}) => {
  clearMetricCache();
  const input = { source: "wand", click, selectionBounds: boundsOf(poly), rawPath: pathOf(poly), fill: white };
  const result = await prepareSmartPaste({
    trigger: { source: "wand", x: click.x, y: click.y },
    lines: texts.map((text) => ({ text, richTextRuns: null, style: style(24), styleLocked: false })),
    roleStyles: {},
    settings: { distribute: true, hyphenation: "fr", minScale: 0.75, padding: 8, ...settings },
  }, { capture: async () => ({ ...page, documentId: 7, ...input }), measure, useAtlas: true });
  return { result, input };
};

// Align's plan for the pasted texts, read on the same outline
const alignOf = (poly, result) => {
  const texts = result.sessions.map((session, i) => {
    const b = inkBox(session);
    return { id: i + 1, index: i, box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } };
  });
  return planAlignment({ ...page, documentId: 7, texts, bubbles: [{ selectionBounds: boundsOf(poly), rawPath: pathOf(poly), textIds: texts.map((t) => t.id) }] }, "rtl");
};

const near = (a, b, label, tolerance = 0.05) => {
  assert.ok(Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance,
    label + ": (" + a.x.toFixed(2) + ", " + a.y.toFixed(2) + ") vs (" + b.x.toFixed(2) + ", " + b.y.toFixed(2) + ")");
};

(async () => {
  // The centre of a bubble (bodyCentre): an oval's own centre, with or without
  // a tail, whatever the tail's side
  {
    const oval = ellipse(400, 300, 170, 120);
    near(geometry.bodyCentre(oval), { x: 400, y: 300 }, "an oval is centred on its own centre", 0.01);
    near(geometry.bodyCentre(tailed()), { x: 400, y: 300 }, "a tail does not move the centre", 0.75);
    const mirrored = tailed().map((p) => [800 - p[0], p[1]]).reverse();
    near(geometry.bodyCentre(mirrored), { x: 400, y: 300 }, "on the other side either", 0.75);
    // The centre of the box, which follows the tail, is far from it
    const b = geometry.box(tailed());
    assert.ok(Math.hypot((b.left + b.right) / 2 - 400, (b.top + b.bottom) / 2 - 300) > 30, "the box follows the tail");
    // A thick tail the opening cannot cut whole moves it by a few pixels only
    const thick = ellipse(400, 300, 170, 120, 200).filter((p) => !(p[0] > 400 && p[0] < 500 && p[1] > 380)).concat([[500, 400], [560, 540], [400, 420]])
      .sort((p, q) => Math.atan2(p[1] - 300, p[0] - 400) - Math.atan2(q[1] - 300, q[0] - 400));
    const moved = geometry.bodyCentre(thick);
    assert.ok(Math.hypot(moved.x - 400, moved.y - 300) < 8, "a thick tail: " + moved.x.toFixed(1) + ", " + moved.y.toFixed(1));
    // A bump on the top right widens the box by its whole length; the centre
    // of mass moves by its share of the area only
    const bumped = ellipse(400, 300, 170, 120).map((p) => {
      const angle = Math.atan2(p[1] - 300, p[0] - 400);
      const k = angle > -0.8 && angle < -0.4 ? 1.5 : 1;
      return [400 + (p[0] - 400) * k, 300 + (p[1] - 300) * k];
    });
    const bumpCentre = geometry.bodyCentre(bumped);
    const bumpBox = geometry.box(bumped);
    assert.ok((bumpBox.left + bumpBox.right) / 2 > 420, "the bump widens the box: " + (bumpBox.left + bumpBox.right) / 2);
    assert.ok(Math.abs(bumpCentre.x - 400) < 6 && Math.abs(bumpCentre.y - 300) < 6, "and hardly moves the centre: " + bumpCentre.x.toFixed(1));
    // A chamber: a lobe whose corner the neck cut off (two bubbles set
    // diagonally). Its box is still the lobe's, its centroid is pushed away
    // from the neck: the centre is halfway back to the box's
    const cut = ellipse(400, 300, 150, 150, 360).filter((p) => p[0] - 400 + (p[1] - 300) <= 150);
    const chamber = geometry.bodyCentre(cut, true);
    const body = geometry.bodyBounds(cut, geometry.box(cut));
    assert.ok(body.xMid < 397 && body.yMid < 297, "the cut pushes the centroid away from the neck: " + body.xMid.toFixed(1) + ", " + body.yMid.toFixed(1));
    assert.ok(Math.hypot(chamber.x - 400, chamber.y - 300) < Math.hypot(body.xMid - 400, body.yMid - 300) * 0.75,
      "a chamber's centre is nearer the lobe's own: " + chamber.x.toFixed(1) + ", " + chamber.y.toFixed(1));
    assert.ok(chamber.x < 400 && chamber.y < 300, "without passing it");
    // An outline traced on pixels (whole coordinates, as TypeR Studio's): scan
    // lines that pass right on its vertices still fill their rows
    const stairs = [];
    for (let y = 608; y < 800; y++) { const half = Math.round(92 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 704) / 96) ** 2))); stairs.push([876 - half, y], [876 - half, y + 1]); }
    for (let y = 799; y >= 608; y--) { const half = Math.round(92 * Math.sqrt(Math.max(0, 1 - ((y + 0.5 - 704) / 96) ** 2))); stairs.push([876 + half, y + 1], [876 + half, y]); }
    near(geometry.bodyCentre(stairs), { x: 876, y: 704 }, "a pixel outline is centred on its centre", 0.3);
    near(geometry.bodyCentre(stairs.map((p) => [p[0] * 1.7, p[1] * 1.7])), { x: 876 * 1.7, y: 704 * 1.7 }, "at any scale", 0.5);
    // Nothing to centre in
    assert.strictEqual(geometry.bodyCentre([[0, 0], [10, 0]]), null);
    assert.strictEqual(geometry.bodyCentre(null), null);
  }

  // Single bubbles: the ink box on the bubble's centre, the one Align's plan
  // gives for that text, asymmetric lines too
  for (const [label, poly, click, texts] of [
    ["oval", ellipse(400, 300, 170, 120), { x: 400, y: 300 }, ["Je ne pensais vraiment pas te revoir ici, après tout ce temps."]],
    ["oval, a question", ellipse(400, 300, 170, 120), { x: 400, y: 300 }, ["Ça fait longtemps, non ?"]],
    ["oval, a pause", ellipse(400, 300, 150, 110), { x: 400, y: 300 }, ["Attends… tu es sérieux…"]],
    ["oval with a tail", tailed(), { x: 400, y: 280 }, ["Tu devrais faire attention, tu sais."]],
  ]) {
    const { result, input } = await paste(poly, click, texts);
    const session = result.sessions[0];
    const plan = bubblePlan.buildPlan({ ...page, documentId: 7, ...input }, {});
    near(session.text.target, geometry.bodyCentre(plan.outline), label + ": the target is the bubble's centre", 1e-9);
    const box = inkBox(session);
    near(centreOf(box), session.text.target, label + ": the ink box is centred on it");
    const placements = alignOf(poly, result);
    assert.strictEqual(placements.length, 1, label + ": Align plans the single bubble");
    near({ x: placements[0].rect.xMid, y: placements[0].rect.yMid }, session.text.target, label + ": Align would not move it", 1e-9);
    inside(session, box);
  }

  // Double and triple bubbles: each ink box on its chamber's centre, the one
  // Align's plan gives for that text
  for (const [label, poly, click, texts] of [
    ["double", circles([[400, 500], [640, 500]], 160), { x: 330, y: 500 }, ["Toi, à gauche ?", "Et moi… à droite !"]],
    ["triple", circles([[300, 400], [540, 400], [780, 400]], 150), { x: 780, y: 400 }, ["Un.", "Deux ?", "Trois…"]],
  ]) {
    const { result } = await paste(poly, click, texts);
    assert.strictEqual(result.consumed, texts.length, label + ": every chamber takes a line");
    const placements = alignOf(poly, result);
    assert.strictEqual(placements.length, texts.length, label + ": Align finds the same chambers");
    result.sessions.forEach((session, i) => {
      const box = inkBox(session);
      near(session.text.target, { x: session.plan.selection.xMid, y: session.plan.selection.yMid }, label + " " + i + ": the target is the chamber's centre", 1e-9);
      near(centreOf(box), session.text.target, label + " " + i + ": the ink box is centred on it");
      const rect = placements.find((p) => p.id === i + 1).rect;
      near({ x: rect.xMid, y: rect.yMid }, session.text.target, label + " " + i + ": Align would not move it");
      inside(session, box);
    });
  }

  // A text too long for the bubble still overflows on the same centre
  {
    const small = ellipse(300, 300, 45, 35);
    const { result } = await paste(small, { x: 300, y: 300 }, ["Une phrase beaucoup trop longue pour une si petite bulle de rien du tout."], { hyphenation: "off" });
    near(centreOf(inkBox(result.sessions[0])), result.sessions[0].text.target, "overflow: centred");
  }

  console.log("smart paste centring: ink box on Align's centre (oval, tail, asymmetric lines, double, triple, overflow) passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
