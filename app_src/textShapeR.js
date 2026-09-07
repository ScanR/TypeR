import defaultTextShapeRTuning from "./textShapeRDefaultTuning.json";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const VOWELS = "aeiouyAEIOUY\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc";
const MAX_VARIANTS = 12;
const MARKDOWN_TOKENS = ["***", "**", "__", "*", "_"];
const LINE_END_PUNCTUATION = /[.,;:!?…]$/;
const PROFILE_PRESETS = {
  balanced: {
    minLines: 2,
    maxLines: 6,
    lineTarget: 4,
    curves: [0.35, 0.45, 0.6, 0.75],
    shifts: [0, -0.12, 0.12, -0.2, 0.2],
    biases: [-1, 0, 1],
    minWeight: 0.35,
    punctuationBreakBonus: 14,
    adjacentSlack: 0.22,
    smoothnessWeight: 210,
    minLineRatio: 0.4,
    scoreCurve: 0.65,
    maxLineWidth: 26,
  },
  round: {
    minLines: 3,
    maxLines: 5,
    lineTarget: 4,
    curves: [0.55, 0.65, 0.8, 0.95],
    shifts: [0, -0.08, 0.08, -0.16, 0.16],
    biases: [-1, 0, 1],
    minWeight: 0.3,
    punctuationBreakBonus: 14,
    adjacentSlack: 0.18,
    smoothnessWeight: 240,
    minLineRatio: 0.38,
    scoreCurve: 0.8,
    maxLineWidth: 22,
  },
  tall: {
    minLines: 4,
    maxLines: 7,
    lineTarget: 5,
    curves: [0.24, 0.3, 0.42, 0.55],
    shifts: [0, -0.1, 0.1, -0.18, 0.18],
    biases: [-1, 0, 1],
    minWeight: 0.46,
    punctuationBreakBonus: 11,
    adjacentSlack: 0.26,
    smoothnessWeight: 160,
    minLineRatio: 0.36,
    scoreCurve: 0.5,
    maxLineWidth: 18,
  },
  wide: {
    minLines: 2,
    maxLines: 4,
    lineTarget: 3,
    curves: [0.18, 0.22, 0.34, 0.46],
    shifts: [0, -0.08, 0.08, -0.16, 0.16],
    biases: [-1, 0, 1, 2],
    minWeight: 0.58,
    punctuationBreakBonus: 11,
    adjacentSlack: 0.2,
    smoothnessWeight: 220,
    minLineRatio: 0.5,
    scoreCurve: 0.4,
    maxLineWidth: 34,
  },
};

// Merges hyphenation left over from a previous line break: "silho- uette"
// reads as the word "silhouette". The junction is scored with the same
// syllable model used to create hyphenations: a real césure sits on a
// plausible syllable boundary of the merged word, while a compound broken
// at its own hyphen ("court- circuit", "peut- être", "voulait- il") lands
// on an implausible one and keeps its hyphen. Uppercase continuations
// ("Jean- Paul") always read as compounds. Standalone dashes
// ("il - enfin - vint", "—") never match: a letter must sit right before
// the hyphen and the space only after it.
const DEHYPHENATE_PATTERN = /([A-Za-zÀ-ÖØ-öø-ÿ]+)- ([A-Za-zÀ-ÖØ-öø-ÿ]+)/g;
const UPPERCASE_LETTER = /[A-ZÀ-ÖØ-Þ]/;
// Accepts every syllable-boundary score, including the weak vowel-vowel
// ones (7); rejects unknown clusters (10) and consonant+vowel onsets (16)
const CESURE_MAX_PENALTY = 8;

let dehyphenationEnabled = false;
const setDehyphenationEnabled = (enabled) => {
  dehyphenationEnabled = enabled === true;
};

// "This shape is the best" feedback nudges a few bounded scoring knobs so the
// generator drifts toward the silhouettes the user actually keeps. Every knob
// is clamped: feedback fine-tunes the ranking, it can never break generation.
const TUNING_DEFAULTS = {
  samples: 0,
  lineTargetBias: 0, // EMA of (chosen line count - top suggestion's), [-2, 2]
  hyphenPenaltyScale: 1, // scales the per-hyphen score penalty, [0.4, 2.5]
  stepSlackDelta: 0, // extra tolerance on neighbour width steps, [0, 0.15]
  curveDelta: 0, // sharper (+) or flatter (-) silhouette curve, [-0.25, 0.3]
  style: null, // rich learned style profile, see sanitizeStyle
};

// The rich style profile goes beyond scalar knobs: each feedback sample
// accumulates a signature of the shape the user actually kept — silhouette
// curve, text quantity per line, neighbour contrast, hyphen and punctuation
// habits — and scoring then measures every candidate against that signature.
// Every field is an EMA over samples; null means "never observed yet".
const STYLE_RESOLUTION = 7;

const sanitizeStyle = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const pick = (key, min, max) => {
    // Number(null) is 0: a never-observed field must round-trip as null, not
    // silently become a learned 0
    if (raw[key] == null) return null;
    const value = Number(raw[key]);
    return Number.isFinite(value) ? clamp(value, min, max) : null;
  };
  const silhouette = Array.isArray(raw.silhouette) && raw.silhouette.length === STYLE_RESOLUTION
    && raw.silhouette.every((value) => Number.isFinite(Number(value)))
    ? raw.silhouette.map((value) => clamp(Number(value), 0.02, 1))
    : null;
  const style = {
    silhouette, // normalized width curve resampled at STYLE_RESOLUTION heights
    density: pick("density", 2, 80), // preferred text per line, measure units
    stepMean: pick("stepMean", 0, 0.8), // preferred neighbour width contrast
    hyphenRate: pick("hyphenRate", 0, 1), // fraction of breaks hyphenated
    hyphenLineY: pick("hyphenLineY", 0, 1), // preferred hyphen height in block
    punctEndRate: pick("punctEndRate", 0, 1), // breaks landing on punctuation
    // How self-similar the user's validated silhouettes are (0..1): an
    // inconsistent style should push candidates around less than a firm one
    consistency: pick("consistency", 0, 1),
  };
  const hasSignal = style.silhouette || style.density != null || style.stepMean != null
    || style.hyphenRate != null || style.hyphenLineY != null || style.punctEndRate != null;
  return hasSignal ? style : null;
};

// Pairwise learning-to-rank: every candidate maps to this fixed vector of
// normalized (~0..1) interpretable features, and feedback adjusts one bounded
// weight per feature so the shapes the user actually keeps rank first. Caps
// keep any single learned weight below the physical-fit penalties.
const FEATURE_CAPS = {
  hyphens: 110, // presence of hyphenated breaks (0..1, /2 scale)
  lineSurplus: 45, // lines above the context target
  lineDeficit: 55, // lines below the context target
  stepMean: 260, // mean relative width difference between neighbours
  stepMax: 200, // worst neighbour width jump
  edgeTop: 170, // first line width / peak
  edgeBottom: 170, // last line width / peak
  peakOffset: 100, // distance of the widest line from the vertical center
  convexity: 200, // dips before the peak + bumps after it
  minRatio: 130, // narrowest line / peak
  punctEnds: 50, // fraction of internal breaks landing on punctuation
  wideLines: 130, // fraction of lines close to the width cap
};

const FEATURE_KEYS = Object.keys(FEATURE_CAPS);
const PAIR_SCHEMA_VERSION = 1;

const sanitizeWeights = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const weights = {};
  let hasSignal = false;
  FEATURE_KEYS.forEach((key) => {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value !== 0) {
      weights[key] = clamp(value, -FEATURE_CAPS[key], FEATURE_CAPS[key]);
      hasSignal = true;
    }
  });
  return hasSignal ? weights : null;
};

// Experience replay: every feedback stores its (chosen, rejected) feature
// vector pairs, and each new feedback re-trains the ranking weights over the
// whole buffer in a few epochs instead of a single online pass. This sharply
// reduces last-click drift; once full, the bounded buffer intentionally keeps
// the most recent lessons so the user's style can still evolve.
const MAX_TRAINING_PAIRS = 160;
const TRAINING_EPOCHS = 5;
// Passive-aggressive margin the chosen shape must win by, and the cap on how
// far a single pair may move the weights (PA-I aggressiveness)
const RANK_MARGIN = 12;
const RANK_AGGRESSIVENESS = 25;

const featuresToVector = (features) => FEATURE_KEYS.map((key) => (
  Math.round((features[key] || 0) * 1000) / 1000
));

const sanitizeVector = (raw) => (
  Array.isArray(raw) && raw.length === FEATURE_KEYS.length
    && raw.every((value) => Number.isFinite(Number(value)))
    ? raw.map((value) => clamp(Number(value), 0, 1))
    : null
);

const sanitizeTrainingPairs = (raw) => {
  if (!Array.isArray(raw)) return null;
  const pairs = [];
  raw.forEach((entry) => {
    if (pairs.length >= MAX_TRAINING_PAIRS || !entry || typeof entry !== "object") return;
    const chosen = sanitizeVector(entry.c);
    const rejected = sanitizeVector(entry.r);
    if (chosen && rejected) pairs.push({ c: chosen, r: rejected });
  });
  return pairs.length ? pairs : null;
};

const getPairSortKey = (pair) => `${pair.c.join(",")}|${pair.r.join(",")}`;

// Train in canonical feature order so a given replay buffer always produces
// the same ranker. The buffer itself remains chronological because its cap is
// intentionally a recency window once it reaches MAX_TRAINING_PAIRS.
const sortTrainingPairs = (pairs) => pairs.slice().sort((a, b) => {
  const left = getPairSortKey(a);
  const right = getPairSortKey(b);
  return left < right ? -1 : left > right ? 1 : 0;
});

const pairSeparation = (weights, pair) => {
  let separation = 0;
  for (let index = 0; index < FEATURE_KEYS.length; index++) {
    const weight = weights[FEATURE_KEYS[index]];
    if (weight) separation += weight * (pair.r[index] - pair.c[index]);
  }
  return separation;
};

// Fraction of stored preference pairs the weights rank correctly: the
// training accuracy of the learned ranker, persisted as telemetry and used
// as a validation guard against updates that make the model globally worse
const rankingAccuracy = (weights, pairs) => {
  if (!pairs.length) return 0;
  let correct = 0;
  pairs.forEach((pair) => {
    if (pairSeparation(weights || {}, pair) > 0) correct++;
  });
  return correct / pairs.length;
};

// PA-I updates over the replay buffer: each violated pair moves the weights
// just enough to restore the margin, scaled down by the pair's own feature
// distance — big clear mistakes move fast, near-ties barely move at all.
// Deterministic epoch order keeps training reproducible.
const trainRankingWeights = (initialWeights, pairs, aggressiveness) => {
  const weights = { ...(initialWeights || {}) };
  for (let epoch = 0; epoch < TRAINING_EPOCHS; epoch++) {
    pairs.forEach((pair) => {
      const loss = RANK_MARGIN - pairSeparation(weights, pair);
      if (loss <= 0) return;
      let normSq = 0;
      for (let index = 0; index < FEATURE_KEYS.length; index++) {
        const diff = pair.r[index] - pair.c[index];
        normSq += diff * diff;
      }
      if (normSq < 1e-6) return;
      const step = Math.min(aggressiveness, loss / normSq);
      for (let index = 0; index < FEATURE_KEYS.length; index++) {
        const diff = pair.r[index] - pair.c[index];
        if (!diff) continue;
        const key = FEATURE_KEYS[index];
        weights[key] = clamp((weights[key] || 0) + step * diff, -FEATURE_CAPS[key], FEATURE_CAPS[key]);
      }
    });
  }
  return weights;
};

// Exemplar memory: the actual shapes the user validated, kept verbatim with
// their context (text volume, bubble aspect). Scoring measures candidates
// against the exemplars whose context matches instead of a global average —
// that is what makes suggestions follow the user's style case by case.
// Sliding window of validated shapes. Cheap to hold (a few hundred bytes
// each, matched by one linear scan per generation, scoring only ever uses
// the 3 nearest) — the cap only bounds how far back the memory reaches, and
// batch learning fills ~15 per page, so keep room for a dozen pages or so
const MAX_EXEMPLARS = 200;

