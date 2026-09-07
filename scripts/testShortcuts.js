const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const commandSource = fs.readFileSync(path.join(rootDir, "app_src", "shortcutCommands.js"), "utf8");
const contextSource = fs.readFileSync(path.join(rootDir, "app_src", "context.jsx"), "utf8");
const hotkeySource = fs.readFileSync(path.join(rootDir, "app_src", "hotkeys.jsx"), "utf8");
const previewSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "previewBlock", "previewBlock.jsx"), "utf8");
const shortcutEditorSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "modal", "shortCut.jsx"), "utf8");
const settingsSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "modal", "settings.jsx"), "utf8");
const utilsSource = fs.readFileSync(path.join(rootDir, "app_src", "utils.js"), "utf8");
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");

const commandBlocks = [...commandSource.matchAll(/\{\s*\n\s+id:\s+"([^"]+)"[\s\S]*?\n\s{2}\},/g)];
const commandIds = commandBlocks.map((match) => match[1]);
const commandBlockById = new Map(commandBlocks.map((match) => [match[1], match[0]]));
const expectedNewCommands = [
  "previousPage",
  "previousStyle",
  "nextStyle",
  "nextTextSizePreset",
  "applyStyle",
  "applyMultiple",
  "removeLastSelection",
  "clearSelections",
  "toggleTextShapeR",
  "previousTab",
  "nextTab",
];

assert(commandIds.length > 0, "No shortcut commands found");
assert.strictEqual(new Set(commandIds).size, commandIds.length, "Shortcut command IDs must be unique");
expectedNewCommands.forEach((id) => {
  assert(commandIds.includes(id), `Missing shortcut command: ${id}`);
  const block = commandBlockById.get(id);
  assert(
    new RegExp(`label:\\s*"shortcut_${id}"`).test(block) && /defaultKeys:\s*\[\]/.test(block),
    `${id} must have its translated label and remain unassigned by default`
  );
});
const cleaningLayersBlock = commandBlockById.get("toggleCleaningLayers");
assert(cleaningLayersBlock, "Missing shortcut command: toggleCleaningLayers");
assert(
  /label:\s*"shortcut_toggleCleaningLayers"/.test(cleaningLayersBlock) &&
    /defaultKeys:\s*\["CTRL",\s*"H"\]/.test(cleaningLayersBlock),
  "toggleCleaningLayers must use its translated label and default Ctrl+H shortcut"
);
const insertTextBlock = commandBlockById.get("insertText");
assert(insertTextBlock, "Missing shortcut command: insertText");
assert(
  /defaultKeys:\s*\["WIN",\s*"SHIFT",\s*"V"\]/.test(insertTextBlock),
  "insertText must use the safer default Cmd/Ctrl+Shift+V shortcut"
);
const keepTextSizeBlock = commandBlockById.get("keepTextSize");
assert(keepTextSizeBlock, "Missing shortcut modifier: keepTextSize");
assert(
  /defaultKeys:\s*\["ALT"\]/.test(keepTextSizeBlock) && /modifierOnly:\s*true/.test(keepTextSizeBlock),
  "keepTextSize must be an Alt modifier by default and must not run as a standalone command"
);
assert(
  /appliesTo:\s*\["add",\s*"apply",\s*"applyMultiple"\]/.test(keepTextSizeBlock),
  "keepTextSize must declare the commands it modifies so settings can warn about subset overlaps"
);
assert(contextSource.includes("getDefaultShortcuts()"), "Context must read defaults from the shortcut registry");
assert(!contextSource.includes('add: ["WIN", "CTRL"]'), "Shortcut defaults must not be duplicated in context");
assert(hotkeySource.includes("shortcutCommands.forEach"), "Hotkey matching must use the shortcut registry");
assert(!hotkeySource.includes("bindingOrder"), "Hotkey command order must not be maintained separately");
assert(
  (previewSource.match(/withShortcutHint\(/g) || []).length >= 3,
  "Paste, align, and apply tooltips must use the configured shortcut"
);
assert(!previewSource.includes("multiPasteExistingButton"), "Fill layers must not have its own preview button");
assert(
  /const requestId = \+\+hostQueryRef\.current;\s*if \(!hasMainKey\(localKeys\)\) return;/.test(shortcutEditorSource),
  "Modifier-only shortcut capture must not be overwritten by Photoshop's stale keyName"
);
assert(
  shortcutEditorSource.includes("if (props.modifierOnly && !localKeys.length) return;"),
  "A plain key press must not silently clear a modifier-only shortcut"
);
assert(
  shortcutEditorSource.includes("shortcutPressModifiers"),
  "Recording a modifier-only shortcut must show the modifier-specific hint"
);
assert(
  settingsSource.includes("shortcutModifierOverlaps") && settingsSource.includes("shortcutModifierOverlap"),
  "Settings must warn when the keep-size modifier is a subset of a paste shortcut"
);
assert(
  utilsSource.includes("locale.errorKeepTextSizeNoLayer || locale.errorNoTextLayer"),
  "The keep-size failure must use its dedicated error message"
);
assert(
  hotkeySource.includes("preserveActiveTextSize: checkShortcut(state, shortcut.keepTextSize)"),
  "Paste commands must receive the configured keep-size modifier state"
);
assert(
  hotkeySource.includes("syncKeepSizeHeld(context, realState)") &&
    hotkeySource.includes('window.addEventListener("blur", handleWindowBlur)'),
  "The live keep-size badge must be fed by the host poll and cleared on window blur"
);
assert(
  contextSource.includes("keepSizeHeld: false") && contextSource.includes('case "setKeepSizeHeld"'),
  "keepSizeHeld must be transient context state, never restored from storage"
);
assert(
  (previewSource.match(/keepSizeHeld/g) || []).length >= 3,
  "Both paste controls must render the keep-size indicator"
);
assert(
  utilsSource.includes("preserveActiveTextSize: options.preserveActiveTextSize === true") &&
    hostSource.includes("_overrideStyleTextSize(dataStyle") &&
    hostSource.includes("state.data.textSizeOverride = _getTextLayerSize()"),
  "The keep-size option must reach Photoshop for both apply and create flows"
);

const utilityCalls = [];
let selectionSnapshot = { selection: null, layers: [{ id: 10 }, { id: 20 }] };
const transformedCommands = babel.transformSync(commandSource, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const commandModule = { exports: {} };
const mockRequire = (request) => {
  if (request === "./utils") {
    return {
      alignTextLayerToSelection: (...args) => utilityCalls.push(["align", ...args]),
      changeActiveLayerTextSize: (...args) => utilityCalls.push(["resize", ...args]),
      createTextLayerInSelection: (...args) => utilityCalls.push(["create", ...args]),
      createTextLayersInStoredSelections: (...args) => utilityCalls.push(["createMany", ...args]),
      deselectDocument: (...args) => utilityCalls.push(["deselect", ...args]),
      getSelectedTextLayers: (callback) => {
        utilityCalls.push(["getSelectedTextLayers"]);
        callback([{ id: 10 }, { id: 20 }]);
      },
      getTypeRSelectionSnapshot: (callback) => {
        utilityCalls.push(["getTypeRSelectionSnapshot"]);
        callback(selectionSnapshot);
      },
      locale: {
        errorSelectMultipleTextLayers: "Select layers",
        errorNotEnoughLinesForMultiPaste: "Not enough lines",
        multiPastePartial: "{applied}/{selected}",
        errorTitle: "Error",
      },
      nativeAlert: (...args) => utilityCalls.push(["alert", ...args]),
      setActiveLayerText: (...args) => utilityCalls.push(["setText", ...args]),
      setSelectedTextLayers: (items, direction, callback, restoreLayerIds) => {
        utilityCalls.push(["setSelectedTextLayers", items, direction, restoreLayerIds]);
        callback(true);
      },
      toggleCleaningLayers: (...args) => utilityCalls.push(["toggleCleaningLayers", ...args]),
    };
  }
  if (request === "./textLayerPayload") {
    return {
      buildStoredSelectionPayload: () => ({ texts: [], styles: [] }),
      buildSelectedLayerPayload: ({ layerIds }) => ({
        items: layerIds.map((layerId, index) => ({ layerId, text: `line-${index}` })),
        lineEntries: layerIds.map((_, index) => ({ lineIndex: index, styleId: "style-1" })),
        nextLineIndex: 2,
      }),
      getScaledStyle: (style) => style,
    };
  }
  throw new Error(`Unexpected shortcutCommands dependency: ${request}`);
};
new Function("require", "module", "exports", transformedCommands)(
  mockRequire,
  commandModule,
  commandModule.exports
);
const runtimeCommands = commandModule.exports.shortcutCommands;
const getCommand = (id) => runtimeCommands.find((command) => command.id === id);
assert.deepStrictEqual(commandModule.exports.getDefaultShortcuts().insertText, ["WIN", "SHIFT", "V"]);
assert.deepStrictEqual(commandModule.exports.getDefaultShortcuts().keepTextSize, ["ALT"]);
assert.strictEqual(
  commandModule.exports.isShortcutActiveForEvent({ altKey: true }, ["ALT"]),
  true,
  "Alt-click must activate the default keep-size modifier"
);
assert.strictEqual(
  commandModule.exports.isShortcutActiveForEvent({ shiftKey: true }, ["ALT"]),
  false,
  "An unrelated modifier must not activate keep-size"
);
const migratedShortcuts = commandModule.exports.migrateShortcutDefaults(
  { insertText: ["WIN", "V"], nextPage: ["ALT", "P"] },
  commandModule.exports.getDefaultShortcuts()
);
assert.strictEqual(migratedShortcuts.migrated, true, "The old insertText default must be migrated");
assert.deepStrictEqual(migratedShortcuts.shortcuts.insertText, ["WIN", "SHIFT", "V"]);
assert.deepStrictEqual(migratedShortcuts.shortcuts.nextPage, ["ALT", "P"], "Custom shortcuts must be preserved");

const dispatches = [];
const baseContext = {
  state: {
    currentStyle: { id: "style-1" },
    currentStyleId: "style-1",
    direction: "rtl",
    inlineTextShapeR: false,
    multiBubbleMode: true,
    lines: [{ text: "line-0" }, { text: "line-1" }, { text: "line-2" }],
    currentLineIndex: 0,
    storedSelections: [{ id: "selection-1" }, { id: "selection-2" }],
    tabs: [{ id: "tab-1" }, { id: "tab-2" }, { id: "tab-3" }],
    currentTabId: "tab-2",
    multiTabEnabled: true,
  },
  dispatch: (action) => dispatches.push(action),
};

getCommand("applyStyle").handler(baseContext);
assert.deepStrictEqual(utilityCalls.shift(), ["setText", "", baseContext.state.currentStyle, "rtl"]);
const pasteContext = {
  ...baseContext,
  state: {
    ...baseContext.state,
    multiBubbleMode: false,
    storedSelections: [],
    currentLine: { text: "line-0" },
  },
};
getCommand("add").handler(pasteContext);
assert.deepStrictEqual(utilityCalls.shift(), ["getTypeRSelectionSnapshot"]);
assert.deepStrictEqual(utilityCalls.shift(), [
  "setSelectedTextLayers",
  [
    { layerId: 10, text: "line-0" },
    { layerId: 20, text: "line-1" },
  ],
  "rtl",
  [10, 20],
]);
assert.deepStrictEqual(dispatches.shift(), {
  type: "commitLineBatch",
  entries: [
    { lineIndex: 0, styleId: "style-1" },
    { lineIndex: 1, styleId: "style-1" },
  ],
  nextLineIndex: 2,
});
getCommand("apply").handler(pasteContext, { preserveActiveTextSize: true });
const preservedApplyCall = utilityCalls.shift();
assert.strictEqual(preservedApplyCall[0], "setText");
assert.deepStrictEqual(preservedApplyCall[5], { preserveActiveTextSize: true });
selectionSnapshot = { selection: { width: 100, height: 80 }, layers: [{ id: 10 }, { id: 20 }] };
getCommand("add").handler(pasteContext);
assert.deepStrictEqual(utilityCalls.shift(), ["getTypeRSelectionSnapshot"]);
assert.strictEqual(utilityCalls.shift()[0], "create", "Paste with an active selection must create a text layer");
getCommand("applyMultiple").handler(baseContext);
assert.deepStrictEqual(utilityCalls.shift(), ["getSelectedTextLayers"]);
assert.deepStrictEqual(utilityCalls.shift(), [
  "setSelectedTextLayers",
  [
    { layerId: 10, text: "line-0" },
    { layerId: 20, text: "line-1" },
  ],
  "rtl",
  [10, 20],
]);
assert.deepStrictEqual(dispatches.shift(), {
  type: "commitLineBatch",
  entries: [
    { lineIndex: 0, styleId: "style-1" },
    { lineIndex: 1, styleId: "style-1" },
  ],
  nextLineIndex: 2,
});
getCommand("removeLastSelection").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "removeSelection", index: 1 });
assert.deepStrictEqual(utilityCalls.shift(), ["deselect"]);
getCommand("clearSelections").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "clearSelections" });
assert.deepStrictEqual(utilityCalls.shift(), ["deselect"]);
getCommand("toggleTextShapeR").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "setInlineTextShapeR", value: true });
getCommand("toggleCleaningLayers").handler(baseContext);
assert.deepStrictEqual(utilityCalls.shift(), ["toggleCleaningLayers"]);
getCommand("previousTab").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "switchTab", id: "tab-1" });
getCommand("nextTab").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "switchTab", id: "tab-3" });
["previousPage", "previousStyle", "nextStyle", "nextTextSizePreset"].forEach((id) => {
  getCommand(id).handler(baseContext);
});
assert.deepStrictEqual(dispatches, [
  { type: "previousPage" },
  { type: "previousStyle" },
  { type: "nextStyle" },
  { type: "nextStyleSizePreset" },
]);

