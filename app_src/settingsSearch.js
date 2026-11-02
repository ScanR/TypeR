// Search bar of the settings window. The index below names the locale keys of
// every setting: scripts/testSettingsSearch.js fails when settings.jsx shows a
// setting that is missing here, or when a key no longer exists.
//
// An entry reads: title and hint are what the result shows, "also" holds the
// other texts of the setting (options, buttons), "keywords" the words people
// use for it that its own text lacks (English and French, not displayed),
// "parent" the toggle it sits under, and "anchor" the text to scroll to when
// the title is not displayed as such.
const SECTIONS = [
  {
    tab: "general",
    group: "settingsLanguageLabel",
    entries: [
      { title: "settingsLanguageLabel", also: ["settingsLanguageAuto"], keywords: "language langue translation traduction" },
    ],
  },
  {
    tab: "general",
    group: "settingsGroupOnboarding",
    entries: [
      { title: "settingsShowTipsLabel", hint: "settingsShowTipsHint", keywords: "astuce conseil hint help aide" },
    ],
  },
  {
    tab: "general",
    group: "settingsGroupAppUpdates",
    entries: [
      { title: "settingsCheckUpdatesLabel", keywords: "update version mise jour maj" },
      { title: "settingsAutoUpdateLabel", hint: "settingsAutoUpdateHint", parent: "settingsCheckUpdatesLabel", keywords: "update version mise jour maj" },
      { title: "settingsCheckUpdatesButton", keywords: "update version mise jour maj" },
      { title: "settingsUxpMigrationButton", hint: "settingsUxpMigrationHint", requires: "uxpMigration", keywords: "uxp legacy cep" },
    ],
  },
  {
    tab: "general",
    group: "settingsGroupMaintenance",
    entries: [
      { title: "settingsClearCache", hint: "settingsClearCacheHint", requires: "clearCache", keywords: "vider nettoyer espace disque disk space temporary" },
    ],
  },
  {
    tab: "insertion",
    group: "settingsGroupPaste",
    entries: [
      { title: "settingsTextItemKindLabel", also: ["settingsTextItemKindBox", "settingsTextItemKindPoint"], keywords: "paragraph paragraphe" },
      { title: "settingsSmartPasteLabel", hint: "settingsSmartPasteHelp", keywords: "intelligent auto" },
      { title: "settingsSmartPasteDistributeLabel", hint: "settingsSmartPasteDistributeHelp", parent: "settingsSmartPasteLabel", keywords: "double triple" },
      { title: "settingsSmartPasteAutoCleanLabel", hint: "settingsSmartPasteAutoCleanHelp", parent: "settingsSmartPasteLabel", keywords: "cleaning nettoyage nettoyer effacer erase" },
      { title: "settingsSmartPasteMinScaleLabel", hint: "settingsSmartPasteMinScaleHelp", parent: "settingsSmartPasteLabel", keywords: "shrink reduire" },
      {
        title: "settingsSmartPasteHyphenationLabel",
        parent: "settingsSmartPasteLabel",
        also: ["settingsHyphenationAuto", "settingsHyphenationFr", "settingsHyphenationEn"],
        keywords: "hyphen tiret trait union coupure",
      },
      { title: "settingsPasteOnClickLabel", hint: "settingsPasteOnClickHelp", keywords: "baguette magique magic wand clic" },
      { title: "multiBubbleModeToggle", hint: "multiBubbleModeHint", also: ["multiBubbleModeHowToUse"], keywords: "multibulle plusieurs selections" },
    ],
  },
  {
    tab: "insertion",
    group: "settingsGroupCentering",
    entries: [
      {
        title: "settingsAutoCenterLabel",
        hint: "settingsAutoCenterHint",
        also: ["settingsAutoCenterOff", "settingsAutoCenterSingle", "settingsAutoCenterMulti", "settingsAutoCenterSmartPasteNote"],
        keywords: "centrer center",
      },
      { title: "settingsResizeTextBoxOnCenterLabel", hint: "settingsResizeTextBoxOnCenterHint", keywords: "centrer center redimensionner resize" },
      { title: "settingsInternalPaddingLabel", hint: "settingsInternalPaddingHint", keywords: "marge margin espace bord" },
    ],
  },
  {
    tab: "insertion",
    groupText: "TextShapeR",
    entries: [
      { title: "settingsInlineTextShapeRLabel", hint: "settingsInlineTextShapeRHint", keywords: "forme shape suggestion" },
      { title: "settingsDehyphenateLabel", hint: "settingsDehyphenateHint", parent: "settingsInlineTextShapeRLabel", keywords: "cesure tiret hyphen" },
    ],
  },
  {
    tab: "insertion",
    group: "settingsGroupShapeTuning",
    entries: [
      { title: "textShapeRTrainTitle", hint: "textShapeRTrainIntro", keywords: "textshaper apprentissage entrainement learning training" },
      { title: "settingsShapeTuningImport", hint: "settingsShapeTuningHint", keywords: "textshaper apprentissage learning" },
      { title: "settingsShapeTuningExport", hint: "settingsShapeTuningHint", keywords: "textshaper apprentissage learning" },
    ],
  },
  {
    tab: "script",
    group: "settingsGroupTextScript",
    entries: [
      { title: "settingsLinePrefixesLabel", hint: "settingsLinePrefixesDescr", keywords: "ignorer ignore commentaire comment" },
      { title: "settingsIgnoreTagsLabel", hint: "settingsIgnoreTagsDescr", keywords: "balise ignorer ignore" },
      { title: "settingsMarkdownLabel", hint: "settingsMarkdownHint", keywords: "gras italique bold italic" },
    ],
  },
  {
    tab: "script",
    group: "settingsGroupPages",
    entries: [
      { title: "settingsResetLineCounterOnPageLabel", hint: "settingsResetLineCounterOnPageHint", keywords: "numero numerotation number" },
      { title: "settingsAutoClosePsdLabel", hint: "settingsAutoClosePsdHint", keywords: "fermer close psd" },
    ],
  },
  {
    tab: "script",
    group: "settingsGroupTextDirection",
    entries: [
      { title: "settingsDirectionLabel", also: ["settingsDirectionLtr", "settingsDirectionRtl"], keywords: "ltr rtl gauche droite left right arabe arabic hebreu hebrew moyen orient middle east" },
    ],
  },
  {
    tab: "styles",
    group: "settingsGroupStyleSelection",
    entries: [
      { title: "settingsDefaultStyleLabel", hint: "settingsDefaultStyleDescr", also: ["settingsDefaultStyleNone"], keywords: "defaut default" },
      { title: "settingsCurrentFolderTagPriorityLabel", hint: "settingsCurrentFolderTagPriorityHint", keywords: "dossier folder tag balise" },
    ],
  },
  {
    tab: "styles",
    group: "settingsGroupQuickSizes",
    entries: [
      { title: "settingsQuickStyleSizeLabel", keywords: "taille size preset prereglage" },
      { title: "settingsQuickStyleSizeStepLabel", hint: "settingsQuickStyleSizeStepHint", parent: "settingsQuickStyleSizeLabel", keywords: "taille size pas increment" },
    ],
  },
  {
    tab: "styles",
    group: "settingsRefontTitle",
    entries: [
      {
        title: "settingsRefontTitle",
        hint: "settingsRefontHelp",
        also: ["settingsRefontOpen", "settingsRefontClose", "settingsRefontStyle", "settingsRefontKeepMarkers", "settingsRefontAdd"],
        keywords: "police font italique italic marqueur marker guillemets quotes",
      },
    ],
  },
  {
    tab: "shortcuts",
    entries: [
      { title: "settingsResetShortcuts", hint: "settingsShortcutsTip", also: ["settingsShortcutsHint"], keywords: "touche clavier key keyboard hotkey" },
      { title: "settingsKeyboardAccessOpen", hint: "settingsKeyboardAccessText", requires: "keyboardAccess", keywords: "permission macos autorisation surveillance entree input monitoring raccourci shortcut" },
    ],
  },
  {
    tab: "appearance",
    group: "settingsGroupTheme",
    entries: [
      { title: "settingsThemeNew", keywords: "couleur color personnaliser customize" },
      {
        title: "settingsThemeImage",
        also: ["settingsBackgroundBlur", "settingsBackgroundOpacity", "settingsBackgroundTint", "settingsBackgroundZoom"],
        keywords: "fond background wallpaper photo",
      },
    ],
  },
  {
    tab: "appearance",
    group: "settingsGroupInterface",
    entries: [
      { title: "settingsLayoutBlockPreview", layoutBlock: "preview", keywords: "masquer hide panneau panel" },
      { title: "settingsLayoutBlockText", layoutBlock: "text", keywords: "masquer hide panneau panel" },
      { title: "settingsLayoutBlockStyles", layoutBlock: "styles", keywords: "masquer hide panneau panel" },
      { title: "settingsLayoutBlockFooter", layoutBlock: "footer", keywords: "bas masquer hide" },
      { title: "settingsLayoutPreviewHeight", anchor: "settingsLayoutHeight", layoutBlock: "preview", keywords: "taille size" },
      { title: "settingsLayoutStylesHeight", anchor: "settingsLayoutHeight", layoutBlock: "styles", keywords: "taille size" },
      { title: "settingsLayoutElTabBar", layoutBlock: "text", parent: "settingsLayoutBlockText", keywords: "onglet" },
      { title: "settingsLayoutElCreate", layoutBlock: "preview", parent: "settingsLayoutBlockPreview" },
      { title: "settingsLayoutElAlign", layoutBlock: "preview", parent: "settingsLayoutBlockPreview" },
      { title: "settingsLayoutElSize", layoutBlock: "preview", parent: "settingsLayoutBlockPreview" },
      { title: "settingsLayoutElNav", layoutBlock: "preview", parent: "settingsLayoutBlockPreview" },
      { title: "settingsLayoutElWidget", layoutBlock: "preview", parent: "settingsLayoutBlockPreview" },
      { title: "settingsLayoutElHelp", layoutBlock: "footer", parent: "settingsLayoutBlockFooter" },
      { title: "settingsLayoutElSettings", layoutBlock: "footer", parent: "settingsLayoutBlockFooter" },
      { title: "settingsLayoutElRepo", layoutBlock: "footer", parent: "settingsLayoutBlockFooter" },
      { title: "settingsLayoutModeIcons", hint: "settingsLayoutModeIconsNote", layoutBlock: "footer", parent: "settingsLayoutBlockFooter", keywords: "icone icon" },
      { title: "settingsLayoutScaleLabel", keywords: "zoom taille size agrandir echelle ui" },
      { title: "settingsLayoutReset", hint: "settingsLayoutCanvasHint", keywords: "reinitialiser" },
    ],
  },
  {
    tab: "data",
    group: "profilesTitle",
    entries: [
      { title: "profilesTitle", hint: "profilesHint", keywords: "profil profile compte" },
      { title: "profilesManageTitle", also: ["profilesRename", "profilesDelete"], keywords: "profil profile" },
      { title: "profilesCreateTitle", hint: "profilesCreateHint", keywords: "profil profile nouveau new" },
    ],
  },
  {
    tab: "data",
    group: "settingsGroupImportExport",
    entries: [
      { title: "fontScanTitle", hint: "fontScanPromo", keywords: "police font psd" },
      { title: "settingsImport", keywords: "importer import sauvegarde backup json tpl restaurer restore" },
      { title: "settingsExport", keywords: "exporter export sauvegarde backup json" },
    ],
  },
  {
    tab: "data",
    group: "settingsGroupDanger",
    entries: [
      { title: "settingsResetProfile", hint: "settingsResetProfileHint", keywords: "reinitialiser supprimer effacer delete erase" },
    ],
  },
];

