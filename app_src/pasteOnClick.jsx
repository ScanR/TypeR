// Paste on click and the undo sync, mounted once in the main layout.
//   - A Magic Wand click, a rectangle or a lasso selection pastes the current
//     line at once when "paste on click" is on (smart paste, or the classic
//     paste when smart paste is off).
//   - UXP reports every history move (TYPER_HISTORY_EVENT): an Undo of a
//     TypeR paste puts the script line back. CEP has no history event: the
//     history is checked after Photoshop events and when the panel is focused.

import React from "react";
import { useContext } from "./context";
import { addPhotoshopEventListener, msSinceHostAction } from "./utils";
import { PS_EVENT_SET } from "./photoshopEvents";
import { classifySelectionEvent, parseCepEventData } from "./oneClick/selectionEvent";
import {
  applyHistorySnapshot, hasPasteHistory, isSmartPasteSettling, rememberSelectionTrigger, smartPasteInSelection, syncPasteHistory,
} from "./smartPasteClient";
import { pasteInSelection } from "./shortcutCommands";

// Sent by the UXP host (uxp-src/host/main.js); no CEP event uses this id
export const TYPER_HISTORY_EVENT = 1215591779;

// Selections TypeR itself makes are reported to a CEP panel shortly after
const OWN_SELECTION_GRACE = 400;

export const shouldPasteOnClick = (state, trigger, sinceHostAction) => !!(
  trigger && state && state.pasteOnClick && !state.multiBubbleMode &&
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
      const state = getState();
      const trigger = classifySelectionEvent(data.eventData);
      if (trigger && msSinceHostAction() >= OWN_SELECTION_GRACE && !isSmartPasteSettling()) rememberSelectionTrigger(trigger);
      if (!shouldPasteOnClick(state, trigger, msSinceHostAction())) {
        if (!trigger) scheduleHistoryCheck();
        return;
      }
      if (state.smartPaste === true) {
        smartPasteInSelection(getState, dispatch, { trigger });
      } else {
        pasteInSelection({ state, dispatch, getState });
      }
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
