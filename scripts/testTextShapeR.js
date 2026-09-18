const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");
const moduleCache = {};

const loadAppModule = (relativePath) => {
  const filePath = path.resolve(rootDir, relativePath);
  if (moduleCache[filePath]) return moduleCache[filePath].exports;

  const source = fs.readFileSync(filePath, "utf8");
  const { code } = babel.transformSync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    plugins: [
      "@babel/plugin-transform-modules-commonjs",
      "@babel/plugin-proposal-optional-chaining",
      "@babel/plugin-proposal-class-properties",
    ],
  });

  const mod = new Module(filePath, module);
  moduleCache[filePath] = mod;
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(code, filePath);
  return mod.exports;
};

const {
  estimateManualLineCount,
  generateManualTextShapeRVariant,
  generateTextShapeRVariants,
  recordTextShapeRFeedback,
  retrainTextShapeRRanker,
  sanitizeTextShapeRTuning,
  setTextShapeRTuning,
  visibleLength,
  visibleWidth,
} = loadAppModule("app_src/textShapeR.js");

const shippedDefaultTuning = require("../app_src/textShapeRDefaultTuning.json");
assert.strictEqual(shippedDefaultTuning.samples, 178);
assert.ok(shippedDefaultTuning.style && shippedDefaultTuning.weights,
  "the shipped default must contain the trained global style and ranker");
assert.ok(!shippedDefaultTuning.exemplars && !shippedDefaultTuning.pairs,
  "language-specific examples and replay data must not ship as global defaults");
const defaultProbeText = "Je crois que nous devrions vraiment partir avant que la nuit tombe sur la ville.";
const shippedDefaultTop = generateTextShapeRVariants(defaultProbeText, { limit: 12, profile: "balanced" })[0];
setTextShapeRTuning({});
const neutralProbeTop = generateTextShapeRVariants(defaultProbeText, { limit: 12, profile: "balanced" })[0];
assert.notStrictEqual(shippedDefaultTop.text, neutralProbeTop.text,
  "the shipped trained profile must affect default ranking");

const variants = generateTextShapeRVariants("This sentence needs a pleasant bubble shaped manga layout today.");
// Default cap is MAX_VARIANTS (12); the exact count depends on how many
// unique candidates the sentence yields, so only bound it
assert.ok(variants.length > 0 && variants.length <= 12);
assert.strictEqual(new Set(variants.map((variant) => variant.text)).size, variants.length);
assert.ok(variants[0].lines.length >= 2);

const bestLengths = variants[0].lines.map(visibleLength);
const middleIndex = Math.floor((bestLengths.length - 1) / 2);
const middleLength = bestLengths[middleIndex];
if (bestLengths.length > 2) {
  assert.ok(middleLength >= bestLengths[0]);
  assert.ok(middleLength >= bestLengths[bestLengths.length - 1]);
} else {
  assert.ok(Math.abs(bestLengths[0] - bestLengths[1]) <= 6);
}

const hyphenated = generateTextShapeRVariants("extraordinarily shaped lettering can fit better", { limit: 10 });
assert.ok(hyphenated.some((variant) => /-\n/.test(variant.text)));

const noHyphen = generateTextShapeRVariants("extraordinarily shaped lettering can fit better", { limit: 10, allowHyphenation: false });
assert.ok(noHyphen.every((variant) => !/-\n/.test(variant.text)));

const markdown = generateTextShapeRVariants("A **bold sentence** should keep markdown markers safe", { limit: 10 });
assert.ok(markdown.every((variant) => !/\*\*bo\nld|sent\nence\*\*/.test(variant.text)));
assert.ok(markdown.every((variant) => (variant.text.match(/\*\*/g) || []).length === 2));

const short = generateTextShapeRVariants("Bonjour");
assert.deepStrictEqual(short.map((variant) => variant.text), ["Bonjour"]);

