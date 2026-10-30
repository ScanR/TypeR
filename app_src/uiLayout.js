// Main panel layout (Settings > Appearance): block order, what is shown and
// the sizes. Pure logic, shared by the reducer, the footer and the settings.

// Footer mode toggles, in footer order: each one can be hidden on its own
export const FOOTER_MODE_KEYS = {
  textShapeR: "footerModeTextShapeR",
  multiBubble: "footerModeMultiBubble",
  pasteOnClick: "footerModePasteOnClick",
  autoClean: "footerModeAutoClean",
};

export const defaultUiLayout = {
  order: ["preview", "text", "styles"],
  visible: {
    preview: true,
    text: true,
    styles: true,
    tabBar: true,
    previewCreateButton: true,
    previewAlignButton: true,
    previewSizeControls: true,
    previewNav: true,
    previewWidget: true,
    footerHelp: true,
    footerRepo: true,
    footerModeTextShapeR: true,
    footerModeMultiBubble: true,
    footerModePasteOnClick: true,
    footerModeAutoClean: true,
  },
  sizes: {
    previewHeight: 130,
    uiScale: 100,
  },
  // Footer mode toggles: icons at any panel width instead of only when narrow
  footerModeIcons: false,
};

const clampNumber = (value, min, max, fallback) => {
  const num = parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

// Merge a stored/partial layout with the defaults so missing or invalid
// fields (older storage versions, bad imports) never break the UI
export const normalizeUiLayout = (raw) => {
  const layout = raw && typeof raw === "object" ? raw : {};
  const visible = { ...defaultUiLayout.visible };
  const stored = layout.visible && typeof layout.visible === "object" ? layout.visible : {};
  // Older versions hid every mode toggle with a single switch
  if (stored.footerModeToggles === false) {
    Object.keys(FOOTER_MODE_KEYS).forEach((id) => {
      visible[FOOTER_MODE_KEYS[id]] = false;
    });
  }
  for (const key in visible) {
    if (typeof stored[key] === "boolean") visible[key] = stored[key];
  }
  let order = Array.isArray(layout.order)
    ? layout.order.filter((id, index, order) => defaultUiLayout.order.includes(id) && order.indexOf(id) === index)
    : [];
  order = order.concat(defaultUiLayout.order.filter((id) => !order.includes(id)));
  // The panel must never end up fully empty
  if (!visible.preview && !visible.text && !visible.styles) visible.text = true;
  const sizes = {
    previewHeight: clampNumber(layout.sizes?.previewHeight, 80, 300, defaultUiLayout.sizes.previewHeight),
    uiScale: clampNumber(layout.sizes?.uiScale, 70, 150, defaultUiLayout.sizes.uiScale),
  };
  return { order, visible, sizes, footerModeIcons: layout.footerModeIcons === true };
};

export const isFooterModeVisible = (layout, id) => {
  const key = FOOTER_MODE_KEYS[id];
  return !key || !layout || !layout.visible || layout.visible[key] !== false;
};
