// Smart paste engine bench, as the CEP panel runs it: how many measurement
// round trips, native requests (atlas / single line) and solver searches a
// paste costs on synthetic bubbles, and the JS time of the engine itself.
// No Photoshop involved: the native measurement is simulated. Every
// ExtendScript round trip is the expensive part of the Legacy panel, so the
// counts matter more than the milliseconds.
//
//   node scripts/benchSmartPasteCep.js [--json out.json] [--runs 3]
const fs = require("fs");
const path = require("path");
const load = require("./helpers/loadAppModule")();

const geometry = load("app_src/oneClick/geometry.js");
const solverModule = load("app_src/oneClick/solver.js");
const { clearMetricCache } = load("app_src/oneClick/measureSpec.js");
const { prepareSmartPaste } = load("app_src/oneClick/smartPaste.js");

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const RUNS = parseInt(argValue("--runs", "3"), 10);
const JSON_OUT = argValue("--json", null);
// --uxp: the UXP host's measurement (exhaustive, batched); default: the
// Legacy panel's lean measurement
const LEAN = args.indexOf("--uxp") === -1;

/* ---------------- fixtures (as scripts/testSmartPasteEngine.js) ---------------- */

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
const polygonNodes = (poly) => poly.map((p) => [p, p, p]);
const ellipseNodes = (cx, cy, rx, ry) => {
  const k = 0.5522847498;
  return [
    [[cx + rx, cy], [cx + rx, cy + ry * k], [cx + rx, cy - ry * k]],
    [[cx, cy + ry], [cx - rx * k, cy + ry], [cx + rx * k, cy + ry]],
    [[cx - rx, cy], [cx - rx, cy - ry * k], [cx - rx, cy + ry * k]],
    [[cx, cy - ry], [cx + rx * k, cy - ry], [cx - rx * k, cy - ry]],
  ];
};
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
// Deterministic pseudo-random jitter (a wand outline is never a clean star)
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const star = (cx, cy, outer, inner, spikes, jitter = 0, seed = 1) => {
  const rand = lcg(seed);
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = (i % 2 ? inner : outer) * (1 + (rand() - 0.5) * jitter);
    const t = (i / (spikes * 2)) * Math.PI * 2 + (rand() - 0.5) * jitter * 0.1;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
};
// A wand outline of a round bubble read at 2 px tolerance: hundreds of nodes
const noisyCircle = (cx, cy, r, nodes, seed = 2) => {
  const rand = lcg(seed);
  const pts = [];
  for (let i = 0; i < nodes; i++) {
    const t = (i / nodes) * Math.PI * 2;
    const rr = r + (rand() - 0.5) * 2;
    pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
  }
  return pts;
};
const boundsOf = (poly) => {
  const b = geometry.box(poly);
  return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) };
};

