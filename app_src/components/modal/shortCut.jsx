import React from "react";
import PropTypes from "prop-types";
import { FiX } from "react-icons/fi";
import { locale, getHotkeyPressed } from "../../utils";

const MODIFIERS = ["WIN", "CTRL", "ALT", "SHIFT"];
const SPECIAL_KEYS = { "+": "PLUS", "-": "MINUS", "=": "EQUAL", "/": "DIVIDE", "*": "MULTIPLY" };
const IGNORED_KEYS = ["Meta", "Control", "Alt", "Shift", "AltGraph", "CapsLock", "Dead", "Process", "Unidentified"];
const hasMainKey = (keys) => (keys || []).some((key) => !MODIFIERS.includes(String(key).toUpperCase()));

const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");

// Stored key names -> short human-friendly keycap labels (cosmetic only,
// the stored value keeps the host vocabulary)
const KEY_LABELS = {
  WIN: IS_MAC ? "Cmd" : "Win",
  CTRL: "Ctrl",
  SHIFT: "Shift",
  ALT: IS_MAC ? "Opt" : "Alt",
  ENTER: "Enter",
  TAB: "Tab",
  SPACE: "Space",
  ESCAPE: "Esc",
  BACKSPACE: "Bksp",
  DELETE: "Del",
  PLUS: "+",
  MINUS: "-",
  EQUAL: "=",
  DIVIDE: "/",
  MULTIPLY: "*",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
  MOUSE4: "Mouse 4",
  MOUSE5: "Mouse 5",
};

// e.button 3/4 are the side buttons, reported by the watcher as XBUTTON1/2
const MOUSE_BUTTON_KEYS = { 3: "MOUSE4", 4: "MOUSE5" };

const keyLabel = (key) => KEY_LABELS[String(key).toUpperCase()] || key;

const getLocalKeys = (e) => {
  const keys = [];
  if (e.metaKey) keys.push("WIN");
  if (e.ctrlKey) keys.push("CTRL");
  if (e.altKey) keys.push("ALT");
  if (e.shiftKey) keys.push("SHIFT");
  if (e.key && !IGNORED_KEYS.includes(e.key)) {
    if (SPECIAL_KEYS[e.key]) {
      keys.push(SPECIAL_KEYS[e.key]);
    } else if ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 65 && e.keyCode <= 90)) {
      // Letters and digits: the virtual key code names the key itself, while
      // e.key is the produced character, which Shift/Alt distort (e.g. Alt+Z
      // gives "Ω" on macOS) into names the Photoshop poller never reports
      keys.push(String.fromCharCode(e.keyCode));
    } else {
      keys.push(e.key.toUpperCase());
    }
  }
  return keys;
};

// Same "aWINaCTRLaZa" format as the hotkey poller
const parseHostKeys = (state) => {
  if (!state || typeof state !== "string" || state.indexOf("a") !== 0) return [];
  const keys = state.split("a");
  keys.shift();
  keys.pop();
  return keys.filter((key) => key);
};