const profileText = "A longer sentence can choose different bubble silhouettes for the same lettering.";
const tall = generateTextShapeRVariants(profileText, { profile: "tall", limit: 10 });
const wide = generateTextShapeRVariants(profileText, { profile: "wide", limit: 10 });
assert.ok(tall[0].lines.length > wide[0].lines.length);
assert.ok(visibleWidth("minimum") < visibleWidth("maximum"));

const punctuated = generateTextShapeRVariants("Mais attends, je voulais juste te parler de ce qui est arrive hier soir.", { limit: 10 });
assert.ok(/attends,\n/.test(punctuated[0].text));

const clyde = generateTextShapeRVariants("CLYDE, JE PEUX UTILISER UN M\u00c9DAILLON ?", { limit: 10 });
const hasAbruptJump = (variant) => {
  const widths = variant.lines.map(visibleWidth);
  const maxWidth = Math.max.apply(null, widths);
  return widths.some((width, index) => (
    index > 0 && Math.abs(width - widths[index - 1]) / maxWidth > 0.55
  ));
};
assert.ok(!/^CLYDE,\nJE PEUX UTILISER/.test(clyde[0].text));
assert.ok(clyde.slice(0, 5).every((variant) => variant.lines.length <= 2 || !hasAbruptJump(variant)));

// French spacing before "!" / "?" must never allow punctuation to start a
// line or an opening quote to end one
const frenchPunctuation = generateTextShapeRVariants("salut ! comment ça va aujourd'hui mes amis ?", { limit: 12 });
assert.ok(frenchPunctuation.length > 0);
frenchPunctuation.forEach((variant) => {
  variant.lines.forEach((line) => {
    assert.ok(!/^[!?;:.,…»›)\]}]/.test(line.trim()), `line starts with punctuation: "${line}" in\n${variant.text}`);
    assert.ok(!/[«‹¿¡(\[{]$/.test(line.trim()), `line ends with opening punctuation: "${line}" in\n${variant.text}`);
  });
});

const frenchHyphenation = generateTextShapeRVariants("utiliser", { limit: 10 });
assert.ok(frenchHyphenation.some((variant) => /uti-\nliser/i.test(variant.text)));
assert.ok(frenchHyphenation.every((variant) => !/util-\niser/i.test(variant.text)));

const manualText = "Manual shaping should follow the bubble selection and still keep a readable text block.";
const manual = generateManualTextShapeRVariant(manualText, {
  width: 260,
  height: 360,
  shape: "ellipse",
  lineCount: 5,
  softness: 0.6,
  floor: 0.15,
});
assert.strictEqual(manual.lines.length, 5);
assert.strictEqual(manual.text.split("\n").length, 5);
assert.ok(manual.widths.length === manual.targets.length);

const manualTall = estimateManualLineCount(manualText, 220, 440);
const manualWide = estimateManualLineCount(manualText, 440, 220);
assert.ok(manualTall > manualWide);

const selectionProfile = {
  rows: [
    { y: 0, left: 0.45, right: 0.55, width: 0.1 },
    { y: 0.25, left: 0.18, right: 0.82, width: 0.64 },
    { y: 0.5, left: 0, right: 1, width: 1 },
    { y: 0.75, left: 0.28, right: 0.72, width: 0.44 },
    { y: 1, left: 0.48, right: 0.52, width: 0.04 },
  ],
};
const selectionManual = generateManualTextShapeRVariant(manualText, {
  width: 260,
  height: 360,
  shape: "selection",
  shapeProfile: selectionProfile,
  lineCount: 5,
});
assert.ok(selectionManual.targets[2] > selectionManual.targets[0]);
assert.ok(selectionManual.targets[2] > selectionManual.targets[4]);