const sanitizeExemplars = (raw) => {
  if (!Array.isArray(raw)) return null;
  const exemplars = [];
  raw.forEach((entry) => {
    if (exemplars.length >= MAX_EXEMPLARS || !entry || typeof entry !== "object") return;
    const lines = Array.isArray(entry.lines)
      ? entry.lines.map((line) => String(line || "").slice(0, 160).trim()).filter(Boolean).slice(0, 12)
      : null;
    if (!lines || !lines.length) return;
    const units = Number(entry.units);
    if (!Number.isFinite(units) || units <= 0) return;
    // Number(null) is 0, which would clamp to a bogus 0.1 aspect: a missing
    // bubble context must survive the round trip as null
    const aspect = entry.aspect == null ? NaN : Number(entry.aspect);
    const sanitizeCurve = (value) => (
      Array.isArray(value) && value.length === STYLE_RESOLUTION
        && value.every((sample) => Number.isFinite(Number(sample)))
        ? value.map((sample) => clamp(Number(sample), 0, 1))
        : null
    );
    exemplars.push({
      lines,
      units: clamp(units, 1, 4000),
      lineCount: clamp(Math.round(Number(entry.lineCount)) || lines.length, 1, 12),
      aspect: Number.isFinite(aspect) ? clamp(aspect, 0.1, 10) : null,
      hyphens: Math.max(0, Math.round(Number(entry.hyphens) || 0)),
      curve: sanitizeCurve(entry.curve),
      // Outline signature of the bubble the shape was validated in: lets the
      // matcher pick exemplars from same-shaped bubbles, not just same ratio
      bubble: sanitizeCurve(entry.bubble),
      // Times the user re-validated this exact shape: repetition is
      // reinforcement, a shape kept twice speaks louder than one kept once
      hits: clamp(Math.round(Number(entry.hits)) || 1, 1, 99),
    });
  });
  return exemplars.length ? exemplars : null;
};

const sanitizeTuning = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  // Unversioned pairs came from the first replay implementation and use the
  // same feature order as schema 1. Unknown future schemas must not be read as
  // today's vectors merely because their array length happens to match.
  const pairSchemaVersion = source.pairSchemaVersion == null
    ? PAIR_SCHEMA_VERSION
    : Math.floor(Number(source.pairSchemaVersion));
  const compatiblePairSchema = pairSchemaVersion === PAIR_SCHEMA_VERSION;
  const pick = (key, min, max) => {
    const value = Number(source[key]);
    return Number.isFinite(value) ? clamp(value, min, max) : TUNING_DEFAULTS[key];
  };
  return {
    samples: Math.max(0, Math.floor(Number(source.samples) || 0)),
    lineTargetBias: pick("lineTargetBias", -2, 2),
    hyphenPenaltyScale: pick("hyphenPenaltyScale", 0.4, 2.5),
    stepSlackDelta: pick("stepSlackDelta", 0, 0.15),
    curveDelta: pick("curveDelta", -0.25, 0.3),
    style: sanitizeStyle(source.style),
    weights: sanitizeWeights(source.weights),
    exemplars: sanitizeExemplars(source.exemplars),
    pairs: compatiblePairSchema ? sanitizeTrainingPairs(source.pairs) : null,
    pairSchemaVersion: PAIR_SCHEMA_VERSION,
    // Training accuracy of the ranking weights over the replay buffer:
    // telemetry for "how well trained is my TextShapeR"
    pairAccuracy: (() => {
      if (!compatiblePairSchema || source.pairAccuracy == null) return null;
      const value = Number(source.pairAccuracy);
      return Number.isFinite(value) ? clamp(value, 0, 1) : null;
    })(),
  };
};

// New installs use Sakushi's trained, language-agnostic ranking profile. The
// bundled profile deliberately excludes verbatim exemplars and replay pairs:
// those are tied to the French training dialogues and are not a sound default
// for every language. A user's own tuning always replaces this profile.
let tuning = sanitizeTuning(defaultTextShapeRTuning);
// Bumped on every tuning change so cached variant lists never survive it
let tuningRevision = 0;
const setTextShapeRTuning = (next) => {
  tuning = sanitizeTuning(next == null ? defaultTextShapeRTuning : next);
  tuningRevision++;
};

const dehyphenate = (text) => {
  if (!dehyphenationEnabled || text.indexOf("- ") === -1) return text;
  return text.replace(DEHYPHENATE_PATTERN, (match, before, after) => {
    if (UPPERCASE_LETTER.test(after[0])) return before + "-" + after;
    const penalty = getSyllableSplitPenalty(before + after, before.length);
    return penalty < CESURE_MAX_PENALTY ? before + after : before + "-" + after;
  });
};

const normalizeText = (text) => dehyphenate(String(text || "").replace(/\s+/g, " ").trim());

const stripMarkdownForMeasure = (text) => String(text || "")
  .replace(/\\([\\*_])/g, "$1")
  .replace(/[*_]/g, "");

const visibleLength = (text) => stripMarkdownForMeasure(text).length;

