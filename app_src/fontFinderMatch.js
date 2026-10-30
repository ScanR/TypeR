// Finds the Font FindeR family matching a font a document or a style asks for.
// Pure logic, no CEP dependency, unit-testable.
//
// The name Photoshop reports rarely equals the Font FindeR family name:
// "ImaginaryFriendBBW00-Bold" is the "Imaginary Friend" family, whose files are
// named "ImaginaryFriendBB-Bold". So several searches are tried, from the exact
// name to a cleaned-up one (style suffix, vendor tags, camel case removed), and
// every result is scored against the requested name before being proposed.

import { findInstalledFont } from "./fontPreview";

// Tokens that tag a vendor or a web/licensing build, not the design itself
const NOISE_TOKENS = new Set(["bb", "std", "pro", "lt", "mt", "ot", "tt", "otf", "ttf", "regular"]);
const NOISE_PATTERN = /^w\d\d$/;
// Comicraft prefixes its PostScript names with "CC" (CCWildWords → Wild Words)
const LEADING_NOISE_TOKENS = new Set(["cc"]);
const STYLE_SUFFIX = /^(regular|reg|bold|bd|italic|ital|it|oblique|obl|light|lt|medium|med|semi|demi|extra|ultra|black|blk|heavy|thin|book|roman|condensed|cond|narrow|wide|expanded|plain|normal|mt|ps)+$/;

const MAX_QUERIES = 5;
const MIN_QUERY_LENGTH = 4;
// Scores: 100 same PostScript name, 95 same name without the style (both
// install what Photoshop asks for), 90 same cleaned-up family (another build
// of the font, its PostScript name differs), below 90 an approximate match
const SAME_FAMILY_SCORE = 90;
const EXACT_SCORE = 95;
const MIN_SCORE = 70;

const compact = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/(\.(otf|ttf|ttc|woff2?))+$/i, "")
    .replace(/[^a-z0-9]/g, "");

// "ImaginaryFriendBBW00-Bold" → "ImaginaryFriendBBW00"
const stripStyleSuffix = (name) => {
  const value = String(name || "").trim();
  const dash = value.lastIndexOf("-");
  if (dash <= 0) return value;
  return STYLE_SUFFIX.test(compact(value.slice(dash + 1))) ? value.slice(0, dash) : value;
};

// "ImaginaryFriendBBW00" → ["Imaginary", "Friend", "BB", "W00"]
const splitWords = (name) =>
  String(name || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z]{2,}?)(W\d\d)\b/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean);

const dropNoise = (words) => {
  const kept = words.filter((word) => {
    const lower = word.toLowerCase();
    return !NOISE_TOKENS.has(lower) && !NOISE_PATTERN.test(lower);
  });
  if (kept.length > 1 && LEADING_NOISE_TOKENS.has(kept[0].toLowerCase())) kept.shift();
  // Trailing style words left by a family name ("Wild Words Bold")
  while (kept.length > 1 && STYLE_SUFFIX.test(compact(kept[kept.length - 1]))) kept.pop();
  return kept;
};

const coreName = (name) => compact(dropNoise(splitWords(stripStyleSuffix(name))).join(""));

const describeTarget = (target) => {
  const postScriptName = String((target && target.postScriptName) || "").trim();
  const fontName = String((target && target.fontName) || "").trim();
  const base = stripStyleSuffix(postScriptName || fontName);
  const cores = [base, fontName].map(coreName).filter(Boolean);
  return {
    postScriptName: compact(postScriptName),
    base: compact(base),
    cores: Array.from(new Set(cores)),
  };
};

// Searches to run, most precise first
const buildSearchQueries = (target) => {
  const postScriptName = String((target && target.postScriptName) || "").trim();
  const fontName = String((target && target.fontName) || "").trim();
  const queries = [];
  const seen = new Set();
  const add = (query) => {
    const value = String(query || "").trim();
    const key = compact(value);
    if (key.length < MIN_QUERY_LENGTH || seen.has(key) || queries.length >= MAX_QUERIES) return;
    seen.add(key);
    queries.push(value);
  };
  const base = stripStyleSuffix(postScriptName || fontName);
  add(base);
  add(stripStyleSuffix(fontName));
  const coreWords = [base, fontName].map((name) => dropNoise(splitWords(stripStyleSuffix(name))));
  coreWords.forEach((words) => add(words.join(" ")));
  // Then shorter and shorter prefixes ("Fight to the Finish Fixed" → "Fight
  // to the Finish"): the scoring below rejects what is only a namesake
  coreWords.forEach((words) => {
    for (let count = words.length - 1; count >= 1; count--) add(words.slice(0, count).join(" "));
  });
  return queries;
};

// Sørensen–Dice coefficient over letter pairs, 0..1
const similarity = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }
  let common = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) || 0;
    if (count > 0) {
      pairs.set(pair, count - 1);
      common++;
    }
  }
  return (2 * common) / (a.length + b.length - 2);
};