// Bubble-aware mode: a round outline plus pixel calibration must yield
// variants that stay inside the bubble and keep a harmonious convex shape
const ellipseRows = [];
for (let i = 0; i <= 12; i++) {
  const y = i / 12;
  const width = Math.sqrt(Math.max(0, 1 - Math.pow(2 * y - 1, 2)));
  ellipseRows.push({ y, left: 0.5 - width / 2, right: 0.5 + width / 2, width });
}
const bubbleWidth = 300;
const bubbleHeight = 300;
const bubbleCalibration = { unitPx: 10, linePx: 40 };
const bubbleText = "Je crois que nous devrions vraiment partir avant que la nuit tombe sur la ville.";
const bubbleVariants = generateTextShapeRVariants(bubbleText, {
  limit: 12,
  profile: "balanced",
  shapeProfile: { rows: ellipseRows },
  width: bubbleWidth,
  height: bubbleHeight,
  calibration: bubbleCalibration,
});
assert.ok(bubbleVariants.length > 0);

const ellipseWidthAt = (y) => {
  const clamped = Math.max(0, Math.min(1, y));
  return Math.sqrt(Math.max(0, 1 - Math.pow(2 * clamped - 1, 2)));
};
const bubbleBest = bubbleVariants[0];
const bestWidths = bubbleBest.lines.map(visibleWidth);
assert.ok(bestWidths.length > 1, `expected a multi-line bubble variant:\n${bubbleBest.text}`);
// Block height must fit the bubble
assert.ok(bestWidths.length * bubbleCalibration.linePx <= bubbleHeight, `too many lines for the bubble:\n${bubbleBest.text}`);
// Every line must stay inside the outline over its whole vertical band
bubbleBest.lines.forEach((line, index) => {
  const yCenter = 0.5 + (index + 0.5 - bestWidths.length / 2) * (bubbleCalibration.linePx / bubbleHeight);
  const halfBand = (bubbleCalibration.linePx / bubbleHeight) * 0.4;
  const rowWidth = Math.min(ellipseWidthAt(yCenter - halfBand), ellipseWidthAt(yCenter + halfBand));
  const availablePx = bubbleWidth * rowWidth;
  const linePx = visibleWidth(line) * bubbleCalibration.unitPx;
  assert.ok(linePx <= availablePx * 1.05, `line escapes the bubble: "${line}" (${linePx}px > ${availablePx}px) in\n${bubbleBest.text}`);
});
// Harmonious convex silhouette: widest line in the interior, edges shorter,
// and no abrupt jump between neighbouring lines
if (bestWidths.length > 2) {
  const interiorMax = Math.max(...bestWidths.slice(1, -1));
  assert.ok(interiorMax >= bestWidths[0], `top line wider than interior:\n${bubbleBest.text}`);
  assert.ok(interiorMax >= bestWidths[bestWidths.length - 1], `bottom line wider than interior:\n${bubbleBest.text}`);
}
const bubbleMax = Math.max(...bestWidths);
bestWidths.forEach((width, index) => {
  if (!index) return;
  assert.ok(Math.abs(width - bestWidths[index - 1]) / bubbleMax <= 0.6, `abrupt width jump in\n${bubbleBest.text}`);
});

// The shipped default uses Sakushi's global profile, but feedback learning is
// deliberately isolated from it: a first lesson starts at sample 1 on the
// engine's neutral baseline, then later lessons continue the user's history.
// Marking a hand-typeset shape as ideal must return bounded tuning knobs, bias
// future suggestions toward that style, and be reversible to the shipped
// default; tests can still select `{}` explicitly to inspect the neutral core.
const feedbackText = "Je crois que nous devrions vraiment partir avant que la nuit tombe sur la ville.";
const baselineTop = generateTextShapeRVariants(feedbackText, { limit: 12, profile: "balanced" })[0];
const chosenShape = "Je crois que\nnous devrions\nvraiment partir\navant que la\nnuit tombe\nsur la ville.";
setTextShapeRTuning(null);
const feedback = recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, null);
assert.ok(feedback, "feedback should be recorded");
assert.strictEqual(feedback.tuning.samples, 1,
  "first Learn action must not inherit the bundled profile's 178 samples");
