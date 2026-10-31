// Smart paste from the panel. UXP: the plugin host runs the whole engine
// (smartPaste). CEP: the engine runs here, the ExtendScript host captures,
// measures and commits (smartPasteCapture, smartPasteMeasure,
// smartPasteCommit). A refusal falls back to the classic paste with a short
// notice. Every paste is recorded for the undo sync (pasteHistory.js).

import {
  buildRichTextPayload, createTextLayerInSelection, csInterface, getUserFonts, locale, safeJsonParse, trackHostAction,
} from "./utils";
import { getScaledStyle, resolveStylePointText } from "./textLayerPayload";
import { parsePageMarker } from "./pageMarker";
import { prepareSmartPaste } from "./oneClick/smartPaste";
import { captureSource, fillFromHistograms, triggerClick } from "./oneClick/bubblePlan";
import { applyRefont, refontTextStyle } from "./oneClick/refont";
import { resolveHyphenationLanguage } from "./oneClick/hyphenation";
import { getInterfaceLanguage } from "./interfaceLanguage";
import { createPasteHistory, lineAfterHistoryMove } from "./oneClick/pasteHistory";
import { resolveTypeRFontVariant } from "./fontVariantResolver.jsxinc";

const isUxp = () => !!(typeof window !== "undefined" && window.typerUXP);


// The smart paste's own selections (polygons, deselections) never look like
// a click, so its steps leave paste on click open (touchesSelection off)
const evalHost = (script, timeout = 60000, touchesSelection = false) => new Promise((resolve) => {
  csInterface.evalScript(script, trackHostAction((result) => resolve(result), timeout, touchesSelection));
});

const clone = (value) => JSON.parse(JSON.stringify(value));

/* ======================= request ======================= */

const uiLanguage = getInterfaceLanguage;

// The style marked for each bubble kind in the current style's folder
export const roleStylesFor = (state) => {
  const folder = state.currentStyle ? state.currentStyle.folder || null : null;
  const out = { shout: null, narration: null };
  const styles = state.styles || [];
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
    if ((style.folder || null) !== folder) continue;
    if ((style.bubbleType === "shout" || style.bubbleType === "narration") && !out[style.bubbleType]) {
      out[style.bubbleType] = getScaledStyle(style, state.textScale);
    }
  }
  return out;
};

// Refont rules with the run style of their target style
export const refontRulesFor = (state) => (state.refontRules || []).map((rule) => {
  const target = (state.styles || []).find((style) => style.id === rule.styleId);
  return { ...rule, textStyle: refontTextStyle(target) };
}).filter((rule) => rule.textStyle);

// The current line and the next ones of the same page (connected bubbles)
export const nextPasteLines = (state, count) => {
  const out = [];
  const lines = state.lines || [];
  for (let i = state.currentLineIndex; i < lines.length && out.length < count; i++) {
    const line = lines[i];
    if (!line) break;
    if (i > state.currentLineIndex && parsePageMarker(line.rawText)) break;
    if (line.ignore) continue;
    out.push({ index: i, line });
    if (line.last) break;
  }
  return out;
};

// The first usable line after `index`; a page's last line stays current
export const lineAfter = (state, index) => {
  const lines = state.lines || [];
  if (lines[index] && lines[index].last) return index;
  for (let i = index + 1; i < lines.length; i++) if (lines[i] && !lines[i].ignore) return i;
  return index;
};

export const buildSmartPasteRequest = (state, trigger, options = {}) => {
  const wanted = state.smartPasteDistribute === false || options.single ? 1 : 3;
  const from = typeof options.lineIndex === "number" ? { ...state, currentLineIndex: options.lineIndex } : state;
  const picked = nextPasteLines(from, wanted);
  if (!picked.length) return null;
  const rules = refontRulesFor(state);
  // The first line takes the selected style. The next ones take their script
  // prefix, a "//" continuation the style of the line before it, any other
  // line the selected style: the style a line was pasted with earlier (an
  // undone paste, a page done again) never comes back.
  let previous = null;
  const lines = picked.map((entry, i) => {
    const continued = i > 0 && /^\/\//.test(entry.line.stylePrefix || "");
    const source = i === 0
      ? options.style || state.currentStyle
      : (continued ? previous.source : entry.line.style || state.currentStyle);
    const styleLocked = continued ? previous.styleLocked : !!entry.line.style;
    previous = { source, styleLocked };
    const parsed = applyRefont(buildRichTextPayload(entry.line.text), rules);
    return {
      text: parsed.text,
      richTextRuns: parsed.richTextRuns || null,
      style: getScaledStyle(source, state.textScale),
      styleLocked,
    };
  });
  return {
    lineIndexes: picked.map((entry) => entry.index),
    request: {
      trigger: trigger && trigger.source !== "manual" ? trigger : manualTrigger(),
      lines,
      roleStyles: roleStylesFor(state),
      settings: {
        autoClean: !!state.smartPasteAutoClean,
        distribute: state.smartPasteDistribute !== false,
        minScale: state.smartPasteMinScale > 0 ? state.smartPasteMinScale : 0.85,
        hyphenation: resolveHyphenationLanguage(state.smartPasteHyphenation || "auto", uiLanguage(state)),
        direction: state.direction,
        padding: state.internalPadding || 0,
        keepSize: options.preserveActiveTextSize === true,
        pointText: resolveStylePointText(state.currentStyle, state.pastePointText),
      },
    },
  };
};