const getCharWidth = (char) => {
  if (!char) return 0;
  if (/\s/.test(char)) return 0.45;
  if (/[ilI.,;:!|'’]/.test(char)) return 0.45;
  if (/[mwMW@#%&]/.test(char)) return 1.32;
  if (/[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/.test(char)) return 1.12;
  return 1;
};

const visibleWidth = (text) => {
  const clean = stripMarkdownForMeasure(text);
  let width = 0;
  for (let index = 0; index < clean.length; index++) {
    width += getCharWidth(clean[index]);
  }
  return width;
};

const tokenLength = (token) => {
  // Token text never changes: cache the measured width on the token itself
  if (token.__width == null) token.__width = visibleWidth(token.text);
  return token.__width;
};

const lineText = (tokens) => tokens.map((token) => token.text).join(" ").trim();

const lineLength = (tokens) => visibleWidth(lineText(tokens));

const isVowel = (char) => VOWELS.indexOf(char) !== -1;

const isLetter = (char) => /[A-Za-z\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc]/.test(char || "");

const isConsonant = (char) => isLetter(char) && !isVowel(char);

const hasVowel = (text) => {
  for (let index = 0; index < text.length; index++) {
    if (isVowel(text[index])) return true;
  }
  return false;
};

const hasMarkdownSyntax = (word) => /[*_\\]/.test(word);

const endsWithBreakPunctuation = (text) => {
  const clean = stripMarkdownForMeasure(text)
    .replace(/[)"'’»\]]+$/g, "")
    .trim();
  return LINE_END_PUNCTUATION.test(clean);
};

const isEscaped = (text, index) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) count++;
  return count % 2 === 1;
};

const findMarkdownTokenAt = (text, index) => MARKDOWN_TOKENS.find((token) => (
  text.slice(index, index + token.length) === token && !isEscaped(text, index)
));

const findClosingMarkdownToken = (text, token, start) => {
  let index = text.indexOf(token, start);
  while (index !== -1) {
    if (!isEscaped(text, index)) return index;
    index = text.indexOf(token, index + token.length);
  }
  return -1;
};

const splitWordsPreservingMarkdown = (text) => {
  const words = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index++;
    if (index >= text.length) break;

    const markdownToken = findMarkdownTokenAt(text, index);
    if (markdownToken) {
      const contentStart = index + markdownToken.length;
      const closeIndex = findClosingMarkdownToken(text, markdownToken, contentStart);
      if (closeIndex !== -1) {
        words.push(text.slice(index, closeIndex + markdownToken.length));
        index = closeIndex + markdownToken.length;
        continue;
      }
    }

    let nextSpace = index;
    while (nextSpace < text.length && !/\s/.test(text[nextSpace])) nextSpace++;
    words.push(text.slice(index, nextSpace));
    index = nextSpace;
  }
  return words.filter(Boolean);
};

const splitTrailingPunctuation = (word) => {
  const match = String(word || "").match(/^(.+?)([.,;:!?]+)?$/);
  return {
    body: match ? match[1] : word,
    punctuation: match && match[2] ? match[2] : "",
  };
};

// French syllable attacks: consonant clusters that legally start a syllable
// and therefore must travel together to the next line. Splitting inside one
// ("tab-leau", "vac-he") reads as cutting mid-syllable.
const FRENCH_ONSETS = {
  bl: 1, br: 1, ch: 1, cl: 1, cr: 1, dr: 1, fl: 1, fr: 1, gl: 1, gn: 1,
  gr: 1, kl: 1, kr: 1, ph: 1, pl: 1, pr: 1, rh: 1, th: 1, tr: 1, vr: 1,
  chl: 1, chr: 1, phl: 1, phr: 1, thr: 1,
};

// Penalty scale: 0-1.5 are clean French syllable boundaries (the only ones
// hyphenation generation uses), 6-7 are merge-plausible but never generated
// (mute-e tails, digraph interiors, vowel-vowel), 10+ are implausible
// boundaries that keep a compound's own hyphen during dehyphenation
const getSyllableSplitPenalty = (body, index) => {
  const lower = String(body || "").toLowerCase();
  const left = lower.slice(0, index);
  const right = lower.slice(index);
  if (!hasVowel(left) || !hasVowel(right)) return Infinity;
  const prev = lower[index - 1];
  const current = lower[index];
  if (isVowel(prev) && isVowel(current)) return 7;
  // Splitting between a consonant and its vowel beheads the syllable
  if (isConsonant(prev) && isVowel(current)) return 16;
  // French typography: no hyphen before an intervocalic x ("ta-xi")
  if (current === "x" && isVowel(lower[index + 1])) return 12;
  // Boundary inside an inseparable pair: mid-syllable cut, never generate
  if (isConsonant(prev) && FRENCH_ONSETS[prev + current]) return 7;

  // Walk the consonant run around the boundary: the consonants carried to
  // the next line (the onset) must form a legal French syllable attack
  let start = index;
  while (start > 0 && isConsonant(lower[start - 1])) start--;
  let end = index;
  while (end < lower.length && isConsonant(lower[end])) end++;
  const onset = lower.slice(index, end);
  const codaLength = index - start;
  const rest = lower.slice(end);
  // Carrying consonants + mute e ("attitu-des") strands a silent syllable
  if (rest === "e" || rest === "es") return 6;
  // A lone aspirated/mute h can't open a carried syllable ("ca-hier")
  if (onset === "h") return 6;
  // Two coda consonants land here only via compound junctions
  // ("court- circuit"): keep them implausible so dehyphenation preserves them
  if (codaLength >= 2) return 10;
  if (onset.length === 1) return codaLength === 0 ? 0 : 1;
  if (FRENCH_ONSETS[onset]) return codaLength === 0 ? 0.5 : 1.5;
  return 10;
};

// Tokens made purely of closing punctuation (French "salut !" splits into
// two words) must never start a line: glue them to the previous word.
// Opening punctuation ("«", "¿") must never end a line: glue to the next.
const CLOSING_PUNCTUATION_ONLY = /^[!?;:.,…»›)\]}]+$/;
const OPENING_PUNCTUATION_ONLY = /^[«‹¿¡(\[{]+$/;

const mergePunctuationWords = (words) => {
  const closed = [];
  words.forEach((word) => {
    if (closed.length && CLOSING_PUNCTUATION_ONLY.test(stripMarkdownForMeasure(word))) {
      closed[closed.length - 1] += ` ${word}`;
      return;
    }
    closed.push(word);
  });
  const merged = [];
  for (let index = 0; index < closed.length; index++) {
    let word = closed[index];
    while (index + 1 < closed.length && OPENING_PUNCTUATION_ONLY.test(stripMarkdownForMeasure(word))) {
      index++;
      word += ` ${closed[index]}`;
    }
    merged.push(word);
  }
  return merged;
};

const hyphenSplitCache = new Map();

const getHyphenSplits = (word) => {
  const cached = hyphenSplitCache.get(word);
  if (cached) return cached;
  const splits = computeHyphenSplits(word);
  if (hyphenSplitCache.size >= 512) hyphenSplitCache.clear();
  hyphenSplitCache.set(word, splits);
  return splits;
};

const computeHyphenSplits = (word) => {
  const { body, punctuation } = splitTrailingPunctuation(word);
  if (!body || body.length < 8) return [];
  if (hasMarkdownSyntax(body) || /[-'’\s]/.test(body)) return [];

  const positions = [];
  for (let index = 3; index <= body.length - 3; index++) {
    const syllablePenalty = getSyllableSplitPenalty(body, index);
    // Only clean syllable boundaries (0-1.5) become visible hyphenations;
    // merge-plausible-but-ugly cuts (6+) are reserved for dehyphenation
    if (!Number.isFinite(syllablePenalty) || syllablePenalty >= 3) continue;
    const centerPenalty = Math.abs(index - body.length / 2);
    positions.push({
      index,
      penalty: syllablePenalty * 10 + centerPenalty,
      prefix: body.slice(0, index) + "-",
      suffix: body.slice(index) + punctuation,
    });
  }

  return positions
    .sort((a, b) => a.penalty - b.penalty || a.index - b.index)
    .slice(0, 3);
};

const buildWeights = (lineCount, curve = 0.5, shift = 0, minWeight = 0.35) => {
  if (lineCount <= 1) return [1];
  const center = (lineCount - 1) / 2 + shift;
  const maxDistance = Math.max(center, lineCount - 1 - center) || 1;
  return Array.from({ length: lineCount }, (_, index) => {
    const distance = Math.abs(index - center) / maxDistance;
    return Math.max(minWeight, 1 - distance * curve);
  });
};

const buildTargets = (tokens, lineCount, curve, shift, bias, minWeight) => {
  const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount);
  const weights = buildWeights(lineCount, curve, shift, minWeight);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => Math.max(1, (total * weight) / weightTotal + bias));
};

const serializeLines = (lines) => lines.map((line) => line.map((token) => token.text).join(" ").trim()).join("\n");

const getTokenMetrics = (tokens) => {
  // Cached on the token array: prefix width sums and per-token flags make
  // every DP line cost O(1) instead of re-measuring joined strings
  if (tokens.__metrics) return tokens.__metrics;
  const tokenCount = tokens.length;
  const prefix = new Array(tokenCount + 1);
  prefix[0] = 0;
  const charPrefix = new Array(tokenCount + 1);
  charPrefix[0] = 0;
  const endsBreak = new Array(tokenCount);
  const punctOnly = new Array(tokenCount);
  const breakCount = new Array(tokenCount + 1);
  breakCount[0] = 0;
  const punctCount = new Array(tokenCount + 1);
  punctCount[0] = 0;
  for (let index = 0; index < tokenCount; index++) {
    prefix[index + 1] = prefix[index] + tokenLength(tokens[index]);
    charPrefix[index + 1] = charPrefix[index] + visibleLength(tokens[index].text);
    endsBreak[index] = endsWithBreakPunctuation(tokens[index].text);
    punctOnly[index] = /^[.,;:!?…]+$/.test(stripMarkdownForMeasure(tokens[index].text));
    breakCount[index + 1] = breakCount[index] + (tokens[index].forceBreakAfter ? 1 : 0);
    punctCount[index + 1] = punctCount[index] + (punctOnly[index] ? 1 : 0);
  }
  const metrics = { prefix, charPrefix, endsBreak, punctOnly, breakCount, punctCount };
  tokens.__metrics = metrics;
  return metrics;
};

// Lines wider than this ratio of their target never survive scoring: stop
// extending `to` past it so the DP inner loop stays proportional to the
// target width instead of the whole token count
const DP_WIDTH_PRUNE_RATIO = 2.5;

// Flat typed-array DP buffers reused across every buildCandidate run: the
// generator fires this DP hundreds of times per call and per-run 2D array
// allocation dominated the profile
let dpBuffer = new Float64Array(0);
let prevBuffer = new Int32Array(0);

const buildCandidate = (tokens, lineCount, targets) => {
  if (!tokens.length || lineCount < 1) return null;
  if (tokens.length < lineCount) return null;
  const tokenCount = tokens.length;
  const { prefix, endsBreak, punctOnly, breakCount } = getTokenMetrics(tokens);
  const stride = tokenCount + 1;
  const size = (lineCount + 1) * stride;
  if (dpBuffer.length < size) {
    dpBuffer = new Float64Array(size);
    prevBuffer = new Int32Array(size);
  }
  dpBuffer.fill(Infinity, 0, size);
  prevBuffer.fill(-1, 0, size);
  dpBuffer[0] = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const target = targets[lineIndex] || 1;
    const pruneWidth = target * (1 + DP_WIDTH_PRUNE_RATIO);
    const isLastLine = lineIndex === lineCount - 1;
    const rowOffset = lineIndex * stride;
    const nextRowOffset = rowOffset + stride;
    const maxTo = tokenCount - (lineCount - lineIndex - 1);
    for (let from = lineIndex; from <= tokenCount; from++) {
      const baseCost = dpBuffer[rowOffset + from];
      if (baseCost === Infinity) continue;
      const fromPrefix = prefix[from];
      const fromBreaks = breakCount[from];
      for (let to = from + 1; to <= maxTo; to++) {
        const width = prefix[to] - fromPrefix + 0.45 * (to - from - 1);
        // Single-token lines stay allowed so one giant word can never make
        // the whole DP infeasible
        if (width > pruneWidth && to > from + 1) break;
        // A forced break inside the range (anywhere but on its last token)
        // makes the line invalid; prefix counts make the check O(1)
        if (breakCount[to - 1] - fromBreaks > 0) continue;
        const ratio = (width - target) / target;
        let cost = ratio * ratio;
        if (!isLastLine && endsBreak[to - 1]) {
          cost = cost > 0.09 ? cost - 0.09 : 0;
        }
        if (to - from === 1 && punctOnly[from]) cost += 3;
        const nextCost = baseCost + cost;
        if (nextCost < dpBuffer[nextRowOffset + to]) {
          dpBuffer[nextRowOffset + to] = nextCost;
          prevBuffer[nextRowOffset + to] = from;
        }
      }
    }
  }

  if (dpBuffer[lineCount * stride + tokenCount] === Infinity) return null;

  const lines = [];
  let cursor = tokenCount;
  for (let lineIndex = lineCount; lineIndex > 0; lineIndex--) {
    const from = prevBuffer[lineIndex * stride + cursor];
    if (from < 0) return null;
    lines.unshift(tokens.slice(from, cursor));
    cursor = from;
  }
  return lines;
};

// Absolute silhouette quality gate, separate from scoring: scores only rank
// candidates against each other, so when every candidate is bad the "best"
// one is still bad — this measure tells ugly from clean in absolute terms so
// the final list can drop ragged stacks, huge adjacent jumps, and overlong
// lines outright instead of merely ranking them last
const CLEAN_SILHOUETTE_BADNESS = 0.6;
const BEARABLE_SILHOUETTE_BADNESS = 1.3;

const getSilhouetteBadness = (lengths, widthCap) => {
  const lineCount = lengths.length;
  const maxLength = Math.max.apply(null, lengths);
  let badness = 0;
  if (widthCap > 0) {
    lengths.forEach((length) => {
      badness += Math.max(0, length / widthCap - 1) * 3;
    });
  }
  if (lineCount < 2 || !(maxLength > 0)) return badness;
  // Steps measured against the longer of the two neighbours: a 2-unit line
  // beside a 10-unit line reads terribly even when the block peak is 20
  const stepSlack = (lineCount === 2 ? 0.32 : 0.48) + tuning.stepSlackDelta;
  const stepWeight = lineCount === 2 ? 6 : 5;
  for (let index = 1; index < lineCount; index++) {
    const longer = Math.max(lengths[index], lengths[index - 1], 1);
    const step = Math.abs(lengths[index] - lengths[index - 1]) / longer;
    badness += Math.max(0, step - stepSlack) * stepWeight;
  }
  if (lineCount >= 3) {
    const interiorMax = Math.max.apply(null, lengths.slice(1, lineCount - 1));
    const edgeMax = Math.max(lengths[0], lengths[lineCount - 1]);
    if (edgeMax > interiorMax) {
      badness += ((edgeMax - interiorMax) / maxLength) * 2.5;
    }
    // Convex profile: rise to the peak, fall after it; small waves pass
    const peakIndex = lengths.indexOf(maxLength);
    for (let index = 1; index <= peakIndex; index++) {
      const drop = (lengths[index - 1] - lengths[index]) / maxLength;
      if (drop > 0.18) badness += (drop - 0.18) * 2;
    }
    for (let index = peakIndex + 1; index < lineCount; index++) {
      const rise = (lengths[index] - lengths[index - 1]) / maxLength;
      if (rise > 0.18) badness += (rise - 0.18) * 2;
    }
    const minRatio = Math.min.apply(null, lengths) / maxLength;
    if (minRatio < 0.3) badness += (0.3 - minRatio) * 2;
  }
  return badness;
};

// Aesthetic silhouette rules shared by generic and bubble-aware scoring:
// the widest line belongs in the middle, the top/bottom edges stay short,
// widths rise to the peak then fall, and neighbouring lines keep close widths
const scoreSilhouetteAesthetics = (lengths, profile) => {
  const lineCount = lengths.length;
  const maxLength = Math.max.apply(null, lengths);
  const minLength = Math.min.apply(null, lengths);
  if (!(maxLength > 0) || lineCount < 2) return 0;
  const smoothnessWeight = profile.smoothnessWeight == null ? 160 : profile.smoothnessWeight;

  if (lineCount === 2) {
    const adjacentSlack = profile.adjacentSlack == null ? 0.24 : profile.adjacentSlack;
    const difference = Math.abs(lengths[0] - lengths[1]) / maxLength;
    const excess = Math.max(0, difference - adjacentSlack);
    return excess * excess * smoothnessWeight;
  }

  const adjacentSlack = profile.adjacentSlack == null ? 0.3 : profile.adjacentSlack;
  const minLineRatio = profile.minLineRatio == null ? 0.34 : profile.minLineRatio;
  const minRatio = minLength / maxLength;
  const interiorLengths = lengths.slice(1, lineCount - 1);
  const interiorMax = Math.max.apply(null, interiorLengths);
  let score = 0;

  // The widest line must sit in the middle of the shape, not on an edge
  const edgeMax = Math.max(lengths[0], lengths[lineCount - 1]);
  if (edgeMax > interiorMax) {
    score += Math.pow((edgeMax - interiorMax) / maxLength, 2) * 420 + 20;
  }

  // Edge lines must stay clearly below the interior peak (graded, not
  // binary): equal-width top and middle lines read as a slab, not a bubble
  if (interiorMax > 0) {
    [lengths[0], lengths[lineCount - 1]].forEach((edgeLength) => {
      const edgeExcess = Math.max(0, edgeLength / interiorMax - 0.85);
      score += edgeExcess * edgeExcess * 900;
    });
  }

  // Bubble profile: lengths should rise toward the peak then fall after it;
  // every dip before the peak or bump after it breaks the convex silhouette
  const peakIndex = lengths.indexOf(maxLength);
  for (let index = 1; index <= peakIndex; index++) {
    const drop = lengths[index - 1] - lengths[index];
    if (drop > 0) score += Math.pow(drop / maxLength, 2) * 300;
  }
  for (let index = peakIndex + 1; index < lineCount; index++) {
    const rise = lengths[index] - lengths[index - 1];
    if (rise > 0) score += Math.pow(rise / maxLength, 2) * 300;
  }

  // The peak reads best at the vertical center of the block: a peak sitting
  // right next to an edge tilts the whole silhouette
  const centerIndex = (lineCount - 1) / 2;
  if (centerIndex > 0) {
    const peakOffset = Math.abs(peakIndex - centerIndex) / centerIndex;
    score += peakOffset * peakOffset * 60;
  }

  // Neighbouring lines must keep close widths for a smooth outline
  for (let index = 1; index < lengths.length; index++) {
    const difference = Math.abs(lengths[index] - lengths[index - 1]) / maxLength;
    const excess = Math.max(0, difference - adjacentSlack);
    score += excess * excess * smoothnessWeight;
    score += Math.max(0, difference - 0.38) * 280;
    // Jumps between two short neighbouring lines barely move the global
    // ratio but read just as badly: also measure against the longer of the
    // two so ragged tails of tiny words get caught
    const localStep = Math.abs(lengths[index] - lengths[index - 1]) / Math.max(lengths[index], lengths[index - 1], 1);
    const localExcess = Math.max(0, localStep - 0.45);
    score += localExcess * localExcess * 700;
  }

  // First and last lines may differ, but a lopsided pair reads badly
  const edgeDifference = Math.abs(lengths[0] - lengths[lineCount - 1]) / maxLength;
  score += Math.pow(Math.max(0, edgeDifference - 0.22), 2) * 240;

  if (minRatio < minLineRatio) {
    score += Math.pow(minLineRatio - minRatio, 2) * 260;
  }
  return score;
};

// Normalized width curve of a block, resampled at fixed relative heights so
// silhouettes of different line counts become directly comparable signatures
const resampleSilhouette = (lengths) => {
  const lineCount = lengths.length;
  const peak = Math.max.apply(null, lengths);
  if (!(peak > 0) || lineCount < 1) return null;
  const curve = new Array(STYLE_RESOLUTION);
  for (let index = 0; index < STYLE_RESOLUTION; index++) {
    const position = ((index + 0.5) / STYLE_RESOLUTION) * lineCount - 0.5;
    const low = clamp(Math.floor(position), 0, lineCount - 1);
    const high = Math.min(low + 1, lineCount - 1);
    const ratio = clamp(position - low, 0, 1);
    const width = lengths[low] + (lengths[high] - lengths[low]) * ratio;
    curve[index] = clamp(width / peak, 0, 1);
  }
  return curve;
};

const meanAdjacentStep = (lengths) => {
  if (lengths.length < 2) return 0;
  let sum = 0;
  for (let index = 1; index < lengths.length; index++) {
    sum += Math.abs(lengths[index] - lengths[index - 1]) / Math.max(lengths[index], lengths[index - 1], 1);
  }
  return sum / (lengths.length - 1);
};

// Learned terms fade in over the first few feedbacks: one sample nudges the
// ranking, four or more make the style a first-class scoring signal. A style
// whose samples contradict each other self-attenuates: confidence follows
// how consistently the user's kept silhouettes resemble one another.
const getStyleConfidence = () => {
  if (!tuning.style) return 0;
  const base = Math.min(1, tuning.samples / 4);
  const consistency = tuning.style.consistency;
  return consistency == null ? base : base * (0.45 + 0.55 * consistency);
};

const HYPHEN_LINE_END = /[A-Za-zÀ-ÖØ-öø-ÿ]-$/;

// Mean relative height (0..1) of the hyphenated lines in a block; the last
// line can't end with a césure so it never counts
const getHyphenLineY = (lineTexts) => {
  let positionSum = 0;
  let hyphenLines = 0;
  for (let index = 0; index < lineTexts.length - 1; index++) {
    if (HYPHEN_LINE_END.test(lineTexts[index])) {
      positionSum += (index + 0.5) / lineTexts.length;
      hyphenLines++;
    }
  }
  return hyphenLines ? positionSum / hyphenLines : null;
};

// Normalized (~0..1) interpretable features of a shape, shared between live
// scoring and the pairwise ranking updates so both speak the same language
const extractShapeFeatures = (lengths, lineTexts, hyphenCount, profile) => {
  const lineCount = lengths.length;
  const peak = Math.max.apply(null, lengths) || 1;
  const target = profile.lineTarget || 4;
  const maxLineWidth = profile.maxLineWidth || 28;
  let stepMax = 0;
  let stepSum = 0;
  for (let index = 1; index < lineCount; index++) {
    const step = Math.abs(lengths[index] - lengths[index - 1]) / Math.max(lengths[index], lengths[index - 1], 1);
    stepSum += step;
    if (step > stepMax) stepMax = step;
  }
  const peakIndex = lengths.indexOf(Math.max.apply(null, lengths));
  const center = (lineCount - 1) / 2;
  let convexity = 0;
  for (let index = 1; index <= peakIndex; index++) {
    const drop = lengths[index - 1] - lengths[index];
    if (drop > 0) convexity += drop / peak;
  }
  for (let index = peakIndex + 1; index < lineCount; index++) {
    const rise = lengths[index] - lengths[index - 1];
    if (rise > 0) convexity += rise / peak;
  }
  let punctuationEnds = 0;
  let wideLines = 0;
  for (let index = 0; index < lineCount; index++) {
    if (index < lineCount - 1 && endsWithBreakPunctuation(lineTexts[index])) punctuationEnds++;
    if (lengths[index] > maxLineWidth * 0.92) wideLines++;
  }
  return {
    hyphens: Math.min(1, hyphenCount / 2),
    lineSurplus: clamp((lineCount - target) / 3, 0, 1),
    lineDeficit: clamp((target - lineCount) / 3, 0, 1),
    stepMean: lineCount > 1 ? clamp(stepSum / (lineCount - 1), 0, 1) : 0,
    stepMax: clamp(stepMax, 0, 1),
    edgeTop: clamp(lengths[0] / peak, 0, 1),
    edgeBottom: clamp(lengths[lineCount - 1] / peak, 0, 1),
    peakOffset: center > 0 ? clamp(Math.abs(peakIndex - center) / center, 0, 1) : 0,
    convexity: clamp(convexity, 0, 1),
    minRatio: clamp(Math.min.apply(null, lengths) / peak, 0, 1),
    punctEnds: lineCount > 1 ? punctuationEnds / (lineCount - 1) : 0,
    wideLines: wideLines / lineCount,
  };
};

const dotFeatures = (weights, features) => {
  let sum = 0;
  for (const key in weights) {
    if (features[key]) sum += weights[key] * features[key];
  }
  return sum;
};

const curveDistance = (a, b) => {
  let distance = 0;
  for (let index = 0; index < STYLE_RESOLUTION; index++) {
    const diff = a[index] - b[index];
    distance += diff * diff;
  }
  return distance / STYLE_RESOLUTION;
};

// Exact layouts are only authoritative in a comparable bubble. Reusing an
// old break pattern in a differently proportioned or differently shaped
// bubble can otherwise bypass physical-fit checks merely because the dialogue
// text happens to be identical.
const exemplarContextMatches = (exemplar, aspect, bubble) => {
  if (aspect != null) {
    if (exemplar.aspect == null || Math.abs(Math.log(exemplar.aspect / aspect)) > 0.3) return false;
  }
  if (bubble) {
    if (!exemplar.bubble || curveDistance(bubble, exemplar.bubble) > 0.025) return false;
  }
  return true;
};

const exemplarStorageContextMatches = (exemplar, aspect, bubble) => {
  if (aspect == null && !bubble) return exemplar.aspect == null && !exemplar.bubble;
  return exemplarContextMatches(exemplar, aspect, bubble);
};

// Exemplars whose context (text volume, bubble aspect, bubble outline)
// resembles the current request: preferences are conditioned on context
// instead of averaged globally — a squat wide bubble, a tall narrow one and
// a pointed one each keep their own learned style
const getMatchedExemplars = (units, aspect, bubble) => {
  const exemplars = tuning.exemplars;
  if (!exemplars || !exemplars.length) return [];
  const scored = exemplars.map((exemplar, index) => {
    let distance = Math.abs(Math.log(exemplar.units / Math.max(1, units)));
    if (aspect != null && exemplar.aspect != null) {
      distance += Math.abs(Math.log(exemplar.aspect / aspect)) * 0.8;
    } else {
      distance += 0.25;
    }
    if (bubble && exemplar.bubble) {
      // Same-shaped bubbles (round vs oval vs pointed) call for the same
      // text shape: outline distance outweighs the coarse ratio term
      distance += Math.sqrt(curveDistance(bubble, exemplar.bubble)) * 2.2;
    } else if (bubble || exemplar.bubble) {
      distance += 0.2;
    }
    // Styles drift: older exemplars (stored first) fade behind recent ones,
    // and a shape the user re-validated several times pulls harder
    distance += 0.22 * (1 - (index + 1) / exemplars.length);
    distance -= Math.min(0.18, Math.log(exemplar.hits || 1) * 0.08);
    return { exemplar, distance };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, 3).filter((entry) => entry.distance < 1.4).map((entry) => entry.exemplar);
};

const getExemplarConfidence = () => (
  tuning.exemplars && tuning.exemplars.length ? Math.min(1, tuning.exemplars.length / 5) : 0
);

// Learned ranking weights: the linear term the pairwise updates trained so
// the user's kept shapes outrank the generator's own favourites
const scoreLearnedWeights = (lengths, lineTexts, hyphenCount, profile) => {
  const weights = tuning.weights;
  if (!weights) return 0;
  return dotFeatures(weights, extractShapeFeatures(lengths, lineTexts, hyphenCount, profile));
};

// Exemplar affinity: silhouette distance to the closest context-matched
// exemplar. This is what "propose shapes in my style" means concretely.
const scoreExemplarAffinity = (lengths, profile) => {
  const curves = profile.exemplarCurves;
  if (!curves || !curves.length || lengths.length < 2) return 0;
  const confidence = getExemplarConfidence();
  if (confidence <= 0) return 0;
  const curve = resampleSilhouette(lengths);
  if (!curve) return 0;
  let best = Infinity;
  curves.forEach((exemplarCurve) => {
    const distance = curveDistance(curve, exemplarCurve);
    if (distance < best) best = distance;
  });
  return Number.isFinite(best) ? best * 700 * confidence : 0;
};

// Style affinity: distance between a candidate and the learned profile.
// Bounded weights keep it below the physical-fit penalties, but decisive
// between shapes of comparable geometric quality.
const scoreStyleAffinity = (lengths, lines, hyphenCount) => {
  const style = tuning.style;
  const confidence = getStyleConfidence();
  if (!style || confidence <= 0) return 0;
  let score = 0;
  if (style.silhouette && lengths.length >= 2) {
    const curve = resampleSilhouette(lengths);
    if (curve) {
      let distance = 0;
      for (let index = 0; index < STYLE_RESOLUTION; index++) {
        const diff = curve[index] - style.silhouette[index];
        distance += diff * diff;
      }
      score += (distance / STYLE_RESOLUTION) * 420 * confidence;
    }
  }
  if (style.density != null && lengths.length >= 1) {
    // Text quantity per line is the strongest fingerprint of a typesetter's
    // style: score each candidate's own density against the learned one
    // instead of only steering the global line-count target with it
    const density = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
    const offset = Math.abs(Math.log(Math.max(1, density) / style.density));
    score += Math.max(0, offset - 0.08) * 260 * confidence;
  }
  if (style.hyphenRate != null && lengths.length >= 2) {
    // Learn both sides of the habit. A user who avoids césures makes them
    // costlier, while one who regularly validates them makes hyphen-free
    // candidates diverge from the learned style instead of fighting the
    // permanent generic hyphen penalty alone.
    const hyphenRate = hyphenCount / (lengths.length - 1);
    const offset = Math.abs(hyphenRate - style.hyphenRate);
    score += Math.max(0, offset - 0.08) * 160 * confidence;
  }
  if (style.stepMean != null && lengths.length >= 2) {
    // The user keeps a consistent contrast between neighbouring lines:
    // both flatter and steppier candidates drift away from their style
    const excess = Math.abs(meanAdjacentStep(lengths) - style.stepMean) - 0.05;
    if (excess > 0) score += excess * excess * 520 * confidence;
  }
  if (style.hyphenLineY != null && hyphenCount > 0) {
    const candidateY = getHyphenLineY(lines.map((line) => lineText(line)));
    if (candidateY != null) {
      const offset = Math.abs(candidateY - style.hyphenLineY);
      score += Math.max(0, offset - 0.12) * 90 * confidence;
    }
  }
  return score;
};

const scoreCandidate = (lines, hyphenCount, profile) => {
  const lengths = lines.map((line) => lineLength(line));
  const lineCount = lines.length;
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const shapeRows = profile.shapeRows && profile.shapeRows.length ? profile.shapeRows : null;
  let targets;
  if (shapeRows) {
    // Targets follow the bubble outline at each line's real rendered height
    // (pixel-calibrated when available) instead of a generic curve
    const rowWeights = lengths.map((_, index) => {
      if (profile.fit) {
        return Math.max(0.12, getFitAvailableUnits(index, lineCount, profile.fit));
      }
      return Math.max(0.12, getProfileWidthAt(shapeRows, (index + 0.5) / lineCount) || 0);
    });
    const rowTotal = rowWeights.reduce((sum, weight) => sum + weight, 0) || 1;
    targets = rowWeights.map((weight) => (totalLength * weight) / rowTotal);
  } else {
    const weights = buildWeights(lineCount, (profile.scoreCurve || 0.65) + tuning.curveDelta, 0, profile.minWeight);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    targets = weights.map((weight) => (totalLength * weight) / weightTotal);
  }
  const maxLength = Math.max.apply(null, lengths);

  const maxLineWidth = profile.maxLineWidth || 28;
  const lineTargetWeight = profile.lineTargetWeight == null ? 16 : profile.lineTargetWeight;
  // Falling short of the target (fewer, longer lines) hurts more than adding
  // a line: manga bubbles read best as compact multi-line stacks, and long
  // 1-2 line blocks are exactly what escapes bubble outlines
  const lineDelta = lineCount - profile.lineTarget;
  const lineDeltaFactor = lineDelta < 0 ? 3 : 1;
  // Hyphenation is a last resort: the penalty must outweigh moderate shape
  // gains so hyphen-free layouts rank first unless breaking a word is the
  // only way to reach a pleasant silhouette
  let score = hyphenCount * 130 * tuning.hyphenPenaltyScale + Math.pow(Math.abs(lineDelta), 1.5) * lineTargetWeight * lineDeltaFactor;

  const fit = profile.fit;
  if (fit) {
    // Absolute fit check in real pixels: text escaping the bubble outline
    // must lose to any candidate that stays inside, whatever its aesthetics
    const heightExcess = Math.max(0, (lineCount * fit.linePx) / (fit.height * FIT_MARGIN) - 1);
    if (heightExcess > 0) score += 80 + heightExcess * heightExcess * 900;
    lengths.forEach((length, index) => {
      const available = getFitAvailableUnits(index, lineCount, fit);
      if (available <= 0) {
        score += 120;
        return;
      }
      const excess = Math.max(0, length / available - 1);
      if (excess > 0) score += 60 + excess * excess * 1600;
    });
  }
  // Learned punctuation habit scales the break-at-punctuation reward toward
  // how often the user's own shapes actually end lines on punctuation
  let punctuationBonus = profile.punctuationBreakBonus || 0;
  const styleConfidence = getStyleConfidence();
  if (styleConfidence > 0 && tuning.style.punctEndRate != null) {
    const preferredScale = 0.4 + tuning.style.punctEndRate * 1.6;
    punctuationBonus *= 1 + (preferredScale - 1) * styleConfidence;
  }
  // With a bubble outline the per-line targets mirror the bubble contour;
  // as the learned style gains confidence that contour-hugging objective
  // fades and the style affinity terms take over the shape choice. Physical
  // fit stays fully enforced above — this only softens aesthetics.
  const contourTrust = shapeRows ? 1 - 0.65 * getStyleConfidence() : 1;
  lengths.forEach((length, index) => {
    const target = targets[index] || 1;
    const relative = (length - target) / target;
    score += relative * relative * 120 * contourTrust;
    // Overlong lines break out of the bubble: penalize width past the profile cap
    const widthExcess = Math.max(0, length - maxLineWidth) / maxLineWidth;
    score += widthExcess * widthExcess * 320;
    if (length <= 1) score += 30;
    if (lineCount > 3 && visibleLength(lineText(lines[index])) <= 4) score += 8;
    if (/^[.,;:!?]+$/.test(serializeLines([lines[index]]))) score += 40;
    if (index < lineCount - 1 && endsWithBreakPunctuation(lineText(lines[index]))) {
      score -= punctuationBonus;
    }
  });

  score += scoreStyleAffinity(lengths, lines, hyphenCount);

  if (tuning.weights || (profile.exemplarCurves && profile.exemplarCurves.length)) {
    const lineTexts = lines.map((line) => lineText(line));
    if (tuning.weights) score += scoreLearnedWeights(lengths, lineTexts, hyphenCount, profile);
    score += scoreExemplarAffinity(lengths, profile);
  }

  if (shapeRows && maxLength > 0 && lineCount > 1) {
    // With a real outline each width step should match the outline's step...
    const smoothnessWeight = profile.smoothnessWeight == null ? 160 : profile.smoothnessWeight;
    for (let index = 1; index < lengths.length; index++) {
      const stepError = ((lengths[index] - lengths[index - 1]) - (targets[index] - targets[index - 1])) / maxLength;
      score += stepError * stepError * smoothnessWeight * contourTrust;
    }
    // ...but outline following alone lets a noisy wand scan produce lopsided
    // blocks: the shared silhouette aesthetics still apply so the result
    // stays harmonious (peak centered, short edges, no abrupt width jumps).
    // The min-line floor is relaxed a little: a genuinely narrow bubble tip
    // legitimately asks for a shorter edge line than the generic silhouette.
    score += scoreSilhouetteAesthetics(lengths, {
      adjacentSlack: profile.adjacentSlack,
      smoothnessWeight: profile.smoothnessWeight,
      minLineRatio: (profile.minLineRatio == null ? 0.34 : profile.minLineRatio) * 0.85,
    });
    return score;
  }

  score += scoreSilhouetteAesthetics(lengths, profile);
  return score;
};

const makeBaseTokens = (words) => words.map((word) => ({ text: word }));

const sumTokenRange = (tokens, from, to) => {
  let width = 0;
  for (let index = from; index < to; index++) {
    if (index > from) width += 0.45;
    width += tokenLength(tokens[index]);
  }
  return width;
};

const getManualShapeWeight = (position, shape, softness, floor) => {
  const normalized = Math.abs(position);
  let weight = 1;
  if (shape === "diamond") {
    weight = 1 - normalized;
  } else if (shape === "ellipse") {
    weight = Math.sqrt(Math.max(0, 1 - normalized * normalized));
  } else {
    weight = Math.cos(Math.PI * normalized / 2);
  }
  return Math.max(floor, Math.pow(Math.max(0, weight), softness));
};

const normalizeShapeRows = (shapeProfile) => {
  const rows = Array.isArray(shapeProfile?.rows) ? shapeProfile.rows : [];
  return rows
    .map((row) => ({
      y: clamp(Number(row.y), 0, 1),
      left: clamp(Number(row.left), 0, 1),
      right: clamp(Number(row.right), 0, 1),
      width: clamp(Number(row.width), 0, 1),
    }))
    .filter((row) => Number.isFinite(row.y) && Number.isFinite(row.width))
    .sort((a, b) => a.y - b.y);
};

const getProfileWidthAt = (rows, y) => {
  if (!rows.length) return null;
  if (y <= rows[0].y) return rows[0].width;
  const last = rows[rows.length - 1];
  if (y >= last.y) return last.width;
  for (let index = 1; index < rows.length; index++) {
    const next = rows[index];
    if (y > next.y) continue;
    const prev = rows[index - 1];
    const span = next.y - prev.y || 1;
    const ratio = (y - prev.y) / span;
    return prev.width + (next.width - prev.width) * ratio;
  }
  return last.width;
};

// Normalized outline signature of a bubble selection: widths sampled at
// STYLE_RESOLUTION heights, peak-normalized so bubbles of any size compare —
// this is what "round bubble" vs "pointed bubble" looks like to the matcher
const getBubbleSignature = (rows) => {
  if (!rows || rows.length < 2) return null;
  const samples = [];
  let peak = 0;
  for (let index = 0; index < STYLE_RESOLUTION; index++) {
    const width = getProfileWidthAt(rows, (index + 0.5) / STYLE_RESOLUTION) || 0;
    samples.push(width);
    if (width > peak) peak = width;
  }
  if (peak <= 0) return null;
  return samples.map((value) => clamp(value / peak, 0.02, 1));
};

// Fraction of the bubble kept as breathing room between text and outline
const FIT_MARGIN = 0.9;

// Vertical position (0..1 of bubble height) of a line's center when the
// whole block sits vertically centered in the bubble
const getFitLineY = (index, lineCount, fit) => (
  0.5 + (index + 0.5 - lineCount / 2) * (fit.linePx / fit.height)
);

// Fraction of a line's leading actually covered by its glyphs: the band the
// outline must accommodate around the line's center
const FIT_GLYPH_BAND = 0.8;

// Width (in measure units) actually available inside the bubble outline over
// the vertical band this line renders in. Sampling only the band center
// overestimates what a convex outline offers to the top and bottom lines
// (their far edge sits on a narrower part of the curve) — exactly where text
// used to escape the bubble: keep the minimum across the band instead.
const getFitAvailableUnits = (index, lineCount, fit) => {
  if (!fit.rows) return (fit.width * FIT_MARGIN) / fit.unitPx;
  const yCenter = getFitLineY(index, lineCount, fit);
  const halfBand = (fit.linePx / fit.height) * (FIT_GLYPH_BAND / 2);
  let rowWidth = Infinity;
  [yCenter - halfBand, yCenter, yCenter + halfBand].forEach((y) => {
    const width = getProfileWidthAt(fit.rows, clamp(y, 0, 1));
    if (width != null && width < rowWidth) rowWidth = width;
  });
  if (!Number.isFinite(rowWidth)) rowWidth = 0;
  return (fit.width * Math.max(0, rowWidth) * FIT_MARGIN) / fit.unitPx;
};

// True when every line of a variant physically stays inside the bubble
// outline (small tolerance for measurement noise)
const variantFitsBubble = (lines, fit) => {
  const lineCount = lines.length;
  if (lineCount * fit.linePx > fit.height * FIT_MARGIN * 1.02) return false;
  return lines.every((line, index) => (
    visibleWidth(line) <= getFitAvailableUnits(index, lineCount, fit) * 1.02
  ));
};

// Lines packed at 100% of their row capacity overflow on the slightest
// measurement error: the estimated line count must leave headroom
const FIT_CAPACITY_SLACK = 1.12;

// Blocks read best when slightly taller than the bubble's own proportions:
// extra lines shorten every line, keeping the outline clear of the text
const FIT_ASPECT_LEAN = 1.15;

// Line count whose text block best echoes the bubble's proportions, among
// the counts that physically hold the whole text. Picking the smallest
// fitting count (the old rule) packs the text into 1-2 lines that run the
// full bubble width and clip the outline on any measurement error; matching
// the bubble aspect yields the compact multi-line stack a round bubble asks
// for, with the peak line well inside the outline.
const estimateFitLineCount = (totalUnits, fit) => {
  const maxByHeight = Math.max(1, Math.floor((fit.height * FIT_MARGIN) / fit.linePx));
  const limit = Math.min(8, maxByHeight);
  const bubbleAspect = fit.height / Math.max(1, fit.width);
  let best = 0;
  let bestCost = Infinity;
  let tightest = 0;
  for (let lineCount = 1; lineCount <= limit; lineCount++) {
    let capacity = 0;
    let widest = 0;
    for (let index = 0; index < lineCount; index++) {
      const units = getFitAvailableUnits(index, lineCount, fit);
      capacity += units;
      if (units > widest) widest = units;
    }
    if (capacity < totalUnits) continue;
    if (!tightest) tightest = lineCount;
    const fill = totalUnits / capacity;
    // Widest line the shaped block would render at this count, in pixels
    const widestLinePx = Math.max(1, widest * fill * fit.unitPx);
    const blockAspect = (lineCount * fit.linePx) / widestLinePx;
    let cost = Math.abs(Math.log(blockAspect / (bubbleAspect * FIT_ASPECT_LEAN)));
    // Rows packed close to capacity overflow on the slightest mismeasure
    const headroomExcess = Math.max(0, fill * FIT_CAPACITY_SLACK - 1);
    cost += headroomExcess * 6;
    if (cost < bestCost) {
      bestCost = cost;
      best = lineCount;
    }
  }
  return best || tightest || limit;
};

// Physically valid line-count range for a calibrated bubble: from the
// smallest count whose rows hold the whole text up to what the height
// allows. Within this range the choice belongs to the learned style, not
// to the bubble — the bubble is a constraint, not an objective.
const getFitLineCountBounds = (totalUnits, fit) => {
  const maxByHeight = Math.max(1, Math.floor((fit.height * FIT_MARGIN) / fit.linePx));
  const limit = Math.min(8, maxByHeight);
  let tightest = 0;
  for (let lineCount = 1; lineCount <= limit; lineCount++) {
    let capacity = 0;
    for (let index = 0; index < lineCount; index++) {
      capacity += getFitAvailableUnits(index, lineCount, fit);
    }
    if (capacity >= totalUnits) {
      tightest = lineCount;
      break;
    }
  }
  return { min: tightest || limit, max: limit };
};

const buildManualTargets = (tokens, lineCount, settings) => {
  const shape = settings.shape || "sine";
  const softness = settings.softness || 0.6;
  const floor = settings.floor == null ? 0.15 : settings.floor;
  const profileRows = normalizeShapeRows(settings.shapeProfile);
  const weights = Array.from({ length: lineCount }, (_, index) => {
    const y = lineCount <= 1 ? 0.5 : (index + 0.5) / lineCount;
    if (shape === "selection" && profileRows.length) {
      return Math.max(floor, getProfileWidthAt(profileRows, y) || 0);
    }
    const position = 2 * y - 1;
    return getManualShapeWeight(position, shape, softness, floor);
  });
  const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount) * 0.45;
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const peak = total / weightTotal;
  return weights.map((weight) => Math.max(1, weight * peak));
};

const splitTokensForManualTargets = (tokens, targets, settings) => {
  const lineCount = targets.length;
  const tokenCount = tokens.length;
  if (!tokenCount || lineCount < 1 || tokenCount < lineCount) return null;

  const punctuationBonus = settings.punctuationBonus == null ? 0.04 : settings.punctuationBonus;
  const edgeMin = settings.edgeMin || 0;
  const edgeMinPenalty = settings.edgeMinPenalty == null ? 1.8 : settings.edgeMinPenalty;
  const { prefix, charPrefix, endsBreak, punctCount } = getTokenMetrics(tokens);
  const dp = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(Infinity));
  const prev = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(-1));
  dp[0][0] = 0;

  // Prefix sums keep every line cost O(1); this DP runs on every manual
  // slider tick so re-joining and re-measuring strings here froze the drag
  const lineCost = (lineIndex, from, to, target, width) => {
    const ratio = (width - target) / target;
    let cost = ratio * ratio;
    if (lineIndex < lineCount - 1 && endsBreak[to - 1]) {
      cost = Math.max(0, cost - punctuationBonus);
    }
    if ((lineIndex === 0 || lineIndex === lineCount - 1) && edgeMin > 0 && charPrefix[to] - charPrefix[from] + (to - from - 1) < edgeMin) {
      cost += edgeMinPenalty;
    }
    if (punctCount[to] - punctCount[from] === to - from) cost += 3;
    return cost;
  };

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const target = targets[lineIndex] || 1;
    const pruneWidth = target * (1 + DP_WIDTH_PRUNE_RATIO);
    for (let from = lineIndex; from <= tokenCount; from++) {
      if (!Number.isFinite(dp[lineIndex][from])) continue;
      const remainingLines = lineCount - lineIndex - 1;
      const maxTo = tokenCount - remainingLines;
      for (let to = from + 1; to <= maxTo; to++) {
        const width = prefix[to] - prefix[from] + 0.45 * (to - from - 1);
        if (width > pruneWidth && to > from + 1) break;
        const nextCost = dp[lineIndex][from] + lineCost(lineIndex, from, to, target, width);
        if (nextCost < dp[lineIndex + 1][to]) {
          dp[lineIndex + 1][to] = nextCost;
          prev[lineIndex + 1][to] = from;
        }
      }
    }
  }

  if (!Number.isFinite(dp[lineCount][tokenCount])) return null;

  const ranges = [];
  let cursor = tokenCount;
  for (let lineIndex = lineCount; lineIndex > 0; lineIndex--) {
    const from = prev[lineIndex][cursor];
    if (from < 0) return null;
    ranges.unshift([from, cursor]);
    cursor = from;
  }
  return {
    ranges,
    cost: dp[lineCount][tokenCount],
  };
};

