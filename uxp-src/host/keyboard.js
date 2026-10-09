// Global keyboard state, in the "aWINaCTRLaKa" format getHotkeyPressed()
// returned from ScriptUI.environment.keyboardState. UXP has no API for the
// keyboard outside the panel, so a small native helper reports it
// (uxp-src/native); this module only keeps its last report.
let state = "a";
let updatedAt = 0;
const listeners = new Set();

function setState(next) {
  const value = typeof next === "string" && next.charAt(0) === "a" ? next : "a";
  updatedAt = Date.now();
  if (value === state) return;
  state = value;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {}
  });
}

function getState() {
  return state;
}

function isShiftDown() {
  return state.indexOf("aSHIFTa") !== -1;
}

function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function lastUpdate() {
  return updatedAt;
}

module.exports = { setState, getState, isShiftDown, onChange, lastUpdate };