const localeFiles = [
  path.join(rootDir, "locale", "messages.properties"),
  ...fs.readdirSync(path.join(rootDir, "locale"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, "locale", entry.name, "messages.properties")),
];

localeFiles.forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  expectedNewCommands.forEach((id) => {
    assert(
      new RegExp(`^shortcut_${id}=`, "m").test(source),
      `Missing shortcut_${id} in ${path.relative(rootDir, file)}`
    );
  });
  assert(
    /^shortcut_toggleCleaningLayers=/m.test(source),
    `Missing shortcut_toggleCleaningLayers in ${path.relative(rootDir, file)}`
  );
  assert(/^shortcut_keepTextSize=/m.test(source), `Missing shortcut_keepTextSize in ${path.relative(rootDir, file)}`);
  assert(/^shortcut_keepTextSizeDescr=/m.test(source), `Missing shortcut_keepTextSizeDescr in ${path.relative(rootDir, file)}`);
  assert(/^errorKeepTextSizeNoLayer=/m.test(source), `Missing errorKeepTextSizeNoLayer in ${path.relative(rootDir, file)}`);
  assert(/^shortcutModifierOverlap=.*\{actions\}/m.test(source), `Missing shortcutModifierOverlap placeholder in ${path.relative(rootDir, file)}`);
  assert(/^shortcutPressModifiers=/m.test(source), `Missing shortcutPressModifiers in ${path.relative(rootDir, file)}`);
  assert(/^shortcutConflict=.*\{actions\}/m.test(source), `Missing shortcutConflict placeholder in ${path.relative(rootDir, file)}`);
  ["createLayerDescr", "alignLayerDescr", "insertStyledText"].forEach((key) => {
    const line = source.match(new RegExp(`^${key}=(.*)$`, "m"));
    assert(line, `Missing ${key} in ${path.relative(rootDir, file)}`);
    assert(!/\(Win\s*\+/.test(line[1]), `${key} still hard-codes a shortcut in ${path.relative(rootDir, file)}`);
  });
});

console.log("shortcut registry tests passed");
