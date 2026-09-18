// Extended offline benchmark for the TextShapeR learning core (v2).
// Simulated typesetters (personas) stand in for real users: each one scores
// a shape with a private rule and always keeps its favourite among the
// proposed variants, like the Learn button. Compared with textShapeRBench.js
// this one adds context-dependent personas (the preference changes with the
// bubble), more texts and bubble shapes, generation recall (is the persona's
// best shape even in the list), style drift (persona switch), and timing
// with a full exemplar memory.
//
// Metrics on held-out texts:
//   top1   persona favourite ranked first (higher is better)
//   top3   persona favourite within the first three (higher is better)
//   regret persona score of suggestion #1 minus best of the list (lower)
//   recall persona best of a 400-candidate pool present in the list (higher)
//   acc    pairwise ordering agreement over the list (higher)
//
// Usage: node scripts/textShapeRBench2.js [module path or git ref] [--quick]
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const target = args.find((arg) => !arg.startsWith("--")) || "wt";

const resolveModule = () => {
  if (target === "wt") return "app_src/textShapeR.js";
  if (fs.existsSync(target)) return path.relative(rootDir, path.resolve(target));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsr-ref-"));
  fs.writeFileSync(path.join(dir, "textShapeR.js"), execSync(`git show ${target}:app_src/textShapeR.js`, { cwd: rootDir, encoding: "utf8", maxBuffer: 1 << 24 }));
  fs.copyFileSync(path.join(rootDir, "app_src/textShapeRDefaultTuning.json"), path.join(dir, "textShapeRDefaultTuning.json"));
  return path.join(dir, "textShapeR.js");
};
const load = require("./helpers/loadAppModule")();
const engine = load(resolveModule());
const { generateTextShapeRVariants, recordTextShapeRFeedback, setTextShapeRTuning, visibleWidth } = engine;
const retrain = engine.retrainTextShapeRRanker || ((t) => t);

const stats = (variant) => {
  const widths = variant.lines.map(visibleWidth);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const peak = Math.max(...widths);
  return { widths, total, peak, density: total / widths.length, count: widths.length };
};
const punctEnds = (variant) => variant.lines.slice(0, -1).filter((line) => /[.,;:!?…]$/.test(line)).length;
const lozenge = (s, depth) => {
  let score = 0;
  const center = (s.count - 1) / 2;
  s.widths.forEach((width, index) => {
    const ideal = 1 - depth * (center > 0 ? Math.abs(index - center) / center : 0);
    score += Math.abs(width / s.peak - ideal);
  });
  return score;
};
const aspectOf = (options) => (options.width && options.height ? options.height / options.width : 1);

// Each persona: (variant, options) -> score, lower = preferred
const PERSONAS = {
  tall: (v) => {
    const s = stats(v);
    let score = Math.abs(s.density - 11) * 3 + v.hyphenCount * 25;
    if (s.count >= 3) score += (s.widths[0] / s.peak) * 8 + (s.widths[s.count - 1] / s.peak) * 8;
    return score;
  },
  wide: (v) => Math.abs(stats(v).density - 24) * 3 - v.hyphenCount * 4,
  diamond: (v) => {
    const s = stats(v);
    return v.hyphenCount * 30 + Math.abs(s.density - 15) * 1.5 + lozenge(s, 0.5) * 12;
  },
  block: (v) => {
    const s = stats(v);
    let score = v.hyphenCount * 15 + Math.abs(s.density - 17) * 1.5 - punctEnds(v) * 6;
    s.widths.forEach((width) => { score += (1 - width / s.peak) * 10; });
    return score;
  },
  // Context-dependent: compact stacks in tall bubbles, long lines in wide ones
  contextual: (v, o) => {
    const s = stats(v);
    const wanted = 15 / Math.sqrt(aspectOf(o));
    return Math.abs(Math.log(s.density / wanted)) * 40 + v.hyphenCount * 20 + lozenge(s, 0.35) * 6;
  },
  // Sense-group breaker: line ends on punctuation, tolerates ragged shapes
  phrasing: (v) => {
    const s = stats(v);
    const breaks = Math.max(1, s.count - 1);
    return -(punctEnds(v) / breaks) * 30 + Math.abs(s.density - 14) * 1.2 + v.hyphenCount * 10;
  },
};

