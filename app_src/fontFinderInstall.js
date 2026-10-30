import { fetchBody } from "./network";
import { FONT_VIEWER_API_BASE, getDownloadManifest } from "./fontViewerApi";
import { installFontFiles } from "./fontInstaller";
import { refreshUserFonts } from "./utils";

// Downloads Font FindeR files and installs them. Shared by the Font FindeR
// viewer and the missing font suggestions (FontScanR, style import).

const DOWNLOAD_CONCURRENCY = 3;
const INSTALLED_STORAGE_KEY = "typer.fontViewer.installed.v1";

const safeFileName = (name, fallback = "font") => {
  const clean = String(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return clean || fallback;
};

const makeUniqueFileNames = (fonts) => {
  const used = new Set();
  return (fonts || []).map((font) => {
    const original = safeFileName(font.file_name, `${font.name || font.id}.otf`);
    const dot = original.lastIndexOf(".");
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const ext = dot > 0 ? original.slice(dot) : "";
    let name = original;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix += 1) name = `${stem}-${suffix}${ext}`;
    used.add(name.toLowerCase());
    return { ...font, saveName: name };
  });
};

const fetchWithConcurrency = async (items, worker, limit = DOWNLOAD_CONCURRENCY) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

// Resolves the original files for the given fonts and fetches their bytes.
// onProgress(completed, total) runs after each file.
const fetchFontFinderFiles = async (fonts, onProgress) => {
  let manifestFonts;
  if (fonts.length === 1) {
    const font = fonts[0];
    manifestFonts = [{ ...font, download_url: `${FONT_VIEWER_API_BASE}/fonts/${Number(font.id)}/file?original=1` }];
  } else {
    const manifest = await getDownloadManifest(fonts.map((font) => font.id));
    manifestFonts = manifest.fonts || [];
  }
  const namedFonts = makeUniqueFileNames(manifestFonts);
  let completed = 0;
  return fetchWithConcurrency(namedFonts, async (font) => {
    const bytes = new Uint8Array(await fetchBody(font.download_url, { headers: { Accept: "application/octet-stream" } }, "arrayBuffer", 60000));
    completed += 1;
    if (onProgress) onProgress(completed, namedFonts.length);
    return { id: font.id, name: font.saveName, displayName: font.name || font.family || font.saveName, bytes };
  });
};

const readInstalledFontIds = () => {
  try {
    const raw = window.localStorage && window.localStorage.getItem(INSTALLED_STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch (e) {
    return [];
  }
};

// Keeps the viewer's "installed" badges in sync with installs made elsewhere
const rememberInstalledFontIds = (ids) => {
  try {
    if (!window.localStorage) return;
    const all = Array.from(new Set(readInstalledFontIds().map(String).concat((ids || []).map(String))));
    window.localStorage.setItem(INSTALLED_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    // The installed badges are a convenience; losing them is harmless.
  }
};

// The files are fully registered at this point; ask Photoshop to rescan its
// font list (app.refreshFonts) so the new fonts appear without a restart,
// with one delayed backstop (one-shot, not a recurring re-enumeration).
const scheduleFontRefresh = (onFonts) => {
  window.setTimeout(() => refreshUserFonts(onFonts || null, true), 1500);
  window.setTimeout(() => refreshUserFonts(onFonts || null, true), 10000);
};

// Installs every variant of the given Font FindeR families (deduplicated).
// Resolves to the installed files.
const installFontFinderFamilies = async (families, onProgress, onFonts) => {
  const seen = new Set();
  const fonts = [];
  (families || []).forEach((family) => {
    ((family && family.fonts) || []).forEach((font) => {
      if (!font || seen.has(font.id)) return;
      seen.add(font.id);
      fonts.push(font);
    });
  });
  if (!fonts.length) return [];
  const files = await fetchFontFinderFiles(fonts, onProgress);
  await installFontFiles(files.map((file) => ({ saveName: file.name, displayName: file.displayName, bytes: file.bytes })));
  rememberInstalledFontIds(files.map((file) => file.id));
  scheduleFontRefresh(onFonts);
  return files;
};

export {
  INSTALLED_STORAGE_KEY,
  fetchFontFinderFiles,
  fetchWithConcurrency,
  installFontFinderFamilies,
  makeUniqueFileNames,
  readInstalledFontIds,
  rememberInstalledFontIds,
  safeFileName,
  scheduleFontRefresh,
};