assert.strictEqual(feedback.chosenLineCount, 6);
// The chosen shape is taller than the baseline top: the bias must lean up
assert.ok(feedback.tuning.lineTargetBias > 0);
// The chosen shape uses no hyphen: the hyphen penalty must not decrease
assert.ok(feedback.tuning.hyphenPenaltyScale >= 1);
// The rich style profile captures the shape's signature, not just its count
assert.ok(feedback.tuning.style, "a style profile should be learned");
assert.strictEqual(feedback.tuning.style.silhouette.length, 7);
assert.ok(feedback.tuning.style.density > 0, "density (text per line) should be learned");
assert.ok(feedback.tuning.style.stepMean >= 0, "neighbour step preference should be learned");
// One click stores the shape itself as a contextual exemplar and trains the
// pairwise ranking weights on interpretable features
assert.ok(feedback.tuning.weights, "ranking weights should be learned from the first click");
assert.strictEqual(feedback.tuning.exemplars.length, 1, "the validated shape should be stored as an exemplar");
assert.strictEqual(feedback.tuning.exemplars[0].lineCount, 6);
assert.ok(feedback.tuning.exemplars[0].units > 0);
assert.strictEqual(feedback.tuning.exemplars[0].curve.length, 7);
setTextShapeRTuning(feedback.tuning);
const tunedVariants = generateTextShapeRVariants(feedbackText, { limit: 12, profile: "balanced" });
const tunedTop = tunedVariants[0];
assert.ok(tunedTop.lines.length >= baselineTop.lines.length, "tuned top should not get shorter");
// The exemplar is injected into the candidate list for its own text: the
// user's shape always competes, even when the generator would never build it
assert.ok(tunedVariants.some((variant) => variant.text === chosenShape),
  "the validated shape must appear among candidates after one click");
// A second feedback pass accumulates instead of restarting
const secondFeedback = recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, feedback.tuning);
assert.strictEqual(secondFeedback.tuning.samples, 2);
// Repeated feedback on the same style converges: the exact hand-made shape
// must climb the ranking until it sits at (or right next to) the top
let convergedTuning = feedback.tuning;
for (let pass = 0; pass < 3; pass++) {
  const step = recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, convergedTuning);
  convergedTuning = step.tuning;
  setTextShapeRTuning(convergedTuning);
}
const convergedVariants = generateTextShapeRVariants(feedbackText, { limit: 12, profile: "balanced" });
const convergedRank = convergedVariants.findIndex((variant) => variant.text === chosenShape);
assert.ok(convergedRank >= 0 && convergedRank <= 2,
  `hand-made shape should rank in the top 3 after convergence, got ${convergedRank + 1}\n${convergedVariants[0].text}`);
// Re-learning the same shape must update its exemplar, not duplicate it
assert.strictEqual(convergedTuning.exemplars.length, 1, "same shape must not duplicate exemplars");
// Experience replay: feedback pairs are stored so later feedbacks re-train
// on the whole history, and the training accuracy is persisted as telemetry
assert.ok(Array.isArray(convergedTuning.pairs) && convergedTuning.pairs.length > 0,
  "preference pairs should be stored for replay training");
assert.ok(convergedTuning.pairs.every((pair) => pair.c.length === 16 && pair.r.length === 16
  && Number.isInteger(pair.t)),
  "stored pairs should hold full feature vectors");
assert.ok(convergedTuning.pairAccuracy >= 0.8,
  `replay training should rank most stored pairs correctly, got ${convergedTuning.pairAccuracy}`);
// Re-validating the exact same shape is reinforcement: hits accumulate on
// the single exemplar instead of duplicating it
assert.ok(convergedTuning.exemplars[0].hits >= 4,
  `repeated validation should increment the exemplar's hits, got ${convergedTuning.exemplars[0].hits}`);
// A perfectly self-consistent style must be recognized as such
assert.ok(convergedTuning.style.consistency >= 0.95,
  `repeating one shape should read as a consistent style, got ${convergedTuning.style.consistency}`);