const TEXTS = [
  "Je crois que nous devrions vraiment partir avant que la nuit tombe sur la ville.",
  "Il faudra bien finir par leur dire ce qui est arrivé cette nuit-là dans la forêt.",
  "On ne peut pas rester ici toute la nuit sans savoir ce qui nous attend dehors.",
  "Tu devrais lui parler avant qu'il ne soit trop tard pour changer d'avis.",
  "Personne n'avait remarqué la porte entrouverte au fond du couloir sombre.",
  "Quand le soleil se couche derrière les collines, tout le village retient son souffle.",
  "Elle avait promis de revenir avant la fin de l'été, mais personne ne l'a revue.",
  "Attends ! Ne bouge surtout pas, il y a quelque chose derrière toi.",
  "Hein ? Tu veux dire que c'était lui depuis le début ?",
  "Je ne te laisserai jamais faire ça, même si je dois y laisser ma vie !",
  "C'est incroyable... Je n'aurais jamais imaginé le revoir ici.",
  "Arrête de pleurer. On va trouver une solution, je te le promets.",
  "Nous avons cherché partout mais la clé du grenier reste introuvable depuis hier.",
  "Si tu savais tout ce que j'ai dû abandonner pour arriver jusqu'ici ce soir.",
  "Franchement, je n'ai aucune idée de ce que tu racontes depuis tout à l'heure.",
  "Ce n'est pas le moment de flancher, pas après tout ce chemin parcouru ensemble.",
  "Merci. Sans toi, je ne serais jamais sorti vivant de cet enfer.",
  "Tu entends ce bruit ? On dirait que quelqu'un frappe à la porte.",
  "I can't believe you actually came back after everything that happened here.",
  "Wait! Don't move, there's something standing right behind you.",
  "We need to get out of here before the whole building comes crashing down.",
  "You promised me you'd never lie to me again, and yet here we are.",
  "Huh? What are you talking about? I've never seen that guy before.",
  "If we don't stop him now, nobody else will have the chance to.",
  "Listen carefully, because I'm only going to explain this once.",
  "The strongest swordsman in the world doesn't need to boast about it.",
  "Thank you... I really mean it. I couldn't have done this without you.",
  "Hey, hey! Slow down a little, I can't keep up with you like this!",
  "Nobody in this town remembers what the old lighthouse was built for.",
  "So that's how it is. Fine, then I'll just do it myself.",
  "Are you seriously telling me the train left without us?",
  "It doesn't matter how many times you fall, as long as you stand up again.",
];
const FOLD_A = TEXTS.filter((_, index) => index % 2 === 0);
const FOLD_B = TEXTS.filter((_, index) => index % 2 === 1);

const ellipse = (pointy = 1) => {
  const rows = [];
  for (let i = 0; i <= 12; i++) {
    const y = i / 12;
    const width = Math.pow(Math.max(0, 1 - Math.pow(2 * y - 1, 2)), 0.5 * pointy);
    rows.push({ y, left: 0.5 - width / 2, right: 0.5 + width / 2, width });
  }
  return { rows };
};
const CONTEXTS = {
  none: { limit: 12, profile: "balanced", allowHyphenation: true },
  tallAspect: { limit: 12, profile: "balanced", allowHyphenation: true, width: 220, height: 340 },
  wideAspect: { limit: 12, profile: "balanced", allowHyphenation: true, width: 420, height: 230 },
  roundBubble: { limit: 12, profile: "balanced", allowHyphenation: true, width: 340, height: 300, shapeProfile: ellipse(1), calibration: { unitPx: 10, linePx: 34 } },
  tallBubble: { limit: 12, profile: "balanced", allowHyphenation: true, width: 250, height: 380, shapeProfile: ellipse(1.6), calibration: { unitPx: 9, linePx: 30 } },
};

const pickFavourite = (variants, oracle, options) => {
  let best = 0;
  let bestScore = Infinity;
  variants.forEach((variant, index) => {
    const score = oracle(variant, options);
    if (score < bestScore - 1e-9) { bestScore = score; best = index; }
  });
  return { index: best, score: bestScore };
};

