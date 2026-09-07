import {
  buildCustomPalette,
  extractThemeKeys,
  isValidColor,
  toHex,
  withAlpha,
} from "./themeColors";

const EDITOR_THEME_PRESETS = [
  {
    id: "system",
    label: "Photoshop",
    mode: "system",
    swatches: ["#2f3030", "#dfe2e2", "#288edf"],
  },
  {
    id: "editor-dark",
    label: "Dark+",
    mode: "dark",
    swatches: ["#1e1e1e", "#252526", "#007acc"],
    colors: {
      surface: "#1e1e1e",
      surfaceAlt: "#252526",
      panel: "#2d2d30",
      input: "#1b1b1b",
      inputAlt: "#333333",
      text: "#d4d4d4",
      muted: "#8f8f8f",
      border: "rgba(255, 255, 255, 0.13)",
      borderStrong: "rgba(255, 255, 255, 0.24)",
      accent: "#007acc",
      accentHover: "#1684d4",
      accentText: "#ffffff",
      accentSoft: "rgba(0, 122, 204, 0.22)",
      codeBg: "#1e1e1e",
      codeGutter: "#252526",
      codeText: "#d4d4d4",
      codeMuted: "#858585",
      codeCurrent: "#264f78",
      codeCurrentText: "#ffffff",
      codePage: "#2d5a27",
    },
  },
  {
    id: "pure-dark",
    labelKey: "settingsThemePureDark",
    mode: "dark",
    swatches: ["#000000", "#0a0a0a", "#4dabf7"],
    colors: {
      // Keep the large background and editor surfaces at absolute black so
      // OLED pixels can switch off. Near-black elevations preserve just
      // enough separation for controls and panels.
      surface: "#000000",
      surfaceAlt: "#060606",
      panel: "#0a0a0a",
      input: "#080808",
      inputAlt: "#111111",
      text: "#f2f2f2",
      muted: "#8c8c8c",
      border: "rgba(255, 255, 255, 0.12)",
      borderStrong: "rgba(255, 255, 255, 0.24)",
      accent: "#4dabf7",
      accentHover: "#74c0fc",
      accentText: "#000000",
      accentSoft: "rgba(77, 171, 247, 0.2)",
      codeBg: "#000000",
      codeGutter: "#060606",
      codeText: "#f2f2f2",
      codeMuted: "#8c8c8c",
      codeCurrent: "#10243a",
      codeCurrentText: "#ffffff",
      codePage: "#102b1a",
    },
  },
  {
    id: "editor-light",
    label: "Light+",
    mode: "light",
    swatches: ["#ffffff", "#f3f3f3", "#006ab1"],
    colors: {
      surface: "#ffffff",
      surfaceAlt: "#f3f3f3",
      panel: "#e8e8e8",
      input: "#ffffff",
      inputAlt: "#f5f5f5",
      text: "#1f1f1f",
      muted: "#616161",
      border: "rgba(0, 0, 0, 0.16)",
      borderStrong: "rgba(0, 0, 0, 0.28)",
      accent: "#006ab1",
      accentHover: "#007acc",
      accentText: "#ffffff",
      accentSoft: "rgba(0, 106, 177, 0.14)",
      codeBg: "#ffffff",
      codeGutter: "#f3f3f3",
      codeText: "#1f1f1f",
      codeMuted: "#6a6a6a",
      codeCurrent: "#add6ff",
      codeCurrentText: "#000000",
      codePage: "#d7f8cf",
    },
  },
  {
    id: "monokai",
    label: "Monokai",
    mode: "dark",
    swatches: ["#272822", "#3e3d32", "#a6e22e"],
    colors: {
      surface: "#272822",
      surfaceAlt: "#33342b",
      panel: "#3e3d32",
      input: "#1f201b",
      inputAlt: "#4a4b3f",
      text: "#f8f8f2",
      muted: "#b8b8ad",
      border: "rgba(255, 255, 255, 0.14)",
      borderStrong: "rgba(255, 255, 255, 0.28)",
      accent: "#a6e22e",
      accentHover: "#b6f23e",
      accentText: "#1f201b",
      accentSoft: "rgba(166, 226, 46, 0.18)",
      codeBg: "#272822",
      codeGutter: "#1f201b",
      codeText: "#f8f8f2",
      codeMuted: "#90908a",
      codeCurrent: "#49483e",
      codeCurrentText: "#f8f8f2",
      codePage: "#496024",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    mode: "dark",
    swatches: ["#002b36", "#073642", "#2aa198"],
    colors: {
      surface: "#002b36",
      surfaceAlt: "#073642",
      panel: "#0b3a45",
      input: "#00212b",
      inputAlt: "#124652",
      text: "#eee8d5",
      muted: "#93a1a1",
      border: "rgba(238, 232, 213, 0.15)",
      borderStrong: "rgba(238, 232, 213, 0.28)",
      accent: "#2aa198",
      accentHover: "#36b8ae",
      accentText: "#002b36",
      accentSoft: "rgba(42, 161, 152, 0.2)",
      codeBg: "#002b36",
      codeGutter: "#073642",
      codeText: "#eee8d5",
      codeMuted: "#839496",
      codeCurrent: "#0f4a55",
      codeCurrentText: "#fdf6e3",
      codePage: "#365d1f",
    },
  },
  {
    id: "abyss",
    label: "Abyss",
    mode: "dark",
    swatches: ["#000c18", "#071a2f", "#00aaff"],
    colors: {
      surface: "#000c18",
      surfaceAlt: "#071a2f",
      panel: "#0b2440",
      input: "#001426",
      inputAlt: "#123354",
      text: "#d7ecff",
      muted: "#7da2c4",
      border: "rgba(125, 194, 255, 0.18)",
      borderStrong: "rgba(125, 194, 255, 0.34)",
      accent: "#00aaff",
      accentHover: "#3fbdff",
      accentText: "#001426",
      accentSoft: "rgba(0, 170, 255, 0.18)",
      codeBg: "#000c18",
      codeGutter: "#071a2f",
      codeText: "#d7ecff",
      codeMuted: "#6f8cab",
      codeCurrent: "#123f67",
      codeCurrentText: "#ffffff",
      codePage: "#0d4c3a",
    },
  },
  {
    id: "one-dark",
    label: "One Dark Pro",
    mode: "dark",
    swatches: ["#282c34", "#21252b", "#61afef"],
    colors: {
      surface: "#282c34",
      surfaceAlt: "#21252b",
      panel: "#2f343e",
      input: "#1e2227",
      inputAlt: "#363c47",
      text: "#abb2bf",
      muted: "#7f848e",
      border: "rgba(255, 255, 255, 0.12)",
      borderStrong: "rgba(255, 255, 255, 0.24)",
      accent: "#61afef",
      accentHover: "#74bdf5",
      accentText: "#1e2227",
      accentSoft: "rgba(97, 175, 239, 0.18)",
      codeBg: "#282c34",
      codeGutter: "#21252b",
      codeText: "#abb2bf",
      codeMuted: "#5c6370",
      codeCurrent: "#2c313c",
      codeCurrentText: "#ffffff",
      codePage: "#354a30",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    mode: "dark",
    swatches: ["#282a36", "#44475a", "#bd93f9"],
    colors: {
      surface: "#282a36",
      surfaceAlt: "#21222c",
      panel: "#343746",
      input: "#1e1f29",
      inputAlt: "#3c3f51",
      text: "#f8f8f2",
      muted: "#9ba3c7",
      border: "rgba(189, 147, 249, 0.16)",
      borderStrong: "rgba(189, 147, 249, 0.34)",
      accent: "#bd93f9",
      accentHover: "#cba6ff",
      accentText: "#1e1f29",
      accentSoft: "rgba(189, 147, 249, 0.2)",
      codeBg: "#282a36",
      codeGutter: "#21222c",
      codeText: "#f8f8f2",
      codeMuted: "#6272a4",
      codeCurrent: "#44475a",
      codeCurrentText: "#f8f8f2",
      codePage: "#29543a",
    },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    swatches: ["#2e3440", "#3b4252", "#88c0d0"],
    colors: {
      surface: "#2e3440",
      surfaceAlt: "#272c36",
      panel: "#3b4252",
      input: "#242933",
      inputAlt: "#434c5e",
      text: "#eceff4",
      muted: "#94a0b8",
      border: "rgba(216, 222, 233, 0.14)",
      borderStrong: "rgba(216, 222, 233, 0.28)",
      accent: "#88c0d0",
      accentHover: "#99d3e0",
      accentText: "#2e3440",
      accentSoft: "rgba(136, 192, 208, 0.2)",
      codeBg: "#2e3440",
      codeGutter: "#272c36",
      codeText: "#d8dee9",
      codeMuted: "#616e88",
      codeCurrent: "#434c5e",
      codeCurrentText: "#eceff4",
      codePage: "#40513a",
    },
  },
];

const DEFAULT_EDITOR_THEME_ID = "system";
const CUSTOM_IMAGE_THEME_ID = "custom-image";
const CUSTOM_THEME_PREFIX = "custom-";

// User-made themes and the background image live in the app storage, but the
// theme lookup has to stay a synchronous pure function (it runs during the
// initial reducer state and inside the theme manager). A module-level registry
// is kept in sync by the context whenever either of them changes.
let customEditorThemes = [];
let backgroundImageMeta = null;

const createCustomThemeId = () =>
  CUSTOM_THEME_PREFIX + Math.random().toString(36).substr(2, 8);

const normalizeCustomTheme = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id.indexOf(CUSTOM_THEME_PREFIX) === 0 && raw.id !== CUSTOM_IMAGE_THEME_ID
    ? raw.id
    : createCustomThemeId();
  const mode = raw.mode === "light" ? "light" : "dark";
  const keys = extractThemeKeys(raw.keys || raw.colors, mode);
  const colors = buildCustomPalette(keys, mode);
  return {
    id,
    // Kept as typed (the name field must stay erasable while editing)
    label: typeof raw.label === "string" ? raw.label.slice(0, 32) : "Custom",
    mode,
    keys,
    colors,
    swatches: [colors.surface, colors.panel, colors.accent],
    custom: true,
  };
};

const normalizeCustomThemes = (list) =>
  (Array.isArray(list) ? list : []).map(normalizeCustomTheme).filter(Boolean);

const setCustomEditorThemes = (list) => {
  customEditorThemes = normalizeCustomThemes(list);
  return customEditorThemes;
};

const setBackgroundImageMeta = (meta) => {
  backgroundImageMeta = meta && typeof meta === "object" ? meta : null;
};

const getBackgroundImageMeta = () => backgroundImageMeta;

// The image theme reuses a built-in palette but makes every surface partly
// transparent, so the picture stays visible behind the panels.
const buildImageThemePreset = (meta) => {
  const mode = meta && meta.mode === "light" ? "light" : "dark";
  const base = getEditorThemePreset(mode === "light" ? "editor-light" : "editor-dark").colors;
  const tint = meta && Number.isFinite(meta.tint) ? meta.tint : 0.45;
  return {
    id: CUSTOM_IMAGE_THEME_ID,
    label: "Custom image",
    mode,
    image: true,
    swatches: [base.surface, base.panel, base.accent],
    background: {
      base: base.surface,
      tint: withAlpha(base.surface, tint),
    },
    colors: {
      ...base,
      // Body and app background: fully see-through, the fixed image layer and
      // its tint sit underneath and provide the color.
      surface: "transparent",
      surfaceAlt: withAlpha(base.surfaceAlt, 0.94),
      panel: withAlpha(base.panel, 0.72),
      input: withAlpha(base.input, 0.58),
      inputAlt: withAlpha(base.inputAlt, 0.64),
      codeBg: withAlpha(base.codeBg, 0.55),
      codeGutter: withAlpha(base.codeGutter, 0.62),
      codeCurrent: withAlpha(base.codeCurrent, 0.85),
      codePage: withAlpha(base.codePage, 0.8),
    },
  };
};

const getImageThemePreset = () =>
  backgroundImageMeta ? buildImageThemePreset(backgroundImageMeta) : null;

const getEditorThemePreset = (id) => {
  const preset = EDITOR_THEME_PRESETS.find((theme) => theme.id === id);
  if (preset) return preset;
  const custom = customEditorThemes.find((theme) => theme.id === id);
  if (custom) return custom;
  if (id === CUSTOM_IMAGE_THEME_ID) {
    const imageTheme = getImageThemePreset();
    if (imageTheme) return imageTheme;
  }
  return EDITOR_THEME_PRESETS[0];
};

const normalizeEditorTheme = (id) => getEditorThemePreset(id).id;

// Colors used to render the theme cards in settings; the "system" preset
// has no fixed palette, so it falls back to a Photoshop-like mock.
const getEditorThemePreviewColors = (preset) => {
  if (preset.image) {
    const base = getEditorThemePreset(preset.mode === "light" ? "editor-light" : "editor-dark").colors;
    return { ...base, ...preset.colors, surface: base.surface };
  }
  return (
    preset.colors || {
      surface: "#323232",
      panel: "#3f3f3f",
      text: "#e8e8e8",
      muted: "#9a9a9a",
      accent: preset.swatches ? preset.swatches[2] : "#288edf",
    }
  );
};

// A new custom theme starts from the palette of the theme it was created from
const createCustomThemeFrom = (sourceId, label) => {
  const source = getEditorThemePreset(sourceId);
  const mode = source.mode === "light" ? "light" : "dark";
  return normalizeCustomTheme({
    id: createCustomThemeId(),
    label,
    mode,
    keys: extractThemeKeys(source.colors, mode),
  });
};

const normalizePageLineColor = (value) => (isValidColor(value) ? toHex(value) : null);

export {
  EDITOR_THEME_PRESETS,
  DEFAULT_EDITOR_THEME_ID,
  CUSTOM_IMAGE_THEME_ID,
  CUSTOM_THEME_PREFIX,
  getEditorThemePreset,
  normalizeEditorTheme,
  getEditorThemePreviewColors,
  normalizeCustomTheme,
  normalizeCustomThemes,
  createCustomThemeFrom,
  createCustomThemeId,
  setCustomEditorThemes,
  setBackgroundImageMeta,
  getBackgroundImageMeta,
  getImageThemePreset,
  buildImageThemePreset,
  normalizePageLineColor,
};
