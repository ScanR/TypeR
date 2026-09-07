import {
  alignTextLayerToSelection,
  changeActiveLayerTextSize,
  createTextLayerInSelection,
  createTextLayersInStoredSelections,
  deselectDocument,
  getSelectedTextLayers,
  getTypeRSelectionSnapshot,
  locale,
  nativeAlert,
  setActiveLayerText,
  setSelectedTextLayers,
  toggleCleaningLayers,
} from "./utils";
import { buildSelectedLayerPayload, buildStoredSelectionPayload, getScaledStyle } from "./textLayerPayload";

const applyLinesToLayers = (ctx, layers, preferredOrder = [], options = {}) => {
  const selectedIds = layers
    .map((layer) => layer.id)
    .filter((id) => typeof id === "number");
  const orderedIds = preferredOrder
    .filter((id) => selectedIds.indexOf(id) !== -1)
    .concat(selectedIds.filter((id) => preferredOrder.indexOf(id) === -1));

  if (orderedIds.length < 2) {
    nativeAlert(locale.errorSelectMultipleTextLayers, locale.errorTitle, true);
    return;
  }

  const payload = buildSelectedLayerPayload({
    layerIds: orderedIds,
    lines: ctx.state.lines,
    currentLineIndex: ctx.state.currentLineIndex,
    currentStyle: ctx.state.currentStyle,
    textScale: ctx.state.textScale,
  });
  if (payload.items.length < 2) {
    nativeAlert(locale.errorNotEnoughLinesForMultiPaste, locale.errorTitle, true);
    return;
  }

  setSelectedTextLayers(payload.items, ctx.state.direction, (ok) => {
    if (!ok) return;
    ctx.dispatch({
      type: "commitLineBatch",
      entries: payload.lineEntries,
      nextLineIndex: payload.nextLineIndex,
    });
    if (payload.items.length < orderedIds.length) {
      nativeAlert(
        locale.multiPastePartial
          .replace("{applied}", payload.items.length)
          .replace("{selected}", orderedIds.length),
        locale.warningTitle,
        true
      );
    }
  }, orderedIds, options);
};

const pasteInSelection = (ctx, preferredOrder = [], options = {}) => {
  const storedSelections = ctx.state.storedSelections || [];

  if (ctx.state.multiBubbleMode && storedSelections.length > 0) {
    const payload = buildStoredSelectionPayload({
      storedSelections,
      lines: ctx.state.lines,
      currentLineIndex: ctx.state.currentLineIndex,
      styles: ctx.state.styles,
      currentStyle: ctx.state.currentStyle,
      textScale: ctx.state.textScale,
    });

    createTextLayersInStoredSelections(
      payload.texts,
      payload.styles,
      storedSelections,
      ctx.state.pastePointText,
      ctx.state.internalPadding || 0,
      ctx.state.direction,
      (ok) => {
        if (!ok) return;
        ctx.dispatch({ type: "clearSelections", preserveLine: true });
        // Prevent the selection monitor from immediately capturing the live
        // marquee again after a successful multi-bubble paste.
        deselectDocument();
      },
      options
    );
    return;
  }

  getTypeRSelectionSnapshot(({ selection, layers }) => {
    if (!selection && layers.length >= 2) {
      applyLinesToLayers(ctx, layers, preferredOrder, options);
      return;
    }

    const line = ctx.state.currentLine || { text: "" };
    const style = getScaledStyle(ctx.state.currentStyle, ctx.state.textScale);
    createTextLayerInSelection(
      line.text,
      style,
      ctx.state.pastePointText,
      ctx.state.internalPadding || 0,
      ctx.state.direction,
      (ok) => {
        if (ok) ctx.dispatch({ type: "nextLine", add: true });
      },
      options
    );
  });
};

const applyLineAndStyle = (ctx, options = {}) => {
  const line = ctx.state.currentLine || { text: "" };
  const style = getScaledStyle(ctx.state.currentStyle, ctx.state.textScale);
  setActiveLayerText(line.text, style, ctx.state.direction, (ok) => {
    if (ok) ctx.dispatch({ type: "nextLine", add: true });
  }, options);
};

const insertLineText = (ctx) => {
  const line = ctx.state.currentLine || { text: "" };
  setActiveLayerText(line.text, null, ctx.state.direction, (ok) => {
    if (ok) ctx.dispatch({ type: "nextLine", add: true });
  });
};