/* ======================= CEP adapter ======================= */

const cepAdapter = (request) => ({
  capture: async (trigger) => {
    const raw = await evalHost("smartPasteCapture(" + JSON.stringify({ trigger, keepSize: !!request.settings.keepSize }) + ")");
    const data = safeJsonParse(raw, { error: "error" });
    if (data.error) throw Object.assign(new Error(data.error), { code: data.error });
    const histograms = Array.isArray(data.histograms) ? data.histograms : [];
    let total = 0;
    if (histograms[0]) for (let i = 0; i < histograms[0].length; i++) total += histograms[0][i];
    const source = captureSource(trigger, data.rawPath);
    return {
      ...data,
      source,
      click: source === "wand" ? triggerClick(trigger, data.resolution) : null,
      fill: histograms.length ? fillFromHistograms(histograms, total) : null,
      sample: null,
    };
  },
  measure: async (requests) => {
    const raw = await evalHost("smartPasteMeasure(" + JSON.stringify({ requests: requests.map((r) => ({ params: r.params })) }) + ")");
    const replies = safeJsonParse(raw, null);
    if (!Array.isArray(replies)) throw Object.assign(new Error("measure"), { code: "measure" });
    return replies;
  },
  resolveRunStyle: (base, run) => {
    const style = clone(base);
    const fonts = getUserFonts();
    if ((run.bold || run.italic) && fonts.length) {
      resolveTypeRFontVariant(style, run, fonts);
    } else {
      if (run.bold) style.syntheticBold = true;
      if (run.italic) style.syntheticItalic = true;
    }
    return style;
  },
  useAtlas: false,
});

export const runSmartPaste = async (request) => {
  if (isUxp()) {
    const raw = await evalHost("smartPaste(" + JSON.stringify(request) + ")", 120000);
    return safeJsonParse(raw, { ok: false, code: "error" });
  }
  try {
    const prepared = await prepareSmartPaste(request, cepAdapter(request));
    const raw = await evalHost("smartPasteCommit(" + JSON.stringify(prepared) + ")");
    const done = safeJsonParse(raw, { error: "commit" });
    if (done.error) return { ok: false, code: done.error, message: done.message };
    return {
      ok: true,
      consumed: prepared.consumed,
      layerIds: done.layerIds,
      history: done.history,
      cleanupSkipped: prepared.cleanupSkipped,
      selectionBounds: prepared.selectionBounds,
      sessions: prepared.sessions.map((session) => ({ kind: session.plan.kind, role: session.role, styleId: session.styleId, size: session.text.size, tier: session.text.tier })),
    };
  } catch (error) {
    return { ok: false, code: (error && error.code) || "error", message: String((error && error.message) || error), textColor: (error && error.textColor) || null };
  }
};

// Auto colour also holds for the classic paste: white text without a stroke
export const styleWithTextColor = (style, textColor) => {
  if (!style || !textColor) return style;
  const out = clone(style);
  const ranges = out.textProps && out.textProps.layerText && out.textProps.layerText.textStyleRange;
  if (ranges) ranges.forEach((range) => { if (range.textStyle) range.textStyle.color = { ...textColor }; });
  out.stroke = null;
  return out;
};

/* ======================= undo sync ======================= */

const pasteHistory = createPasteHistory();

export const getHistorySnapshot = async () => safeJsonParse(await evalHost("getHistorySnapshot()", 15000), null);