// The learned density generalizes: another text of similar volume should
// also lean toward the same text-per-line budget rather than a fixed count
const transferVariants = generateTextShapeRVariants(
  "Il faudra bien finir par leur dire ce qui est arrivé cette nuit-là dans la forêt.",
  { limit: 12, profile: "balanced" }
);
assert.ok(transferVariants[0].lines.length >= 5,
  `learned density should transfer to other texts, got ${transferVariants[0].lines.length} lines`);
// Batch learning (Alt-click): several layers learned in sequence accumulate
// samples and exemplars, each feeding the next generation pass
setTextShapeRTuning({});
let batchTuning = null;
[
  "On ne peut pas\nrester ici toute la nuit\nsans savoir ce qui\nnous attend dehors.",
  "Tu devrais lui parler\navant qu'il ne soit trop tard\npour changer d'avis.",
  "Personne n'avait remarqué\nla porte entrouverte\nau fond du couloir sombre.",
].forEach((layerTextSample) => {
  const step = recordTextShapeRFeedback(layerTextSample, { limit: 12, profile: "balanced" }, batchTuning);
  assert.ok(step, "batch feedback should record every layer");
  batchTuning = step.tuning;
});
assert.strictEqual(batchTuning.samples, 3);
assert.strictEqual(batchTuning.exemplars.length, 3, "each distinct layer should add an exemplar");
// Bubble-aware learning: the exemplar records the outline signature of the
// selection it was validated in, so same-shaped bubbles recall it first
setTextShapeRTuning({});
const bubbleFeedback = recordTextShapeRFeedback(chosenShape, {
  limit: 12,
  profile: "balanced",
  shapeProfile: { rows: ellipseRows },
  width: 300,
  height: 340,
}, null);
assert.strictEqual(bubbleFeedback.tuning.exemplars.length, 1);
assert.strictEqual(bubbleFeedback.tuning.exemplars[0].bubble.length, 7,
  "the bubble outline signature should be stored with the exemplar");
assert.ok(Math.abs(bubbleFeedback.tuning.exemplars[0].aspect - 340 / 300) < 1e-6,
  "the bubble aspect should be stored with the exemplar");
setTextShapeRTuning(bubbleFeedback.tuning);
const sameBubbleRecall = generateTextShapeRVariants(feedbackText, {
  limit: 12,
  profile: "balanced",
  shapeProfile: { rows: ellipseRows },
  width: 300,
  height: 340,
});
assert.ok(sameBubbleRecall.some((variant) => variant.text === chosenShape && variant.injected),
  "an exact layout should be recalled in the bubble where it was learned");
const pointedRows = [0.12, 0.3, 0.65, 1, 0.65, 0.3, 0.12].map((width, index, rows) => ({
  y: (index + 0.5) / rows.length,
  left: 0.5 - width / 2,
  right: 0.5 + width / 2,
  width,
}));
const differentBubbleRecall = generateTextShapeRVariants(feedbackText, {
  limit: 12,
  profile: "balanced",
  shapeProfile: { rows: pointedRows },
  width: 300,
  height: 340,
  calibration: bubbleCalibration,
});
assert.ok(!differentBubbleRecall.some((variant) => variant.text === chosenShape && variant.injected),
  "an exact layout learned in another bubble must not bypass current fit constraints");
const replacementShape = "Je crois que nous\ndevrions vraiment\npartir avant que\nla nuit tombe sur\nla ville.";
const replacementFeedback = recordTextShapeRFeedback(replacementShape, {
  limit: 12,
  profile: "balanced",
  shapeProfile: { rows: ellipseRows },
  width: 300,
  height: 340,
}, bubbleFeedback.tuning);
assert.strictEqual(replacementFeedback.tuning.exemplars.length, 1,
  "a newer layout for the same text and bubble should replace the stale exemplar");