const TAB_HINTS = { fontViewer: "fontViewerIntro" };
const TAB_KEYWORDS = {
  shortcuts: "touche clavier key keyboard hotkey",
  appearance: "theme interface",
  fontViewer: "police font telecharger download",
};

// Words that say nothing about a setting: "taille du texte" must find "Taille
// de texte". Other languages lose their short words through the length rule.
const STOP_WORDS = [
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "au", "aux", "en", "dans", "pour", "avec", "sur", "mon", "ma", "mes", "ce", "cette",
  "the", "an", "of", "to", "in", "on", "for", "and", "or", "with", "my", "this",
];

const WEIGHTS = { title: 100, baseTitle: 60, keywords: 50, crumbs: 35, also: 30, hint: 25, baseAlso: 15, baseHint: 15 };
const PROMINENT = ["title", "baseTitle", "keywords", "crumbs", "also"];
const QUALITY = { exact: 1, prefix: 0.8, stem: 0.7, inner: 0.5, fuzzy: 0.45 };
const MAX_RESULTS = 40;

const FOLDED_LETTERS = { œ: "oe", æ: "ae", ß: "ss", đ: "d", ı: "i", ł: "l", ø: "o" };

// Case, accents, ligatures and punctuation out, character count aside: the
// highlight relies on folding one character at a time giving the same text.
const foldText = (value) => String(value === null || value === undefined ? "" : value)
  .normalize("NFD")
  .replace(/[̀-ًͯ-ٟ]/g, "")
  .toLowerCase()
  .replace(/[œæßđıłø]/g, (letter) => FOLDED_LETTERS[letter])
  .replace(/[\u0000-/:-@[-`{-¿ -⁯　-〿]/g, " ");

export const normalizeSearchText = (value) => foldText(value).replace(/ +/g, " ").trim();

const makeField = (name, values) => {
  const phrase = normalizeSearchText(values.filter(Boolean).join(" "));
  return phrase ? { name, weight: WEIGHTS[name], phrase, words: phrase.split(" "), compact: phrase.replace(/ /g, "") } : null;
};

const prepareEntry = (entry, locale, baseLocale, tabLabel) => {
  const text = (key) => (key && locale[key]) || "";
  const baseText = (key) => (key && baseLocale[key]) || "";
  const title = entry.titleText || text(entry.title);
  const hint = text(entry.hint);
  const parent = text(entry.parent);
  const group = entry.groupText || text(entry.group);
  const also = (entry.also || []).map(text);
  // The path shown above the title, without repeating it
  const crumbs = [tabLabel, group, parent].filter((crumb, index, all) => crumb && crumb !== title && all.indexOf(crumb) === index);
  const baseIfDifferent = (key, current) => {
    const value = baseText(key);
    return value && value !== current ? value : "";
  };
  const fields = [
    makeField("title", [title]),
    makeField("keywords", [entry.keywords]),
    makeField("crumbs", crumbs),
    makeField("also", also),
    makeField("hint", [hint]),
    // English also works in a translated interface
    makeField("baseTitle", [baseIfDifferent(entry.title, title)]),
    makeField("baseAlso", (entry.also || []).map((key) => baseIfDifferent(key, text(key)))),
    makeField("baseHint", [baseIfDifferent(entry.hint, hint)]),
  ].filter(Boolean);
  return {
    id: entry.id,
    tab: entry.tab,
    title,
    hint,
    crumbs,
    group,
    parent,
    anchor: text(entry.anchor) || title,
    layoutBlock: entry.layoutBlock || null,
    isTab: entry.isTab === true,
    boost: entry.boost || 0,
    fields,
  };
};

// available.<name> tells whether the entries that require it are displayed;
// a disabled tab is left out of the results with everything inside it.
export const buildSettingsSearchIndex = ({
  locale = {},
  baseLocale = {},
  tabs = [],
  shortcutGroups = [],
  themes = [],
  footerModes = [],
  available = {},
} = {}) => {
  const tabLabels = {};
  const enabledTabs = tabs.filter((tab) => !tab.disabled);
  enabledTabs.forEach((tab) => {
    tabLabels[tab.id] = tab.label;
  });
  const raw = enabledTabs.map((tab) => ({
    tab: tab.id,
    isTab: true,
    titleText: tab.label,
    hint: TAB_HINTS[tab.id],
    keywords: TAB_KEYWORDS[tab.id],
  }));
  SECTIONS.forEach((section) => {
    section.entries.forEach((entry) => {
      if (entry.requires && !available[entry.requires]) return;
      raw.push({ ...entry, tab: section.tab, group: section.group, groupText: section.groupText });
    });
  });
  // A setting comes before a theme that scores the same, and before a shortcut
  // that merely starts with the words searched: "paste" is about Smart paste
  // before "Paste text to the current layer". A shortcut's exact name still wins.
  themes.forEach((label) => {
    raw.push({ tab: "appearance", group: "settingsGroupTheme", titleText: label, keywords: "theme mode", boost: -5 });
  });
  footerModes.forEach((label) => {
    raw.push({
      tab: "appearance",
      group: "settingsGroupInterface",
      parent: "settingsLayoutBlockFooter",
      titleText: label,
      layoutBlock: "footer",
      keywords: "masquer hide",
      boost: -5,
    });
  });
  shortcutGroups.forEach((group) => {
    group.commands.forEach((command) => {
      raw.push({
        tab: "shortcuts",
        group: group.labelKey,
        title: command.label,
        hint: command.label + "Descr",
        keywords: "raccourci touche clavier key keyboard hotkey",
        boost: -60,
      });
    });
  });
  return raw
    .filter((entry) => tabLabels[entry.tab])
    .map((entry, index) => prepareEntry({ ...entry, id: index }, locale, baseLocale, entry.isTab ? "" : tabLabels[entry.tab]))
    .filter((entry) => entry.title);
};

const commonPrefixLength = (a, b) => {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length++;
  return length;
};

// "couleurs" finds "couleur" and "coller" finds "collage", "page" stays away
// from "paste"
const isSameStem = (token, word) => {
  if (token.length < 4 || word.length < 4) return false;
  return commonPrefixLength(token, word) >= Math.max(4, token.length - 2);
};

const matchField = (field, token, prominent) => {
  let best = 0;
  let matched = token;
  for (let i = 0; i < field.words.length; i++) {
    const word = field.words[i];
    if (word === token) return { quality: QUALITY.exact, term: token };
    // A short token would find half of the descriptions
    if (word.indexOf(token) === 0 && (token.length >= 3 || prominent)) {
      if (best < QUALITY.prefix) {
        best = QUALITY.prefix;
        matched = token;
      }
    } else if (best < QUALITY.stem && isSameStem(token, word)) {
      best = QUALITY.stem;
      matched = word;
    }
  }
  // Across words, so "multibulle" finds "multi-bulle"
  if (!best && prominent && token.length >= 3 && field.compact.indexOf(token) >= 0) {
    best = QUALITY.inner;
  }
  return best ? { quality: best, term: matched } : null;
};

const typoAllowance = (length) => (length >= 8 ? 2 : length >= 4 ? 1 : 0);

// Edit distance with swapped letters counted once, given up past "max"
const editDistance = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let beforeLast = null;
  let last = [];
  for (let j = 0; j <= b.length; j++) last[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(last[j] + 1, row[j - 1] + 1, last[j - 1] + cost);
      if (beforeLast && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforeLast[j - 2] + 1);
      }
      row[j] = value;
      if (value < smallest) smallest = value;
    }
    if (smallest > max) return max + 1;
    beforeLast = last;
    last = row;
  }
  return last[b.length];
};

const matchFieldFuzzy = (field, token) => {
  const max = typoAllowance(token.length);
  if (!max) return null;
  for (let i = 0; i < field.words.length; i++) {
    const word = field.words[i];
    // The word itself, or its beginning while it is still being typed
    if (word.length >= 4 && (editDistance(token, word, max) <= max
      || (token.length >= 5 && word.length > token.length && editDistance(token, word.slice(0, token.length), max) <= max))) {
      return { quality: QUALITY.fuzzy, term: word };
    }
  }
  return null;
};

const scoreToken = (entry, token, fuzzy) => {
  let best = null;
  entry.fields.forEach((field) => {
    const prominent = PROMINENT.indexOf(field.name) >= 0;
    const match = fuzzy ? (prominent ? matchFieldFuzzy(field, token) : null) : matchField(field, token, prominent);
    if (!match) return;
    const score = field.weight * match.quality;
    if (!best || score > best.score) best = { score, term: match.term, field: field.name };
  });
  return best;
};

const scoreEntry = (entry, tokens, phrase, { fuzzy = false, missingAllowed = 0 } = {}) => {
  let score = entry.boost;
  let missing = 0;
  let inTitle = 0;
  const terms = [];
  for (let i = 0; i < tokens.length; i++) {
    const hit = scoreToken(entry, tokens[i], fuzzy);
    if (!hit) {
      missing += 1;
      if (missing > missingAllowed) return null;
    } else {
      score += hit.score;
      terms.push(hit.term);
      if (hit.field === "title") inTitle += 1;
    }
  }
  if (inTitle === tokens.length) score += 60;
  const titleField = entry.fields[0];
  if (titleField.phrase === phrase) score += 300;
  else if (titleField.phrase.indexOf(phrase) === 0) score += 120;
  else if (titleField.phrase.indexOf(phrase) > 0) score += 60;
  else if (tokens.length > 1 && entry.fields.some((field) => field.name === "hint" && field.phrase.indexOf(phrase) >= 0)) score += 20;
  return { entry, score: missing ? score / 2 : score, terms };
};

const runPass = (entries, tokens, phrase, options) => entries
  .map((entry) => scoreEntry(entry, tokens, phrase, options))
  .filter(Boolean);

const queryTokens = (phrase) => {
  const all = phrase.split(" ").filter(Boolean).filter((token, index, list) => list.indexOf(token) === index);
  const useful = all.filter((token) => token.length > 2 && STOP_WORDS.indexOf(token) < 0);
  return useful.length ? useful : all;
};

// Exact words first; typos only when nothing matches as written, so "fond"
// never brings "font"; a word that matches nothing at all only as a last resort
export const searchSettings = (entries, query) => {
  const phrase = normalizeSearchText(query);
  if (!phrase) return [];
  const tokens = queryTokens(phrase);
  let results = runPass(entries, tokens, phrase, {});
  if (!results.length) results = runPass(entries, tokens, phrase, { fuzzy: true });
  if (!results.length && tokens.length > 1) results = runPass(entries, tokens, phrase, { missingAllowed: 1 });
  return results
    .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length || a.entry.id - b.entry.id)
    .slice(0, MAX_RESULTS);
};

// Cuts a text into plain and matched pieces, on the original characters
export const splitHighlights = (text, terms) => {
  const source = String(text === null || text === undefined ? "" : text);
  let folded = "";
  const origin = [];
  for (let i = 0; i < source.length; i++) {
    const piece = foldText(source[i]);
    for (let j = 0; j < piece.length; j++) origin.push(i);
    folded += piece;
  }
  const marked = new Array(source.length).fill(false);
  (terms || []).forEach((term) => {
    if (!term) return;
    const starts = { word: [], any: [] };
    let at = folded.indexOf(term);
    while (at >= 0) {
      starts.any.push(at);
      if (at === 0 || folded[at - 1] === " ") starts.word.push(at);
      at = folded.indexOf(term, at + 1);
    }
    const chosen = starts.word.length ? starts.word : term.length >= 3 ? starts.any : [];
    chosen.forEach((start) => {
      for (let i = start; i < start + term.length; i++) marked[origin[i]] = true;
    });
  });
  const pieces = [];
  for (let i = 0; i < source.length; i++) {
    const last = pieces[pieces.length - 1];
    if (last && last.match === marked[i]) last.text += source[i];
    else pieces.push({ text: source[i], match: marked[i] });
  }
  return pieces;
};

const ROW_SELECTOR = [
  ".settings-checkbox-item",
  ".shortcut-row",
  ".settings-layout-element",
  ".settings-layout-pick",
  ".settings-layout-slider",
  ".settings-layout-scale",
  ".settings-theme-cell",
  ".field",
  ".settings-group",
].join(",");

const findTextElement = (root, text) => {
  const wanted = normalizeSearchText(text);
  if (!root || !wanted) return null;
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null, false);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && parent.tagName !== "OPTION" && normalizeSearchText(node.nodeValue) === wanted) return parent;
    node = walker.nextNode();
  }
  return null;
};

// The row to show for a result. It is found by its displayed text, so the
// setting markup needs no marker. An option under a toggle that is off is not
// displayed: the toggle is shown instead, then the group.
export const findSettingRow = (root, entry) => {
  const groupTitle = findTextElement(root, entry.group);
  const group = groupTitle ? groupTitle.closest(".settings-group") : null;
  const target = findTextElement(group, entry.anchor)
    || findTextElement(root, entry.anchor)
    || findTextElement(group, entry.parent)
    || findTextElement(root, entry.parent)
    || groupTitle;
  return target ? target.closest(ROW_SELECTOR) || target : null;
};
