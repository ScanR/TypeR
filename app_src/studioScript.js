// A script sent by TypeR Studio (Open in Photoshop, "Import the script"):
// Studio writes one file, TypeR/Studio/script.json in the user's application
// data folder, then opens the pages in Photoshop. The panel takes it as soon
// as it sees it (a document opened, the panel started, shown or focused):
// the tab that already holds the same text becomes current, or a new tab
// does. The file is removed before the script is used, so it is taken once.

import React from "react";
import { csInterface } from "./utils";

const FROM = "TypeR Studio";
// Pages opened in a Photoshop that had no TypeR panel open: the script still
// waits for the panel that day, never for a later session
const MAX_AGE = 6 * 60 * 60 * 1000;
const NAME_LIMIT = 200;
// The file is read on every focus of the panel: a check that cheap may run
// often, but never twice at once
const CHECK_GAP = 400;

const normalizeLineBreaks = (text) => String(text).replace(/\r\n?/g, "\n");

// The file's script, { name, text }, or null when it can't be used: not from
// Studio, empty, from too long ago
const parseStudioScript = (raw, now = Date.now()) => {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return null;
  }
  if (!value || typeof value !== "object" || value.from !== FROM || value.version !== 1) return null;
  if (typeof value.text !== "string" || !value.text.trim()) return null;
  const sent = Number(value.sent);
  // A minute ahead allows for a clock that moved
  if (!Number.isFinite(sent) || now - sent > MAX_AGE || sent - now > 60 * 1000) return null;
  const name = typeof value.name === "string" ? value.name.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT) : "";
  return { name, text: normalizeLineBreaks(value.text) };
};

// The tab that already holds this text, or null. Line breaks and the blank
// lines around it don't count, as when the tour looks for its practice tab.
const findScriptTab = (tabs, text) => {
  const wanted = normalizeLineBreaks(text).trim();
  return (tabs || []).find((tab) => tab && typeof tab.text === "string" && normalizeLineBreaks(tab.text).trim() === wanted) || null;
};

// What to do with a script: { type: "switchTab", id } or the new tab to add
const scriptTabAction = (tabs, script, createId = () => "studio-" + Math.random().toString(36).substr(2, 8)) => {
  const existing = findScriptTab(tabs, script.text);
  if (existing) return { type: "switchTab", id: existing.id };
  const action = { type: "addTab", id: createId(), data: { text: script.text, currentLineIndex: 0 } };
  // Without a name, the tab names itself from its script (tabNames.js)
  if (script.name) action.name = script.name;
  return action;
};

const joinPath = (folder, ...names) => {
  const separator = folder.indexOf("\\") >= 0 ? "\\" : "/";
  return [folder.replace(/[\\/]+$/, "")].concat(names).join(separator);
};

// The folder TypeR and TypeR Studio share, <application data>/TypeR/Studio,
// or null where there is none (TypeR Studio itself runs this panel)
const studioFolder = () => {
  if (typeof window === "undefined" || window.__typerWeb) return null;
  if (window.typerUXP) {
    // UXP keeps its files in <application data>/TypeR/UXP
    const root = window.typerUXP.storageRoot;
    if (typeof root !== "string" || !/[\\/]UXP[\\/]*$/i.test(root)) return null;
    return joinPath(root.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, ""), "Studio");
  }
  try {
    const userData = csInterface.getSystemPath(window.SystemPath.USER_DATA);
    return userData ? joinPath(userData, "TypeR", "Studio") : null;
  } catch (error) {
    return null;
  }
};

// Where Studio leaves the script, or null
const studioScriptPath = () => {
  const folder = studioFolder();
  return folder ? joinPath(folder, "script.json") : null;
};

// The script waiting, taken off the disk, or null. CEP answers at once, UXP
// with a promise: both are awaited.
const takeStudioScript = async () => {
  const file = studioScriptPath();
  const fs = window.cep && window.cep.fs;
  if (!file || !fs) return null;
  const read = await fs.readFile(file);
  if (!read || read.err || typeof read.data !== "string") return null;
  // Removed first: another check, or the other TypeR, must not take it too.
  // A file that can't be removed is left, and its script not used.
  const removed = await fs.deleteFile(file);
  if (removed && removed.err && removed.err !== (fs.ERR_NOT_FOUND || 3)) return null;
  return parseStudioScript(read.data);
};

// Looks for a script when Photoshop opens a document (CEP:
// documentAfterActivate; UXP: the host's "open" listener, sent under the same
// name), when the panel starts, and when it's shown or focused.
const useStudioScript = (dispatch, getState) => {
  React.useEffect(() => {
    if (!studioScriptPath()) return undefined;
    let running = false;
    let last = 0;
    let stopped = false;
    let again = null;
    const check = async () => {
      if (stopped) return;
      const now = Date.now();
      // Asked again meanwhile: once more right after
      if (running || now - last < CHECK_GAP) {
        if (!again) again = setTimeout(() => { again = null; check(); }, CHECK_GAP);
        return;
      }
      running = true;
      last = now;
      try {
        const script = await takeStudioScript();
        if (script && !stopped) dispatch(scriptTabAction(getState().tabs, script));
      } catch (error) {
        console.warn("TypeR: script from TypeR Studio", error);
      } finally {
        running = false;
      }
    };
    const onVisible = () => {
      if (!document.hidden) check();
    };
    csInterface.addEventListener("documentAfterActivate", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    check();
    return () => {
      stopped = true;
      clearTimeout(again);
      csInterface.removeEventListener("documentAfterActivate", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
};

export {
  joinPath,
  studioFolder,
  parseStudioScript,
  findScriptTab,
  scriptTabAction,
  studioScriptPath,
  takeStudioScript,
  useStudioScript,
};
