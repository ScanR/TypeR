// Smart paste from the panel (app_src/smartPasteClient.js, pasteOnClick.jsx):
// the request built from the panel state, the lines a paste consumes, the
// fallback to the classic paste, the undo sync and the paste-on-click gate.
const assert = require("assert");

const evalCalls = [];
let hostReplies = {};
const classicCalls = [];
global.window = { typerUXP: { request() {} }, __adobe_cep__: { getHostEnvironment: () => JSON.stringify({ appUILocale: "fr_FR" }) } };
global.navigator = { language: "fr-FR" };

const utilsStub = {
  csInterface: {
    evalScript(script, callback) {
      evalCalls.push(script);
      const name = script.slice(0, script.indexOf("("));
      const reply = typeof hostReplies[name] === "function" ? hostReplies[name](script) : hostReplies[name];
      setTimeout(() => callback(reply === undefined ? "" : reply), 0);
    },
  },
  trackHostAction: (callback) => callback,
  safeJsonParse: (raw, fallback = {}) => {
    try { return JSON.parse(raw) || fallback; } catch (error) { return fallback; }
  },
  buildRichTextPayload: (text) => {
    const bold = /\*\*(.+?)\*\*/.exec(text);
    if (!bold) return { text, richTextRuns: null };
    const plain = text.replace(/\*\*(.+?)\*\*/, "$1");
    return { text: plain, richTextRuns: [{ text: plain.slice(0, bold.index), bold: false, italic: false }, { text: bold[1], bold: true, italic: false }, { text: plain.slice(bold.index + bold[1].length), bold: false, italic: false }] };
  },
  createTextLayerInSelection: (...args) => {
    classicCalls.push(args);
    args[5](true);
  },
  getUserFonts: () => [],
  locale: {
    smartPasteFallback: "Smart paste unavailable ({reason}): pasted the classic way.",
    smartPasteReason_noPlacement: "the text does not fit this bubble",
    smartPasteReason_error: "unexpected error",
    smartPasteReason_noSelection: "no selection",
    smartPasteCleanSkipped: "Auto clean skipped",
  },
};

const load = require("./helpers/loadAppModule")({ "./utils": utilsStub });
const client = load("app_src/smartPasteClient.js");

const style = (id, folder, bubbleType, font = "Font" + id) => ({
  id,
  folder,
  bubbleType,
  textProps: { layerText: { textStyleRange: [{ from: 0, to: 9, textStyle: { fontPostScriptName: font, fontName: font, size: 20 } }], paragraphStyleRange: [{ paragraphStyle: {} }] } },
});
const regular = style("r", "f1", "");
const shout = style("s", "f1", "shout");
const narration = style("n", "f1", "narration");
const otherShout = style("o", "f2", "shout");
const line = (rawIndex, text, extra = {}) => ({ rawIndex, rawText: text, text, ignore: false, ...extra });

const baseState = () => ({
  currentLineIndex: 1,
  currentStyle: regular,
  currentLine: null,
  styles: [regular, shout, narration, otherShout],
  lines: [
    line(0, "Avant"),
    line(1, "Première **ligne**"),
    line(2, "", { ignore: true }),
    line(3, "Deuxième", { style: shout }),
    line(4, "Troisième", { last: true }),
    line(5, "Page 2", { rawText: "Page 2", ignore: true }),
    line(6, "Autre page"),
  ],
  textScale: null,
  smartPasteDistribute: true,
  smartPasteAutoClean: true,
  smartPasteMinScale: 0.8,
  smartPasteHyphenation: "auto",
  language: "auto",
  direction: "rtl",
  internalPadding: 4,
  pastePointText: false,
  refontRules: [{ open: "«", close: "»", styleId: "n" }],
});

