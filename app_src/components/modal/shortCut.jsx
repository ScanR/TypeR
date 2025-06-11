import React from "react";
import { locale } from "../../utils";

const Shortcut = (props) => {
  const changeShortCut = (e) => {
    e.preventDefault();
    let shortCut = "";
    if (e.metaKey) {
      shortCut += "WIN";
    }
    if (e.ctrlKey) {
      shortCut += `${shortCut ? " + " : ""}CTRL`;
    }
    if (e.altKey) {
      shortCut += `${shortCut ? " + " : ""}ALT`;
    }
    if (e.shiftKey) {
      shortCut += `${shortCut ? " + " : ""}SHIFT`;
    }
    if (e.button !== undefined) {
      if (e.button === 3) {
        shortCut += `${shortCut ? " + " : ""}BUTTON4`;
      } else if (e.button === 4) {
        shortCut += `${shortCut ? " + " : ""}BUTTON5`;
      }
    }
    if (e.key && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
      if (e.key === "+") {
        shortCut += `${shortCut ? " + " : ""}PLUS`;
      } else if (e.key === "-") {
        shortCut += `${shortCut ? " + " : ""}MINUS`;
      } else if (e.key === "=") {
        shortCut += `${shortCut ? " + " : ""}EQUAL`;
      } else if (e.key === "/") {
        shortCut += `${shortCut ? " + " : ""}DIVIDE`;
      } else if (e.key === "*") {
        shortCut += `${shortCut ? " + " : ""}MULTIPLY`;
      } else {
        shortCut += `${shortCut ? " + " : ""}${e.key.toUpperCase()}`;
      }
    }
    e.target.value = shortCut;
  };

  return (
    <React.Fragment key={props.index}>
      <div className="field-mini-label">{locale[`shortcut_${props.index}`]}</div>
      <div className="field-input">
        <input
          id={`shortcut_${props.index}`}
          value={props.value.join(" + ")}
          onKeyDown={changeShortCut}
          onMouseDown={changeShortCut}
          className="topcoat-textarea"
        />
      </div>
    </React.Fragment>
  );
};

export default Shortcut;
