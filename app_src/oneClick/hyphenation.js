// Fallback hyphenation for the smart paste, used only when a translation
// does not fit even at the smallest allowed size. French: TextShapeR's
// syllable boundaries. English: the hyphen library's en-US patterns (ISC
// license, see hyphen/LICENSE.txt), built on first use.

import { frenchHyphenPoints } from "../textShapeR";
import { detectLanguage } from "../textShapeRLanguage";
import createHyphenator from "./hyphen/hyphenEngine";
import englishPatterns from "./hyphen/enUsPatterns";

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

// "fr", "en" or "off"; "auto" follows the script, which can be in another
// language than the interface. The interface settles what the script does not.
export const resolveHyphenationLanguage = (setting, uiLanguage, script) => {
  if (setting === "fr" || setting === "en" || setting === "off") return setting;
  const language = detectLanguage(script);
  if (language === "fr" || language === "en") return language;
  return /^fr/i.test(String(uiLanguage || "")) ? "fr" : "en";
};

// The break point function for a language, or null (no hyphenation)
export const breakPointsFor = (language) => {
  if (language === "fr") return (word) => frenchHyphenPoints(word);
  if (language === "en") return englishPoints;
  return null;
};
