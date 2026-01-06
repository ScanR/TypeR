import React from "react";
import { FiX } from "react-icons/fi";
import { locale } from "../../utils";

const Shortcut = (props) => {
  React.useEffect(() => {
    const input = document.getElementById(`shortcut_${props.index}`);
    if (input) input.value = (props.value || []).join(" + ");
  }, [props.index, props.value]);

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

  const clearShortcut = () => {
    const input = document.getElementById(`shortcut_${props.index}`);
    if (input) input.value = "";
  };

  return (
    <React.Fragment key={props.index}>
      <div className="field-mini-label">{locale[`shortcut_${props.index}`]}</div>
      <div className="field-input shortcut-field">
        <input id={`shortcut_${props.index}`} defaultValue={props.value.join(" + ")} onKeyDown={changeShortCut} className="topcoat-textarea" />
        <button type="button" className="topcoat-icon-button--large--quiet" title={locale.delete} onClick={clearShortcut}>
          <FiX size={14} />
        </button>
      </div>
    </React.Fragment>
  );
};

export default Shortcut;