const applyLinesToSelectedLayers = (ctx, preferredOrder = [], options = {}) => {
  getSelectedTextLayers((layers) => {
    applyLinesToLayers(ctx, layers, preferredOrder, options);
  });
};

const switchTab = (ctx, direction) => {
  const tabs = ctx.state.tabs || [];
  if (ctx.state.multiTabEnabled === false || tabs.length < 2) return;
  const currentIndex = tabs.findIndex((tab) => tab.id === ctx.state.currentTabId);
  const baseIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = (baseIndex + direction + tabs.length) % tabs.length;
  ctx.dispatch({ type: "switchTab", id: tabs[nextIndex].id });
};

// This is the single source of truth for shortcut identity, default keys,
// display label, repeat policy, and runtime behavior.
const shortcutCommands = [
  {
    id: "add",
    label: "shortcut_add",
    defaultKeys: ["WIN", "CTRL"],
    repeatDelay: 0,
    handler: (ctx, options) => pasteInSelection(ctx, [], options),
  },
  {
    id: "apply",
    label: "shortcut_apply",
    defaultKeys: ["WIN", "SHIFT"],
    repeatDelay: 0,
    handler: applyLineAndStyle,
  },
  {
    id: "keepTextSize",
    label: "shortcut_keepTextSize",
    defaultKeys: ["ALT"],
    modifierOnly: true,
    // Commands whose behavior this modifier changes. Matching is subset-based,
    // so if these bindings contain every key of the modifier, the modifier is
    // permanently on for them; the settings screen warns about that overlap.
    appliesTo: ["add", "apply", "applyMultiple"],
    repeatDelay: 0,
    handler: () => {},
  },
  {
    id: "center",
    label: "shortcut_center",
    defaultKeys: ["WIN", "ALT"],
    repeatDelay: 0,
    handler: (ctx) => alignTextLayerToSelection(
      ctx.state.resizeTextBoxOnCenter,
      ctx.state.internalPadding || 0
    ),
  },
  {
    id: "applyStyle",
    label: "shortcut_applyStyle",
    defaultKeys: [],
    repeatDelay: 0,
    handler: (ctx) => {
      if (ctx.state.currentStyle) {
        setActiveLayerText("", ctx.state.currentStyle, ctx.state.direction);
      }
    },
  },
  {
    id: "previous",
    label: "shortcut_previous",
    defaultKeys: ["CTRL", "TAB"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "prevLine" }),
  },
  {
    id: "next",
    label: "shortcut_next",
    defaultKeys: ["CTRL", "ENTER"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextLine" }),
  },
  {
    id: "previousPage",
    label: "shortcut_previousPage",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "previousPage" }),
  },
  {
    id: "nextPage",
    label: "shortcut_nextPage",
    defaultKeys: ["SHIFT", "X"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextPage" }),
  },
  {
    id: "previousStyle",
    label: "shortcut_previousStyle",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "previousStyle" }),
  },
  {
    id: "nextStyle",
    label: "shortcut_nextStyle",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextStyle" }),
  },
  {
    id: "nextTextSizePreset",
    label: "shortcut_nextTextSizePreset",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextStyleSizePreset" }),
  },
  {
    id: "increase",
    label: "shortcut_increase",
    defaultKeys: ["CTRL", "SHIFT", "PLUS"],
    repeatDelay: 300,
    handler: (ctx) => changeActiveLayerTextSize(ctx.state.textSizeIncrement || 1),
  },
  {
    id: "decrease",
    label: "shortcut_decrease",
    defaultKeys: ["CTRL", "SHIFT", "MINUS"],
    repeatDelay: 300,
    handler: (ctx) => changeActiveLayerTextSize(-(ctx.state.textSizeIncrement || 1)),
  },
  {
    id: "toggleCleaningLayers",
    label: "shortcut_toggleCleaningLayers",
    defaultKeys: ["CTRL", "H"],
    repeatDelay: 300,
    handler: () => toggleCleaningLayers(),
  },
  {
    id: "insertText",
    label: "shortcut_insertText",
    defaultKeys: ["WIN", "SHIFT", "V"],
    legacyDefaultKeys: ["WIN", "V"],
    repeatDelay: 0,
    handler: insertLineText,
  },
  {
    id: "applyMultiple",
    label: "shortcut_applyMultiple",
    defaultKeys: [],
    repeatDelay: 0,
    handler: (ctx, options) => applyLinesToSelectedLayers(ctx, [], options),
  },
  {
    id: "toggleMultiBubble",
    label: "shortcut_toggleMultiBubble",
    defaultKeys: ["CTRL", "ALT", "M"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({
      type: "setMultiBubbleMode",
      value: !ctx.state.multiBubbleMode,
    }),
  },
  {
    id: "detectBubbles",
    label: "shortcut_detectBubbles",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "setModal", modal: "bubbleDetect" }),
  },
  {
    id: "removeLastSelection",
    label: "shortcut_removeLastSelection",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => {
      const selections = ctx.state.storedSelections || [];
      if (selections.length) {
        ctx.dispatch({ type: "removeSelection", index: selections.length - 1 });
        // The removed item is normally still the live Photoshop marquee.
        // Drop it so the selection monitor cannot capture it again.
        deselectDocument();
      }
    },
  },
  {
    id: "clearSelections",
    label: "shortcut_clearSelections",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => {
      if ((ctx.state.storedSelections || []).length) {
        ctx.dispatch({ type: "clearSelections" });
        deselectDocument();
      }
    },
  },
  {
    id: "toggleTextShapeR",
    label: "shortcut_toggleTextShapeR",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({
      type: "setInlineTextShapeR",
      value: !ctx.state.inlineTextShapeR,
    }),
  },
  {
    id: "previousTab",
    label: "shortcut_previousTab",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => switchTab(ctx, -1),
  },
  {
    id: "nextTab",
    label: "shortcut_nextTab",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => switchTab(ctx, 1),
  },
];