const estimateManualLineCount = (text, width = 320, height = 280) => {
  const normalized = normalizeText(text);
  if (!normalized) return 1;
  const wordCount = mergePunctuationWords(splitWordsPreservingMarkdown(normalized)).length;
  if (wordCount <= 2) return 1;
  const aspect = clamp((height || 1) / Math.max(1, width || 1), 0.35, 2.4);
  const maxLines = Math.min(8, Math.max(1, wordCount));
  // Lean toward one more line than the square split: compact multi-line
  // stacks track a bubble outline better than fewer, longer lines
  return clamp(Math.round(Math.sqrt(wordCount * aspect * 1.5)), 2, maxLines);
};

let nextTokenSetId = 1;
const getTokenSetId = (tokens) => {
  if (!tokens.__id) tokens.__id = nextTokenSetId++;
  return tokens.__id;
};

const addCandidate = (resultMap, seenTargets, tokens, lineCount, curve, shift, bias, hyphenCount, profile, targetsOverride, minWeightOverride) => {
  if (!tokens.length || tokens.length < lineCount) return;
  const targets = targetsOverride || buildTargets(tokens, lineCount, curve, shift, bias, minWeightOverride == null ? profile.minWeight : minWeightOverride);
  // Many curve/shift/bias combos collapse to (near) identical line targets
  // once clamped: dedupe BEFORE the DP runs, not after, at ~quarter-char
  // resolution — the split is insensitive to smaller target changes
  let signature = getTokenSetId(tokens) + ":" + lineCount;
  for (let index = 0; index < targets.length; index++) {
    signature += "," + Math.round(targets[index] * 4);
  }
  if (seenTargets.has(signature)) return;
  seenTargets.add(signature);
  const lines = buildCandidate(tokens, lineCount, targets);
  if (!lines) return;
  const text = serializeLines(lines);
  if (!text || resultMap.has(text)) return;
  resultMap.set(text, {
    id: `shape-${resultMap.size + 1}`,
    text,
    lines: text.split("\n"),
    score: scoreCandidate(lines, hyphenCount, profile),
    hyphenCount,
  });
};

