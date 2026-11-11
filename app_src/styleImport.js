import { strFromU8, unzipSync } from "fflate";

import { serializeStyle, validateImportData } from "./librarySerialization";
import { NO_TEXT_PRESETS, toolPresetFileToImportData } from "./toolPresetImport";
import { collectMissingStyleFonts } from "./fontFinderMatch";
import { installFontFiles, isFontInstallSupported } from "./fontInstaller";
import { safeFileName, scheduleFontRefresh } from "./fontFinderInstall";
import { getStyleImportReporter } from "./styleImportReporter";
import { backupStorage, getUserFonts, locale, nativeAlert, nativeConfirm } from "./utils";

// Style import shared by the settings (Data tab), the styles context menu and
// the style creation window. It reads the TypeR folder exports (.json, or the
// .zip that carries the fonts too), whole style libraries and Photoshop tool
// presets (.tpl). The settings keep their own branch for full backups.

const STYLE_IMPORT_EXTENSIONS = ["json", "zip", "tpl"];
const FONT_FILE_RE = /\.(ttf|otf|ttc)$/i;

const newId = () => Math.random().toString(36).substring(2, 8);

const base64ToBytes = (base64) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const readFileOrThrow = async (path, encoding) => {
  const result = await window.cep.fs.readFile(path, encoding);
  if (!result || result.err) throw new Error("read");
  return result.data;
};