const poolBestCache = new Map();
const poolBest = (text, options, oracle, key) => {
  const cacheKey = `${key}|${text}`;
  if (poolBestCache.has(cacheKey)) return poolBestCache.get(cacheKey);
  setTextShapeRTuning({});
  const pool = generateTextShapeRVariants(text, { ...options, limit: 400 });
  const value = Math.min(...pool.map((variant) => oracle(variant, options)));
  poolBestCache.set(cacheKey, value);
  return value;
};

const evaluate = (tuning, texts, options, oracle, key) => {
  const out = { top1: 0, top3: 0, regret: 0, recall: 0, acc: 0 };
  texts.forEach((text) => {
    const best = poolBest(text, options, oracle, key);
    setTextShapeRTuning(tuning);
    const variants = generateTextShapeRVariants(text, options);
    const scores = variants.map((variant) => oracle(variant, options));
    const fav = pickFavourite(variants, oracle, options);
    let agree = 0;
    let total = 0;
    for (let i = 0; i < scores.length; i++) {
      for (let j = i + 1; j < scores.length; j++) {
        if (Math.abs(scores[i] - scores[j]) < 1e-9) continue;
        total++;
        if (scores[i] < scores[j]) agree++;
      }
    }
    out.top1 += fav.index === 0 ? 1 : 0;
    out.top3 += fav.index < 3 ? 1 : 0;
    out.regret += scores[0] - Math.min(best, fav.score);
    out.recall += fav.score <= best + 1e-9 ? 1 : 0;
    out.acc += total ? agree / total : 1;
  });
  Object.keys(out).forEach((k) => { out[k] /= texts.length; });
  return out;
};

const train = (tuning, texts, options, oracle, shots) => {
  for (let step = 0; step < shots; step++) {
    const text = texts[step % texts.length];
    setTextShapeRTuning(tuning || {});
    const variants = generateTextShapeRVariants(text, options);
    const fav = variants[pickFavourite(variants, oracle, options).index];
    const result = recordTextShapeRFeedback(fav.text, options, tuning);
    if (result) tuning = result.tuning;
  }
  return tuning;
};

const add = (a, b) => { Object.keys(b).forEach((k) => { a[k] = (a[k] || 0) + b[k]; }); return a; };
const div = (a, n) => { const o = {}; Object.keys(a).forEach((k) => { o[k] = a[k] / n; }); return o; };
const fmt = (m) => `top1=${(m.top1 * 100).toFixed(0).padStart(3)}% top3=${(m.top3 * 100).toFixed(0).padStart(3)}% regret=${m.regret.toFixed(2).padStart(6)} recall=${(m.recall * 100).toFixed(0).padStart(3)}% acc=${(m.acc * 100).toFixed(1)}%`;

const started = Date.now();
const SHOTS = quick ? [3, 16] : [1, 3, 8, 16];
const contextNames = quick ? ["none", "tallAspect", "roundBubble"] : Object.keys(CONTEXTS);
const personaNames = Object.keys(PERSONAS);
const grand = {};
const prior = {};
let cells = 0;
personaNames.forEach((personaName) => {
  const oracle = PERSONAS[personaName];
  const row = {};
  contextNames.forEach((contextName) => {
    const options = CONTEXTS[contextName];
    const key = `${personaName}|${contextName}`;
    add(prior, div(add(evaluate({}, FOLD_B, options, oracle, key), evaluate({}, FOLD_A, options, oracle, key)), 2));
    SHOTS.forEach((shots) => {
      const m = div(add(
        evaluate(train(null, FOLD_A, options, oracle, shots), FOLD_B, options, oracle, key),
        evaluate(train(null, FOLD_B, options, oracle, shots), FOLD_A, options, oracle, key)
      ), 2);
      grand[shots] = add(grand[shots] || {}, m);
      if (shots === SHOTS[SHOTS.length - 1]) add(row, m);
    });
    cells++;
  });
  console.log(`${personaName.padEnd(11)} ${SHOTS[SHOTS.length - 1]}-shot ${fmt(div(row, contextNames.length))}`);
});