const CHAR = (ch) => (ch === " " ? 0.3 : /[.,;:!'’]/.test(ch) ? 0.25 : /[A-Z]/.test(ch) ? 0.68 : 0.55);
const page = { width: 1200, height: 1700, resolution: 72 };
const white = { fill: 255, rgb: { red: 255, green: 255, blue: 255 } };

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
const line = (text, s = style("regular", 24)) => ({ text, richTextRuns: null, style: s, styleLocked: false });

const wandInput = (poly, click, nodes) => ({
  source: "wand", click, selectionBounds: boundsOf(poly), rawPath: pathOf([nodes || polygonNodes(poly)]), fill: white,
});

const oval = ellipseNodes(600, 500, 260, 190);
const small = ellipseNodes(300, 300, 95, 70);
const tiny = ellipseNodes(300, 300, 45, 35);
const spiky = star(600, 600, 300, 210, 14);
const roughShout = star(600, 600, 290, 200, 36, 0.25, 7);
const noisy = noisyCircle(600, 500, 230, 600);
const double = peanut([400, 500], [640, 500], 160);

const CASES = [
  { id: "oval-fits", note: "oval, long line, fits at the style size", input: wandInput(geometry.flatten(oval), { x: 600, y: 500 }, oval),
    lines: [line("Je ne pensais vraiment pas te revoir ici, après tout ce temps passé loin de la ville.")], settings: { distribute: true, hyphenation: "fr", minScale: 0.75 } },
  { id: "small-shrinks", note: "small bubble, the text shrinks (range tier)", input: wandInput(geometry.flatten(small), { x: 300, y: 300 }, small),
    lines: [line("Attends-moi devant la porte du magasin.")], settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "tiny-fails", note: "tiny bubble, nothing fits: the classic paste follows", input: wandInput(geometry.flatten(tiny), { x: 300, y: 300 }, tiny),
    lines: [line("Une phrase beaucoup trop longue pour une si petite bulle de rien du tout.")], settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "shout-short", note: "clean shout (14 spikes), short loud line at 30", input: wandInput(spiky, { x: 600, y: 600 }),
    lines: [line("Arrête !")], roleStyles: { shout: style("shout", 30, "BadaBoom") }, settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "shout-rough-long", note: "rough shout (36 spikes, jitter), long loud line at 40", input: wandInput(roughShout, { x: 600, y: 600 }),
    lines: [line("QU'EST-CE QUE TU FAIS ENCORE ICI, TOI ?!")], roleStyles: { shout: style("shout", 40, "BadaBoom") }, settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "shout-rough-fails", note: "rough shout, far too much text at 48: the ladder runs to the classic paste", input: wandInput(roughShout, { x: 600, y: 600 }),
    lines: [line("QU'EST-CE QUE TU FAIS ENCORE ICI, TOI ?! JE T'AVAIS DIT DE NE JAMAIS REVENIR DANS CETTE MAISON !")], roleStyles: { shout: style("shout", 48, "BadaBoom") }, settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "noisy-fails", note: "600-node outline, too much text at 30: the ladder runs", input: wandInput(noisy, { x: 600, y: 500 }),
    lines: [line("Tu devrais vraiment rentrer avant qu'il ne fasse nuit, crois-moi, parce que personne ne viendra te chercher dans cette forêt si tu te perds encore une fois.", style("regular", 30))], settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "noisy-600-nodes", note: "round wand outline with 600 nodes, medium line at 26", input: wandInput(noisy, { x: 600, y: 500 }),
    lines: [line("Tu devrais vraiment rentrer avant qu'il ne fasse nuit, crois-moi.", style("regular", 26))], settings: { hyphenation: "fr", minScale: 0.75 } },
  { id: "double-two-lines", note: "double bubble, two lines distributed", input: wandInput(double, { x: 330, y: 500 }),
    lines: [line("Toi, à gauche."), line("Et moi, à droite !")], settings: { distribute: true, hyphenation: "fr" } },
  { id: "min-100-no-shrink", note: "small bubble, minimum size 100%: never shrink", input: wandInput(geometry.flatten(small), { x: 300, y: 300 }, small),
    lines: [line("Attends-moi devant la porte du magasin.")], settings: { hyphenation: "fr", minScale: 1 } },
];

/* ---------------- simulated host, counting ---------------- */

const makeMeasure = (stats) => async (requests) => {
  stats.rounds++;
  stats.requests += requests.length;
  return requests.map((request) => {
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
      stats.atlases++;
      stats.atlasLines += rows.length;
      return { metrics: rows.map((row, i) => {
        const b = rowMetric(row, i);
        return { left: (b.left - page.width / 2 - 1) / 64, right: (b.right - page.width / 2 + 1) / 64, top: (b.top - (page.height / 2 + i * 256) - 1) / 64, bottom: (b.bottom - (page.height / 2 + i * 256) + 1) / 64 };
      }) };
    }
    stats.singles++;
    return { bounds: rowMetric(rows[0], 0) };
  });
};

const solveStats = { calls: 0, ms: 0 };
const originalSolve = solverModule.solve;
solverModule.solve = (batch) => {
  const began = process.hrtime.bigint();
  const out = originalSolve(batch);
  solveStats.calls++;
  solveStats.ms += Number(process.hrtime.bigint() - began) / 1e6;
  return out;
};

const runCase = async (entry) => {
  const stats = { rounds: 0, requests: 0, atlases: 0, atlasLines: 0, singles: 0 };
  solveStats.calls = 0;
  solveStats.ms = 0;
  clearMetricCache();
  const adapter = { capture: async () => ({ ...page, documentId: 7, ...entry.input }), measure: makeMeasure(stats), useAtlas: true, leanMeasure: LEAN };
  const began = process.hrtime.bigint();
  let outcome;
  try {
    const result = await prepareSmartPaste({ trigger: { source: "wand", x: entry.input.click.x, y: entry.input.click.y }, lines: entry.lines, roleStyles: entry.roleStyles || {}, settings: entry.settings }, adapter);
    outcome = { ok: true, size: Math.round(result.sessions[0].text.size * 100) / 100, tier: result.sessions[0].text.tier, lines: result.sessions.map((s) => s.text.params.layerText.textKey.split("\r").length - 1), consumed: result.consumed };
  } catch (error) {
    outcome = { ok: false, code: error.code || String(error.message) };
  }
  const ms = Number(process.hrtime.bigint() - began) / 1e6;
  return { ...stats, solves: solveStats.calls, solveMs: Math.round(solveStats.ms), ms: Math.round(ms), outcome };
};

(async () => {
  const report = [];
  for (const entry of CASES) {
    let best = null;
    for (let run = 0; run < RUNS; run++) {
      const sample = await runCase(entry);
      if (!best || sample.ms < best.ms) best = sample;
    }
    report.push({ id: entry.id, note: entry.note, ...best });
  }
  const pad = (value, width) => String(value).padStart(width);
  console.log("mode: " + (LEAN ? "lean (Legacy CEP panel)" : "exhaustive (UXP host)") + ", best of " + RUNS);
  console.log(["case".padEnd(20), pad("rounds", 6), pad("reqs", 5), pad("atlas", 5), pad("a.lines", 7), pad("single", 6), pad("solves", 6), pad("solveMs", 7), pad("ms", 6), "  outcome"].join(" "));
  for (const row of report) {
    console.log([row.id.padEnd(20), pad(row.rounds, 6), pad(row.requests, 5), pad(row.atlases, 5), pad(row.atlasLines, 7), pad(row.singles, 6), pad(row.solves, 6), pad(row.solveMs, 7), pad(row.ms, 6), "  " + JSON.stringify(row.outcome)].join(" "));
  }
  const totals = report.reduce((sum, row) => ({ rounds: sum.rounds + row.rounds, requests: sum.requests + row.requests, solves: sum.solves + row.solves, ms: sum.ms + row.ms }), { rounds: 0, requests: 0, solves: 0, ms: 0 });
  console.log("total".padEnd(20), pad(totals.rounds, 6), pad(totals.requests, 5), "".padStart(27), pad(totals.solves, 6), "".padStart(8), pad(totals.ms, 6));
  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ node: process.version, runs: RUNS, lean: LEAN, cases: report, totals }, null, 2));
    console.log("written " + JSON_OUT);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