// Move the script line after a history move (latest state through getState)
export const applyHistorySnapshot = (snapshot, getState, dispatch) => {
  if (!snapshot || !pasteHistory.size()) return false;
  let moved = false;
  const changes = pasteHistory.observe(snapshot);
  for (let i = 0; i < changes.length; i++) {
    const target = lineAfterHistoryMove(changes[i], getState().currentLineIndex);
    if (target === null) continue;
    dispatch({ type: "setCurrentLineIndex", index: target });
    moved = true;
  }
  return moved;
};

// CEP has no history event: check before a paste, on Photoshop events and
// when the panel gets the focus
export const syncPasteHistory = async (getState, dispatch) => {
  if (!pasteHistory.size()) return false;
  return applyHistorySnapshot(await getHistorySnapshot(), getState, dispatch);
};

export const hasPasteHistory = () => pasteHistory.size() > 0;

/* ======================= paste ======================= */

// The last selection the user made in Photoshop, as a trigger (multi-bubble
// stores it with each captured selection, to replay it at paste time)
let lastTrigger = null;
export const rememberSelectionTrigger = (trigger) => {
  lastTrigger = trigger ? { trigger, at: Date.now() } : null;
};
export const recentSelectionTrigger = (maxAge = 4000) => (
  lastTrigger && Date.now() - lastTrigger.at <= maxAge && (lastTrigger.trigger.source === "wand" || lastTrigger.trigger.source === "rectangle")
    ? lastTrigger.trigger
    : null
);
// A manual Paste, with the tool of the last selection (see captureSource)
const manualTrigger = () => (lastTrigger ? { source: "manual", lastSource: lastTrigger.trigger.source } : { source: "manual" });

let busy = false;
let lastFinishedAt = 0;
let fallbacksRunning = 0;
let lastFallbackAt = 0;

// Selection events Photoshop sends for TypeR's own work arrive late in CEP
const SETTLE_TIME = 600;
export const isSmartPasteSettling = () => busy || Date.now() - lastFinishedAt < SETTLE_TIME;
export const isSmartPasteBusy = () => busy;
export const smartPasteFinishedAt = () => lastFinishedAt;
// The classic paste's auto-centre probes with the Magic Wand: its selection
// events look like clicks
export const isClassicFallbackSettling = () => fallbacksRunning > 0 || Date.now() - lastFallbackAt < SETTLE_TIME;

const runFallback = async (run) => {
  fallbacksRunning++;
  try {
    return await run();
  } finally {
    fallbacksRunning--;
    lastFallbackAt = Date.now();
  }
};

const notice = (dispatch, text, kind = "info") => {
  if (text) dispatch({ type: "showNotice", text, kind });
};

// No classic paste after these: there is nothing to paste into, or (timeout)
// Photoshop may still be finishing the smart paste and would get both
const stopsWithoutFallback = (code) => code === "doc" || code === "noSelection" || code === "timeout";

const reasonText = (code) => locale["smartPasteReason_" + code] || locale.smartPasteReason_error || code;

// Select again the click (or rectangle) a selection event reported
export const replaySelection = async (trigger, dispatch) => {
  const replayed = safeJsonParse(await evalHost("replaySelectionTrigger(" + JSON.stringify(trigger) + ")", 15000), { error: "error" });
  if (!replayed.error) return true;
  notice(dispatch, reasonText(replayed.error), "warning");
  return false;
};

const classicPaste = (state, dispatch, options, textColor) => new Promise((resolve) => {
  const line = state.currentLine || { text: "" };
  const style = styleWithTextColor(getScaledStyle(state.currentStyle, state.textScale), textColor);
  createTextLayerInSelection(line.text, style, state.pastePointText, state.internalPadding || 0, state.direction, (ok) => {
    if (ok) dispatch({ type: "nextLine", add: true });
    resolve(ok);
  }, {
    autoCenter: state.autoCenterMode || "off",
    resizeTextBox: !!state.resizeTextBoxOnCenter,
    preserveActiveTextSize: options.preserveActiveTextSize === true,
  });
});

// Moves the script line past the pasted lines and records the paste
const commitSmartResult = (getState, dispatch, state, built, result) => {
  const consumed = built.lineIndexes.slice(0, result.consumed);
  const entries = consumed.map((lineIndex, i) => ({
    lineIndex,
    styleId: (result.sessions && result.sessions[i] && result.sessions[i].styleId) || (state.currentStyle && state.currentStyle.id),
  }));
  const nextLineIndex = lineAfter(getState(), consumed[consumed.length - 1]);
  dispatch({ type: "commitLineBatch", entries, nextLineIndex });
  if (result.history && result.history.before != null && result.history.after != null) {
    pasteHistory.register({ ...result.history, lineBefore: consumed[0], lineAfter: nextLineIndex });
  }
  if (result.cleanupSkipped && built.request.settings.autoClean) notice(dispatch, locale.smartPasteCleanSkipped, "warning");
};

