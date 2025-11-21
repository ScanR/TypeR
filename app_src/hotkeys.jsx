import _ from "lodash";
import React from "react";

import { csInterface, setActiveLayerText, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, getHotkeyPressed, changeActiveLayerTextSize } from "./utils";
import { useContext } from "./context";

const CTRL = "CTRL";
const SHIFT = "SHIFT";
const ALT = "ALT";
const WIN = "WIN";

const intervalTime = 50;
let keyboardInterval = 0;
let keyUp = true;
let lastAction = 0;

const checkRepeatTime = (time = 0) => {
  const now = Date.now();
  if (!keyUp || now - lastAction < time) return false;
  lastAction = now;
  keyUp = false;
  return true;
};

const checkShortcut = (state, ref) => {
  return ref.every((key) => state.includes(key));
};

const HotkeysListner = React.memo(function HotkeysListner() {
  const context = useContext();
  const checkState = (state) => {
    const realState = state.split("a");
    realState.shift();
    realState.pop();
    if (checkShortcut(realState, context.state.shortcut.add)) {
      if (!checkRepeatTime()) return;
      
      const storedSelections = context.state.storedSelections || [];
      
      if (context.state.multiBubbleMode && storedSelections.length > 0) {
        // Mode sélections multiples
        const texts = [];
        const styles = [];
        const lines = context.state.lines || [];
        let nextFallbackIndex = context.state.currentLineIndex;

        const resolveStyleForLine = (targetLine, selection) => {
          if (targetLine?.style) {
            return targetLine.style;
          }
          if (selection?.styleId) {
            const storedStyle = context.state.styles.find((s) => s.id === selection.styleId);
            if (storedStyle) return storedStyle;
          }
          return context.state.currentStyle;
        };

        const resolveLineForSelection = (selection) => {
          if (typeof selection.lineIndex === "number" && selection.lineIndex >= 0) {
            const storedLine = lines[selection.lineIndex];
            if (storedLine && !storedLine.ignore) {
              nextFallbackIndex = Math.max(nextFallbackIndex, selection.lineIndex + 1);
              return storedLine;
            }
          }

          while (nextFallbackIndex < lines.length) {
            const candidate = lines[nextFallbackIndex];
            nextFallbackIndex++;
            if (candidate && !candidate.ignore) {
              return candidate;
            }
          }
          return null;
        };

        for (let i = 0; i < storedSelections.length; i++) {
          const selection = storedSelections[i];
          const targetLine = resolveLineForSelection(selection);
          if (!targetLine) {
            break;
          }

          texts.push(targetLine.text);

          let lineStyle = resolveStyleForLine(targetLine, selection);
          if (lineStyle && context.state.textScale) {
            lineStyle = _.cloneDeep(lineStyle);
            const txtStyle = lineStyle.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
            if (typeof txtStyle.size === "number") {
              txtStyle.size *= context.state.textScale / 100;
            }
            if (typeof txtStyle.leading === "number" && txtStyle.leading) {
              txtStyle.leading *= context.state.textScale / 100;
            }
          }
          styles.push(lineStyle);
        }
        
        const pointText = context.state.pastePointText;
        const padding = context.state.internalPadding || 0;
        createTextLayersInStoredSelections(texts, styles, storedSelections, pointText, padding, (ok) => {
          if (ok) {
            // Vider les sélections stockées
            context.dispatch({ type: "clearSelections" });
          }
        });
      } else {
        // Mode sélection unique (comportement original)
        const line = context.state.currentLine || { text: "" };
        let style = context.state.currentStyle;
        if (style && context.state.textScale) {
          style = _.cloneDeep(style);
          const txtStyle = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
          if (typeof txtStyle.size === "number") {
            txtStyle.size *= context.state.textScale / 100;
          }
          if (typeof txtStyle.leading === "number" && txtStyle.leading) {
            txtStyle.leading *= context.state.textScale / 100;
          }
        }
        const pointText = context.state.pastePointText;
        const padding = context.state.internalPadding || 0;
        createTextLayerInSelection(line.text, style, pointText, padding, (ok) => {
          if (ok) context.dispatch({ type: "nextLine", add: true });
        });
      }
    } else if (checkShortcut(realState, context.state.shortcut.apply)) {
      if (!checkRepeatTime()) return;
      const line = context.state.currentLine || { text: "" };
      let style = context.state.currentStyle;
      if (style && context.state.textScale) {
        style = _.cloneDeep(style);
        const txtStyle = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
        if (typeof txtStyle.size === "number") {
          txtStyle.size *= context.state.textScale / 100;
        }
        if (typeof txtStyle.leading === "number" && txtStyle.leading) {
          txtStyle.leading *= context.state.textScale / 100;
        }
      }
      setActiveLayerText(line.text, style, context.state.direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    } else if (checkShortcut(realState, context.state.shortcut.center)) {
      if (!checkRepeatTime()) return;
      const padding = context.state.internalPadding || 0;
      alignTextLayerToSelection(context.state.resizeTextBoxOnCenter, padding);
    } else if (checkShortcut(realState, context.state.shortcut.toggleMultiBubble)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "setMultiBubbleMode", value: !context.state.multiBubbleMode });
    } else if (checkShortcut(realState, context.state.shortcut.next)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "nextLine" });
    } else if (checkShortcut(realState, context.state.shortcut.previous)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "prevLine" });
    } else if (checkShortcut(realState, context.state.shortcut.increase)) {
      if (!checkRepeatTime(300)) return;
      changeActiveLayerTextSize(context.state.textSizeIncrement || 1);
    } else if (checkShortcut(realState, context.state.shortcut.decrease)) {
      if (!checkRepeatTime(300)) return;
      changeActiveLayerTextSize(-(context.state.textSizeIncrement || 1));
    } else if (checkShortcut(realState, context.state.shortcut.insertText)) {
      if (!checkRepeatTime()) return;
      const line = context.state.currentLine || { text: "" };
      setActiveLayerText(line.text, null, context.state.direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    } else if (checkShortcut(realState, context.state.shortcut.nextPage)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "nextPage" });
    } else {
      keyUp = true;
    }

  };

  clearInterval(keyboardInterval);
  keyboardInterval = setInterval(() => {
    if (context.state.modalType === "settings") return;
    getHotkeyPressed(checkState);
  }, intervalTime);

  document.onkeydown = (e) => {
    if (e.key === "Escape") {
      if (context.state.modalType) {
        context.dispatch({ type: "setModal" });
      }
    }
  };

  React.useEffect(() => {
    const keyInterests = [{ keyCode: 27 }];
    csInterface.registerKeyEventsInterest(JSON.stringify(keyInterests));
  }, []);

  return <React.Fragment />;
});

export default HotkeysListner;