assert.strictEqual(replacementFeedback.tuning.exemplars[0].lines.join("\n"), replacementShape);
// Without a selection the exemplar simply carries no bubble context
assert.strictEqual(batchTuning.exemplars[0].bubble, null);
setTextShapeRTuning({});
// Hyphenated feedback lowers the hyphen penalty and records the habit
const hyphenFeedback = recordTextShapeRFeedback("CLYDE, JE PEUX UTI-\nLISER UN MÉDAILLON ?", { limit: 10 }, null);
assert.ok(hyphenFeedback.tuning.hyphenPenaltyScale < 1);
assert.strictEqual(hyphenFeedback.chosenHyphens, 1);
assert.ok(hyphenFeedback.tuning.style.hyphenRate > 0, "hyphen habit should be learned");
assert.ok(hyphenFeedback.tuning.style.hyphenLineY != null, "hyphen height should be learned");
// The neutral core remains exactly recoverable for isolated learning tests.
setTextShapeRTuning({});
const restoredTop = generateTextShapeRVariants(feedbackText, { limit: 12, profile: "balanced" })[0];
assert.strictEqual(restoredTop.text, baselineTop.text);
// Garbage tuning input must sanitize instead of breaking generation
setTextShapeRTuning({
  lineTargetBias: 99, hyphenPenaltyScale: -5, stepSlackDelta: "x", curveDelta: null, samples: -3,
  style: { silhouette: "x", density: -4, stepMean: 9, hyphenRate: "y", hyphenLineY: [], punctEndRate: NaN },
});
assert.ok(generateTextShapeRVariants(feedbackText, { limit: 12 }).length > 0);
setTextShapeRTuning({ samples: 5, style: { silhouette: [0.5, "a", 0.7, 0.9, 0.7, 0.5, 0.4], density: 12 } });
assert.ok(generateTextShapeRVariants(feedbackText, { limit: 12 }).length > 0);
// Garbage weights and exemplars must sanitize instead of breaking generation
setTextShapeRTuning({
  samples: 4,
  weights: { hyphens: 9999, bogus: 5, stepMean: "x", convexity: -Infinity },
  exemplars: [
    { lines: "not-an-array" },
    { lines: ["une ligne valide", "et une seconde"], units: -5, lineCount: 99, curve: [1, 2] },
    null,
    { lines: ["texte correct ici", "sur deux lignes"], units: 30, lineCount: 2, aspect: 1.2, hyphens: 0, curve: [0.5, 0.6, 0.8, 1, 0.8, 0.6, 0.4] },
  ],
});
assert.ok(generateTextShapeRVariants(feedbackText, { limit: 12 }).length > 0);
// Garbage replay pairs must sanitize instead of breaking training
setTextShapeRTuning({
  samples: 2,
  pairs: [null, "x", { c: [1, 2], r: "y" }, { c: new Array(12).fill(0.5), r: new Array(12).fill(9) }],
  pairAccuracy: "not-a-number",
});
const afterGarbagePairs = recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, {
  samples: 2,
  pairs: [null, { c: [1, 2], r: "y" }, { c: new Array(12).fill(0.5), r: new Array(12).fill(0.7) }],
});
assert.ok(afterGarbagePairs && afterGarbagePairs.tuning.pairs.length > 0,
  "feedback on top of garbage pairs should still train");
assert.ok(afterGarbagePairs.tuning.pairAccuracy >= 0 && afterGarbagePairs.tuning.pairAccuracy <= 1);
assert.strictEqual(afterGarbagePairs.tuning.pairSchemaVersion, 2,
  "persisted replay vectors should carry an explicit schema version");
// Schema 1 buffers (12 features) migrate forward: new features padded with 0
const migratedPairs = sanitizeTextShapeRTuning({
  samples: 2,
  pairs: [{ c: new Array(12).fill(0.2), r: new Array(12).fill(0.8) }],
});
assert.strictEqual(migratedPairs.pairs.length, 1);
assert.strictEqual(migratedPairs.pairs[0].c.length, 16);
assert.deepStrictEqual(migratedPairs.pairs[0].c.slice(12), [0, 0, 0, 0]);
// Schema 2 pairs keep their feedback index and generator offset (clamped)
const datedPairs = sanitizeTextShapeRTuning({
  samples: 5,
  pairSchemaVersion: 2,
  pairs: [{ c: new Array(16).fill(0.2), r: new Array(16).fill(0.8), t: 3, o: 99 }],
});
assert.strictEqual(datedPairs.pairs[0].t, 3);
assert.strictEqual(datedPairs.pairs[0].o, 4, "generator offsets are clamped");
assert.strictEqual(sanitizeTextShapeRTuning({ pairSchemaVersion: 2, pairs: [{ c: new Array(12).fill(0.2), r: new Array(12).fill(0.8) }] }).pairs, null,
  "schema 2 vectors must have the full feature length");