/* ================= second click: split ================= */

// A Magic Wand paste that filled a bubble with one line while the next line
// was waiting. Clicking the same bubble again right after says it is a double
// bubble TypeR did not see: the paste is undone and both lines are pasted, one
// per chamber, split at the bubble's likeliest neck.
let lastSingle = null;
// Selection steps allowed between the paste and the second click (the click
// itself, a deselection)
const SPLIT_CLICK_STATES = 3;

export const hasSplitCandidate = () => !!lastSingle;

const sameBounds = (a, b) => !!(a && b && ["left", "top", "right", "bottom"].every((side) => Math.abs(a[side] - b[side]) <= 2));

export const rememberSinglePaste = (built, result, trigger) => {
  lastSingle = null;
  if (!trigger || trigger.source !== "wand" || !result || !result.ok || result.consumed !== 1 || built.lineIndexes.length < 2) return;
  if (!result.history || result.history.before == null || result.history.after == null || !result.selectionBounds) return;
  lastSingle = { ...result.history, selectionBounds: result.selectionBounds, trigger, lineIndex: built.lineIndexes[0] };
};

// The paste a second click asks to split, or null
export const splitCandidate = (record, snapshot, bounds) => {
  if (!record || !snapshot || snapshot.documentId !== record.documentId || !Array.isArray(snapshot.states)) return null;
  const after = snapshot.states.indexOf(record.after);
  const current = snapshot.states.indexOf(snapshot.current);
  if (after < 0 || current !== snapshot.states.length - 1 || current - after < 1 || current - after > SPLIT_CLICK_STATES) return null;
  return sameBounds(bounds, record.selectionBounds) ? record : null;
};

// Null when the click is not a second click; true or false otherwise
const splitAgain = async (getState, dispatch, trigger) => {
  const record = lastSingle;
  lastSingle = null;
  if (!record || !trigger || trigger.source !== "wand") return null;
  const snapshot = await getHistorySnapshot();
  const probe = safeJsonParse(await evalHost("smartPasteSelectionProbe()", 15000), {});
  if (!splitCandidate(record, snapshot, probe.bounds)) return null;
  // Back before the one-line paste: its selection is the bubble again
  const restored = safeJsonParse(await evalHost("restoreHistoryState(" + JSON.stringify({ documentId: record.documentId, state: record.before }) + ")", 15000), { error: "error" });
  if (restored.error) return null;
  applyHistorySnapshot(await getHistorySnapshot(), getState, dispatch);
  const state = getState();
  // The first line stays in the chamber clicked first
  for (const click of [record.trigger, trigger]) {
    const built = buildSmartPasteRequest(state, click, { lineIndex: record.lineIndex });
    if (!built || built.lineIndexes.length < 2) break;
    built.request.settings.forceSplit = true;
    const result = await runSmartPaste(built.request);
    if (result && result.ok && result.consumed >= 2) {
      commitSmartResult(getState, dispatch, state, built, result);
      return true;
    }
    if (result && result.ok) {
      // One chamber only: undo it and try from the other click
      const again = await getHistorySnapshot();
      if (!again || again.current !== result.history.after) break;
      await evalHost("restoreHistoryState(" + JSON.stringify({ documentId: record.documentId, state: result.history.before }) + ")", 15000);
    } else if (result && stopsWithoutFallback(result.code)) {
      break;
    }
  }
  // No neck: paste the line alone again, as before the second click
  notice(dispatch, locale.smartPasteSplitFailed, "warning");
  const built = buildSmartPasteRequest(getState(), record.trigger, { lineIndex: record.lineIndex });
  const result = built ? await runSmartPaste(built.request) : null;
  if (result && result.ok && result.consumed > 0) commitSmartResult(getState, dispatch, getState(), built, result);
  return false;
};

