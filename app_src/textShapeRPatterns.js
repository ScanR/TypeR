// Hyphenation patterns of every language TextShapeR breaks words in. Kept out of
// the engine module: smart paste imports the engine at startup, and these only
// matter once TextShapeR opens (see textShapeREngineLoader).
import dePatterns from "./oneClick/hyphen/dePatterns.js";
import englishPatterns from "./oneClick/hyphen/enUsPatterns.js";
import esPatterns from "./oneClick/hyphen/esPatterns.js";
import frPatterns from "./oneClick/hyphen/frPatterns.js";
import itPatterns from "./oneClick/hyphen/itPatterns.js";
import ptPatterns from "./oneClick/hyphen/ptPatterns.js";
import ruPatterns from "./oneClick/hyphen/ruPatterns.js";
import trPatterns from "./oneClick/hyphen/trPatterns.js";
import ukPatterns from "./oneClick/hyphen/ukPatterns.js";

export default {
  de: dePatterns,
  en: englishPatterns,
  es: esPatterns,
  fr: frPatterns,
  it: itPatterns,
  pt: ptPatterns,
  ru: ruPatterns,
  tr: trPatterns,
  uk: ukPatterns,
};
