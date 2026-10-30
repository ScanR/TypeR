// Paste on click and the undo sync, mounted once in the main layout.
//   - A Magic Wand click, a rectangle or a lasso selection pastes the current
//     line at once when "paste on click" is on (smart paste, or the classic
//     paste when smart paste is off).
//   - With smart paste, clicks made while a paste runs wait their turn: each
//     one selects its bubble again and pastes the next line.
//   - UXP reports every history move (TYPER_HISTORY_EVENT): an Undo of a
//     TypeR paste puts the script line back. CEP has no history event: the
//     history is checked after Photoshop events and when the panel is focused.

import React from "react";
import { useContext } from "./context";
import { addPhotoshopEventListener, csInterface, msSinceHostAction, safeJsonParse } from "./utils";
import { PS_EVENT_SET } from "./photoshopEvents";
import { classifySelectionEvent, parseCepEventData, triggerSourceForTool } from "./oneClick/selectionEvent";
import {
  applyHistorySnapshot, hasPasteHistory, isClassicFallbackSettling, isSmartPasteBusy, isSmartPasteSettling, rememberSelectionTrigger,
  hasSplitCandidate, replaySelection, smartPasteFinishedAt, smartPasteInSelection, syncPasteHistory,
} from "./smartPasteClient";
import { pasteInSelection } from "./shortcutCommands";

// Sent by the UXP host (uxp-src/host/main.js); no CEP event uses this id
export const TYPER_HISTORY_EVENT = 1215591779;

// Selections TypeR itself makes are reported to a CEP panel shortly after
const OWN_SELECTION_GRACE = 400;

// A CEP event without its descriptor: ask the host for the tool and the
// selection, and paste when a selection tool made a new selection. Right
// after a one-line paste the same bounds are a new click too: a second click
// in the bubble splits it.
let lastProbeBounds = null;
let lastProbeAt = 0;
const sameBounds = (a, b) => !!(a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);
const probeTrigger = () => new Promise((resolve) => {
  csInterface.evalScript("smartPasteSelectionProbe()", (raw) => {
    const probe = safeJsonParse(raw, {});
    const source = triggerSourceForTool(probe.tool);
    const changed = probe.bounds && (!sameBounds(probe.bounds, lastProbeBounds) || (hasSplitCandidate() && smartPasteFinishedAt() > lastProbeAt));
    lastProbeBounds = probe.bounds || null;
    lastProbeAt = Date.now();
    resolve(source && changed ? { source } : null);
  });
});
const hasDescriptor = (eventData) => !!(eventData && typeof eventData === "object" && Object.keys(eventData).length);

// The panel is closed, collapsed or behind another tab: TypeR stays out of
// the way. UXP: the shim's document.hidden. CEP: a closed panel is unloaded,
// a collapsed one reports its window as hidden.
export const isPanelHidden = () => {
  if (typeof document !== "undefined" && document.hidden) return true;
  try {
    if (typeof csInterface.isWindowVisible === "function") {
      const visible = csInterface.isWindowVisible();
      return visible === false || visible === "false";
    }
  } catch (error) {}
  return false;
};

export const shouldPasteOnClick = (state, trigger, sinceHostAction, hidden = false) => !!(
  !hidden && trigger && state && state.pasteOnClick && !state.multiBubbleMode &&
  state.currentLine && !state.currentLine.ignore && state.currentLine.text &&
  sinceHostAction >= OWN_SELECTION_GRACE && !isSmartPasteSettling()
);

// Clicks that can be selected again: the Magic Wand and the rectangle
const isReplayable = (trigger) => !!(trigger && (trigger.source === "wand" || trigger.source === "rectangle"));

const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1.5;

// The selection event of TypeR's own replay of a click. A click read in
// points comes back in pixels: the same scale on both axes.
export const matchesReplay = (event, trigger) => {
  if (!event || !trigger || event.source !== trigger.source) return false;
  if (event.source === "rectangle") return ["left", "top", "right", "bottom"].every((side) => near(event[side], trigger[side]));
  if (event.source !== "wand") return false;
  if ((event.unit || "pixelsUnit") === (trigger.unit || "pixelsUnit")) return near(event.x, trigger.x) && near(event.y, trigger.y);
  const points = trigger.unit === "distanceUnit" ? trigger : event;
  const pixels = points === trigger ? event : trigger;
  if (!(points.x > 0 && points.y > 0)) return false;
  const scale = pixels.x / points.x;
  return scale > 0 && near(pixels.y, points.y * scale);
};