// getState() returns the latest panel state (the line may move while a
// paste waits for Photoshop)
export const smartPasteInSelection = async (getState, dispatch, options = {}) => {
  if (busy) return false;
  busy = true;
  try {
    if (!isUxp()) await syncPasteHistory(getState, dispatch);
    const split = await splitAgain(getState, dispatch, options.trigger);
    if (split !== null) return split;
    const state = getState();
    const built = buildSmartPasteRequest(state, options.trigger, options);
    if (!built) return false;
    const result = await runSmartPaste(built.request);
    if (result && result.ok && result.consumed > 0) {
      commitSmartResult(getState, dispatch, state, built, result);
      rememberSinglePaste(built, result, options.trigger);
      return true;
    }
    // Classic paste, recorded too so an Undo still moves the line back
    const code = (result && result.code) || "error";
    if (stopsWithoutFallback(code)) {
      notice(dispatch, reasonText(code), "warning");
      return false;
    }
    notice(dispatch, String(locale.smartPasteFallback || "{reason}").replace("{reason}", reasonText(code)), "warning");
    const before = await getHistorySnapshot();
    const lineBefore = getState().currentLineIndex;
    const ok = await runFallback(() => classicPaste(getState(), dispatch, options, result && result.textColor));
    if (ok && before) {
      const after = await getHistorySnapshot();
      if (after && after.current !== before.current) {
        pasteHistory.register({ documentId: after.documentId, before: before.current, after: after.current, lineBefore, lineAfter: lineAfter(getState(), lineBefore) });
      }
    }
    return ok;
  } finally {
    busy = false;
    lastFinishedAt = Date.now();
  }
};

// Multi-bubble with smart paste: every stored selection that remembers the
// click (or rectangle) that made it is selected again and pasted on its own
// line. Answers false when a selection cannot be replayed (the panel then
// uses the classic batch paste).
export const canSmartPasteStoredSelections = (selections) => Array.isArray(selections) && selections.length > 0 &&
  selections.every((selection) => selection && selection.trigger && (selection.trigger.source === "wand" || selection.trigger.source === "rectangle"));

export const smartPasteStoredSelections = async (getState, dispatch, options = {}) => {
  const selections = (getState().storedSelections || []).slice();
  if (busy || !canSmartPasteStoredSelections(selections)) return false;
  busy = true;
  lastSingle = null;
  let pasted = 0;
  const completed = [];
  const initialTabId = getState().currentTabId;
  try {
    for (let i = 0; i < selections.length; i++) {
      const selection = selections[i];
      const state = getState();
      if (state.currentTabId !== initialTabId) break;
      const lineIndex = typeof selection.lineIndex === "number" ? selection.lineIndex : state.currentLineIndex;
      const line = state.lines && state.lines[lineIndex];
      if (!line || line.ignore) continue;
      const trigger = { ...selection.trigger, documentKey: selection.documentKey || selection.trigger.documentKey };
      const replayed = safeJsonParse(await evalHost("replaySelectionTrigger(" + JSON.stringify(trigger) + ")", 15000, true), { error: "error" });
      if (replayed.error) {
        notice(dispatch, reasonText(replayed.error), "warning");
        break;
      }
      if (getState().currentTabId !== initialTabId) break;
      const style = selection.styleId ? (state.styles || []).find((entry) => entry.id === selection.styleId) : null;
      const built = buildSmartPasteRequest(state, trigger, { ...options, lineIndex, single: true, style });
      if (!built) continue;
      const result = await runSmartPaste(built.request);
      if (getState().currentTabId !== initialTabId) break;
      if (result && result.ok) {
        pasted++;
        completed.push(selection);
        dispatch({ type: "commitLineBatch", entries: [{ lineIndex, styleId: (result.sessions && result.sessions[0] && result.sessions[0].styleId) || (style && style.id) || (state.currentStyle && state.currentStyle.id) }] });
        if (result.history && result.history.before != null && result.history.after != null) {
          pasteHistory.register({ ...result.history, lineBefore: lineIndex, lineAfter: lineAfter(getState(), lineIndex) });
        }
      } else {
        if (result && stopsWithoutFallback(result.code)) {
          notice(dispatch, reasonText(result.code), "warning");
          break;
        }
        notice(dispatch, String(locale.smartPasteFallback || "{reason}").replace("{reason}", reasonText((result && result.code) || "error")), "warning");
        await new Promise((resolve) => createTextLayerInSelection(line.text, styleWithTextColor(getScaledStyle(style || state.currentStyle, state.textScale), result && result.textColor), state.pastePointText, state.internalPadding || 0, state.direction, (ok) => {
          if (ok) { pasted++; completed.push(selection); }
          resolve();
        }, { preserveActiveTextSize: options.preserveActiveTextSize === true }));
        if (!completed.includes(selection)) break;
      }
    }
    if (getState().currentTabId === initialTabId && completed.length) {
      dispatch({ type: "clearSelections", preserveLine: true, completed });
      if (completed.length === selections.length) await evalHost("deselectDocumentSelection()", 5000);
    }
    return pasted > 0;
  } finally {
    busy = false;
    lastFinishedAt = Date.now();
  }
};