const Shortcut = (props) => {
  const hostQueryRef = React.useRef(0);
  const inputRef = React.useRef(null);
  // Mirrors the hidden input's value so the keycaps can render reactively
  const [displayKeys, setDisplayKeys] = React.useState(props.value || []);
  const [recording, setRecording] = React.useState(false);

  React.useEffect(() => {
    const input = inputRef.current;
    if (input) input.value = (props.value || []).join(" + ");
    setDisplayKeys(props.value || []);
  }, [props.index, props.value]);

  const changeShortCut = (e) => {
    e.preventDefault();
    const input = e.target;
    const capturedKeys = getLocalKeys(e);
    const localKeys = props.modifierOnly
      ? capturedKeys.filter((key) => MODIFIERS.includes(key))
      : capturedKeys;
    // A plain key press carries no modifier: keep the current binding instead
    // of silently clearing a modifier-only shortcut.
    if (props.modifierOnly && !localKeys.length) return;
    input.value = localKeys.join(" + ");
    setDisplayKeys(localKeys);
    props.onChange(props.index, localKeys);

    // ScriptUI can keep a stale keyName (commonly APOSTROPHE) while only a
    // modifier is held. The browser event is authoritative for modifier-only
    // shortcuts, so do not let the asynchronous host sample overwrite it.
    const requestId = ++hostQueryRef.current;
    if (!hasMainKey(localKeys)) return;

    // Shortcuts are matched at runtime against ScriptUI's keyboardState key
    // names, which can differ from browser key names (layout, Alt symbols,
    // function keys). Ask the host what it sees for the held combo and store
    // that, so recording and matching share the same vocabulary.
    getHotkeyPressed((state) => {
      if (requestId !== hostQueryRef.current) return;
      if (document.activeElement !== input) return;
      const hostKeys = parseHostKeys(state);
      if (!hostKeys.length) return;
      const hostHasMainKey = hasMainKey(hostKeys);
      // The main key may already be released when the host samples the
      // keyboard; fall back to the locally captured name for it
      const keys = hostHasMainKey ? hostKeys : hostKeys.concat(localKeys.filter((key) => !MODIFIERS.includes(key)));
      input.value = keys.join(" + ");
      setDisplayKeys(keys);
      props.onChange(props.index, keys);
    });
  };

  // Recording happens with the cursor over the panel, so the DOM event is
  // available here even though matching at runtime goes through the watcher.
  // The host is never queried: ScriptUI cannot see mouse buttons at all.
  const changeShortCutFromMouse = (e) => {
    const mouseKey = MOUSE_BUTTON_KEYS[e.button];
    if (!mouseKey || !recording) return;
    if (props.modifierOnly) return;
    e.preventDefault();
    e.stopPropagation();
    hostQueryRef.current++;
    const keys = [];
    if (e.metaKey) keys.push("WIN");
    if (e.ctrlKey) keys.push("CTRL");
    if (e.altKey) keys.push("ALT");
    if (e.shiftKey) keys.push("SHIFT");
    keys.push(mouseKey);
    const input = inputRef.current;
    if (input) input.value = keys.join(" + ");
    setDisplayKeys(keys);
    props.onChange(props.index, keys);
  };

  const focusShortcut = () => {
    if (inputRef.current) inputRef.current.focus();
  };

  const clearShortcut = (e) => {
    e.stopPropagation();
    hostQueryRef.current++;
    const input = inputRef.current;
    if (input) input.value = "";
    setDisplayKeys([]);
    props.onChange(props.index, []);
  };

  const label = locale[`shortcut_${props.index}`];
  const description = locale[`shortcut_${props.index}Descr`];
  return (
    <div className={"shortcut-row" + (props.conflict ? " m-conflict" : "")} key={props.index} onClick={focusShortcut} onMouseDown={changeShortCutFromMouse}>
      <div className="shortcut-row-copy">
        <div className="shortcut-row-label" title={label}>{label}</div>
        {description ? <div className="shortcut-row-descr">{description}</div> : null}
      </div>
      <div className={"shortcut-capture" + (recording ? " m-recording" : "")}>
        <input
          ref={inputRef}
          id={`shortcut_${props.index}`}
          defaultValue={(props.value || []).join(" + ")}
          onKeyDown={changeShortCut}
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
        />
        <div className="shortcut-keys">
          {displayKeys.length ? (
            displayKeys.map((key, i) => (
              <React.Fragment key={`${key}_${i}`}>
                {i > 0 && <span className="shortcut-plus">+</span>}
                <kbd className="shortcut-key">{keyLabel(key)}</kbd>
              </React.Fragment>
            ))
          ) : (
            <span className="shortcut-empty">
              {recording
                ? (props.modifierOnly
                  ? locale.shortcutPressModifiers || "Hold a modifier key..."
                  : locale.shortcutPressKeys || "Press keys...")
                : locale.shortcutNotSet || "Not set"}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="topcoat-icon-button--large--quiet shortcut-clear"
        title={locale.delete}
        onClick={clearShortcut}
      >
        <FiX size={14} />
      </button>
      {props.conflict ? <div className="shortcut-row-warning">{props.conflict}</div> : null}
    </div>
  );
};

Shortcut.propTypes = {
  index: PropTypes.string.isRequired,
  value: PropTypes.arrayOf(PropTypes.string).isRequired,
  onChange: PropTypes.func.isRequired,
  conflict: PropTypes.string,
  modifierOnly: PropTypes.bool,
};

export default Shortcut;
