import { getNumpadStyleId } from "./numpadStyleShortcuts";
import { requestModalClose } from "./modalClose";
import React from "react";

import { csInterface, getHotkeyPressed, isHostActionPending, isPanelIdle, isPanelInteracting, notePanelActivity, onMouseShortcut, startForegroundWatcher } from "./utils";
import { useContext } from "./context";
import { shortcutCommands } from "./shortcutCommands";
import { isBlockingModal } from "./whatsNewSession";

const intervalTime = 75;
// After a few idle minutes the keyboard poll slows to this rate: even 13 host
// round-trips per second against an untouched Photoshop is what makes long
// background sessions crawl. The first pressed key restores the fast rate.
const idleIntervalTime = 500;

const MODIFIER_KEYS = ["WIN", "CTRL", "ALT", "SHIFT"];
// Held longer than this, modifiers alone are not a tap: a drag or a click on
// the canvas usually follows (Cmd+Shift+drag, Cmd+Opt+drag)
const MODIFIER_CHORD_MAX_HOLD = 700;
// The same key is "=" or "+" depending on the layout and on what reads it:
// ScriptUI reports Equal for Shift+= where the UXP reader reports both
const KEY_ALIASES = { PLUS: "EQUAL", EQUAL: "PLUS" };

const isKeyHeld = (state, key) => state.includes(key) || (KEY_ALIASES[key] !== undefined && state.includes(KEY_ALIASES[key]));

const checkShortcut = (state, ref) => {
  return Array.isArray(ref) && ref.length > 0 && ref.every((key) => isKeyHeld(state, key));
};

const isModifierChord = (ref) => Array.isArray(ref) && ref.length > 0 && ref.every((key) => MODIFIER_KEYS.includes(key));

// Matching is subset-based, so a modifier-only binding (e.g. default add =
// WIN+CTRL) would always shadow a longer custom binding built on the same
// modifiers. Pick the most specific match instead of the first one.
// Bindings made of modifiers only and the others run at different times (see
// createModifierChordTracker), so the caller picks one of the two kinds.
const matchBinding = (state, shortcut, modifierChords) => {
  let best = null;
  let bestLength = 0;
  shortcutCommands.forEach((command) => {
    if (command.modifierOnly) return;
    const ref = shortcut[command.id];
    if (isModifierChord(ref) === modifierChords && checkShortcut(state, ref) && ref.length > bestLength) {
      best = command;
      bestLength = ref.length;
    }
  });
  return best;
};

const getCommandOptions = (state, shortcut) => ({
  preserveActiveTextSize: checkShortcut(state, shortcut.keepTextSize),
});

// The paste buttons show a live badge while the keep-size modifier is held.
// The state is fed from two sources: the host keyboard poll (works while
// Photoshop has focus) and DOM key events (work while the panel has focus,
// where the poll backs off). Both go through here so the flag only
// dispatches on actual changes.
const syncKeepSizeHeld = (context, pressedKeys) => {
  const ctxState = context.getState();
  const held = checkShortcut(pressedKeys, ctxState.shortcut.keepTextSize);
  if (held !== ctxState.keepSizeHeld) {
    context.dispatch({ type: "setKeepSizeHeld", value: held });
  }
};

const getDomModifierKeys = (e) => {
  const keys = [];
  if (e.metaKey) keys.push("WIN");
  if (e.ctrlKey) keys.push("CTRL");
  if (e.altKey) keys.push("ALT");
  if (e.shiftKey) keys.push("SHIFT");
  return keys;
};

// Mouse bindings are matched on their own so the mouse path can only ever add
// behavior: a keyboard-only binding whose modifiers happen to be held during a
// click (e.g. WIN+CTRL) must not fire a second time through here.
const MOUSE_KEYS = ["MOUSE4", "MOUSE5"];
const hasMouseKey = (ref) => Array.isArray(ref) && ref.some((key) => MOUSE_KEYS.includes(key));

const matchMouseBinding = (state, shortcut) => {
  let best = null;
  let bestLength = 0;
  shortcutCommands.forEach((command) => {
    if (command.modifierOnly) return;
    const ref = shortcut[command.id];
    if (hasMouseKey(ref) && checkShortcut(state, ref) && ref.length > bestLength) {
      best = command;
      bestLength = ref.length;
    }
  });
  return best;
};

// The user types in the panel: a field has the focus and so has the panel.
// A textarea keeps document.activeElement after the user goes back to the
// canvas (UXP's WebView always, CEP's window too), and the shortcuts must
// work there; keystrokes only reach the panel while its document has focus.
const isFormFieldActive = () => {
  if (typeof document.hasFocus === "function" && !document.hasFocus()) return false;
  const active = document.activeElement;
  if (!active) return false;
  const tagName = active.tagName;
  return active.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
};