const getDefaultShortcuts = () => shortcutCommands.reduce((shortcuts, command) => {
  shortcuts[command.id] = command.defaultKeys.concat([]);
  return shortcuts;
}, {});

const sameShortcut = (left, right) => (
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((key, index) => key === right[index])
);

// Move users who still have an unchanged previous default onto the new one,
// while preserving shortcuts they explicitly customized.
const migrateShortcutDefaults = (storedShortcuts, defaults = getDefaultShortcuts()) => {
  const stored = storedShortcuts && typeof storedShortcuts === "object" ? storedShortcuts : {};
  const shortcuts = { ...defaults, ...stored };
  let migrated = false;

  shortcutCommands.forEach((command) => {
    if (!sameShortcut(stored[command.id], command.legacyDefaultKeys)) return;
    shortcuts[command.id] = (defaults[command.id] || []).concat([]);
    migrated = true;
  });

  return { shortcuts, migrated };
};

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
const shortcutKeyLabels = {
  WIN: isMac ? "Cmd" : "Win",
  CTRL: "Ctrl",
  SHIFT: "Shift",
  ALT: isMac ? "Opt" : "Alt",
  ENTER: "Enter",
  TAB: "Tab",
  SPACE: "Space",
  ESCAPE: "Esc",
  BACKSPACE: "Bksp",
  DELETE: "Del",
  PLUS: "+",
  MINUS: "-",
  EQUAL: "=",
  DIVIDE: "/",
  MULTIPLY: "*",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
  MOUSE4: "Mouse 4",
  MOUSE5: "Mouse 5",
};

const formatShortcut = (keys) => (keys || [])
  .map((key) => shortcutKeyLabels[String(key).toUpperCase()] || key)
  .join(" + ");

const withShortcutHint = (label, keys) => {
  const shortcut = formatShortcut(keys);
  return shortcut ? `${label} (${shortcut})` : label;
};

const isShortcutActiveForEvent = (event, keys) => {
  if (!event || !Array.isArray(keys) || !keys.length) return false;
  const pressedModifiers = [];
  if (event.metaKey) pressedModifiers.push("WIN");
  if (event.ctrlKey) pressedModifiers.push("CTRL");
  if (event.altKey) pressedModifiers.push("ALT");
  if (event.shiftKey) pressedModifiers.push("SHIFT");
  return keys.every((key) => pressedModifiers.indexOf(String(key).toUpperCase()) !== -1);
};

export {
  shortcutCommands,
  getDefaultShortcuts,
  migrateShortcutDefaults,
  shortcutKeyLabels,
  formatShortcut,
  withShortcutHint,
  isShortcutActiveForEvent,
  applyLinesToSelectedLayers,
  pasteInSelection,
};