const generateHyphenTokenSets = (words, baseTokens) => {
  const sets = [];
  words.forEach((word, wordIndex) => {
    getHyphenSplits(word).forEach((split) => {
      const tokens = [];
      words.forEach((currentWord, index) => {
        if (index !== wordIndex) {
          // Reuse the base token objects so their cached measured widths are
          // shared across every hyphen set instead of re-measured
          tokens.push(baseTokens[index]);
          return;
        }
        tokens.push({ text: split.prefix, forceBreakAfter: true });
        tokens.push({ text: split.suffix });
      });
      sets.push(tokens);
    });
  });
  return sets;
};

// Same text + same options come back often (hover refreshes, panel
// re-mounts, page switches): cache the last few results so those are free
const VARIANT_CACHE_LIMIT = 16;
const variantCache = new Map();

const getVariantCacheKey = (text, options) => JSON.stringify([
  // The toggle changes normalization, so cached entries must not cross it
  dehyphenationEnabled,
  // Feedback tuning changes scoring: cached lists must not survive it
  tuningRevision,
  text,
  options.profile || null,
  options.limit || null,
  options.maxLines || null,
  options.allowHyphenation !== false,
  options.width || null,
  options.height || null,
  options.shapeProfile?.rows || null,
  // Quantized so sub-pixel calibration jitter doesn't defeat the cache
  options.calibration
    ? [Math.round(options.calibration.unitPx * 50), Math.round(options.calibration.linePx * 5)]
    : null,
]);