const OWN_REPLAY_WINDOW = 3000;
const MAX_QUEUED_CLICKS = 8;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Smart paste clicks, pasted one after the other. The first one pastes into
// the selection it made; the ones that waited (the previous paste deselects)
// are selected again first, and their replay events are not new clicks.
export const createClickQueue = ({ canPaste, paste, replay, isBusy = () => false }) => {
  const queue = [];
  const replays = [];
  let draining = false;

  const drain = async () => {
    draining = true;
    let reselect = false;
    try {
      while (queue.length) {
        while (isBusy()) {
          reselect = true;
          await wait(30);
        }
        const trigger = queue.shift();
        if (!canPaste()) {
          queue.length = 0;
          break;
        }
        if (reselect) {
          if (!isReplayable(trigger)) continue;
          replays.push({ trigger, at: Date.now() });
          if (!(await replay(trigger))) {
            queue.length = 0;
            break;
          }
        }
        await paste(trigger);
        reselect = true;
      }
    } finally {
      draining = false;
    }
  };

  return {
    // Consumes the expected event of a replay
    isOwnReplay: (trigger) => {
      const now = Date.now();
      for (let i = replays.length - 1; i >= 0; i--) {
        if (now - replays[i].at > OWN_REPLAY_WINDOW) replays.splice(i, 1);
        else if (matchesReplay(trigger, replays[i].trigger)) {
          replays.splice(i, 1);
          return true;
        }
      }
      return false;
    },
    isDraining: () => draining,
    push: (trigger) => {
      if (queue.length >= MAX_QUEUED_CLICKS) return false;
      queue.push(trigger);
      if (!draining) drain();
      return true;
    },
    clear: () => {
      queue.length = 0;
    },
  };
};

// Smart paste: a Magic Wand or rectangle click is the user's unless it is a
// replay or the classic paste's auto-centre probes (Magic Wand selections too)
export const canQueueClick = (state, trigger, sinceHostAction, hidden = false) => !!(
  !hidden && isReplayable(trigger) && state && state.pasteOnClick && !state.multiBubbleMode && state.smartPaste === true &&
  sinceHostAction >= OWN_SELECTION_GRACE && !isClassicFallbackSettling()
);

const PasteOnClick = () => {
  const context = useContext((state) => ({ pasteOnClick: state.pasteOnClick }));
  const { getState, dispatch } = context;

  React.useEffect(() => {
    const isUxp = !!window.typerUXP;
    let historyTimer = null;
    const clicks = createClickQueue({
      canPaste: () => {
        const state = getState();
        return !!(state.pasteOnClick && !state.multiBubbleMode && state.smartPaste === true && !isPanelHidden() &&
          state.currentLine && !state.currentLine.ignore && state.currentLine.text);
      },
      paste: (trigger) => smartPasteInSelection(getState, dispatch, { trigger }),
      replay: (trigger) => replaySelection(trigger, dispatch),
      isBusy: isSmartPasteBusy,
    });
    const scheduleHistoryCheck = () => {
      if (isUxp || !hasPasteHistory()) return;
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        if (!isSmartPasteSettling()) syncPasteHistory(getState, dispatch);
      }, 250);
    };
    const off = addPhotoshopEventListener((event) => {
      const data = parseCepEventData(event && event.data);
      if (data && data.eventID === TYPER_HISTORY_EVENT) {
        applyHistorySnapshot(data.eventData, getState, dispatch);
        return;
      }
      if (!data || data.eventID !== PS_EVENT_SET) {
        scheduleHistoryCheck();
        return;
      }
      const paste = (trigger) => {
        const state = getState();
        if (isReplayable(trigger) && clicks.isOwnReplay(trigger)) return;
        if (canQueueClick(state, trigger, msSinceHostAction(), isPanelHidden())) {
          rememberSelectionTrigger(trigger);
          if (state.currentLine && !state.currentLine.ignore && state.currentLine.text) clicks.push(trigger);
          return;
        }
        // A lasso cannot be selected again: it pastes only when TypeR is idle
        if (trigger && msSinceHostAction() >= OWN_SELECTION_GRACE && !isSmartPasteSettling() && !clicks.isDraining()) rememberSelectionTrigger(trigger);
        if (clicks.isDraining() || !shouldPasteOnClick(state, trigger, msSinceHostAction(), isPanelHidden())) {
          if (!trigger) scheduleHistoryCheck();
          return;
        }
        if (state.smartPaste === true) clicks.push(trigger);
        else pasteInSelection({ state, dispatch, getState });
      };
      if (!hasDescriptor(data.eventData) && !isUxp) {
        const state = getState();
        if (state.pasteOnClick && !state.multiBubbleMode && !isPanelHidden() && msSinceHostAction() >= OWN_SELECTION_GRACE && !isSmartPasteSettling()) probeTrigger().then(paste);
        return;
      }
      paste(classifySelectionEvent(data.eventData));
    });
    const onFocus = () => scheduleHistoryCheck();
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      clicks.clear();
      window.removeEventListener("focus", onFocus);
      clearTimeout(historyTimer);
    };
  }, [getState, dispatch]);

  return null;
};

export default PasteOnClick;
