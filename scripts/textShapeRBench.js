// Offline benchmark for the TextShapeR ranking model. No real user data is
// bundled, so simulated typesetters (personas) stand in for the user: each
// persona scores a shape with a fixed private rule and always keeps its
// favourite among the proposed variants, exactly like the Learn button.
// The engine is trained on one half of a French/English dialogue corpus and
// measured on the other half (2-fold, both directions), in three contexts:
// no bubble info, aspect only, calibrated elliptic bubble.
//
// Metrics on held-out texts (all lower-is-better except acc/top1):
//   top1   oracle favourite ranked first
//   rank   mean rank of the oracle favourite in the list
//   regret oracle score of the #1 suggestion minus the best in the list
//   acc    pairwise ordering agreement between engine order and oracle
//          over every variant pair of the list (held-out pairwise accuracy)
//
// Usage: node scripts/textShapeRBench.js [module path or git ref] [--no-weights]
//   --no-weights drops the learned linear weights before evaluation, an
//   ablation that shows what the pairwise ranker contributes on its own.
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const noWeights = args.includes("--no-weights");
const shotsArg = args.find((arg) => arg.startsWith("--shots="));
const SHOTS = shotsArg ? shotsArg.slice(8).split(",").map(Number) : [1, 3, 20];
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

const shapeStats = (variant) => {
  const widths = variant.lines.map(visibleWidth);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const peak = Math.max(...widths);
  return { widths, total, peak, density: total / widths.length, count: widths.length };
};
const punctEnds = (variant) => variant.lines.slice(0, -1).filter((line) => /[.,;:!?…]$/.test(line)).length;

// Each persona: lower score = preferred
const PERSONAS = {
  tall: (variant) => {
    const s = shapeStats(variant);
    let score = Math.abs(s.density - 11) * 3 + variant.hyphenCount * 25;
    if (s.count >= 3) score += (s.widths[0] / s.peak) * 8 + (s.widths[s.count - 1] / s.peak) * 8;
    return score;
  },
  wide: (variant) => {
    const s = shapeStats(variant);
    return Math.abs(s.density - 24) * 3 - variant.hyphenCount * 4;
  },
  // Classic lozenge: edges about half the peak, peak in the middle
  diamond: (variant) => {
    const s = shapeStats(variant);
    let score = variant.hyphenCount * 30 + Math.abs(s.density - 15) * 1.5;
    const center = (s.count - 1) / 2;
    s.widths.forEach((width, index) => {
      const ideal = 1 - 0.5 * (center > 0 ? Math.abs(index - center) / center : 0);
      score += Math.abs(width / s.peak - ideal) * 12;
    });
    return score;
  },
  // Flat block: near-equal lines, likes breaking on punctuation
  block: (variant) => {
    const s = shapeStats(variant);
    let score = variant.hyphenCount * 15 + Math.abs(s.density - 17) * 1.5 - punctEnds(variant) * 6;
    s.widths.forEach((width) => { score += (1 - width / s.peak) * 10; });
    return score;
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
];
const TRAIN_A = TEXTS.filter((_, index) => index % 2 === 0);
const TRAIN_B = TEXTS.filter((_, index) => index % 2 === 1);

const ellipseRows = [];
for (let i = 0; i <= 12; i++) {
  const y = i / 12;
  const width = Math.sqrt(Math.max(0, 1 - Math.pow(2 * y - 1, 2)));
  ellipseRows.push({ y, left: 0.5 - width / 2, right: 0.5 + width / 2, width });
}
const CONTEXTS = {
  none: { limit: 12, profile: "balanced", allowHyphenation: true },
  aspect: { limit: 12, profile: "balanced", allowHyphenation: true, width: 260, height: 320 },
  bubble: { limit: 12, profile: "balanced", allowHyphenation: true, width: 340, height: 300, shapeProfile: { rows: ellipseRows }, calibration: { unitPx: 10, linePx: 34 } },
};

const pickFavourite = (variants, oracle) => {
  let best = 0;
  let bestScore = Infinity;
  variants.forEach((variant, index) => {
    const score = oracle(variant);
    if (score < bestScore - 1e-9) { bestScore = score; best = index; }
  });
  return { index: best, score: bestScore };
};

const evaluate = (tuning, texts, options, oracle) => {
  setTextShapeRTuning(tuning);
  const out = { top1: 0, rank: 0, regret: 0, acc: 0 };
  texts.forEach((text) => {
    const variants = generateTextShapeRVariants(text, options);
    const fav = pickFavourite(variants, oracle);
    const scores = variants.map(oracle);
    let agree = 0;
    let total = 0;
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        if (Math.abs(scores[i] - scores[j]) < 1e-9) continue;
        total++;
        if (scores[i] < scores[j]) agree++;
      }
    }
    out.top1 += fav.index === 0 ? 1 : 0;
    out.rank += fav.index + 1;
    out.regret += scores[0] - fav.score;
    out.acc += total ? agree / total : 1;
  });
  Object.keys(out).forEach((key) => { out[key] /= texts.length; });
  return out;
};

const train = (texts, options, oracle, shots) => {
  let tuning = null;
  for (let step = 0; step < shots; step++) {
    const text = texts[step % texts.length];
    setTextShapeRTuning(tuning || {});
    const variants = generateTextShapeRVariants(text, options);
    const fav = variants[pickFavourite(variants, oracle).index];
    const result = recordTextShapeRFeedback(fav.text, options, tuning);
    if (result) tuning = result.tuning;
  }
  if (tuning && noWeights) tuning = { ...tuning, weights: null };
  return tuning;
};

const fmt = (m) => `top1=${(m.top1 * 100).toFixed(0).padStart(3)}% rank=${m.rank.toFixed(2)} regret=${m.regret.toFixed(2).padStart(6)} acc=${(m.acc * 100).toFixed(1)}%`;
const add = (a, b) => { Object.keys(b).forEach((key) => { a[key] = (a[key] || 0) + b[key]; }); return a; };
const div = (a, n) => { const o = {}; Object.keys(a).forEach((key) => { o[key] = a[key] / n; }); return o; };

const started = Date.now();
const grand = {};
SHOTS.forEach((shots) => { grand[shots] = {}; });
const priorAll = {};
let cells = 0;
Object.keys(PERSONAS).forEach((personaName) => {
  const oracle = PERSONAS[personaName];
  Object.keys(CONTEXTS).forEach((contextName) => {
    const options = CONTEXTS[contextName];
    const prior = div(add(add({}, evaluate({}, TRAIN_B, options, oracle)), evaluate({}, TRAIN_A, options, oracle)), 2);
    add(priorAll, prior);
    let line = `${personaName.padEnd(8)}${contextName.padEnd(7)} prior ${fmt(prior)}`;
    SHOTS.forEach((shots) => {
      const m = div(add(
        add({}, evaluate(train(TRAIN_A, options, oracle, shots), TRAIN_B, options, oracle)),
        evaluate(train(TRAIN_B, options, oracle, shots), TRAIN_A, options, oracle)
      ), 2);
      add(grand[shots], m);
      if (shots === SHOTS[SHOTS.length - 1]) line += ` | ${shots}-shot ${fmt(m)}`;
    });
    cells++;
    console.log(line);
  });
});
setTextShapeRTuning(null);
console.log(`MEAN prior          ${fmt(div(priorAll, cells))}`);
SHOTS.forEach((shots) => console.log(`MEAN ${String(shots).padStart(2)}-shot trained ${fmt(div(grand[shots], cells))}`));
console.log(`(${target}${noWeights ? ", weights ablated" : ""}, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