// Decides when a matched shortcut runs. Pure apart from the injected clock and
// timer, so scripts/testShortcuts.js can drive it.
// - Key state fires once per press: a held chord waits for a state that
//   matches nothing before it can fire again.
// - A new press that lands inside the previous command's repeatDelay runs at
//   the end of that delay instead of being dropped. At most one press waits;
//   further presses inside the window are dropped.
// - Mouse side buttons are edges (press(..., true)): no release to wait for,
//   same delay.
const createShortcutGate = ({ now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout } = {}) => {
  let released = true;
  let lastAt = -Infinity;
  let deferred = null;
  const fire = (run) => {
    lastAt = now();
    run();
  };
  return {
    release() {
      released = true;
    },
    press(command, run, edge = false) {
      if (!edge) {
        if (!released) return false;
        released = false;
      }
      if (deferred) return false;
      const wait = (command.repeatDelay || 0) - (now() - lastAt);
      if (wait <= 0) {
        fire(run);
        return true;
      }
      deferred = schedule(() => {
        deferred = null;
        fire(run);
      }, wait);
      return true;
    },
    dispose() {
      if (deferred) cancel(deferred);
      deferred = null;
    },
  };
};

// Decides when a shortcut made of modifiers only (Cmd+Ctrl, Cmd+Shift...) runs.
// These keys start most of Photoshop's own shortcuts, so such a chord runs when
// its first key is released, with every modifier held at that point: the press
// order does not matter. It does not run if another key joined it (Cmd+Shift+Z),
// nor if it was held too long to be a tap. Pure apart from the injected clock,
// so scripts/testShortcuts.js can drive it.
const createModifierChordTracker = ({ now = () => Date.now(), maxHold = MODIFIER_CHORD_MAX_HOLD } = {}) => {
  let peak = [];
  let lastAddedAt = 0;
  let spent = false;
  let cancelled = false;
  let ignored = [];
  return {
    // Takes the held keys, answers the modifiers of the chord to run, if any
    update(keys) {
      const modifiers = keys.filter((key) => MODIFIER_KEYS.includes(key));
      const others = keys.filter((key) => !MODIFIER_KEYS.includes(key));
      // A name already there with the first modifier is not part of the
      // chord: ScriptUI can keep a stale keyName while only modifiers are held
      if (!peak.length && modifiers.length) ignored = others;
      if (others.some((key) => !ignored.includes(key))) cancelled = true;
      let chord = null;
      if (peak.some((key) => !modifiers.includes(key))) {
        if (!spent && !cancelled && now() - lastAddedAt <= maxHold) chord = peak;
        spent = true;
      }
      if (modifiers.some((key) => !peak.includes(key))) {
        spent = false;
        lastAddedAt = now();
      }
      peak = modifiers;
      if (!modifiers.length) {
        spent = false;
        cancelled = false;
        ignored = [];
      }
      return chord;
    },
    // Another shortcut used these modifiers: they are not a chord of their own
    cancel() {
      cancelled = true;
    },
  };
};