(async () => {
  // Lines of a paste: the current one and the next usable ones of the page
  const state = baseState();
  assert.deepStrictEqual(client.nextPasteLines(state, 3).map((entry) => entry.index), [1, 3, 4]);
  assert.deepStrictEqual(client.nextPasteLines({ ...state, currentLineIndex: 4 }, 3).map((entry) => entry.index), [4], "a page's last line ends the group");
  assert.strictEqual(client.lineAfter(state, 1), 3);
  assert.strictEqual(client.lineAfter(state, 4), 4, "the last line of a page stays current");

  // Role styles come from the current style's folder only
  const roles = client.roleStylesFor(state);
  assert.strictEqual(roles.shout.id, "s");
  assert.strictEqual(roles.narration.id, "n");
  assert.strictEqual(client.roleStylesFor({ ...state, currentStyle: style("x", "f2", "") }).shout.id, "o");

  // The request
  const built = client.buildSmartPasteRequest(state, { source: "wand", x: 5, y: 6 }, { preserveActiveTextSize: true });
  assert.deepStrictEqual(built.lineIndexes, [1, 3, 4]);
  const request = built.request;
  assert.strictEqual(request.lines[0].text, "Première ligne");
  assert.ok(request.lines[0].richTextRuns.some((run) => run.bold && run.text === "ligne"), "markdown runs travel with the line");
  assert.strictEqual(request.lines[0].styleLocked, false);
  assert.strictEqual(request.lines[1].styleLocked, true, "a prefix style is locked");
  assert.strictEqual(request.lines[1].style.id, "s");
  assert.deepStrictEqual(request.settings, {
    autoClean: true, distribute: true, minScale: 0.8, hyphenation: "fr", direction: "rtl", padding: 4, keepSize: true, pointText: false,
  });
  assert.strictEqual(client.buildSmartPasteRequest({ ...state, smartPasteDistribute: false }, null).lineIndexes.length, 1);
  assert.strictEqual(client.buildSmartPasteRequest({ ...state, smartPasteHyphenation: "off" }, null).request.settings.hyphenation, "off");
  const refont = client.buildSmartPasteRequest({ ...state, lines: [line(0, "Il dit «non»")], currentLineIndex: 0 }, null).request.lines[0];
  assert.strictEqual(refont.text, "Il dit non");
  assert.strictEqual(refont.richTextRuns[1].textStyle.fontPostScriptName, "Fontn", "refont takes the rule style's font");

  // A successful UXP paste consumes the connected lines and records history
  const dispatched = [];
  let current = baseState();
  const getState = () => current;
  const dispatch = (action) => dispatched.push(action);
  hostReplies = {
    smartPaste: JSON.stringify({ ok: true, consumed: 2, history: { documentId: 3, before: 10, after: 11 }, sessions: [{ styleId: "r" }, { styleId: "s" }] }),
  };
  assert.strictEqual(await client.smartPasteInSelection(getState, dispatch, { trigger: { source: "wand", x: 1, y: 2 } }), true);
  const batch = dispatched.find((action) => action.type === "commitLineBatch");
  assert.deepStrictEqual(batch, { type: "commitLineBatch", entries: [{ lineIndex: 1, styleId: "r" }, { lineIndex: 3, styleId: "s" }], nextLineIndex: 4 });
  assert.ok(client.hasPasteHistory());
  assert.ok(evalCalls[evalCalls.length - 1].startsWith("smartPaste("));
  const sent = JSON.parse(evalCalls[evalCalls.length - 1].slice("smartPaste(".length, -1));
  assert.deepStrictEqual(sent.trigger, { source: "wand", x: 1, y: 2 });

  // Undo of that paste: the line goes back; redo moves it forward again
  dispatched.length = 0;
  current = { ...current, currentLineIndex: 4 };
  assert.strictEqual(client.applyHistorySnapshot({ documentId: 3, current: 10, states: [9, 10, 11] }, getState, dispatch), true);
  assert.deepStrictEqual(dispatched, [{ type: "setCurrentLineIndex", index: 1 }]);
  dispatched.length = 0;
  current = { ...current, currentLineIndex: 1 };
  client.applyHistorySnapshot({ documentId: 3, current: 11, states: [9, 10, 11] }, getState, dispatch);
  assert.deepStrictEqual(dispatched, [{ type: "setCurrentLineIndex", index: 4 }]);

  // A refusal falls back to the classic paste with a notice
  dispatched.length = 0;
  classicCalls.length = 0;
  current = { ...baseState(), currentLine: line(1, "Première") };
  let snapshots = 0;
  hostReplies = {
    smartPaste: JSON.stringify({ ok: false, code: "noPlacement" }),
    getHistorySnapshot: () => JSON.stringify({ documentId: 3, current: 20 + snapshots++, states: [] }),
  };
  assert.strictEqual(await client.smartPasteInSelection(getState, dispatch, {}), true);
  assert.strictEqual(classicCalls.length, 1);
  assert.ok(dispatched.some((action) => action.type === "showNotice" && /does not fit/.test(action.text)));
  assert.ok(dispatched.some((action) => action.type === "nextLine"));

  // No selection: only a notice, no classic paste
  classicCalls.length = 0;
  hostReplies = { smartPaste: JSON.stringify({ ok: false, code: "noSelection" }) };
  assert.strictEqual(await client.smartPasteInSelection(getState, dispatch, {}), false);
  assert.strictEqual(classicCalls.length, 0);

  // Past the host's time limit Photoshop may still finish the smart paste:
  // no classic paste on top of it
  dispatched.length = 0;
  hostReplies = { smartPaste: JSON.stringify({ ok: false, code: "timeout" }) };
  assert.strictEqual(await client.smartPasteInSelection(getState, dispatch, {}), false);
  assert.strictEqual(classicCalls.length, 0);
  assert.ok(!dispatched.some((action) => action.type === "nextLine"));

  // Multi-bubble: every remembered selection is replayed then pasted
  assert.strictEqual(client.canSmartPasteStoredSelections([{ trigger: { source: "wand" } }, { trigger: { source: "rectangle" } }]), true);
  assert.strictEqual(client.canSmartPasteStoredSelections([{ trigger: { source: "wand" } }, {}]), false);
  dispatched.length = 0;
  evalCalls.length = 0;
  current = { ...baseState(), storedSelections: [
    { lineIndex: 1, styleId: "r", trigger: { source: "wand", x: 10, y: 10, options: { tolerance: 20 } } },
    { lineIndex: 3, styleId: "s", trigger: { source: "rectangle", left: 1, top: 2, right: 50, bottom: 60 } },
  ] };
  hostReplies = {
    replaySelectionTrigger: JSON.stringify({ ok: true }),
    smartPaste: JSON.stringify({ ok: true, consumed: 1, history: { documentId: 3, before: 1, after: 2 }, sessions: [{ styleId: "r" }] }),
    deselectDocumentSelection: "",
  };
  assert.strictEqual(await client.smartPasteStoredSelections(getState, dispatch, {}), true);
  assert.deepStrictEqual(evalCalls.map((call) => call.slice(0, call.indexOf("("))), ["replaySelectionTrigger", "smartPaste", "replaySelectionTrigger", "smartPaste", "deselectDocumentSelection"]);
  const second = JSON.parse(evalCalls[3].slice("smartPaste(".length, -1));
  assert.strictEqual(second.lines.length, 1, "one line per stored selection");
  assert.strictEqual(second.lines[0].text, "Deuxième");
  assert.ok(dispatched.some((action) => action.type === "clearSelections"));

  // A failed replay keeps every unprocessed bubble and never pastes elsewhere.
  dispatched.length = 0;
  evalCalls.length = 0;
  current.storedSelections[0].documentKey = "session:3";
  hostReplies = { replaySelectionTrigger: JSON.stringify({ error: "doc" }) };
  assert.strictEqual(await client.smartPasteStoredSelections(getState, dispatch), false);
  assert.strictEqual(evalCalls.length, 1);
  assert.strictEqual(JSON.parse(evalCalls[0].slice("replaySelectionTrigger(".length, -1)).documentKey, "session:3");
  assert(!dispatched.some(action => action.type === "clearSelections"));

  // If the second replay fails, only the successful first bubble is removed.
  dispatched.length = 0;
  let replays = 0;
  hostReplies = {
    replaySelectionTrigger: () => JSON.stringify(++replays === 1 ? { ok: true } : { error: "replay" }),
    smartPaste: JSON.stringify({ ok: true, consumed: 1 }),
  };
  assert.strictEqual(await client.smartPasteStoredSelections(getState, dispatch), true);
  const cleared = dispatched.find(action => action.type === "clearSelections");
  assert.deepStrictEqual(cleared.completed, [current.storedSelections[0]]);
  const { reducer, initial } = require("./helpers/loadContext")();
  const remaining = reducer({ ...initial, storedSelections: current.storedSelections }, cleared).storedSelections;
  assert.deepStrictEqual(remaining, [current.storedSelections[1]]);

  // A document change detected after replay must not trigger a classic fallback.
  dispatched.length = 0;
  classicCalls.length = 0;
  hostReplies = {
    replaySelectionTrigger: JSON.stringify({ ok: true }),
    smartPaste: JSON.stringify({ ok: false, code: "doc" }),
  };
  assert.strictEqual(await client.smartPasteStoredSelections(getState, dispatch), false);
  assert.strictEqual(classicCalls.length, 0);
  assert(!dispatched.some(action => action.type === "clearSelections"));

  // Nor after a smart paste past the host's time limit
  dispatched.length = 0;
  hostReplies = {
    replaySelectionTrigger: JSON.stringify({ ok: true }),
    smartPaste: JSON.stringify({ ok: false, code: "timeout" }),
  };
  assert.strictEqual(await client.smartPasteStoredSelections(getState, dispatch), false);
  assert.strictEqual(classicCalls.length, 0);
  assert(!dispatched.some(action => action.type === "clearSelections"));

  // Remembered triggers expire
  client.rememberSelectionTrigger({ source: "wand", x: 1, y: 1 });
  assert.deepStrictEqual(client.recentSelectionTrigger(), { source: "wand", x: 1, y: 1 });
  client.rememberSelectionTrigger({ source: "lasso" });
  assert.strictEqual(client.recentSelectionTrigger(), null, "a lasso cannot be replayed");

  // Paste on click gate
  const gate = require("./helpers/loadAppModule")({
    "./utils": { ...utilsStub, addPhotoshopEventListener: () => () => {}, msSinceHostAction: () => 1000, csInterface: utilsStub.csInterface, safeJsonParse: utilsStub.safeJsonParse },
    "./context": { useContext: () => ({}) },
    "./shortcutCommands": { pasteInSelection: () => {} },
    react: { useEffect: () => {} },
  })("app_src/pasteOnClick.jsx");
  const ready = { pasteOnClick: true, multiBubbleMode: false, currentLine: { text: "Bonjour", ignore: false } };
  const wand = { source: "wand", x: 1, y: 2 };
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.strictEqual(gate.shouldPasteOnClick(ready, wand, 1000), true);
  assert.strictEqual(gate.shouldPasteOnClick({ ...ready, pasteOnClick: false }, wand, 1000), false);
  assert.strictEqual(gate.shouldPasteOnClick({ ...ready, multiBubbleMode: true }, wand, 1000), false);
  assert.strictEqual(gate.shouldPasteOnClick(ready, null, 1000), false);
  assert.strictEqual(gate.shouldPasteOnClick(ready, wand, 100), false, "TypeR's own selections are ignored");
  assert.strictEqual(gate.shouldPasteOnClick(ready, wand, 1000, true), false, "a closed or collapsed panel never pastes");
  assert.strictEqual(gate.shouldPasteOnClick({ ...ready, currentLine: { text: "", ignore: true } }, wand, 1000), false);

  console.log("smart paste panel client tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
