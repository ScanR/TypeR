// Language of the text being shaped, and where its words may break. A script
// can be in another language than the interface, so the text decides; the
// interface language only settles texts too short to tell.

import createHyphenator from "./oneClick/hyphen/hyphenEngine.js";
// Filled by registerTextShapeRPatterns when TextShapeR opens
let patterns = {};
const hyphenators = {};
const registerTextShapeRPatterns = (loaded) => {
  patterns = loaded || {};
};
const SUPPORTED_LANGUAGES = ["de", "en", "es", "fr", "it", "pt", "ru", "tr", "uk"];

// Everyday words that tell the languages apart: words shared between them
// ("la", "de", "que") are left out on purpose
const COMMON_WORDS = {
  fr: "je tu il elle nous vous ils elles on moi toi lui le les des du une et est suis es sont ai as ont pas ne ce cette ces ça c'est j'ai qu'il qu'on qu'elle mais pour dans avec sur oui non qui bien très tout ici alors quoi comment pourquoi merci bonjour salut hein mon ton son ma ta sa mes tes ses a me te se au aux",
  en: "i you he she we they it him her us them the an and is am are was were be been do does did don't i'm you're it's that's have has had will would can could should not yes what why how who where when this that these those my your his our their of to in for with at but so just",
  es: "yo tú él ella nosotros ellos ellas el los las y soy eres estoy está están qué por para pero con sin sí muy más también aquí ahora porque cómo gracias hola mi tu su mis esto eso nada todo",
  pt: "eu você ele ela nós eles elas os um uma é sou são estou está não sim por para mas sem muito mais também aqui agora porque como obrigado olá meu minha seu sua isso nada tudo",
  de: "ich du er sie wir ihr der die das den dem ein eine einen und ist bin bist sind war nicht ja nein was warum wie wer wo mit für auf aber auch noch schon hier jetzt danke mein dein sein",
  it: "io lei noi voi loro lo gli è sono sei siamo ho hai sì che per ma con senza molto più anche qui ora perché come grazie ciao mio tuo suo questo quello niente tutto",
  tr: "ben sen biz siz onlar bir ve bu şu için ama ile çok daha evet hayır ne neden nasıl kim var yok değil benim senin teşekkürler merhaba",
};
const WORD_SETS = Object.keys(COMMON_WORDS).reduce((sets, language) => {
  sets[language] = new Set(COMMON_WORDS[language].split(" "));
  return sets;
}, {});
const SIGNATURE_LETTERS = {
  fr: /[êàèùûîïœç]/g,
  es: /[ñ¿¡]/g,
  pt: /[ãõ]/g,
  de: /[äöüß]/g,
  it: /[ìò]/g,
  tr: /[ğışİ]/g,
};
const CYRILLIC = /[Ѐ-ӿ]/;
const UKRAINIAN_LETTERS = /[іїєґ]/i;
// Scripts written without hyphenated line breaks in manga lettering
const UNBROKEN_SCRIPTS = /[֐-ࣿ฀-໿぀-ヿ㐀-鿿가-힯]/;
const LATIN_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ]/;

// Language of a text, or null when it says too little
const detectLanguage = (text) => {
  const lower = String(text || "").toLowerCase();
  const words = lower.replace(/[*_]/g, "").replace(/’/g, "'").split(/[^a-zà-öø-ÿā-ſ']+/).filter(Boolean);
  let best = null;
  let bestScore = 0;
  let runnerUp = 0;
  Object.keys(WORD_SETS).forEach((language) => {
    let score = 0;
    words.forEach((word) => {
      if (WORD_SETS[language].has(word)) score += 1;
    });
    const letters = SIGNATURE_LETTERS[language] && lower.match(SIGNATURE_LETTERS[language]);
    if (letters) score += letters.length * 1.5;
    if (score > bestScore) {
      runnerUp = bestScore;
      bestScore = score;
      best = language;
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  });
  return bestScore > 0 && bestScore > runnerUp ? best : null;
};

let interfaceLanguage = "fr";
const setTextShapeRInterfaceLanguage = (language) => {
  const code = String(language || "").slice(0, 2).toLowerCase();
  interfaceLanguage = SUPPORTED_LANGUAGES.includes(code) ? code : "en";
};
const getInterfaceHint = () => interfaceLanguage;

// Hyphenation language of a text; null for scripts that do not hyphenate
const resolveTextLanguage = (text) => {
  const source = String(text || "");
  if (UNBROKEN_SCRIPTS.test(source)) return null;
  if (CYRILLIC.test(source)) return UKRAINIAN_LETTERS.test(source) ? "uk" : "ru";
  if (!LATIN_LETTER.test(source)) return null;
  return detectLanguage(source) || interfaceLanguage;
};

const getHyphenator = (language) => {
  if (!patterns[language]) return null;
  if (!hyphenators[language]) hyphenators[language] = createHyphenator(patterns[language], { minWordLength: 4 });
  return hyphenators[language];
};

// Offsets inside a word where its language allows a line break
const getLanguageBreakPoints = (language, word) => {
  const hyphenator = getHyphenator(language);
  if (!hyphenator) return [];
  const sections = hyphenator(word).split("­");
  const points = [];
  let offset = 0;
  for (let index = 0; index + 1 < sections.length; index++) {
    offset += sections[index].length;
    points.push(offset);
  }
  return points;
};

export { detectLanguage, getInterfaceHint, getLanguageBreakPoints, registerTextShapeRPatterns, resolveTextLanguage, setTextShapeRInterfaceLanguage };
