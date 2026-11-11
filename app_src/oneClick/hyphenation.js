// Fallback hyphenation for the smart paste, used only when a translation
// does not fit even at the smallest allowed size. French: TextShapeR's
// syllable boundaries. English: the hyphen library's en-US patterns (ISC
// license, see hyphen/LICENSE.txt), built on first use. The other languages:
// the same library's patterns, registered when a paste needs them.

import { frenchHyphenPoints } from "../textShapeR";
import { detectLanguage } from "../textShapeRLanguage";
import createHyphenator from "./hyphen/hyphenEngine";
import englishPatterns from "./hyphen/enUsPatterns";
import { HYPHENATION_LANGUAGES } from "./hyphenationLanguages";

let englishHyphenator = null;

const englishPoints = (source) => {
  // "neighbor's": the letters before the apostrophe break on their own
  const whole = /^([A-Za-z]{8,})(?:['’][A-Za-z]+)?$/.exec(source);
  if (!whole) return [];
  const word = whole[1];
  if (!englishHyphenator) englishHyphenator = createHyphenator(englishPatterns, { minWordLength: 8 });
  const sections = englishHyphenator(word).split("­");
  const points = [];
  let offset = 0;
  for (let i = 0; i + 1 < sections.length; i++) {
    offset += sections[i].length;
    if (offset >= 3 && word.length - offset >= 3) points.push(offset);
  }
  return points;
};

// The other languages' patterns are large (German alone is 400 KB): they are
// given here when a paste needs them (runSmartPaste in the panel, smartPaste
// in the UXP host), as { de: patterns, ... }
const patternSets = {};
const hyphenators = {};
export const registerHyphenationPatterns = (loaded) => {
  Object.keys(loaded || {}).forEach((language) => {
    if (loaded[language] && !patternSets[language]) patternSets[language] = loaded[language];
  });
};
// Whether a paste in this language waits for patterns not given yet
export const needsHyphenationPatterns = (language) => (
  language !== "fr" && language !== "en" && HYPHENATION_LANGUAGES.indexOf(language) !== -1 && !patternSets[language]
);

const LETTERS = "A-Za-zÀ-ÖØ-öø-ɏЀ-ӿ";
const PATTERN_WORD = new RegExp("^([" + LETTERS + "]{8,})(?:['’][" + LETTERS + "]+)?$");

// The patterns are in small letters, put letter for letter so that the cuts
// stay in place. In Turkish, I is ı and İ is i, whatever the computer's language.
const smallLetters = (word, language) => {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    let letter = word.charAt(i);
    if (language === "tr" && letter === "I") letter = "ı";
    else if (language === "tr" && letter === "İ") letter = "i";
    const small = letter.toLowerCase();
    out += small.length === 1 ? small : letter;
  }
  return out;
};

// Break points from a language's patterns, 3 letters at least on each side;
// none while its patterns are missing
const patternPoints = (language) => (source) => {
  const whole = PATTERN_WORD.exec(source);
  if (!whole || !patternSets[language]) return [];
  const word = whole[1];
  if (!hyphenators[language]) hyphenators[language] = createHyphenator(patternSets[language], { minWordLength: 8 });
  const sections = hyphenators[language](smallLetters(word, language)).split("­");
  const points = [];
  let offset = 0;
  for (let i = 0; i + 1 < sections.length; i++) {
    offset += sections[i].length;
    if (offset >= 3 && word.length - offset >= 3) points.push(offset);
  }
  return points;
};

const CYRILLIC = /[Ѐ-ӿ]/;
const UKRAINIAN_LETTERS = /[іїєґ]/i;

// One of HYPHENATION_LANGUAGES, or "off". "auto" follows the script, which
// can be in another language than the interface; the interface settles what
// the script does not, English when TypeR has no patterns for it.
export const resolveHyphenationLanguage = (setting, uiLanguage, script) => {
  if (setting === "off" || HYPHENATION_LANGUAGES.indexOf(setting) !== -1) return setting;
  const source = String(script || "");
  const language = detectLanguage(source);
  if (HYPHENATION_LANGUAGES.indexOf(language) !== -1) return language;
  if (CYRILLIC.test(source)) return UKRAINIAN_LETTERS.test(source) ? "uk" : "ru";
  const ui = String(uiLanguage || "").slice(0, 2).toLowerCase();
  return HYPHENATION_LANGUAGES.indexOf(ui) !== -1 ? ui : "en";
};

// The break point function for a language, or null (no hyphenation)
export const breakPointsFor = (language) => {
  if (language === "fr") return (word) => frenchHyphenPoints(word);
  if (language === "en") return englishPoints;
  if (HYPHENATION_LANGUAGES.indexOf(language) !== -1) return patternPoints(language);
  return null;
};
