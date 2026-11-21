import { contrastText, isValidColor, toHex } from "./themeColors";

const STYLE_BG_PALETTE_COUNT = 10;

const hslToHex = (hue, saturation, lightness) => {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const l = Math.max(0, Math.min(100, lightness)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return toHex({
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  });
};

// Generates distinct, well-balanced random hex colors across the hue wheel
// so the style background selector always starts with 10 usable palettes.
const generateRandomBackgroundPalettes = (count = STYLE_BG_PALETTE_COUNT, rng = Math.random) => {
  const size = Math.max(1, Math.floor(Number(count) || STYLE_BG_PALETTE_COUNT));
  const baseHue = rng() * 360;
  const step = 360 / size;
  const palette = [];

  for (let i = 0; i < size; i += 1) {
    const jitter = (rng() - 0.5) * step * 0.65;
    const hue = (baseHue + i * step + jitter + 360) % 360;
    const saturation = 48 + rng() * 30;
    const lightness = 30 + rng() * 38;
    palette.push(hslToHex(hue, saturation, lightness));
  }

  for (let i = palette.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = palette[i];
    palette[i] = palette[j];
    palette[j] = temp;
  }

  return palette;
};

const normalizeStyleBackgroundColor = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || !isValidColor(trimmed)) return "";
  return toHex(trimmed);
};

const getStyleItemColors = (value) => {
  const backgroundColor = normalizeStyleBackgroundColor(value);
  if (!backgroundColor) return null;
  return {
    backgroundColor,
    color: contrastText(backgroundColor),
  };
};

export {
  STYLE_BG_PALETTE_COUNT,
  generateRandomBackgroundPalettes,
  getStyleItemColors,
  hslToHex,
  normalizeStyleBackgroundColor,
};
