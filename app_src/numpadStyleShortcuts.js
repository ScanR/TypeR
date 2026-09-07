const MODIFIER_KEYS = ["WIN", "CTRL", "ALT", "SHIFT"];

export const getNumpadStylePosition = (pressedKeys) => {
  if (!Array.isArray(pressedKeys) || pressedKeys.length !== 1) return null;
  if (pressedKeys.some((key) => MODIFIER_KEYS.includes(key))) return null;

  // ScriptUI does not expose the keyboard location consistently across
  // Photoshop versions. Accept the known host names plus the digit fallback.
  const key = String(pressedKeys[0] || "").toUpperCase().replace(/[\s_-]/g, "");
  const match = key.match(/^(?:NUMPAD|NUM|KP)?([1-9])$/);
  return match ? parseInt(match[1], 10) - 1 : null;
};

export const getNumpadStyleId = (styles, currentStyleId, pressedKeys) => {
  const position = getNumpadStylePosition(pressedKeys);
  if (position === null || !Array.isArray(styles) || !styles.length) return null;

  const currentStyle = styles.find((style) => style.id === currentStyleId) || styles[0];
  const currentFolderId = currentStyle.folder || null;
  const folderStyles = styles.filter((style) => (style.folder || null) === currentFolderId);
  return folderStyles[position]?.id || null;
};