const approximateScore = (core, candidate) => {
  if (!core || !candidate) return 0;
  const shorter = core.length <= candidate.length ? core : candidate;
  const longer = shorter === core ? candidate : core;
  const ratio = shorter.length / longer.length;
  let score = 0;
  // A shared start weighs more: "Collect Em All" for "Collect Em All Fixed"
  if (longer.indexOf(shorter) === 0 && ratio >= 0.65) score = 80;
  else if (longer.indexOf(shorter) !== -1 && ratio >= 0.75) score = 80;
  const dice = similarity(core, candidate);
  if (dice >= 0.85) score = Math.max(score, Math.round(dice * 85));
  return score;
};

// Best score of a Font FindeR family for the target, with the variant that got it
const scoreFamily = (target, family) => {
  const described = target && target.cores ? target : describeTarget(target);
  const fonts = (family && family.fonts) || [];
  const familyCore = coreName(family && family.family);
  let best = { score: 0, font: null };
  const consider = (score, font) => {
    if (score > best.score) best = { score, font };
  };
  fonts.forEach((font) => {
    const fontName = font && font.name;
    if (described.postScriptName && compact(fontName) === described.postScriptName) consider(100, font);
    if (described.base && compact(stripStyleSuffix(fontName)) === described.base) consider(95, font);
    const fontCore = coreName(fontName);
    described.cores.forEach((core) => {
      if (core === fontCore) consider(SAME_FAMILY_SCORE, font);
      else consider(approximateScore(core, fontCore), font);
    });
  });
  const defaultFont = fonts.find((font) => font.id === (family && family.default_font_id)) || fonts[0] || null;
  described.cores.forEach((core) => {
    if (core === familyCore) consider(SAME_FAMILY_SCORE, defaultFont);
    else consider(approximateScore(core, familyCore), defaultFont);
  });
  return best;
};

const pickBestMatch = (target, families) => {
  const described = describeTarget(target);
  let best = null;
  (families || []).forEach((family) => {
    if (!family || !family.fonts || !family.fonts.length) return;
    const { score, font } = scoreFamily(described, family);
    if (score < MIN_SCORE) return;
    // Ties go to the shorter family name: "Victory Speech" over "Victory Speech Lower"
    if (
      !best ||
      score > best.score ||
      (score === best.score && String(family.family).length < String(best.family.family).length)
    ) {
      best = { family, font, score, exact: score >= EXACT_SCORE };
    }
  });
  return best;
};

// search(query) resolves to an array of Font FindeR families. Resolves to the
// best match, or null when nothing close enough exists. Queries go from the
// most precise to the loosest: the first exact match wins, otherwise the best
// match of the first query that found one.
const findFontFinderMatch = async (target, search) => {
  const queries = buildSearchQueries(target);
  let best = null;
  let bestQuery = -1;
  // After a non-exact match, one more query may still find the exact build
  for (let i = 0; i < queries.length && (bestQuery < 0 || i <= bestQuery + 1); i++) {
    const match = pickBestMatch(target, await search(queries[i]));
    if (match && match.exact) return match;
    if (match && (!best || match.score > best.score)) {
      if (!best) bestQuery = i;
      best = match;
    }
  }
  return best;
};

const getMatchTargetKey = (target) =>
  [compact(target && target.postScriptName), compact(target && target.fontName)].join("|");

// Fonts used by the given styles that this computer does not have, one entry
// per font with the names of the styles using it.
const collectMissingStyleFonts = (styles, installedFonts) => {
  const missing = new Map();
  (styles || []).forEach((style) => {
    const layerText = style && style.textProps && style.textProps.layerText;
    const ranges = (layerText && layerText.textStyleRange) || [];
    ranges.forEach((range) => {
      const textStyle = range && range.textStyle;
      if (!textStyle || (!textStyle.fontPostScriptName && !textStyle.fontName)) return;
      if (findInstalledFont(installedFonts, textStyle)) return;
      const target = { postScriptName: textStyle.fontPostScriptName || "", fontName: textStyle.fontName || "" };
      const key = getMatchTargetKey(target);
      if (!missing.has(key)) missing.set(key, { ...target, key, styles: [] });
      const entry = missing.get(key);
      if (style.name && entry.styles.indexOf(style.name) === -1) entry.styles.push(style.name);
    });
  });
  return Array.from(missing.values());
};

// Web search for a font Font FindeR does not have: "<name> font" on Google
const getFontWebSearchUrl = (target) => {
  const name = String((target && (target.fontName || target.postScriptName)) || "").trim();
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} font`)}`;
};

export {
  buildSearchQueries,
  collectMissingStyleFonts,
  coreName,
  findFontFinderMatch,
  getFontWebSearchUrl,
  getMatchTargetKey,
  pickBestMatch,
  scoreFamily,
  similarity,
  splitWords,
  stripStyleSuffix,
};
