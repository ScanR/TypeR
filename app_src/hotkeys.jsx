import _ from "lodash";
import React from "react";

import { csInterface, setActiveLayerText, createTextLayerInSelection, alignTextLayerToSelection, getHotkeyPressed, changeActiveLayerTextSize } from "./utils";
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
      createTextLayerInSelection(line.text, style, pointText, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
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
      setActiveLayerText(line.text, style, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    } else if (checkShortcut(realState, context.state.shortcut.center)) {
      if (!checkRepeatTime()) return;
      alignTextLayerToSelection(context.state.resizeTextBoxOnCenter);
    } else if (checkShortcut(realState, context.state.shortcut.next)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "nextLine" });
    } else if (checkShortcut(realState, context.state.shortcut.previous)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "prevLine" });
    } else if (checkShortcut(realState, context.state.shortcut.increase)) {
      if (!checkRepeatTime(300)) return;
      changeActiveLayerTextSize(1);
    } else if (checkShortcut(realState, context.state.shortcut.decrease)) {
      if (!checkRepeatTime(300)) return;
      changeActiveLayerTextSize(-1);
    } else if (checkShortcut(realState, context.state.shortcut.insertText)) {
      if (!checkRepeatTime()) return;
      const line = context.state.currentLine || { text: "" };
      setActiveLayerText(line.text, null, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
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