const HotkeysListner = React.memo(function HotkeysListner() {
  const context = useContext(() => ({}));

  const gateRef = React.useRef(null);
  if (!gateRef.current) gateRef.current = createShortcutGate();
  const chordRef = React.useRef(null);
  if (!chordRef.current) chordRef.current = createModifierChordTracker();
  const hotkeyPollPendingRef = React.useRef(false);
  const lastPollAtRef = React.useRef(0);

  // The handler's context is read when the command runs: a press the gate
  // deferred acts on the current line, and not while a modal is open or a
  // paste/align still runs (its callback has not advanced the line yet, so
  // the same line would be pasted twice)
  const runCommand = (command, options) => () => {
    const state = context.getState();
    if (isBlockingModal(state.modalType) || isHostActionPending()) return;
    command.handler({ state, dispatch: context.dispatch, getState: context.getState }, options);
  };

  React.useEffect(() => () => gateRef.current.dispose(), []);

  React.useEffect(() => {
    // With canFire false (a modal is open, the user types in the panel) the
    // state still records releases: otherwise the gate stays "held" and the
    // next press of that chord is lost
    const checkState = (state, canFire = true) => {
      if (!state) return;
      const shortcut = context.getState().shortcut;
      const realState = state.split("a");
      realState.shift();
      realState.pop();
      if (canFire) {
        // Pressed keys are activity: restore fast polling before matching so
        // a hotkey burst after an idle period is never throttled
        if (realState.length) notePanelActivity();
        syncKeepSizeHeld(context, realState);
      }
      const chord = chordRef.current.update(realState);
      if (chord && canFire) {
        const chordCommand = matchBinding(chord, shortcut, true);
        if (chordCommand) gateRef.current.press(chordCommand, runCommand(chordCommand, getCommandOptions(chord, shortcut)), true);
      }
      const command = matchBinding(realState, shortcut, false);
      if (!command) {
        gateRef.current.release();
        return;
      }
      chordRef.current.cancel();
      if (canFire) gateRef.current.press(command, runCommand(command, getCommandOptions(realState, shortcut)));
    };

    // UXP: the plugin pushes every change of the keyboard state
    // (uxp-src/web/cepShim.js), at no cost to Photoshop, so none of the
    // poll's back-offs below apply; only what CEP's poll also skips does
    // (an open modal, typing in the panel, a host action still running)
    const subscribeToKeys = window.typerUXP && window.typerUXP.onKeys;
    const unsubscribeKeys = subscribeToKeys
      ? subscribeToKeys((state) => checkState(state, !isBlockingModal(context.getState().modalType) && !isHostActionPending() && !isFormFieldActive() && !document.hidden))
      : null;

    const interval = subscribeToKeys ? null : setInterval(() => {
      // Back off while a paste/align/apply runs: polling would queue behind it
      // in the ExtendScript engine and delay the action's completion
      if (isBlockingModal(context.getState().modalType) || isFormFieldActive() || hotkeyPollPendingRef.current || isHostActionPending() || document.hidden) return;
      // The user is clicking inside the panel: a host round-trip right now
      // would land on Photoshop's main thread while it should be delivering
      // the click, which is exactly what made every button feel laggy
      if (isPanelInteracting()) return;
      if (isPanelIdle() && Date.now() - lastPollAtRef.current < idleIntervalTime) return;
      lastPollAtRef.current = Date.now();
      hotkeyPollPendingRef.current = true;
      getHotkeyPressed((state) => {
        hotkeyPollPendingRef.current = false;
        checkState(state);
      });
    }, intervalTime);

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && context.getState().modalType) {
        e.preventDefault();
        requestModalClose(() => context.dispatch({ type: "setModal" }));
      }
      syncKeepSizeHeld(context, getDomModifierKeys(e));
      if (!e.repeat && !isBlockingModal(context.getState().modalType) && !isFormFieldActive() && getDomModifierKeys(e).length === 0 && (e.location === 3 || /^Numpad[1-9]$/.test(e.code || ''))) {
        const state = context.getState();
        const styleId = getNumpadStyleId(state.styles, state.currentStyleId, [e.code || ('NUMPAD' + e.key)]);
        if (styleId !== null) {
          e.preventDefault();
          context.dispatch({ type: 'setCurrentStyleId', id: styleId });
        }
      }
    };
    // On keyup the released modifier is already reported as false, so the
    // same event-flag read clears the badge
    const handleKeyUp = (e) => {
      syncKeepSizeHeld(context, getDomModifierKeys(e));
    };
    // Neither source sees the release once the panel and Photoshop both lose
    // focus; never leave a stale "held" badge behind
    const handleWindowBlur = () => {
      syncKeepSizeHeld(context, []);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      if (interval) clearInterval(interval);
      if (unsubscribeKeys) unsubscribeKeys();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  React.useEffect(() => {
    // The watcher normally starts from the first hotkey poll, but mouse
    // bindings must work even while that poll is backing off
    startForegroundWatcher();

    const unsubscribe = onMouseShortcut((state) => {
      chordRef.current.cancel();
      const ctxState = context.getState();
      // No isFormFieldActive() guard: a side button never types a character,
      // and the panel's textarea usually holds focus while the user works
      if (isBlockingModal(ctxState.modalType)) return;
      const command = matchMouseBinding(state, ctxState.shortcut);
      if (!command) return;
      gateRef.current.press(command, runCommand(command, getCommandOptions(state, ctxState.shortcut)), true);
    });

    // CEF maps these buttons to history back/forward, which blanks the panel.
    // Only needed while the cursor is over the panel; the shortcut itself is
    // delivered by the watcher, not by these events.
    const swallowMouseNav = (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    document.addEventListener("mousedown", swallowMouseNav, true);
    document.addEventListener("mouseup", swallowMouseNav, true);
    document.addEventListener("auxclick", swallowMouseNav, true);

    return () => {
      unsubscribe();
      document.removeEventListener("mousedown", swallowMouseNav, true);
      document.removeEventListener("mouseup", swallowMouseNav, true);
      document.removeEventListener("auxclick", swallowMouseNav, true);
    };
  }, []);

  React.useEffect(() => {
    const keyInterests = [{ keyCode: 27 }];
    csInterface.registerKeyEventsInterest(JSON.stringify(keyInterests));
  }, []);

  return <React.Fragment />;
});

export default HotkeysListner;
