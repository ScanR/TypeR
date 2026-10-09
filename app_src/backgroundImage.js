// Custom background image ("Custom image" theme).
//
// The picture itself is kept in its own file next to the storage file instead
// of inside it: the main storage is rewritten on every text edit, and dragging
// a megabyte of base64 through JSON.stringify on each keystroke would be felt
// immediately in the text block.

import { getActiveProfileAssetPath } from "./profileStorage";
import { clamp, clamp01 } from "./themeColors";

const assetPath = getActiveProfileAssetPath("background");

// Source pictures are re-encoded before being stored so a 12 MP photo does not
// end up as a 15 MB base64 string that has to be parsed at every panel start.
const MAX_STORED_SIZE = 2000;
const STORED_QUALITY = 0.86;

const DEFAULT_CROP = { zoom: 1, x: 0.5, y: 0.5 };

let dataCache;

const normalizeCrop = (raw) => {
  const crop = raw && typeof raw === "object" ? raw : {};
  return {
    zoom: clamp(Number.isFinite(crop.zoom) ? crop.zoom : 1, 1, 4),
    x: clamp01(Number.isFinite(crop.x) ? crop.x : 0.5),
    y: clamp01(Number.isFinite(crop.y) ? crop.y : 0.5),
  };
};

const normalizeBackgroundImage = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const width = parseInt(raw.width, 10);
  const height = parseInt(raw.height, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    width,
    height,
    crop: normalizeCrop(raw.crop),
    opacity: clamp(Number.isFinite(raw.opacity) ? raw.opacity : 0.55, 0.05, 1),
    blur: clamp(Number.isFinite(raw.blur) ? raw.blur : 0, 0, 24),
    tint: clamp(Number.isFinite(raw.tint) ? raw.tint : 0.45, 0, 0.95),
    mode: raw.mode === "light" ? "light" : "dark",
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
};

const readBackgroundImageData = () => {
  if (dataCache !== undefined) return dataCache;
  const result = window.cep.fs.readFile(assetPath);
  dataCache = !result || result.err || !result.data ? null : String(result.data);
  return dataCache;
};

const writeBackgroundImageData = (dataUrl) => {
  const result = window.cep.fs.writeFile(assetPath, dataUrl);
  if (result && result.err) return false;
  dataCache = dataUrl;
  return true;
};

const clearBackgroundImageData = () => {
  window.cep.fs.deleteFile(assetPath);
  dataCache = null;
};

const loadImageElement = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("decodeFailed"));
    image.src = dataUrl;
  });

const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  gif: "image/gif",
};

// Reads a picture from disk through the CEP file API and returns a re-encoded,
// size-capped data URL together with its final dimensions.
const importImageFile = async (filePath) => {
  const extension = String(filePath).split(".").pop().toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new Error("unsupportedFormat");
  const result = await window.cep.fs.readFile(filePath, window.cep.encoding.Base64);
  if (!result || result.err || !result.data) throw new Error("readFailed");

  const source = await loadImageElement(`data:${mime};base64,${result.data}`);
  const scale = Math.min(1, MAX_STORED_SIZE / Math.max(source.naturalWidth, source.naturalHeight));
  const width = Math.max(1, Math.round(source.naturalWidth * scale));
  const height = Math.max(1, Math.round(source.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  // JPEG has no alpha: flatten on white so transparent PNGs keep readable
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", STORED_QUALITY),
    width,
    height,
    name: String(filePath).split(/[\\/]/).pop(),
  };
};

// Background-size / background-position for a "cover" fit zoomed by crop.zoom
// and re-centered by crop.x / crop.y. Used both by the live panel background
// and by the crop preview, so what the editor shows is what the panel gets.
const computeBackgroundLayout = (boxWidth, boxHeight, imageWidth, imageHeight, rawCrop) => {
  const crop = normalizeCrop(rawCrop);
  if (!boxWidth || !boxHeight || !imageWidth || !imageHeight) {
    return { backgroundSize: "cover", backgroundPosition: "center", maxOffsetX: 0, maxOffsetY: 0 };
  }
  const coverScale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
  const scale = coverScale * crop.zoom;
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  const maxOffsetX = Math.max(0, width - boxWidth);
  const maxOffsetY = Math.max(0, height - boxHeight);
  return {
    backgroundSize: `${Math.round(width)}px ${Math.round(height)}px`,
    backgroundPosition: `${Math.round(-maxOffsetX * crop.x)}px ${Math.round(-maxOffsetY * crop.y)}px`,
    maxOffsetX,
    maxOffsetY,
  };
};

export {
  DEFAULT_CROP,
  normalizeCrop,
  normalizeBackgroundImage,
  readBackgroundImageData,
  writeBackgroundImageData,
  clearBackgroundImageData,
  importImageFile,
  computeBackgroundLayout,
};