// The .zip made by "Export with fonts": one .json at its root, the font files
// under fonts/
const readStyleArchive = (bytes) => {
  const entries = unzipSync(bytes, {
    filter: (entry) => /\.json$/i.test(entry.name) || FONT_FILE_RE.test(entry.name),
  });
  const names = Object.keys(entries);
  const jsonName = names.find((name) => /\.json$/i.test(name) && name.indexOf("/") === -1)
    || names.find((name) => /\.json$/i.test(name) && !/^__MACOSX\//.test(name));
  if (!jsonName) throw new Error("zip: no style file");
  const fontFiles = names
    .filter((name) => FONT_FILE_RE.test(name) && !/^__MACOSX\//.test(name) && entries[name].length)
    .map((name) => ({ name: name.split("/").pop(), bytes: entries[name] }));
  return { data: JSON.parse(strFromU8(entries[jsonName])), fontFiles };
};

// Resolves to { data, fontFiles } or throws: NO_TEXT_PRESETS for a .tpl
// without text presets, anything else for an unreadable file
const readStyleImportFile = async (path) => {
  if (/\.tpl$/i.test(path)) {
    const base64 = await readFileOrThrow(path, window.cep.encoding.Base64);
    return { data: validateImportData(toolPresetFileToImportData(base64, path)), fontFiles: [] };
  }
  if (/\.zip$/i.test(path)) {
    const base64 = await readFileOrThrow(path, window.cep.encoding.Base64);
    const archive = readStyleArchive(base64ToBytes(base64));
    return { data: validateImportData(archive.data), fontFiles: archive.fontFiles };
  }
  const text = await readFileOrThrow(path);
  return { data: validateImportData(JSON.parse(text)), fontFiles: [] };
};

const importedStyle = (style, folder, importedAt) => ({
  ...serializeStyle(style),
  id: newId(),
  name: style.name,
  folder,
  textType: style.textType || "inherit",
  textProps: style.textProps,
  prefixes: style.prefixes || [],
  prefixColor: style.prefixColor,
  stroke: style.stroke,
  edited: importedAt,
});

// A folder export ({ name, exportedStyles }): one new folder at the root
const buildFolderImport = (data) => {
  const folderId = newId();
  const importedAt = Date.now();
  return {
    folder: { id: folderId, name: data.name },
    styles: data.exportedStyles.map((style) => importedStyle(style, folderId, importedAt)),
  };
};

// A whole library ({ folders, styles }): every folder gets a new id
const buildLibraryImport = (data) => {
  const idMap = {};
  (data.folders || []).forEach((folder) => {
    idMap[folder.id] = newId();
  });
  const folders = (data.folders || []).map((folder) => ({
    id: idMap[folder.id],
    name: folder.name,
    parentId: folder.parentId ? idMap[folder.parentId] || null : null,
    order: typeof folder.order === "number" ? folder.order : undefined,
  }));
  const importedAt = Date.now();
  const styles = (data.styles || []).map((style) => importedStyle(style, style.folder ? idMap[style.folder] || null : null, importedAt));
  return { folders, styles };
};

const describeImportError = (error) =>
  error && error.message === NO_TEXT_PRESETS ? locale.importTplNoText : locale.importStyleError || locale.errorImportStyles;

// Picks style files and imports the styles they hold, never the settings a
// full backup also carries. Resolves to null when nothing was imported.
const importStyleFiles = async (dispatch) => {
  const pathSelect = await window.cep.fs.showOpenDialogEx(true, false, null, null, STYLE_IMPORT_EXTENSIONS);
  if (!pathSelect?.data?.length) return null;
  let backedUp = false;
  let folders = 0;
  const styles = [];
  const fontFiles = [];
  for (const path of pathSelect.data) {
    let file;
    try {
      file = await readStyleImportFile(path);
    } catch (error) {
      nativeAlert(describeImportError(error), locale.errorTitle, true);
      continue;
    }
    const { data } = file;
    let action;
    if (data.exportedStyles) action = { type: "importStyleFolder", ...buildFolderImport(data) };
    else if (Array.isArray(data.styles) && data.styles.length) action = { type: "importStyleLibrary", ...buildLibraryImport(data) };
    else {
      nativeAlert(locale.importStyleNoStyles || locale.errorImportStyles, locale.errorTitle, true);
      continue;
    }
    if (data.incomplete) nativeAlert(locale.importTplPartial, locale.errorTitle, true);
    if (!backedUp) {
      if (!backupStorage()) {
        nativeAlert(locale.storageWarning, locale.errorTitle, true);
        break;
      }
      backedUp = true;
    }
    dispatch(action);
    styles.push(...action.styles);
    folders += action.folders ? action.folders.length : 1;
    fontFiles.push(...file.fontFiles);
  }
  return folders ? { folders, styles, fontFiles } : null;
};

const installArchiveFonts = async (fontFiles, onFonts) => {
  const used = new Set();
  const files = fontFiles.map((file) => {
    const original = safeFileName(file.name, "font.otf");
    const dot = original.lastIndexOf(".");
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const ext = dot > 0 ? original.slice(dot) : "";
    let saveName = original;
    for (let suffix = 2; used.has(saveName.toLowerCase()); suffix += 1) saveName = `${stem}-${suffix}${ext}`;
    used.add(saveName.toLowerCase());
    return { saveName, displayName: stem, bytes: file.bytes };
  });
  const count = await installFontFiles(files);
  scheduleFontRefresh(onFonts);
  return count;
};

// After an import: offers the fonts of a .zip when some are missing here,
// otherwise lists the missing fonts (Font FindeR) or confirms the import.
// reporter: { showMissingFonts({ fonts, message }), onFonts(fonts) }, by
// default the styles block (styleImportReporter.js)
const reportStyleImport = (result, reporter) => {
  if (!result) return;
  const target = reporter || getStyleImportReporter() || {};
  const message = result.folders > 1 ? locale.importFoldersSuccess : locale.importFolderSuccess;
  // An empty list means Photoshop's fonts are not known yet: no warning
  const installedFonts = getUserFonts();
  const missingFonts = installedFonts.length ? collectMissingStyleFonts(result.styles, installedFonts) : [];
  const showMissing = () => {
    if (missingFonts.length && target.showMissingFonts) target.showMissingFonts({ fonts: missingFonts, message });
    else nativeAlert(message, locale.successTitle, false);
  };
  if (!missingFonts.length || !result.fontFiles.length || !isFontInstallSupported()) {
    showMissing();
    return;
  }
  const question = (locale.importStyleInstallFonts || "This archive contains {count} font file(s) and some of its fonts are missing on this computer. Install them?")
    .replace("{count}", result.fontFiles.length);
  nativeConfirm(message + "\n\n" + question, locale.confirmTitle, (ok) => {
    if (!ok) {
      showMissing();
      return;
    }
    installArchiveFonts(result.fontFiles, target.onFonts).then(
      (count) => nativeAlert(locale.fontViewerInstalled.replace("{count}", count), locale.successTitle, false),
      () => nativeAlert(locale.fontViewerInstallError, locale.errorTitle, true)
    );
  });
};

export {
  STYLE_IMPORT_EXTENSIONS,
  buildFolderImport,
  buildLibraryImport,
  describeImportError,
  importStyleFiles,
  readStyleImportFile,
  reportStyleImport,
};