// Mixed-context learning: one user, all bubble kinds interleaved. The
// contextual persona only scores well if the memory conditions on context.
const mixed = {};
let mixedCells = 0;
["contextual", "diamond", "block"].forEach((personaName) => {
  const oracle = PERSONAS[personaName];
  [[FOLD_A, FOLD_B], [FOLD_B, FOLD_A]].forEach(([trainTexts, testTexts]) => {
    let tuning = null;
    for (let step = 0; step < (quick ? 16 : 30); step++) {
      const options = CONTEXTS[contextNames[step % contextNames.length]];
      tuning = train(tuning, [trainTexts[step % trainTexts.length]], options, oracle, 1);
    }
    contextNames.forEach((contextName) => {
      add(mixed, evaluate(tuning, testTexts, CONTEXTS[contextName], oracle, `${personaName}|${contextName}`));
      mixedCells++;
    });
  });
});

// Style drift: 16 lessons with one persona, then N lessons with another;
// measured on the second persona. Four switches are averaged because a
// single switch is too noisy to rank engines
const DRIFT_SWITCHES = [["wide", "tall"], ["tall", "wide"], ["diamond", "block"], ["block", "diamond"]];
const drift = {};
[4, 12].forEach((after) => {
  const options = CONTEXTS.none;
  const acc = {};
  let runs = 0;
  DRIFT_SWITCHES.forEach(([from, to]) => {
    [[FOLD_A, FOLD_B], [FOLD_B, FOLD_A]].forEach(([trainTexts, testTexts]) => {
      let tuning = train(null, trainTexts, options, PERSONAS[from], 16);
      tuning = train(tuning, trainTexts.slice(3).concat(trainTexts.slice(0, 3)), options, PERSONAS[to], after);
      add(acc, evaluate(tuning, testTexts, options, PERSONAS[to], `${to}|none`));
      runs++;
    });
  });
  drift[after] = div(acc, runs);
});

// Timing: cold generation (tuning revision bump defeats the cache) with an
// empty memory and with a full memory of 300 exemplars / 800 pairs
const timeGeneration = (tuning) => {
  const samples = [];
  for (let round = 0; round < 3; round++) {
    TEXTS.forEach((text, index) => {
      setTextShapeRTuning(tuning);
      const options = CONTEXTS[Object.keys(CONTEXTS)[index % 5]];
      const t0 = process.hrtime.bigint();
      generateTextShapeRVariants(text, options);
      samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    });
  }
  samples.sort((a, b) => a - b);
  return { median: samples[Math.floor(samples.length / 2)], p95: samples[Math.floor(samples.length * 0.95)] };
};
let full = null;
for (let step = 0; step < (quick ? 60 : 300); step++) {
  const options = { ...CONTEXTS[Object.keys(CONTEXTS)[step % 5]], deferRanker: true };
  const text = TEXTS[step % TEXTS.length] + (step >= TEXTS.length ? ` (${step})` : "");
  setTextShapeRTuning(full || {});
  const variants = generateTextShapeRVariants(text, options);
  const result = recordTextShapeRFeedback(variants[pickFavourite(variants, PERSONAS.diamond, options).index].text, options, full);
  if (result) full = result.tuning;
}
const tRetrain0 = Date.now();
full = retrain(full);
const retrainMs = Date.now() - tRetrain0;
const tFeedback0 = process.hrtime.bigint();
setTextShapeRTuning(full);
recordTextShapeRFeedback(generateTextShapeRVariants(TEXTS[0], CONTEXTS.roundBubble)[0].text, CONTEXTS.roundBubble, full);
const feedbackMs = Number(process.hrtime.bigint() - tFeedback0) / 1e6;
const emptyTiming = timeGeneration({});
const fullTiming = timeGeneration(full);
setTextShapeRTuning(null);

console.log("");
console.log(`MEAN prior            ${fmt(div(prior, cells))}`);
SHOTS.forEach((shots) => console.log(`MEAN ${String(shots).padStart(2)}-shot          ${fmt(div(grand[shots], cells))}`));
console.log(`MIXED contexts        ${fmt(div(mixed, mixedCells))}`);
Object.keys(drift).forEach((after) => console.log(`DRIFT switch +${String(after).padStart(2)}     ${fmt(drift[after])}`));
console.log(`TIMING generate empty median=${emptyTiming.median.toFixed(1)}ms p95=${emptyTiming.p95.toFixed(1)}ms | full memory median=${fullTiming.median.toFixed(1)}ms p95=${fullTiming.p95.toFixed(1)}ms | feedback=${feedbackMs.toFixed(0)}ms retrain=${retrainMs}ms`);
console.log(`(${target}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
