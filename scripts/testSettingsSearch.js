// Settings search: the index stays in step with the settings window, and the
// ranking finds a setting by its title, its description, a synonym, an English
// word in a translated interface, or a typo.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const load = require("./helpers/loadAppModule")();
const search = load("app_src/settingsSearch.js");

const root = path.resolve(__dirname, "..");

const readLocale = (relativePath) => {
  const values = {};
  fs.readFileSync(path.resolve(root, relativePath), "utf8").split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith("#") || line.startsWith(" ")) return;
    const at = line.indexOf("=");
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  });
  return values;
};

const en = readLocale("locale/messages.properties");
const fr = { ...en, ...readLocale("locale/fr_FR/messages.properties") };

const TAB_IDS = ["general", "insertion", "script", "styles", "shortcuts", "appearance", "data", "fontViewer"];
const tabKey = (id) => "settingsTab" + id[0].toUpperCase() + id.slice(1);
const makeTabs = (strings, disabled = []) => TAB_IDS.map((id) => ({ id, label: strings[tabKey(id)], disabled: disabled.includes(id) }));

const commandsSource = fs.readFileSync(path.resolve(root, "app_src/shortcutCommands.js"), "utf8");
const commandLabels = [...new Set(commandsSource.match(/label: "shortcut_[A-Za-z0-9]+"/g).map((line) => line.slice(8, -1)))];

const makeIndex = (strings, options = {}) => search.buildSettingsSearchIndex({
  locale: strings,
  baseLocale: en,
  tabs: makeTabs(strings, options.disabled),
  shortcutGroups: [{ labelKey: "settingsTabShortcuts", commands: commandLabels.map((label) => ({ label })) }],
  themes: options.themes || [],
  footerModes: ["TextShapeR", "Multi-bubble", strings.footerPasteOnClick, strings.footerAutoClean],
  available: options.available || {},
});

const indexFr = makeIndex(fr);
const indexEn = makeIndex(en);
const titles = (index, query) => search.searchSettings(index, query).map((result) => result.entry.title);
const first = (index, query) => titles(index, query)[0];

// Every key of the index exists; read from the source, since the built entries
// hold the translated text
const source = fs.readFileSync(path.resolve(root, "app_src/settingsSearch.js"), "utf8");
const sectionsSource = source.slice(source.indexOf("const SECTIONS"), source.indexOf("const TAB_HINTS"));
const indexedKeys = new Set();
[...sectionsSource.matchAll(/\b(?:title|hint|group|parent|anchor): "([A-Za-z0-9_]+)"/g)].forEach((match) => indexedKeys.add(match[1]));
[...sectionsSource.matchAll(/also: \[([^\]]*)\]/g)].forEach((match) => {
  [...match[1].matchAll(/"([A-Za-z0-9_]+)"/g)].forEach((key) => indexedKeys.add(key[1]));
});
const unknownKeys = [...indexedKeys].filter((key) => !en[key]);
assert.deepStrictEqual(unknownKeys, [], `Keys of the search index missing from the locale: ${unknownKeys.join(", ")}`);

// Every setting shown in the window is indexed. A new setting that should not
// be searchable belongs in this list, with the reason.
const NOT_SEARCHED = new Set([
  "settingsUxpMigrationInstalled", // A status line, no setting behind it
  "settingsThemeUntitled", // Name of a theme without one, themes are indexed by name
  "settingsLayoutScaleReset", // Tooltip of the reset button of the scale
  "settingsLayoutAutoCleanNote", // Note on the Auto clean row
  "settingsLayoutModeState", // Tooltip of the mode state
  "settingsLayoutHeight", // Label of both height sliders, indexed as their anchor
  "settingsLayoutBlockHidden", // Tooltip of a hidden panel
  "settingsLayoutBlockHiddenNote", // Note on a hidden panel
  "settingsLayoutModeKeepsState", // Note under the mode toggles
]);
const settingsSource = fs.readFileSync(path.resolve(root, "app_src/components/modal/settings.jsx"), "utf8");
const render = settingsSource.slice(settingsSource.indexOf("const renderTabContent"));
const shownKeys = new Set(
  [...render.matchAll(/locale\.((?:settings[A-Za-z0-9]*(?:Label|Help|Descr|Hint|Button|Note)|settingsLayout(?:El|Block)[A-Za-z0-9]+|settingsGroup[A-Za-z0-9]+|multiBubbleMode(?:Toggle|Hint)))\b/g)].map((match) => match[1])
);
const notIndexed = [...shownKeys].filter((key) => !indexedKeys.has(key) && !NOT_SEARCHED.has(key));
assert.deepStrictEqual(notIndexed, [], `Settings missing from the search index (app_src/settingsSearch.js): ${notIndexed.join(", ")}`);

// Titles, French interface
assert.strictEqual(first(indexFr, "collage intelligent"), fr.settingsSmartPasteLabel, "title");
assert.strictEqual(first(indexFr, fr.settingsMarkdownLabel), fr.settingsMarkdownLabel, "a full title comes first");
assert.strictEqual(first(indexFr, fr.settingsTabShortcuts), fr.settingsTabShortcuts, "a tab name opens the tab first");
assert.ok(titles(indexFr, fr.settingsTabShortcuts).length > 5, "and lists what it holds");

// Case, accents and ligatures do not count
assert.strictEqual(first(indexFr, "THEME"), first(indexFr, "thème"));
assert.ok(titles(indexFr, "cesure").includes(fr.settingsSmartPasteHyphenationLabel), "césure without its accent");

// Descriptions
assert.ok(!search.normalizeSearchText(en.settingsPasteOnClickLabel).includes("wand"));
assert.ok(titles(indexEn, "magic wand").includes(en.settingsPasteOnClickLabel), "a word of the description");
assert.ok(titles(indexEn, "bubble edges").includes(en.settingsInternalPaddingLabel), "two words of the description");