const unknownPairSchema = sanitizeTextShapeRTuning({
  samples: 2,
  pairSchemaVersion: 99,
  pairs: [{ c: new Array(12).fill(0.2), r: new Array(12).fill(0.8) }],
  pairAccuracy: 1,
});
assert.strictEqual(unknownPairSchema.pairs, null,
  "unknown replay schemas must not be interpreted using the current feature order");
assert.strictEqual(unknownPairSchema.pairAccuracy, null);
const replayPairA = { c: new Array(12).fill(0.1), r: new Array(12).fill(0.7) };
const replayPairB = { c: new Array(12).fill(0.3), r: new Array(12).fill(0.6) };
const trainFromPairOrder = (pairs) => {
  const seed = { samples: 2, pairSchemaVersion: 1, pairs };
  setTextShapeRTuning(seed);
  return recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, seed).tuning;
};
const forwardReplay = trainFromPairOrder([replayPairA, replayPairB]);
const reverseReplay = trainFromPairOrder([replayPairB, replayPairA]);
assert.deepStrictEqual(forwardReplay.weights, reverseReplay.weights,
  "the same replay evidence should produce identical ranking weights regardless of stored order");
assert.strictEqual(forwardReplay.pairAccuracy, reverseReplay.pairAccuracy);
setTextShapeRTuning({});
// Replay stability: a long consistent history must not be wrecked by a
// single contradictory click — accuracy over the buffer stays high
let guardTuning = null;
for (let pass = 0; pass < 4; pass++) {
  guardTuning = recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, guardTuning).tuning;
}
const contradiction = recordTextShapeRFeedback(
  "Je crois que nous devrions vraiment partir avant que\nla nuit tombe sur la ville.",
  { limit: 12, profile: "balanced" },
  guardTuning
);
assert.ok(contradiction.tuning.pairAccuracy >= 0.6,
  `one contradictory feedback should not wreck the trained ranking, accuracy ${contradiction.tuning.pairAccuracy}`);
setTextShapeRTuning({});
// The bubble is a constraint, not an objective: a strongly learned compact
// style must survive bubble-aware mode. Train a tall-stack preference on one
// text, then generate another text inside a round calibrated bubble — the
// top suggestion should keep the learned density (many short lines) instead
// of snapping back to the bubble's own few-wide-lines estimate.
let compactTuning = null;
for (let pass = 0; pass < 4; pass++) {
  compactTuning = recordTextShapeRFeedback(chosenShape, { limit: 12, profile: "balanced" }, compactTuning).tuning;
}
setTextShapeRTuning(compactTuning);
// A wide bubble is the adversarial case: its physical estimate wants 2-3
// long lines while the learned style wants a compact stack
const styledBubbleVariants = generateTextShapeRVariants(
  "Il faudra bien finir par leur dire ce qui est arrivé cette nuit-là dans la forêt.",
  {
    limit: 12,
    profile: "balanced",
    shapeProfile: { rows: ellipseRows },
    width: 520,
    height: 300,
    calibration: bubbleCalibration,
  }
);
const styledBubbleTop = styledBubbleVariants[0];
assert.ok(styledBubbleTop.lines.length >= 5,
  `learned compact style should survive bubble-aware mode, got ${styledBubbleTop.lines.length} lines:\n${styledBubbleTop.text}`);