const generateTextShapeRVariants = (text, options = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const cacheKey = getVariantCacheKey(normalized, options);
  const cached = variantCache.get(cacheKey);
  if (cached) return cached;

  const profile = PROFILE_PRESETS[options.profile] || PROFILE_PRESETS.balanced;
  const words = mergePunctuationWords(splitWordsPreservingMarkdown(normalized));
  const totalUnits = visibleWidth(normalized);
  const widestWordUnits = words.reduce((max, word) => Math.max(max, visibleWidth(word)), 1);
  // Hard readability cap on line count: the widest word sets the block peak,
  // and past this count some line is forced down to a lone tiny word beside
  // it — the ragged staircases no scoring tweak can save. Hyphen token sets
  // compute their own cap because splitting the widest word raises it.
  const granularityMaxLines = clamp(Math.floor(totalUnits / (widestWordUnits * 0.72)), 1, 8);
  const resultMap = new Map();
  const seenTargets = new Set();
  const shapeRows = normalizeShapeRows(options.shapeProfile).filter((row) => row.width > 0);
  // Pixel calibration measured on the live layer (rendered px per measure
  // unit, rendered px per line): turns relative shape scoring into a real
  // "does this line physically fit the bubble" constraint
  const calibration = options.calibration;
  const fit = calibration && calibration.unitPx > 0 && calibration.linePx > 0
      && options.width > 0 && options.height > 0
    ? {
      unitPx: calibration.unitPx,
      linePx: calibration.linePx,
      width: options.width,
      height: options.height,
      rows: shapeRows.length > 1 ? shapeRows : null,
    }
    : null;
  const aspect = options.width > 0 && options.height > 0
    ? clamp(options.height / options.width, 0.25, 3)
    : null;
  const isTallBubble = aspect != null && aspect >= 1.15;
  const isWideBubble = aspect != null && aspect <= 0.85;
  // Tall bubbles want narrower lines, wide ones can afford longer lines
  const aspectStretch = aspect == null ? 1 : clamp(Math.sqrt(aspect), 0.7, 1.45);
  // Exemplars validated in a similar context (text volume, bubble ratio and
  // outline): their silhouettes and densities carry the user's style here
  const bubbleSignature = getBubbleSignature(shapeRows);
  const matchedExemplars = getMatchedExemplars(totalUnits, aspect, bubbleSignature);
  let scoringProfile = profile;
  let shapeTargetSettings = null;
  if (aspect == null && shapeRows.length <= 1) {
    // No bubble info at all: the preset's fixed line target over-shoots
    // short texts and under-shoots long ones — adapt it to the text volume
    // (average line width grows with the line count, roughly sqrt-shaped)
    const volumeTarget = Math.round(Math.sqrt(totalUnits / 2.6));
    scoringProfile = {
      ...profile,
      lineTarget: clamp(volumeTarget, Math.min(profile.minLines, granularityMaxLines), Math.min(profile.maxLines, Math.max(granularityMaxLines, 1))),
    };
  }
  if (aspect != null && shapeRows.length <= 1) {
    // Aspect known but no usable outline: still lean the scoring toward it
    scoringProfile = {
      ...profile,
      lineTarget: clamp(Math.round(profile.lineTarget * aspectStretch), 1, Math.max(1, Math.min(8, granularityMaxLines))),
      maxLineWidth: clamp((profile.maxLineWidth || 28) / aspectStretch, 12, 40),
      lineTargetWeight: 12,
    };
  }
  if (shapeRows.length > 1) {
    // A live Photoshop selection outlines the bubble: bias the line count to
    // the bubble's aspect ratio and score candidates against its silhouette.
    // With pixel calibration the estimate becomes exact: the smallest line
    // count whose rows physically hold the text.
    const estimatedLines = fit
      ? estimateFitLineCount(totalUnits, fit)
      : estimateManualLineCount(normalized, options.width || 320, options.height || 280);
    scoringProfile = {
      ...profile,
      shapeRows,
      lineTarget: clamp(estimatedLines, 1, Math.max(profile.maxLines, estimatedLines)),
      // Soft enough that shapes one line taller/shorter still reach the list
      lineTargetWeight: 24,
      maxLineWidth: clamp((profile.maxLineWidth || 28) / aspectStretch, 12, 40),
    };
    shapeTargetSettings = {
      shape: "selection",
      shapeProfile: options.shapeProfile,
      softness: 1,
      floor: 0.14,
    };
  }
  const styleConfidence = getStyleConfidence();
  let learnedDensity = styleConfidence > 0 && tuning.style.density ? tuning.style.density : null;
  let densityConfidence = styleConfidence;
  if (matchedExemplars.length) {
    // Context-matched exemplars know this case better than the global EMA:
    // their own text-per-line density dominates the blend, re-validated
    // shapes (higher hits) weighing proportionally more
    const hitTotal = matchedExemplars.reduce((sum, exemplar) => sum + (exemplar.hits || 1), 0) || 1;
    const localDensity = matchedExemplars.reduce((sum, exemplar) => (
      sum + (exemplar.units / exemplar.lineCount) * (exemplar.hits || 1)
    ), 0) / hitTotal;
    learnedDensity = learnedDensity ? localDensity * 0.7 + learnedDensity * 0.3 : localDensity;
    densityConfidence = Math.max(densityConfidence, getExemplarConfidence());
  }
  if (tuning.lineTargetBias || learnedDensity) {
    // Learned preference: the coarse taller/shorter bias shifts the target,
    // and the learned density (text quantity per line) derives the count the
    // user's own shapes would give this exact text — it generalizes across
    // texts of any length instead of replaying a fixed line-count delta
    let learnedTarget = scoringProfile.lineTarget + tuning.lineTargetBias;
    if (learnedDensity) {
      const densityLines = totalUnits / learnedDensity;
      learnedTarget += (densityLines - learnedTarget) * 0.65 * densityConfidence;
    }
    if (fit) {
      // The bubble is a hard constraint, not an objective: counts that
      // cannot physically hold the text are out, but within the valid range
      // the learned style decides — the old ±1 clamp around the calibrated
      // estimate silenced strong learned preferences (e.g. compact stacks)
      const bounds = getFitLineCountBounds(totalUnits, fit);
      learnedTarget = clamp(learnedTarget, bounds.min, bounds.max);
    }
    const biasedTarget = clamp(
      Math.round(learnedTarget),
      1,
      Math.max(1, Math.min(8, granularityMaxLines))
    );
    if (biasedTarget !== scoringProfile.lineTarget) {
      scoringProfile = { ...scoringProfile, lineTarget: biasedTarget };
    }
  }
  if (fit) {
    // Cap line width by what the widest part of the bubble physically holds
    const widestRow = fit.rows
      ? fit.rows.reduce((max, row) => Math.max(max, row.width), 0)
      : 1;
    const absoluteMax = (fit.width * widestRow * FIT_MARGIN) / fit.unitPx;
    scoringProfile = {
      ...scoringProfile,
      fit,
      maxLineWidth: clamp(Math.min(scoringProfile.maxLineWidth || 28, absoluteMax), 6, 60),
    };
  }
  // Candidates are scored against the matched exemplars' silhouettes: "in my
  // style" becomes "close to a shape I actually kept in a similar context"
  const exemplarCurves = matchedExemplars.map((exemplar) => exemplar.curve).filter(Boolean);
  if (exemplarCurves.length) {
    scoringProfile = { ...scoringProfile, exemplarCurves };
  }
  const baseMinLines = words.length <= 2 ? 1 : profile.minLines;
  let minLines = Math.min(Math.max(1, baseMinLines), Math.max(1, words.length));
  if (shapeRows.length > 1 && fit) {
    // The calibrated estimate knows how much text the bubble really holds:
    // allow shorter blocks than the preset minimum when the bubble asks
    minLines = Math.min(minLines, Math.max(1, scoringProfile.lineTarget));
  }
  const profileMaxLines = shapeRows.length > 1 ? Math.max(profile.maxLines, Math.min(8, scoringProfile.lineTarget + 1)) : profile.maxLines;
  let maxLines = Math.min(options.maxLines || profileMaxLines, Math.max(1, words.length));
  // Stretch the explored line range toward the bubble ratio so a tall bubble
  // also gets taller suggestions and a wide bubble also gets shorter ones
  if (isTallBubble) {
    maxLines = Math.min(Math.max(1, words.length), Math.min(8, maxLines + (aspect >= 1.6 ? 2 : 1)));
  }
  if (isWideBubble) {
    minLines = Math.max(1, minLines - 1);
  }
  // The granularity cap always wins over profile and bubble stretching, but
  // never pushes the range below the minimum line count
  maxLines = Math.max(minLines, Math.min(maxLines, granularityMaxLines));
  // Always generate with the requested profile; when the bubble ratio leans
  // tall or wide, also generate with that preset's params for extra variety
  const generationParams = [profile];
  if (isTallBubble && profile !== PROFILE_PRESETS.tall) generationParams.push(PROFILE_PRESETS.tall);
  if (isWideBubble && profile !== PROFILE_PRESETS.wide) generationParams.push(PROFILE_PRESETS.wide);
  const baseTokens = makeBaseTokens(words);

  const addShapeCandidates = (tokens, lineCount, hyphenCount) => {
    if (!shapeTargetSettings) return;
    let targets;
    if (fit) {
      // Aim the DP straight at the width the bubble physically offers at each
      // line's rendered height, scaled down to the amount of text: the block
      // then mirrors the outline instead of a generic curve capped afterwards
      const available = [];
      for (let index = 0; index < lineCount; index++) {
        available.push(Math.max(1, getFitAvailableUnits(index, lineCount, fit)));
      }
      const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount) * 0.45;
      const availableTotal = available.reduce((sum, units) => sum + units, 0) || 1;
      const scale = Math.min(1, total / availableTotal);
      targets = available.map((units) => Math.max(1, units * scale));
    } else {
      targets = buildManualTargets(tokens, lineCount, shapeTargetSettings);
    }
    [-1, 0, 1].forEach((bias) => {
      const biasedTargets = bias === 0 ? targets : targets.map((target) => Math.max(1, target + bias));
      addCandidate(resultMap, seenTargets, tokens, lineCount, 0, 0, 0, hyphenCount, scoringProfile, biasedTargets);
    });
  };

  for (let lineCount = minLines; lineCount <= maxLines; lineCount++) {
    generationParams.forEach((params) => {
      params.curves.forEach((curve) => {
        params.shifts.forEach((shift) => {
          params.biases.forEach((bias) => addCandidate(resultMap, seenTargets, baseTokens, lineCount, curve, shift, bias, 0, scoringProfile, null, params.minWeight));
        });
      });
    });
    addShapeCandidates(baseTokens, lineCount, 0);
  }

  if (options.allowHyphenation !== false) {
    generateHyphenTokenSets(words, baseTokens).forEach((tokens) => {
      // Hyphen sets hold more tokens than words: cap by the profile range,
      // not by the word-count-capped maxLines (a single long word must still
      // be allowed to split onto two lines). Their granularity cap is
      // recomputed on the set because the split word is narrower.
      const setWidestUnits = tokens.reduce((max, token) => Math.max(max, tokenLength(token)), 1);
      const setGranularityMaxLines = clamp(Math.floor(totalUnits / (setWidestUnits * 0.72)), 2, 8);
      const hyphenMaxLines = Math.min(
        options.maxLines || Math.max(profileMaxLines, maxLines),
        Math.max(1, tokens.length),
        setGranularityMaxLines
      );
      for (let lineCount = Math.max(2, minLines); lineCount <= hyphenMaxLines; lineCount++) {
        generationParams.forEach((params) => {
          // Hyphen variants carry a heavy score penalty and rarely win: a
          // reduced curve/shift grid keeps the good ones at a third of the
          // DP runs the full grid would burn
          const hyphenCurves = params.curves.length > 2 ? [params.curves[0], params.curves[2]] : params.curves;
          const hyphenShifts = params.shifts.slice(0, 3);
          hyphenCurves.forEach((curve) => {
            hyphenShifts.forEach((shift) => addCandidate(resultMap, seenTargets, tokens, lineCount, curve, shift, 0, 1, scoringProfile, null, params.minWeight));
          });
        });
        addShapeCandidates(tokens, lineCount, 1);
      }
    });
  }

  // The user's own validated shapes for this exact text always compete: the
  // DP grid may never produce them, and a shape that never appears in the
  // list is a shape the ranking can never learn from. Having been validated
  // by hand is itself strong evidence: a recall bonus lifts these shapes
  // toward the top instead of letting generic aesthetics out-score them.
  const EXEMPLAR_RECALL_BONUS = 480;
  if (tuning.exemplars && tuning.exemplars.length) {
    tuning.exemplars.forEach((exemplar) => {
      if (normalizeText(exemplar.lines.join(" ")) !== normalized) return;
      if (!exemplarContextMatches(exemplar, aspect, bubbleSignature)) return;
      const exemplarText = exemplar.lines.join("\n");
      if (resultMap.has(exemplarText)) {
        const existing = resultMap.get(exemplarText);
        if (!existing.injected) {
          existing.injected = true;
          existing.score -= EXEMPLAR_RECALL_BONUS;
        }
        return;
      }
      const tokenLines = exemplar.lines.map((line) => makeBaseTokens(mergePunctuationWords(splitWordsPreservingMarkdown(line))));
      if (tokenLines.some((tokens) => !tokens.length)) return;
      resultMap.set(exemplarText, {
        id: `shape-${resultMap.size + 1}`,
        text: exemplarText,
        lines: exemplar.lines.slice(),
        score: scoreCandidate(tokenLines, exemplar.hyphens, scoringProfile) - EXEMPLAR_RECALL_BONUS,
        hyphenCount: exemplar.hyphens,
        injected: true,
      });
    });
  }

  const limit = options.limit || MAX_VARIANTS;
  let variants = Array.from(resultMap.values());
  // A variant that physically stays inside the bubble must always outrank
  // one that escapes it, whatever their aesthetic scores say
  if (fit) {
    variants.forEach((variant) => {
      // An injected exemplar physically existed as a rendered layer in this
      // bubble: trust that over the calibration estimate
      variant.fits = variant.injected || variantFitsBubble(variant.lines, fit);
    });
    // Escaping the bubble is disqualifying, not just penalizing: overflowing
    // variants never reach the list while at least two alternatives fit
    const fitting = variants.filter((variant) => variant.fits);
    if (fitting.length >= 2) variants = fitting;
  }
  // Absolute quality gate: drop unbearable silhouettes whenever anything
  // better exists, then keep only clean ones when enough of them survive —
  // a shorter list of good shapes beats a full list padded with ugly ones
  const widthCap = (scoringProfile.maxLineWidth || 28) * 1.05;
  variants.forEach((variant) => {
    variant.badness = variant.injected
      ? 0
      : getSilhouetteBadness(variant.lines.map(visibleWidth), widthCap);
  });
  // Shapes close to a context-matched exemplar ARE the user's style: soften
  // the generic quality gates instead of letting them censor that style
  if (exemplarCurves.length) {
    variants.forEach((variant) => {
      if (variant.injected || variant.lines.length < 2 || variant.badness <= CLEAN_SILHOUETTE_BADNESS) return;
      const curve = resampleSilhouette(variant.lines.map(visibleWidth));
      if (!curve) return;
      let best = Infinity;
      exemplarCurves.forEach((exemplarCurve) => {
        const distance = curveDistance(curve, exemplarCurve);
        if (distance < best) best = distance;
      });
      if (best < 0.03) {
        variant.badness *= 0.35 + 0.65 * (best / 0.03);
      }
    });
  }
  const bearable = variants.filter((variant) => variant.badness <= BEARABLE_SILHOUETTE_BADNESS);
  if (bearable.length) variants = bearable;
  const clean = variants.filter((variant) => variant.badness <= CLEAN_SILHOUETTE_BADNESS);
  if (clean.length >= Math.min(3, limit)) variants = clean;
  const compareVariants = (a, b) => {
    if (fit && a.fits !== b.fits) return a.fits ? -1 : 1;
    return a.score - b.score || a.text.localeCompare(b.text);
  };
  const sorted = variants.sort(compareVariants);

  // Guarantee line-count diversity: the best candidate of each line count is
  // kept first so taller and shorter alternatives always reach the list,
  // then the remaining slots are filled by raw score
  const picked = [];
  const pickedTexts = new Set();
  const seenLineCounts = new Set();
  // A shape the user validated for this exact text must never be cut from
  // the list, whatever its generic score — it is the ground truth here
  sorted.forEach((variant) => {
    if (!variant.injected || picked.length >= limit) return;
    if (fit && !variant.fits) return;
    picked.push(variant);
    pickedTexts.add(variant.text);
    seenLineCounts.add(variant.lines.length);
  });
  sorted.forEach((variant) => {
    if (picked.length >= limit) return;
    const count = variant.lines.length;
    if (seenLineCounts.has(count)) return;
    // Diversity must never resurrect a shape that escapes the bubble: those
    // only reach the list through the score-ordered fill below, i.e. last
    if (fit && !variant.fits) return;
    seenLineCounts.add(count);
    picked.push(variant);
    pickedTexts.add(variant.text);
  });
  sorted.forEach((variant) => {
    if (picked.length >= limit || pickedTexts.has(variant.text)) return;
    picked.push(variant);
    pickedTexts.add(variant.text);
  });

  const result = picked
    .sort(compareVariants)
    .map((variant, index) => ({ ...variant, id: `shape-${index + 1}` }));

  if (variantCache.size >= VARIANT_CACHE_LIMIT) {
    variantCache.delete(variantCache.keys().next().value);
  }
  variantCache.set(cacheKey, result);
  return result;
};

