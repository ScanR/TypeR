// "Did you know?" tips for features hidden behind a modifier key, a
// right-click or a gesture. Each tip shows once, right after the user does
// the related action, in a toast above the footer. `after` delays it
// until the action has been done that many times in the session, so a tip
// about a faster way to do something only shows to people who repeat it.
// Placeholders are filled at render time from `vars` below.
const FEATURE_TIPS = {
  applyStyleKeepSize: {
    key: "tipApplyStyleKeepSize",
    after: 3,
    fallback: "Hold Ctrl while clicking a style's ➜ arrow to apply it and keep the current size of the selected layer.",
  },
  numpadStyles: {
    key: "tipNumpadStyles",
    after: 8,
    fallback: "While the panel is active, numpad keys 1 to 9 select the 1st to 9th style of the current folder.",
  },
  styleContextMenu: {
    key: "tipStyleContextMenu",
    fallback: "Right-click a style to copy, paste or duplicate it. Right-click a folder header to paste a copied style into that folder.",
  },
  styleContinuation: {
    key: "tipStyleContinuation",
    fallback: "In the script, a line starting with // takes the style of the line above, so you don't have to repeat its tag.",
  },
  deleteFolderWithStyles: {
    key: "tipDeleteFolderWithStyles",
    fallback: "Hold Shift while clicking \"{delete}\" in the folder editor to delete its styles too, instead of moving them to \"{unsorted}\".",
  },
  renameTab: {
    key: "tipRenameTab",
    fallback: "Double-click a tab to rename it. Drag it to change the order.",
  },
  pageSync: {
    key: "tipPageSync",
    fallback: "Your script has page markers: click \"{importPages}\" at the bottom of the panel to link your PSD files, and TypeR opens the right page as you go through the lines.",
  },
  keepSizePaste: {
    key: "tipKeepSizePaste",
    after: 3,
    fallback: "Hold {keepSize} while pasting to keep the size of the selected text layer.",
  },
  pasteMultipleLayers: {
    key: "tipPasteMultipleLayers",
    after: 6,
    fallback: "Select several text layers in Photoshop with no selection, then click \"{paste}\": they are filled with the next lines, in the order you clicked them.",
  },
  alignWithoutSelection: {
    key: "tipAlignWithoutSelection",
    after: 2,
    fallback: "\"{align}\" also works with no selection: TypeR finds the bubble around the text. Select several text layers to center each one in its own bubble.",
  },
  textShapeRShiftApply: {
    key: "tipTextShapeRShiftApply",
    after: 2,
    fallback: "Shift-click a TextShapeR suggestion to apply it and move on to the next line.",
  },
};

const isFeatureTipId = (id) => Object.prototype.hasOwnProperty.call(FEATURE_TIPS, id);

// Stored data is untrusted: keep only known ids flagged as seen
const normalizeSeenFeatureTips = (value) => {
  const seen = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return seen;
  Object.keys(value).forEach((id) => {
    if (isFeatureTipId(id) && value[id] === true) seen[id] = true;
  });
  return seen;
};

// Returns the state fields to merge after the action behind tip `id`
// happened, or null when nothing changes. The tip stays hidden when tips are
// off, it was already seen, a modal or tour covers the panel, or another tip
// is still on screen (the newer one would bury it before it could be read);
// a hidden tip is not marked as seen, so the next occurrence can show it.
const showFeatureTip = (state, id) => {
  if (!isFeatureTipId(id) || state.showTips === false) return null;
  const seen = normalizeSeenFeatureTips(state.seenFeatureTips);
  if (seen[id]) return null;
  const counts = state.featureTipCounts || {};
  const count = (counts[id] || 0) + 1;
  const result = { featureTipCounts: { ...counts, [id]: count } };
  if (count < (FEATURE_TIPS[id].after || 1) || state.modalType || state.activeFeatureTip) return result;
  result.activeFeatureTip = id;
  result.seenFeatureTips = { ...seen, [id]: true };
  return result;
};

const formatFeatureTip = (id, localeStrings = {}, vars = {}) => {
  const tip = FEATURE_TIPS[id];
  if (!tip) return "";
  const values = {
    delete: localeStrings.delete || "Delete",
    unsorted: localeStrings.noFolderTitle || "Unsorted",
    importPages: localeStrings.footerOpenRepo || "Import pages",
    paste: localeStrings.createLayer || "Paste",
    align: localeStrings.alignLayer || "Align",
    ...vars,
  };
  const text = localeStrings[tip.key] || tip.fallback;
  return text.replace(/\{(\w+)\}/g, (match, name) => (values[name] != null ? values[name] : match));
};

export {
  FEATURE_TIPS,
  formatFeatureTip,
  isFeatureTipId,
  normalizeSeenFeatureTips,
  showFeatureTip,
};
