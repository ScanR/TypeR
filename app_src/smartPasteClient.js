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
import { createPasteHistory, lineAfterHistoryMove } from "./oneClick/pasteHistory";
import { resolveTypeRFontVariant } from "./fontVariantResolver.jsxinc";

const isUxp = () => !!(typeof window !== "undefined" && window.typerUXP);

const evalHost = (script, timeout = 60000) => new Promise((resolve) => {
  csInterface.evalScript(script, trackHostAction((result) => resolve(result), timeout));
});

const clone = (value) => JSON.parse(JSON.stringify(value));

/* ======================= request ======================= */

const uiLanguage = (state) => {
  if (state.language && state.language !== "auto") return state.language;
  try {
    return JSON.parse(window.__adobe_cep__.getHostEnvironment()).appUILocale || "";
  } catch (error) {
    return (typeof navigator !== "undefined" && navigator.language) || "";
  }
};

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
  const lines = picked.map((entry, i) => {
    const source = i === 0 && !options.style ? state.currentStyle : (i === 0 && options.style) || entry.line.usedStyle || entry.line.style || state.currentStyle;
    const parsed = applyRefont(buildRichTextPayload(entry.line.text), rules);
    return {
      text: parsed.text,
      richTextRuns: parsed.richTextRuns || null,
      style: getScaledStyle(source, state.textScale),
      styleLocked: !!entry.line.style,
    };
  });
  return {
    lineIndexes: picked.map((entry) => entry.index),
    request: {
      trigger: trigger || { source: "manual" },
      lines,
      roleStyles: roleStylesFor(state),
      settings: {
        autoClean: !!state.smartPasteAutoClean,
        distribute: state.smartPasteDistribute !== false,
        minScale: state.smartPasteMinScale > 0 ? state.smartPasteMinScale : 0.7,
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
      sessions: prepared.sessions.map((session) => ({ kind: session.plan.kind, role: session.role, styleId: session.styleId, size: session.text.size, tier: session.text.tier })),
    };
  } catch (error) {
    return { ok: false, code: (error && error.code) || "error", message: String((error && error.message) || error) };
  }
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
export const recentSelectionTrigger = (maxAge = 2000) => (
  lastTrigger && Date.now() - lastTrigger.at <= maxAge && (lastTrigger.trigger.source === "wand" || lastTrigger.trigger.source === "rectangle")
    ? lastTrigger.trigger
    : null
);

let busy = false;
let lastFinishedAt = 0;

// Selection events Photoshop sends for TypeR's own work arrive late in CEP
export const isSmartPasteSettling = () => busy || Date.now() - lastFinishedAt < 600;

const notice = (dispatch, text, kind = "info") => {
  if (text) dispatch({ type: "showNotice", text, kind });
};

const reasonText = (code) => locale["smartPasteReason_" + code] || locale.smartPasteReason_error || code;

const classicPaste = (state, dispatch, options) => new Promise((resolve) => {
  const line = state.currentLine || { text: "" };
  const style = getScaledStyle(state.currentStyle, state.textScale);
  createTextLayerInSelection(line.text, style, state.pastePointText, state.internalPadding || 0, state.direction, (ok) => {
    if (ok) dispatch({ type: "nextLine", add: true });
    resolve(ok);
  }, {
    autoCenter: state.autoCenterMode || "off",
    resizeTextBox: !!state.resizeTextBoxOnCenter,
    preserveActiveTextSize: options.preserveActiveTextSize === true,
  });
});

// getState() returns the latest panel state (the line may move while a
// paste waits for Photoshop)
export const smartPasteInSelection = async (getState, dispatch, options = {}) => {
  if (busy) return false;
  busy = true;
  try {
    if (!isUxp()) await syncPasteHistory(getState, dispatch);
    const state = getState();
    const built = buildSmartPasteRequest(state, options.trigger, options);
    if (!built) return false;
    const result = await runSmartPaste(built.request);
    if (result && result.ok && result.consumed > 0) {
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
      return true;
    }
    // Classic paste, recorded too so an Undo still moves the line back
    const code = (result && result.code) || "error";
    if (code === "doc" || code === "noSelection") {
      notice(dispatch, reasonText(code), "warning");
      return false;
    }
    notice(dispatch, String(locale.smartPasteFallback || "{reason}").replace("{reason}", reasonText(code)), "warning");
    const before = await getHistorySnapshot();
    const lineBefore = getState().currentLineIndex;
    const ok = await classicPaste(getState(), dispatch, options);
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
  let pasted = 0;
  try {
    for (let i = 0; i < selections.length; i++) {
      const selection = selections[i];
      const state = getState();
      const lineIndex = typeof selection.lineIndex === "number" ? selection.lineIndex : state.currentLineIndex;
      const line = state.lines && state.lines[lineIndex];
      if (!line || line.ignore) continue;
      const replayed = safeJsonParse(await evalHost("replaySelectionTrigger(" + JSON.stringify(selection.trigger) + ")", 15000), { error: "error" });
      if (replayed.error) continue;
      const style = selection.styleId ? (state.styles || []).find((entry) => entry.id === selection.styleId) : null;
      const built = buildSmartPasteRequest(state, selection.trigger, { ...options, lineIndex, single: true, style });
      if (!built) continue;
      const result = await runSmartPaste(built.request);
      if (result && result.ok) {
        pasted++;
        dispatch({ type: "commitLineBatch", entries: [{ lineIndex, styleId: (result.sessions && result.sessions[0] && result.sessions[0].styleId) || (style && style.id) || (state.currentStyle && state.currentStyle.id) }] });
        if (result.history && result.history.before != null && result.history.after != null) {
          pasteHistory.register({ ...result.history, lineBefore: lineIndex, lineAfter: lineAfter(getState(), lineIndex) });
        }
      } else {
        notice(dispatch, String(locale.smartPasteFallback || "{reason}").replace("{reason}", reasonText((result && result.code) || "error")), "warning");
        await new Promise((resolve) => createTextLayerInSelection(line.text, getScaledStyle(style || state.currentStyle, state.textScale), state.pastePointText, state.internalPadding || 0, state.direction, (ok) => {
          if (ok) pasted++;
          resolve();
        }, { preserveActiveTextSize: options.preserveActiveTextSize === true }));
      }
    }
    dispatch({ type: "clearSelections", preserveLine: true });
    await evalHost("deselectDocumentSelection()", 5000);
    return pasted > 0;
  } finally {
    busy = false;
    lastFinishedAt = Date.now();
  }
};