const generateManualTextShapeRVariant = (text, options = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const words = mergePunctuationWords(splitWordsPreservingMarkdown(normalized));
  if (!words.length) return null;
  const tokens = makeBaseTokens(words);
  const maxLines = Math.min(options.maxLines || 8, tokens.length);
  const requestedLineCount = options.lineCount || estimateManualLineCount(normalized, options.width, options.height);
  const lineCount = clamp(requestedLineCount, 1, Math.max(1, maxLines));
  const settings = {
    shape: options.shape || "sine",
    softness: options.softness == null ? 0.6 : options.softness,
    floor: options.floor == null ? 0.15 : options.floor,
    punctuationBonus: options.punctuationBonus == null ? 0.04 : options.punctuationBonus,
    edgeMin: options.edgeMin == null ? 3 : options.edgeMin,
    shapeProfile: options.shapeProfile || null,
  };
  const targets = buildManualTargets(tokens, lineCount, settings);
  const split = splitTokensForManualTargets(tokens, targets, settings);
  if (!split) {
    return {
      id: "manual",
      text: normalized,
      lines: [normalized],
      targets: [visibleWidth(normalized)],
      widths: [visibleWidth(normalized)],
      lineCount: 1,
      shape: settings.shape,
      shapeProfile: settings.shapeProfile,
      width: options.width,
      height: options.height,
    };
  }

  const lines = split.ranges.map(([from, to]) => lineText(tokens.slice(from, to)));
  return {
    id: "manual",
    text: lines.join("\n"),
    lines,
    targets,
    widths: split.ranges.map(([from, to]) => sumTokenRange(tokens, from, to)),
    lineCount,
    shape: settings.shape,
    shapeProfile: settings.shapeProfile,
    width: options.width,
    height: options.height,
    score: split.cost,
  };
};