assert.ok(styledBubbleTop.lines.length * bubbleCalibration.linePx <= 300,
  `styled bubble top must still physically fit:\n${styledBubbleTop.text}`);
setTextShapeRTuning(null);
const restoredShippedDefaultTop = generateTextShapeRVariants(defaultProbeText, { limit: 12, profile: "balanced" })[0];
assert.strictEqual(restoredShippedDefaultTop.text, shippedDefaultTop.text,
  "null tuning must restore the shipped trained default");

// Structured line-break model (differentiable DP, arXiv:1802.03676)
{
  const ddpSanitized = sanitizeTextShapeRTuning({ samples: 1, ddp: [30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 999] });
  assert.strictEqual(ddpSanitized.ddp.length, 11);
  assert.strictEqual(ddpSanitized.ddp[10], 400, "ddp weights are clamped");
  assert.strictEqual(sanitizeTextShapeRTuning({ samples: 1, ddp: [1, 2, 3] }).ddp, null,
    "a ddp vector of the wrong length is dropped");
  assert.strictEqual(sanitizeTextShapeRTuning({ samples: 1, ddp: [30, 0, 0, 0, 0, 0, 0, 0, 0, 0, "x"] }).ddp, null,
    "a non-numeric ddp vector is dropped");
  const roundTrip = sanitizeTextShapeRTuning(JSON.parse(JSON.stringify(ddpSanitized)));
  assert.deepStrictEqual(roundTrip.ddp, ddpSanitized.ddp, "ddp survives a save/load round-trip");

  // Teach a deliberately unusual compact stack and check its rank improves
  const ddpText = "Tu crois vraiment qu'on va s'en sortir comme ça sans rien dire à personne ?";
  const ddpOptions = { limit: 12, profile: "balanced" };
  setTextShapeRTuning(null);
  const ddpBefore = generateTextShapeRVariants(ddpText, ddpOptions);
  // A proposal the untrained engine ranks low (but not dead last)
  const ddpTarget = ddpBefore[Math.min(4, ddpBefore.length - 1)];
  const rankOf = (variants) => variants.findIndex((variant) => variant.text === ddpTarget.text);
  const rankBefore = rankOf(ddpBefore);
  assert.ok(rankBefore > 0, "the probe layout must start below the top");
  let ddpTuning = null;
  for (let pass = 0; pass < 3; pass++) {
    ddpTuning = recordTextShapeRFeedback(ddpTarget.text, ddpOptions, ddpTuning).tuning;
  }
  assert.ok(Array.isArray(ddpTuning.ddp) && ddpTuning.ddp.length === 11, "feedback trains the ddp model");
  assert.ok(ddpTuning.ddp.every(Number.isFinite), "ddp weights are finite");
  setTextShapeRTuning(ddpTuning);
  const rankAfter = rankOf(generateTextShapeRVariants(ddpText, ddpOptions));
  assert.ok(rankAfter >= 0 && (rankBefore < 0 || rankAfter <= rankBefore),
    `the taught layout must not lose rank (before ${rankBefore}, after ${rankAfter})`);
  assert.strictEqual(rankAfter, 0, `the taught layout should become the top proposal, got rank ${rankAfter}`);

  // Deterministic: same lessons, same weights
  let replay = null;
  for (let pass = 0; pass < 3; pass++) replay = recordTextShapeRFeedback(ddpTarget.text, ddpOptions, replay).tuning;
  assert.deepStrictEqual(replay.ddp, ddpTuning.ddp, "ddp training is deterministic");

  // A deferred (batch) record leaves ddp untouched until the batch retrain
  const deferred = recordTextShapeRFeedback(ddpTarget.text, { ...ddpOptions, deferRanker: true }, null).tuning;
  assert.strictEqual(deferred.ddp, null, "deferred feedback does not fit ddp per layer");
  assert.ok(Array.isArray(retrainTextShapeRRanker(deferred).ddp), "batch retrain fits ddp once");
  setTextShapeRTuning(null);
}

console.log("TextShapeR tests passed");
