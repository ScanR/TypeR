// The languages the smart paste hyphenates in: those TypeR has hyphenation
// patterns for (oneClick/hyphen, the hyphen library's), by their codes.
// The smart paste puts its own hyphen in a word (Photoshop's hyphenation is
// off in the text it lays out), so the same list holds in every host.
export const HYPHENATION_LANGUAGES = ["de", "en", "es", "fr", "it", "pt", "ru", "tr", "uk"];

// What Settings > Smart Paste > Hyphenation keeps: "auto" follows the script
export const SMART_PASTE_HYPHENATION_MODES = ["auto"].concat(HYPHENATION_LANGUAGES, ["off"]);

export const normalizeSmartPasteHyphenation = (value) => (
  SMART_PASTE_HYPHENATION_MODES.indexOf(value) !== -1 ? value : "auto"
);
