// Paste on click and the undo sync, mounted once in the main layout.
//   - A Magic Wand click, a rectangle or a lasso selection pastes the current
//     line at once when "paste on click" is on (smart paste, or the classic
//     paste when smart paste is off).
//   - UXP reports every history move (TYPER_HISTORY_EVENT): an Undo of a
//     TypeR paste puts the script line back. CEP has no history event: the
//     history is checked after Photoshop events and when the panel is focused.

import React from "react";
import { useContext } from "./context";
import { addPhotoshopEventListener, csInterface, msSinceHostAction, safeJsonParse } from "./utils";
import { PS_EVENT_SET } from "./photoshopEvents";
import { classifySelectionEvent, parseCepEventData, triggerSourceForTool } from "./oneClick/selectionEvent";
import {
  applyHistorySnapshot, hasPasteHistory, isSmartPasteSettling, rememberSelectionTrigger, smartPasteInSelection, syncPasteHistory,
} from "./smartPasteClient";
import { pasteInSelection } from "./shortcutCommands";

// Sent by the UXP host (uxp-src/host/main.js); no CEP event uses this id
export const TYPER_HISTORY_EVENT = 1215591779;

// Selections TypeR itself makes are reported to a CEP panel shortly after
const OWN_SELECTION_GRACE = 400;

// A CEP event without its descriptor: ask the host for the tool and the
// selection, and paste when a selection tool made a new selection
let lastProbeBounds = null;
const sameBounds = (a, b) => !!(a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);
const probeTrigger = () => new Promise((resolve) => {
  csInterface.evalScript("smartPasteSelectionProbe()", (raw) => {
    const probe = safeJsonParse(raw, {});
    const source = triggerSourceForTool(probe.tool);
    const changed = probe.bounds && !sameBounds(probe.bounds, lastProbeBounds);
    lastProbeBounds = probe.bounds || null;
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

const PasteOnClick = () => {
  const context = useContext((state) => ({ pasteOnClick: state.pasteOnClick }));
  const { getState, dispatch } = context;

  React.useEffect(() => {
    const isUxp = !!window.typerUXP;
    let historyTimer = null;
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
        if (trigger && msSinceHostAction() >= OWN_SELECTION_GRACE && !isSmartPasteSettling()) rememberSelectionTrigger(trigger);
        if (!shouldPasteOnClick(state, trigger, msSinceHostAction(), isPanelHidden())) {
          if (!trigger) scheduleHistoryCheck();
          return;
        }
        if (state.smartPaste === true) smartPasteInSelection(getState, dispatch, { trigger });
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
      window.removeEventListener("focus", onFocus);
      clearTimeout(historyTimer);
    };
  }, [getState, dispatch]);

  return null;
};

export default PasteOnClick;
