// Records a shortcut from the keyboard reader's states ("aWINaCTRLaKa").
// In the new TypeR (UXP) on Windows, the panel's WebView2 never receives a
// key pressed with Ctrl: Photoshop takes those as its own accelerators, so
// the DOM keydown the shortcut field listens to does not fire for Ctrl, Ctrl+K
// or Ctrl+Win. The keyboard reader still sees them: the field records what it
// reports, from the first key pressed to the release of every key.

export const MODIFIERS = ["WIN", "CTRL", "ALT", "SHIFT"];

// The reader may follow a key with its aliases ("aLEFTaARROWLEFTa"): only the
// first name of the first main key counts
export const parseHostKeys = (state) => {
  if (!state || typeof state !== "string" || state.indexOf("a") !== 0) return [];
  const keys = state.split("a");
  keys.shift();
  keys.pop();
  let mainKeySeen = false;
  return keys.filter((key) => {
    if (!key) return false;
    if (MODIFIERS.includes(key)) return true;
    if (mainKeySeen) return false;
    mainKeySeen = true;
    return true;
  });
};

// update(state) answers the keys to record once every key is released, null
// otherwise. Every modifier held during the press counts, with the first main
// key, in the reader's order (modifiers first).
export const createHostShortcutRecorder = ({ modifierOnly = false } = {}) => {
  let modifiers = [];
  let mainKey = null;
  return {
    update(state) {
      const keys = parseHostKeys(state);
      if (keys.length) {
        keys.forEach((key) => {
          if (MODIFIERS.includes(key)) {
            if (!modifiers.includes(key)) modifiers.push(key);
          } else if (mainKey === null) {
            mainKey = key;
          }
        });
        return null;
      }
      if (!modifiers.length && mainKey === null) return null;
      const ordered = MODIFIERS.filter((key) => modifiers.includes(key));
      const result = modifierOnly ? ordered : (mainKey === null ? ordered : ordered.concat(mainKey));
      modifiers = [];
      mainKey = null;
      return result.length ? result : null;
    },
    reset() {
      modifiers = [];
      mainKey = null;
    },
  };
};
