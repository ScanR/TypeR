import {
  buildCustomPalette,
  extractThemeKeys,
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
    swatches: ["#1f1f1f", "#292929", "#3a7fd2"],
    colors: {
      surface: "#1f1f1f",
      surfaceAlt: "#242424",
      panel: "#292929",
      input: "#191919",
      inputAlt: "#2f2f2f",
      text: "#d6d6d6",
      muted: "#949494",
      border: "rgba(214, 214, 214, 0.09)",
      borderStrong: "rgba(214, 214, 214, 0.18)",
      accent: "#3a7fd2",
      accentHover: "#528ed7",
      accentText: "#ffffff",
      accentSoft: "rgba(58, 127, 210, 0.16)",
      codeBg: "#1f1f1f",
      codeGutter: "#1b1b1b",
      codeText: "#d6d6d6",
      codeMuted: "#7b7b7b",
      codeCurrent: "#242f3d",
      codeCurrentText: "#efefef",
      codePage: "#292f26",
    },
  },
  {
    id: "pure-dark",
    labelKey: "settingsThemePureDark",
    mode: "dark",
    swatches: ["#000000", "#0d0d0d", "#5aa9f0"],
    colors: {
      // Keep the large background and editor surfaces at absolute black so
      // OLED pixels can switch off. Near-black elevations preserve just
      // enough separation for controls and panels.
      surface: "#000000",
      surfaceAlt: "#060606",
      panel: "#0d0d0d",
      input: "#050505",
      inputAlt: "#151515",
      text: "#ededed",
      muted: "#989898",
      border: "rgba(237, 237, 237, 0.09)",
      borderStrong: "rgba(237, 237, 237, 0.18)",
      accent: "#5aa9f0",
      accentHover: "#6eb3f2",
      accentText: "#000000",
      accentSoft: "rgba(90, 169, 240, 0.16)",
      codeBg: "#000000",
      codeGutter: "#050505",
      codeText: "#ededed",
      codeMuted: "#777777",
      codeCurrent: "#0f1d29",
      codeCurrentText: "#f8f8f8",
      codePage: "#0b1b0d",
    },
  },
  {
    id: "editor-light",
    label: "Light+",
    mode: "light",
    swatches: ["#ffffff", "#f5f5f5", "#1e6fd0"],
    colors: {
      surface: "#ffffff",
      surfaceAlt: "#f9f9f9",
      panel: "#f5f5f5",
      input: "#ffffff",
      inputAlt: "#fbfbfb",
      text: "#1f1f1f",
      muted: "#797979",
      border: "rgba(31, 31, 31, 0.1)",
      borderStrong: "rgba(31, 31, 31, 0.2)",
      accent: "#1e6fd0",
      accentHover: "#1b64bb",
      accentText: "#ffffff",
      accentSoft: "rgba(30, 111, 208, 0.12)",
      codeBg: "#ffffff",
      codeGutter: "#f9f9f9",
      codeText: "#1f1f1f",
      codeMuted: "#8f8f8f",
      codeCurrent: "#e2ecf9",
      codeCurrentText: "#131313",
      codePage: "#e5f2e5",
    },
  },
  {
    id: "monokai",
    label: "Monokai",
    mode: "dark",
    swatches: ["#272822", "#32332d", "#a9dc76"],
    colors: {
      surface: "#272822",
      surfaceAlt: "#2d2e28",
      panel: "#32332d",
      input: "#1f201b",
      inputAlt: "#393a34",
      text: "#f2f2ec",
      muted: "#a9a9a3",
      border: "rgba(242, 242, 236, 0.09)",
      borderStrong: "rgba(242, 242, 236, 0.18)",
      accent: "#a9dc76",
      accentHover: "#b3e086",
      accentText: "#1f201b",
      accentSoft: "rgba(169, 220, 118, 0.16)",
      codeBg: "#272822",
      codeGutter: "#22231e",
      codeText: "#f2f2ec",
      codeMuted: "#8d8d87",
      codeCurrent: "#3d4730",
      codeCurrentText: "#fafaf7",
      codePage: "#403f2d",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    mode: "dark",
    swatches: ["#002b36", "#0d353e", "#2a85c9"],
    colors: {
      surface: "#002b36",
      surfaceAlt: "#07303b",
      panel: "#0d353e",
      input: "#00222b",
      inputAlt: "#153b44",
      text: "#e4dfcf",
      muted: "#929e98",
      border: "rgba(228, 223, 207, 0.09)",
      borderStrong: "rgba(228, 223, 207, 0.18)",
      accent: "#2a85c9",
      accentHover: "#4494cf",
      accentText: "#ffffff",
      accentSoft: "rgba(42, 133, 201, 0.16)",
      codeBg: "#002b36",
      codeGutter: "#002630",
      codeText: "#e4dfcf",
      codeMuted: "#728583",
      codeCurrent: "#073a4f",
      codeCurrentText: "#f4f2ec",
      codePage: "#11392f",
    },
  },
  {
    id: "abyss",
    label: "Abyss",
    mode: "dark",
    swatches: ["#000c18", "#0b1824", "#4ea4f2"],
    colors: {
      surface: "#000c18",
      surfaceAlt: "#06121f",
      panel: "#0b1824",
      input: "#000a13",
      inputAlt: "#131f2c",
      text: "#cfe2f5",
      muted: "#8495a5",
      border: "rgba(207, 226, 245, 0.09)",
      borderStrong: "rgba(207, 226, 245, 0.18)",
      accent: "#4ea4f2",
      accentHover: "#63aff4",
      accentText: "#000c18",
      accentSoft: "rgba(78, 164, 242, 0.16)",
      codeBg: "#000c18",
      codeGutter: "#000b15",
      codeText: "#cfe2f5",
      codeMuted: "#687787",
      codeCurrent: "#0d263d",
      codeCurrentText: "#ecf3fb",
      codePage: "#04211e",
    },
  },
  {
    id: "one-dark",
    label: "One Dark Pro",
    mode: "dark",
    swatches: ["#282c34", "#31353d", "#61afef"],
    colors: {
      surface: "#282c34",
      surfaceAlt: "#2d3139",
      panel: "#31353d",
      input: "#20232a",
      inputAlt: "#363a42",
      text: "#c3c8d1",
      muted: "#8b9098",
      border: "rgba(195, 200, 209, 0.09)",
      borderStrong: "rgba(195, 200, 209, 0.18)",
      accent: "#61afef",
      accentHover: "#74b9f1",
      accentText: "#1e2227",
      accentSoft: "rgba(97, 175, 239, 0.16)",
      codeBg: "#282c34",
      codeGutter: "#23272e",
      codeText: "#c3c8d1",
      codeMuted: "#767a83",
      codeCurrent: "#324254",
      codeCurrentText: "#e7e9ed",
      codePage: "#37403d",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    mode: "dark",
    swatches: ["#282a36", "#333540", "#bd93f9"],
    colors: {
      surface: "#282a36",
      surfaceAlt: "#2e303c",
      panel: "#333540",
      input: "#20222b",
      inputAlt: "#3a3c47",
      text: "#f4f4ef",
      muted: "#ababac",
      border: "rgba(244, 244, 239, 0.09)",
      borderStrong: "rgba(244, 244, 239, 0.18)",
      accent: "#bd93f9",
      accentHover: "#c5a0fa",
      accentText: "#21222c",
      accentSoft: "rgba(189, 147, 249, 0.16)",
      codeBg: "#282a36",
      codeGutter: "#232530",
      codeText: "#f4f4ef",
      codeMuted: "#8e8f93",
      codeCurrent: "#413c57",
      codeCurrentText: "#fbfbf9",
      codePage: "#2d453f",
    },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    swatches: ["#2e3440", "#383e4a", "#88c0d0"],
    colors: {
      surface: "#2e3440",
      surfaceAlt: "#333945",
      panel: "#383e4a",
      input: "#252a33",
      inputAlt: "#3e4450",
      text: "#e5e9f0",
      muted: "#a3a8b1",
      border: "rgba(229, 233, 240, 0.09)",
      borderStrong: "rgba(229, 233, 240, 0.18)",
      accent: "#88c0d0",
      accentHover: "#96c8d6",
      accentText: "#2e3440",
      accentSoft: "rgba(136, 192, 208, 0.16)",
      codeBg: "#2e3440",
      codeGutter: "#282e38",
      codeText: "#e5e9f0",
      codeMuted: "#8a8f98",
      codeCurrent: "#3d4c58",
      codeCurrentText: "#f5f6f9",
      codePage: "#3d464a",
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
};
