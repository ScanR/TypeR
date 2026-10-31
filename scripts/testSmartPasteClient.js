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
  // A style recorded by an earlier paste never beats the selected style
  const repasted = client.buildSmartPasteRequest({
    ...state,
    currentLineIndex: 0,
    lines: [
      line(0, "Un", { usedStyle: narration }),
      line(1, "Deux", { usedStyle: otherShout }),
      line(2, "// Suite", { stylePrefix: "//", style: otherShout, usedStyle: otherShout, last: true }),
    ],
  }, null).request.lines;
  assert.deepStrictEqual(repasted.map((entry) => entry.style.id), ["r", "r", "r"], "the selected style, also for the connected lines");
  assert.deepStrictEqual(repasted.map((entry) => entry.styleLocked), [false, false, false]);
  const continued = client.buildSmartPasteRequest({
    ...state,
    currentLineIndex: 0,
    lines: [line(0, "Un"), line(1, "Deux", { style: shout }), line(2, "// Suite", { stylePrefix: "//", style: narration, last: true })],
  }, null).request.lines;
  assert.deepStrictEqual(continued.map((entry) => entry.style.id), ["r", "s", "s"], "a // line follows the line before it");
  assert.deepStrictEqual(continued.map((entry) => entry.styleLocked), [false, true, true]);
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

  // A second click in a bubble that got one line splits it: the paste is
  // undone and both lines are pasted with a forced split, from the first click
  const bubble = { left: 10, top: 20, right: 210, bottom: 320 };
  const record = { documentId: 3, before: 30, after: 31, selectionBounds: bubble, trigger: { source: "wand" }, lineIndex: 1 };
  assert.strictEqual(client.splitCandidate(record, { documentId: 3, current: 32, states: [30, 31, 32] }, { ...bubble, right: 211 }), record);
  assert.strictEqual(client.splitCandidate(record, { documentId: 3, current: 32, states: [30, 31, 32] }, { ...bubble, left: 40 }), null, "another bubble");
  assert.strictEqual(client.splitCandidate(record, { documentId: 3, current: 31, states: [30, 31] }, bubble), null, "no new click");
  assert.strictEqual(client.splitCandidate(record, { documentId: 3, current: 36, states: [30, 31, 32, 33, 34, 35, 36] }, bubble), null, "other work since");
  assert.strictEqual(client.splitCandidate(record, { documentId: 4, current: 32, states: [30, 31, 32] }, bubble), null, "another document");

  const runSecondClick = async (forcedReplies) => {
    dispatched.length = 0;
    evalCalls.length = 0;
    current = baseState();
    let history = { documentId: 3, current: 31, states: [30, 31] };
    let forced = 0;
    hostReplies = {
      smartPaste: (script) => {
        const sent = JSON.parse(script.slice("smartPaste(".length, -1));
        if (!sent.settings.forceSplit) {
          history = { documentId: 3, current: 31, states: [30, 31] };
          return JSON.stringify({ ok: true, consumed: 1, history: { documentId: 3, before: 30, after: 31 }, selectionBounds: bubble, sessions: [{ styleId: "r" }] });
        }
        const reply = forcedReplies[forced++];
        if (reply.ok) history = { documentId: 3, current: reply.history.after, states: [30, reply.history.after] };
        return JSON.stringify(reply);
      },
      getHistorySnapshot: () => JSON.stringify(history),
      smartPasteSelectionProbe: JSON.stringify({ documentId: 3, tool: "magicWandTool", bounds: bubble }),
      restoreHistoryState: (script) => {
        history = { ...history, current: JSON.parse(script.slice("restoreHistoryState(".length, -1)).state };
        return JSON.stringify({ ok: true });
      },
    };
    assert.strictEqual(await client.smartPasteInSelection(getState, dispatch, { trigger: { source: "wand", x: 50, y: 60 } }), true);
    assert.ok(client.hasSplitCandidate());
    current = { ...current, currentLineIndex: 3 };
    history = { documentId: 3, current: 32, states: [30, 31, 32] };
    dispatched.length = 0;
    return client.smartPasteInSelection(getState, dispatch, { trigger: { source: "wand", x: 150, y: 250 } });
  };
  const two = { ok: true, consumed: 2, history: { documentId: 3, before: 30, after: 33 }, selectionBounds: bubble, sessions: [{ styleId: "r" }, { styleId: "s" }] };
  assert.strictEqual(await runSecondClick([two]), true);
  const restore = evalCalls.find((call) => call.startsWith("restoreHistoryState("));
  assert.deepStrictEqual(JSON.parse(restore.slice("restoreHistoryState(".length, -1)), { documentId: 3, state: 30 }, "back before the one-line paste");
  const forcedCall = JSON.parse(evalCalls.filter((call) => call.startsWith("smartPaste(")).pop().slice("smartPaste(".length, -1));
  assert.strictEqual(forcedCall.settings.forceSplit, true);
  assert.deepStrictEqual(forcedCall.trigger, { source: "wand", x: 50, y: 60 }, "the first click keeps the first line");
  assert.strictEqual(forcedCall.lines[0].text, "Première ligne");
  assert.deepStrictEqual(dispatched.find((action) => action.type === "setCurrentLineIndex"), { type: "setCurrentLineIndex", index: 1 });
  assert.deepStrictEqual(dispatched.find((action) => action.type === "commitLineBatch").entries.map((entry) => entry.lineIndex), [1, 3]);
  assert.ok(!client.hasSplitCandidate(), "one split per paste");

  // No neck from either click: the line is pasted alone again, with a notice
  const one = (after) => ({ ok: true, consumed: 1, history: { documentId: 3, before: 30, after }, selectionBounds: bubble, sessions: [{ styleId: "r" }] });
  utilsStub.locale.smartPasteSplitFailed = "No neck found";
  assert.strictEqual(await runSecondClick([one(33), one(34)]), false);
  const forcedTriggers = evalCalls.filter((call) => call.startsWith("smartPaste(")).map((call) => JSON.parse(call.slice("smartPaste(".length, -1)));
  assert.deepStrictEqual(forcedTriggers.map((sent) => [!!sent.settings.forceSplit, sent.trigger.x]), [[false, 50], [true, 50], [true, 150], [false, 50]]);
  assert.ok(dispatched.some((action) => action.type === "showNotice" && action.text === "No neck found"));
  assert.deepStrictEqual(dispatched.filter((action) => action.type === "commitLineBatch").map((action) => action.entries.map((entry) => entry.lineIndex)), [[1]]);

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
  // A manual Paste carries the tool of the last selection
  const manualState = { ...state, currentLineIndex: 1 };
  client.rememberSelectionTrigger({ source: "wand", x: 1, y: 1 });
  assert.deepStrictEqual(client.buildSmartPasteRequest(manualState, { source: "manual" }).request.trigger, { source: "manual", lastSource: "wand" });
  client.rememberSelectionTrigger({ source: "rectangle", left: 0, top: 0, right: 9, bottom: 9 });
  assert.deepStrictEqual(client.buildSmartPasteRequest(manualState, null).request.trigger, { source: "manual", lastSource: "rectangle" });
  client.rememberSelectionTrigger(null);
  assert.deepStrictEqual(client.buildSmartPasteRequest(manualState, null).request.trigger, { source: "manual" });
  assert.deepStrictEqual(client.buildSmartPasteRequest(manualState, { source: "wand", x: 5, y: 6 }).request.trigger, { source: "wand", x: 5, y: 6 });

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

  // Smart paste clicks made during a paste wait their turn
  const smart = { ...ready, smartPaste: true };
  assert.strictEqual(gate.canQueueClick(smart, wand, 1000), true);
  assert.strictEqual(gate.canQueueClick(smart, { source: "rectangle", left: 0, top: 0, right: 9, bottom: 9 }, 1000), true);
  assert.strictEqual(gate.canQueueClick(smart, { source: "lasso" }, 1000), false, "a lasso cannot be selected again");
  assert.strictEqual(gate.canQueueClick(ready, wand, 1000), false, "the classic paste keeps its probe guard");
  assert.strictEqual(gate.canQueueClick(smart, wand, 100), false, "the classic paste's wand probes are not clicks");
  assert.strictEqual(gate.canQueueClick(smart, wand, 1000, true), false);

  assert.strictEqual(gate.matchesReplay({ source: "wand", x: 10.4, y: 20 }, { source: "wand", x: 10, y: 20 }), true);
  assert.strictEqual(gate.matchesReplay({ source: "wand", x: 40, y: 20 }, { source: "wand", x: 10, y: 20 }), false);
  assert.strictEqual(gate.matchesReplay({ source: "wand", x: 41.67, y: 83.33 }, { source: "wand", x: 10, y: 20, unit: "distanceUnit" }), true, "a click in points replays in pixels");
  assert.strictEqual(gate.matchesReplay({ source: "wand", x: 41.67, y: 20 }, { source: "wand", x: 10, y: 20, unit: "distanceUnit" }), false);

  const order = [];
  const replayed = [];
  let release = null;
  let busyNow = false;
  const queue = gate.createClickQueue({
    canPaste: () => true,
    paste: (trigger) => {
      order.push(trigger.x);
      busyNow = true;
      return new Promise((resolve) => { release = () => { busyNow = false; resolve(true); }; });
    },
    replay: async (trigger) => { replayed.push(trigger.x); return true; },
    isBusy: () => false,
  });
  queue.push({ source: "wand", x: 10, y: 10 });
  queue.push({ source: "wand", x: 20, y: 20 });
  queue.push({ source: "wand", x: 30, y: 30 });
  assert.deepStrictEqual(order, [10], "one paste at a time");
  assert.strictEqual(queue.isDraining(), true);
  for (let i = 0; i < 3; i++) {
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepStrictEqual(order, [10, 20, 30], "every quick click pastes, in order");
  assert.deepStrictEqual(replayed, [20, 30], "the clicks that waited are selected again");
  assert.strictEqual(queue.isOwnReplay({ source: "wand", x: 20, y: 20 }), true, "a replay is not a new click");
  assert.strictEqual(queue.isOwnReplay({ source: "wand", x: 20, y: 20 }), false, "each replay is expected once");
  assert.strictEqual(queue.isOwnReplay({ source: "wand", x: 50, y: 50 }), false);
  assert.strictEqual(busyNow, false);
  assert.strictEqual(queue.isDraining(), false);

  // A paste started elsewhere (the Paste button): the click waits, then
  // selects its bubble again; a failed replay drops the rest
  let externalBusy = true;
  const later = [];
  const blocked = gate.createClickQueue({
    canPaste: () => true,
    paste: async (trigger) => { later.push(trigger.x); },
    replay: async (trigger) => trigger.x !== 5,
    isBusy: () => externalBusy,
  });
  blocked.push({ source: "wand", x: 4, y: 4 });
  blocked.push({ source: "wand", x: 5, y: 5 });
  blocked.push({ source: "wand", x: 6, y: 6 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepStrictEqual(later, []);
  externalBusy = false;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepStrictEqual(later, [4]);
  assert.strictEqual(blocked.isDraining(), false);

  console.log("smart paste panel client tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