// Learn from a hand-typeset layer: compare the user's final line breaks with
// what the generator would have proposed for the same text in the same bubble
// context, and nudge the tuning knobs toward the user's choice. Returns the
// updated tuning (to persist) plus a small summary for the UI, or null when
// the layer holds nothing usable.
const recordTextShapeRFeedback = (layerText, options = {}, currentTuning = null) => {
  const chosenLines = String(layerText || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!chosenLines.length) return null;
  const flatText = chosenLines.join(" ");
  if (!normalizeText(flatText)) return null;
  // The bundled default is a suggestion preset, not inherited user history.
  // On the first Learn action `currentTuning` is null, so generate the lesson
  // against the engine's real neutral baseline. Later lessons receive the
  // persisted user tuning and continue from it normally.
  const learningTuning = sanitizeTuning(currentTuning);
  const previousTuning = tuning;
  tuning = learningTuning;
  tuningRevision++;
  let variants;
  try {
    variants = generateTextShapeRVariants(flatText, options);
  } finally {
    tuning = previousTuning;
    tuningRevision++;
  }
  if (!variants.length) return null;
  const top = variants[0];
  const next = learningTuning;
  // Early feedback moves the knobs fast, later feedback stabilises them
  const alpha = 1 / Math.min(next.samples + 1, 5);

  // Line count preference, relative to what the generator ranked first
  const lineDelta = clamp(chosenLines.length - top.lines.length, -2, 2);
  next.lineTargetBias = clamp(next.lineTargetBias + alpha * (lineDelta - next.lineTargetBias), -2, 2);

  // Hyphenation preference, aimed at the habit itself: the sample's césure
  // rate derives a target penalty scale (hyphen-free → expensive césures,
  // frequent césures → cheap) and the knob eases toward that target instead
  // of drifting through fixed multiplicative bumps. Texts where hyphenation
  // was never even an option teach nothing about the habit.
  const chosenHyphens = chosenLines.slice(0, -1).filter((line) => /[A-Za-zÀ-ÖØ-öø-ÿ]-$/.test(line)).length;
  const hyphenWasOption = chosenHyphens > 0 || variants.some((variant) => variant.hyphenCount > 0);
  if (hyphenWasOption) {
    const sampleRate = chosenLines.length > 1 ? chosenHyphens / (chosenLines.length - 1) : 0;
    const targetScale = clamp(1.9 - sampleRate * 1.45, 0.4, 2.5);
    next.hyphenPenaltyScale = clamp(
      next.hyphenPenaltyScale + alpha * 0.6 * (targetScale - next.hyphenPenaltyScale),
      0.4,
      2.5
    );
  }

  const lengths = chosenLines.map(visibleWidth);
  if (chosenLines.length >= 2) {
    // Neighbour step tolerance: relax when the user's own shape steps harder
    // than the quality gate allows, decay back toward strict otherwise
    let maxStep = 0;
    for (let index = 1; index < lengths.length; index++) {
      const step = Math.abs(lengths[index] - lengths[index - 1]) / Math.max(lengths[index], lengths[index - 1], 1);
      if (step > maxStep) maxStep = step;
    }
    const neededDelta = clamp(maxStep + 0.02 - (chosenLines.length === 2 ? 0.32 : 0.48), 0, 0.15);
    next.stepSlackDelta = neededDelta > next.stepSlackDelta
      ? neededDelta
      : clamp(next.stepSlackDelta * (1 - 0.25 * alpha), 0, 0.15);
  }
  if (chosenLines.length >= 3) {
    // Silhouette sharpness: how much shorter the user keeps the edge lines
    // relative to the peak translates into a preferred target curve
    const peak = Math.max.apply(null, lengths);
    const edgeRatio = ((lengths[0] + lengths[lengths.length - 1]) / 2) / Math.max(peak, 1);
    const profile = PROFILE_PRESETS[options.profile] || PROFILE_PRESETS.balanced;
    const desiredCurve = clamp(1 - edgeRatio, 0.2, 1.1);
    const sampleDelta = clamp(desiredCurve - (profile.scoreCurve || 0.65), -0.25, 0.3);
    next.curveDelta = clamp(next.curveDelta + alpha * (sampleDelta - next.curveDelta), -0.25, 0.3);
  }

  // Rich style profile: every sample folds the signature of the kept shape
  // into an EMA — later scoring compares candidates against this signature
  const style = next.style || {};
  const emaValue = (previous, sample) => (
    previous == null || !Number.isFinite(previous) ? sample : previous + alpha * (sample - previous)
  );
  const totalUnits = visibleWidth(normalizeText(flatText));
  style.density = clamp(emaValue(style.density, totalUnits / chosenLines.length), 2, 80);
  if (chosenLines.length >= 2) {
    const curve = resampleSilhouette(lengths);
    if (curve) {
      if (style.silhouette && style.silhouette.length === STYLE_RESOLUTION) {
        // How close this sample sits to the running style BEFORE folding it
        // in: the EMA of that similarity is the style's self-consistency,
        // which later scales how assertive the learned style terms may be
        const sampleConsistency = clamp(1 - curveDistance(curve, style.silhouette) * 18, 0, 1);
        style.consistency = clamp(emaValue(style.consistency, sampleConsistency), 0, 1);
      }
      style.silhouette = style.silhouette && style.silhouette.length === STYLE_RESOLUTION
        ? style.silhouette.map((value, index) => clamp(emaValue(value, curve[index]), 0.02, 1))
        : curve;
    }
    style.stepMean = clamp(emaValue(style.stepMean, meanAdjacentStep(lengths)), 0, 0.8);
    const breaks = chosenLines.length - 1;
    style.hyphenRate = clamp(emaValue(style.hyphenRate, chosenHyphens / breaks), 0, 1);
    const chosenHyphenY = getHyphenLineY(chosenLines);
    if (chosenHyphenY != null) {
      style.hyphenLineY = clamp(emaValue(style.hyphenLineY, chosenHyphenY), 0, 1);
    }
    // Punctuation habit only means something when the text offers internal
    // punctuation to break on — never let punctuation-free texts erode it
    const hasInternalPunctuation = /[.,;:!?…]/.test(stripMarkdownForMeasure(flatText).trim().slice(0, -1));
    if (hasInternalPunctuation) {
      const punctuationEnds = chosenLines.slice(0, -1).filter(endsWithBreakPunctuation).length;
      style.punctEndRate = clamp(emaValue(style.punctEndRate, punctuationEnds / breaks), 0, 1);
    }
  }
  next.style = sanitizeStyle(style);

  // Pairwise learning-to-rank with experience replay: this sample's
  // (chosen, rejected) feature pairs join the stored buffer, then the
  // weights re-train over the whole buffer with passive-aggressive margin
  // updates. Old feedbacks keep teaching alongside new ones — the ranker
  // converges on the whole preference history instead of being nudged by
  // its last sample. Canonical training order makes the ranker reproducible
  // for a given bounded preference buffer.
  const chosenText = chosenLines.join("\n");
  const rankProfile = {
    lineTarget: top.lines.length,
    maxLineWidth: (PROFILE_PRESETS[options.profile] || PROFILE_PRESETS.balanced).maxLineWidth || 28,
  };
  const chosenFeatures = extractShapeFeatures(lengths, chosenLines, chosenHyphens, rankProfile);
  const chosenVector = featuresToVector(chosenFeatures);
  const freshPairs = [];
  variants.slice(0, 5).forEach((variant) => {
    if (variant.text === chosenText) return;
    const variantFeatures = extractShapeFeatures(variant.lines.map(visibleWidth), variant.lines, variant.hyphenCount, rankProfile);
    freshPairs.push({ c: chosenVector, r: featuresToVector(variantFeatures) });
  });
  const matchedRank = variants.findIndex((variant) => variant.text === chosenText);
  const pairs = (next.pairs || []).concat(freshPairs).slice(-MAX_TRAINING_PAIRS);
  if (pairs.length) {
    const trainingPairs = sortTrainingPairs(pairs);
    // Rebuild from the buffer rather than warm-starting from the previous
    // weights: equal stored evidence now produces equal weights regardless of
    // the path that led to it.
    const trained = trainRankingWeights(null, trainingPairs, RANK_AGGRESSIVENESS);
    const trainedAccuracy = rankingAccuracy(trained, trainingPairs);
    next.weights = sanitizeWeights(trained);
    next.pairAccuracy = Math.round(trainedAccuracy * 1000) / 1000;
  }
  next.pairs = pairs.length ? pairs : null;
  next.pairSchemaVersion = PAIR_SCHEMA_VERSION;

  // Exemplar memory: keep the shape itself with its context, so similar
  // future requests are scored against it instead of a global average.
  // Re-validating a shape the memory already holds reinforces it (hits)
  // and refreshes its recency instead of duplicating it.
  const exemplarAspect = options.width > 0 && options.height > 0
    ? clamp(options.height / options.width, 0.1, 10)
    : null;
  const exemplarBubble = getBubbleSignature(normalizeShapeRows(options.shapeProfile).filter((row) => row.width > 0));
  const sameTextAndContext = (exemplar) => (
    normalizeText(exemplar.lines.join(" ")) === normalizeText(flatText)
      && exemplarStorageContextMatches(exemplar, exemplarAspect, exemplarBubble)
  );
  const previousExemplar = (next.exemplars || []).find((exemplar) => (
    exemplar.lines.join("\n") === chosenText && sameTextAndContext(exemplar)
  ));
  // A new layout for the same dialogue in the same bubble replaces the stale
  // choice. Distinct bubble contexts keep their own exemplar.
  const exemplars = (next.exemplars || []).filter((exemplar) => !sameTextAndContext(exemplar));
  exemplars.push({
    lines: chosenLines.slice(),
    units: totalUnits,
    lineCount: chosenLines.length,
    aspect: exemplarAspect,
    hyphens: chosenHyphens,
    curve: chosenLines.length >= 2 ? resampleSilhouette(lengths) : null,
    // Bubble-aware context: the outline of the selection this shape was
    // validated in, so same-shaped bubbles recall it first
    bubble: exemplarBubble,
    hits: previousExemplar ? (previousExemplar.hits || 1) + 1 : 1,
  });
  next.exemplars = sanitizeExemplars(exemplars.slice(-MAX_EXEMPLARS));

  next.samples += 1;
  return {
    tuning: next,
    chosenLineCount: chosenLines.length,
    topLineCount: top.lines.length,
    matchedRank: matchedRank >= 0 ? matchedRank + 1 : null,
    chosenHyphens,
    // Training telemetry: ranking accuracy over the replay buffer and style
    // self-consistency — "how well trained is my TextShapeR"
    pairAccuracy: next.pairAccuracy,
    styleConsistency: next.style && next.style.consistency != null ? next.style.consistency : null,
  };
};

export { generateTextShapeRVariants, generateManualTextShapeRVariant, estimateManualLineCount, setDehyphenationEnabled, setTextShapeRTuning, sanitizeTuning as sanitizeTextShapeRTuning, recordTextShapeRFeedback, visibleLength, visibleWidth };
