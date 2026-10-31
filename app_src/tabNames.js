import { parsePageMarker } from "./pageMarker";

// A tab keeps following its content until the user renames it. Tabs saved
// before this flag existed follow it only under a default name like "Tab 3".
const MAX_LINE_NAME_LENGTH = 24;
const MIN_LINE_NAME_LETTERS = 8;
const MIN_SCRIPT_LINES = 3;
const HEADING_SEARCH_LINES = 15;

// Folders that say how the pages are stored, not what they are: the name is
// looked for one level up
const GENERIC_FOLDERS = new Set([
  "psd", "psds", "png", "pngs", "jpg", "jpeg", "raw", "raws", "clean", "cleans", "cleaned",
  "final", "finals", "typeset", "ts", "export", "exports", "output", "images", "pages", "scans",
  "new folder", "nouveau dossier", "untitled folder",
]);
// Pages sitting directly in these say nothing either. macOS and Windows keep
// their English names on disk whatever the language of the system.
const STOP_FOLDERS = new Set(["desktop", "downloads", "documents", "onedrive", "dropbox", "users", "home", "volumes"]);

// "Chapitre 105 : Les secrets de Lotte" gives "Chapitre 105". A separator or
// the end of the line must follow the number, so that dialogue does not match.
const CHAPTER_HEADING = /^(chapitre|chapter|chap|ch|cap[ií]tulo|capitolo|cap|kapitel|kap|b[öo]l[üu]m|ch[ưu][ơo]ng|глава|розділ|الفصل|[ée]pisode|ep)\.?\s*(?:n°|#)?\s*(\d+(?:[.,]\d+)?)\s*(?:[:.|–—-].*)?$/i;

const isDefaultTabName = (name, label) => {
  const match = /^(.*\S)\s+\d+$/.exec(String(name || ""));
  return !!match && (match[1] === label || match[1] === "Tab");
};

const getNextDefaultTabName = (tabs, label, taken = new Set((tabs || []).map((tab) => tab.name))) => {
  let number = 1;
  while (taken.has(label + " " + number)) number++;
  return label + " " + number;
};

const getPagesFolderName = (images) => {
  const folders = (images || []).map((image) => String((image && image.path) || "").split(/[\\/]/).slice(0, -1));
  if (!folders.length) return null;
  let depth = 0;
  while (depth < folders[0].length && folders.every((folder) => folder[depth] === folders[0][depth])) depth++;
  for (let i = depth - 1; i >= 0; i--) {
    const folder = folders[0][i].trim();
    const lower = folder.toLowerCase();
    const parent = i > 0 ? folders[0][i - 1].toLowerCase() : "";
    if (!folder || /^[a-z]:$/.test(lower) || STOP_FOLDERS.has(lower)) return null;
    // A user's home or a mounted disk
    if (parent === "users" || parent === "home" || parent === "volumes") return null;
    if (!GENERIC_FOLDERS.has(lower)) return folder;
  }
  return null;
};

const cleanHeadingLine = (line) => {
  let heading = line.trim().replace(/^#{1,6}\s*/, "").replace(/[*_~`\\]/g, "").trim();
  if (heading[0] === "[" && heading[heading.length - 1] === "]") heading = heading.slice(1, -1).trim();
  return heading;
};

const getChapterHeading = (rawLines) => {
  const lines = rawLines.filter((line) => line.trim()).slice(0, HEADING_SEARCH_LINES);
  for (let i = 0; i < lines.length; i++) {
    const match = CHAPTER_HEADING.exec(cleanHeadingLine(lines[i]));
    if (match) return match[1] + " " + match[2];
  }
  return null;
};

const shortenLine = (line) => {
  if (line.length <= MAX_LINE_NAME_LENGTH) return line;
  const cut = line.slice(0, MAX_LINE_NAME_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?…-]+$/, "") + "…";
};

// The first real sentence of a script, like an untitled editor tab. Reactions
// ("Ouah !") say little, and a script being typed has no stable first line yet.
const getFirstLineName = (rawLines, { ignorePrefixes = [], stylePrefixes = [] }) => {
  const lines = [];
  rawLines.forEach((rawLine) => {
    if (!rawLine.trim() || parsePageMarker(rawLine)) return;
    if (ignorePrefixes.some((prefix) => prefix && rawLine.startsWith(prefix))) return;
    const stylePrefix = stylePrefixes.reduce(
      (longest, prefix) => (prefix && prefix.length > longest.length && rawLine.startsWith(prefix) ? prefix : longest),
      rawLine.startsWith("//:") ? "//:" : rawLine.startsWith("//") ? "//" : ""
    );
    const line = rawLine.slice(stylePrefix.length).replace(/[*_~`\\]/g, "").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  });
  if (lines.length < MIN_SCRIPT_LINES) return null;
  const sentence = lines.find(
    (line) => line.replace(/[\s\d.,;:!?…'’"«»“”()[\]–—-]/g, "").length >= MIN_LINE_NAME_LETTERS
  );
  return sentence ? shortenLine(sentence) : null;
};

const getAutoTabName = (tab, options = {}) => {
  const rawLines = String(tab.text || "").split("\n");
  return getPagesFolderName(tab.images) || getChapterHeading(rawLines) || getFirstLineName(rawLines, options);
};

const followsContent = (tab, label) =>
  tab.autoName === true || (tab.autoName === undefined && isDefaultTabName(tab.name, label));

// Returns the same array when no name changes
const applyAutoTabNames = (tabs, { label, ...options }) => {
  // Names the user chose are never taken, whatever the order of the tabs
  const taken = new Set(tabs.filter((tab) => !followsContent(tab, label)).map((tab) => tab.name));
  let changed = false;
  const named = tabs.map((tab) => {
    if (!followsContent(tab, label)) return tab;
    const base = getAutoTabName(tab, options);
    let name;
    if (base) {
      name = base;
      for (let copy = 2; taken.has(name); copy++) name = base + " (" + copy + ")";
    } else {
      // Nothing to read yet: a number is kept rather than renumbered
      name = isDefaultTabName(tab.name, label) && !taken.has(tab.name) ? tab.name : getNextDefaultTabName(tabs, label, taken);
    }
    taken.add(name);
    if (name === tab.name) return tab;
    changed = true;
    return { ...tab, name, autoName: true };
  });
  return changed ? named : tabs;
};

export { applyAutoTabNames, getAutoTabName, getNextDefaultTabName };