// A title match beats a description match
assert.strictEqual(first(indexEn, "padding"), en.settingsInternalPaddingLabel);
const hyphen = titles(indexEn, "hyphenation");
assert.strictEqual(hyphen[0], en.settingsSmartPasteHyphenationLabel, "the title before the options that mention it");

// A setting before the shortcuts that start with the same word, unless the
// shortcut is exactly what was typed
const pasteTitles = titles(indexEn, "paste");
assert.ok(pasteTitles.indexOf(en.settingsSmartPasteLabel) < pasteTitles.indexOf(en.shortcut_insertText), "setting before shortcut");
assert.strictEqual(first(indexEn, en.shortcut_center), en.shortcut_center, "exact shortcut name");

// Synonyms that the setting text lacks
assert.ok(titles(indexFr, "marge").includes(fr.settingsInternalPaddingLabel), "marge");
assert.ok(titles(indexFr, "zoom").includes(fr.settingsLayoutScaleLabel), "zoom");
assert.ok(titles(indexFr, "mise à jour").includes(fr.settingsCheckUpdatesLabel), "mise à jour");
assert.ok(titles(indexFr, "gras").includes(fr.settingsMarkdownLabel), "gras");

// Small words are not required, and words can come in any order
assert.ok(titles(indexFr, "marge de la bulle").includes(fr.settingsInternalPaddingLabel), "small words");
assert.ok(titles(indexEn, "scale interface").includes(en.settingsLayoutScaleLabel), "any order");

// English in a translated interface, plurals, close forms
assert.strictEqual(first(indexFr, "smart paste"), fr.settingsSmartPasteLabel, "English title");
assert.ok(titles(indexFr, "couleurs").includes(fr.settingsThemeNew), "plural");
assert.ok(titles(indexEn, "multibubble").includes(en.multiBubbleModeToggle), "written as one word");

// Typos, only when nothing matches as written
assert.strictEqual(first(indexEn, "hypenation"), en.settingsSmartPasteHyphenationLabel, "missing letter");
assert.strictEqual(first(indexEn, "padidng"), en.settingsInternalPaddingLabel, "swapped letters");
assert.ok(titles(indexFr, "fond").length > 0, "fond exists as written");
assert.ok(search.searchSettings(indexFr, "fond").every((result) => !result.terms.includes("font")), "so it does not bring font");
assert.deepStrictEqual(titles(indexEn, "zzzzqqq"), [], "nothing for nonsense");

// A sentence with one unknown word still finds the rest, after the exact pass
assert.ok(titles(indexEn, "padding banana").includes(en.settingsInternalPaddingLabel));

// Options under a toggle are found, with their path
const minScale = search.searchSettings(indexEn, en.settingsSmartPasteMinScaleLabel)[0].entry;
assert.strictEqual(minScale.tab, "insertion");
assert.deepStrictEqual(minScale.crumbs, [en.settingsTabInsertion, en.settingsGroupPaste, en.settingsSmartPasteLabel]);

// What cannot be opened is not offered
const noFontViewer = makeIndex(en, { disabled: ["fontViewer"] });
assert.ok(!noFontViewer.some((entry) => entry.tab === "fontViewer"));
assert.ok(indexEn.some((entry) => entry.tab === "fontViewer"));
assert.ok(!titles(indexEn, en.settingsUxpMigrationButton).includes(en.settingsUxpMigrationButton), "no switch to UXP where it is not offered");
assert.ok(titles(makeIndex(en, { available: { uxpMigration: true } }), en.settingsUxpMigrationButton).includes(en.settingsUxpMigrationButton));

// Dynamic entries: themes and shortcuts
const withThemes = makeIndex(en, { themes: ["Midnight Ink"] });
assert.strictEqual(first(withThemes, "midnight"), "Midnight Ink");
assert.ok(titles(indexEn, "next line").length > 0);

// An empty search shows nothing
assert.deepStrictEqual(search.searchSettings(indexEn, ""), []);
assert.deepStrictEqual(search.searchSettings(indexEn, "   "), []);
assert.deepStrictEqual(search.searchSettings(indexEn, "?!"), []);

// The highlight lands on the original characters, accents included
const marked = (text, terms) => search.splitHighlights(text, terms).filter((piece) => piece.match).map((piece) => piece.text);
assert.deepStrictEqual(marked("Césure du thème", ["cesure", "theme"]), ["Césure", "thème"]);
assert.deepStrictEqual(marked("Cœur de texte", ["coeur"]), ["Cœur"]);
assert.deepStrictEqual(marked("Start art", ["art"]), ["art"], "the start of a word first");
assert.deepStrictEqual(marked("Restart", ["art"]), ["art"], "else inside a word");
assert.deepStrictEqual(marked("Restart", ["ar"]), [], "but not for a short word");
assert.strictEqual(search.splitHighlights("Texte libre", ["texte"]).map((piece) => piece.text).join(""), "Texte libre", "no character lost");
assert.deepStrictEqual(search.splitHighlights("", ["a"]), []);

// Other alphabets go through the same path
const ru = { ...en, ...readLocale("locale/ru_RU/messages.properties") };
const indexRu = makeIndex(ru);
assert.strictEqual(first(indexRu, ru.settingsMarkdownLabel), ru.settingsMarkdownLabel);
const ar = { ...en, ...readLocale("locale/ar_AE/messages.properties") };
const indexAr = makeIndex(ar);
assert.strictEqual(first(indexAr, ar.settingsMarkdownLabel), ar.settingsMarkdownLabel);

console.log("Settings search tests passed");
