// Open in TypeR Studio: the current document, or all the open ones, go on in
// TypeR Studio, the desktop app, with the current script if asked. Each
// document is a file first: a PSD with unsaved changes is saved, the others
// become PSDs in a folder the user picks (and are those files from then on),
// except a picture TypeR Studio opens as it is. The panel then leaves
// <application data>/TypeR/Studio/open.json and opens typer-studio://open,
// which TypeR Studio answers by taking that file. Without TypeR Studio, the
// panel offers to download it.

import { csInterface, safeJsonParse } from "./utils";
import { getNode } from "./uxpMigration";
import { joinPath, studioFolder } from "./studioScript";

const LINK = "typer-studio://open";
const DOWNLOADS = {
  macArm: "https://github.com/ScanR/TypeR-Studio/releases/latest/download/TypeR-Studio-arm64.dmg",
  macIntel: "https://github.com/ScanR/TypeR-Studio/releases/latest/download/TypeR-Studio-x64.dmg",
  windows: "https://github.com/ScanR/TypeR-Studio/releases/latest/download/TypeR-Studio-Setup.exe",
};
const PSD_FILE = /\.ps[db]$/i;
// What TypeR Studio opens as it is, when Photoshop has nothing more to save
const PICTURE_FILE = /\.(png|jpe?g|webp)$/i;

const evalHost = (script) => new Promise((resolve) => csInterface.evalScript(script, resolve));
const nodeRequire = () => (window.cep_node && window.cep_node.require) || (typeof window.require === "function" ? window.require : null);
const parentOf = (path) => String(path).replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
const isWindowsPath = (path) => /^[A-Za-z]:[\\/]/.test(path) || String(path).indexOf("\\") >= 0;

// Available where the shared folder is: not in TypeR Studio itself
const studioAvailable = () => !!studioFolder();

// Inside TypeR Studio's desktop app, the same button goes the other way:
// Studio's own Open in Photoshop, which it lends the panel (web/bridge.js)
const photoshopFromStudio = () => {
  const host = typeof window !== "undefined" ? window.__typerWeb : null;
  return host && typeof host.openInPhotoshop === "function" ? host.openInPhotoshop : null;
};

// The button to the other app: TypeR Studio from Photoshop, Photoshop from TypeR Studio
const otherAppAvailable = () => studioAvailable() || !!photoshopFromStudio();

const pathExists = async (path) => {
  if (window.typerUXP && window.typerUXP.request) {
    try {
      return !!(await window.typerUXP.request("stat", path)).exists;
    } catch (error) {
      return false;
    }
  }
  try {
    const result = window.cep.fs.stat(path);
    return !!result && result.err === 0;
  } catch (error) {
    return false;
  }
};

// Where TypeR Studio can be: where it said it is (it notes its place in the
// shared folder each time it starts), then where its installers put it
const studioPlaces = async (folder) => {
  const places = [];
  const note = await Promise.resolve(window.cep.fs.readFile(joinPath(folder, "app.json")));
  const noted = note && !note.err ? safeJsonParse(note.data, null) : null;
  if (noted && typeof noted.path === "string" && noted.path) places.push(noted.path);
  const appData = parentOf(parentOf(folder));
  if (isWindowsPath(folder)) {
    const programs = joinPath(parentOf(appData), "Local", "Programs");
    places.push(joinPath(programs, "typer-studio", "TypeR Studio.exe"), joinPath(programs, "TypeR Studio", "TypeR Studio.exe"));
  } else {
    const home = appData.replace(/\/Library\/Application Support$/i, "");
    places.push("/Applications/TypeR Studio.app", joinPath(home, "Applications", "TypeR Studio.app"));
  }
  return places;
};

const isStudioInstalled = async () => {
  const folder = studioFolder();
  if (!folder) return false;
  for (const place of await studioPlaces(folder)) {
    if (await pathExists(place)) return true;
  }
  return false;
};

// This computer's TypeR Studio download
const studioDownloadUrl = () => {
  const folder = studioFolder() || "";
  const platform = (window.typerUXP && window.typerUXP.platform) || "";
  if (platform === "win32" || (!platform && isWindowsPath(folder))) return DOWNLOADS.windows;
  let arch = window.typerUXP && window.typerUXP.arch;
  if (!arch) {
    try {
      // As the UXP host does: the processor's name, then what Node says
      const require = nodeRequire();
      const model = require ? String((require("os").cpus()[0] || {}).model || "") : "";
      arch = /apple/i.test(model) ? "arm64" : /intel/i.test(model) ? "x64" : require && require("process").arch;
    } catch (error) {}
  }
  return arch === "x64" ? DOWNLOADS.macIntel : DOWNLOADS.macArm;
};

const listStudioDocuments = async () => {
  const list = safeJsonParse(await evalHost("getStudioDocuments()"), []);
  return Array.isArray(list) ? list : [];
};

// What each document needs before TypeR Studio can open it: nothing (its
// file as it is), a save in place, or a new PSD
const planStudioDocuments = (documents) => documents.map((doc) => {
  const path = typeof doc.path === "string" ? doc.path : "";
  if (path && PSD_FILE.test(path)) return { doc, step: doc.saved ? "ready" : "save" };
  if (path && PICTURE_FILE.test(path) && doc.saved) return { doc, step: "ready" };
  return { doc, step: "psd" };
});

const baseName = (name) => String(name || "").replace(/\.[^.]+$/, "") || "Untitled";

// Makes every document a file: [paths], or { error, name } for the first
// that could not be saved, or null when the folder choice was cancelled
const saveForStudio = async (documents, chooseFolder) => {
  const plan = planStudioDocuments(documents);
  const items = plan.filter((entry) => entry.step === "save").map((entry) => ({ id: entry.doc.id }));
  const needsPsd = plan.filter((entry) => entry.step === "psd");
  if (needsPsd.length) {
    const near = documents.map((doc) => doc.path).find(Boolean);
    const folder = await chooseFolder(near ? parentOf(near) : null);
    if (!folder) return null;
    needsPsd.forEach((entry) => items.push({ id: entry.doc.id, folder, name: baseName(entry.doc.name) }));
  }
  const saved = {};
  if (items.length) {
    const results = safeJsonParse(await evalHost("saveStudioDocuments(" + JSON.stringify(items) + ")"), []);
    for (const item of items) {
      const result = (Array.isArray(results) ? results : []).find((one) => one && one.id === item.id);
      const doc = documents.find((one) => one.id === item.id);
      if (!result || result.error || !result.path) return { error: (result && result.error) || "?", name: doc ? doc.name : "" };
      saved[item.id] = result.path;
    }
  }
  return plan.map((entry) => saved[entry.doc.id] || entry.doc.path);
};

// The request TypeR Studio takes when typer-studio://open reaches it
const writeStudioRequest = async (files, script) => {
  const folder = studioFolder();
  if (!folder) throw new Error("No shared folder");
  const request = { from: "TypeR", version: 1, sent: Date.now(), files };
  if (script && typeof script.text === "string" && script.text.trim()) request.script = { name: String(script.name || ""), text: script.text };
  if (!window.typerUXP) {
    // CEP writes no folder on its own; UXP's host makes the missing ones
    const require = nodeRequire();
    if (require) {
      const fs = require("fs");
      const path = require("path");
      const make = (directory) => {
        if (fs.existsSync(directory)) return;
        make(path.dirname(directory));
        fs.mkdirSync(directory);
      };
      make(folder);
    }
  }
  const result = await Promise.resolve(window.cep.fs.writeFile(joinPath(folder, "open.json"), JSON.stringify(request)));
  if (result && result.err) throw new Error("The request could not be written (" + result.err + ")");
};

// typer-studio://open. UXP opens it as any link (the manifest allows the
// scheme); CEP's own link opener only takes web addresses, so the system does.
const launchStudio = () => new Promise((resolve, reject) => {
  if (window.typerUXP) {
    Promise.resolve(window.cep.util.openURLInDefaultBrowser(LINK)).then(() => resolve(), reject);
    return;
  }
  const require = nodeRequire();
  if (!require) {
    reject(new Error("Node is not available"));
    return;
  }
  const { execFile } = require("child_process");
  const windows = require("process").platform === "win32";
  const [command, args] = windows ? ["cmd", ["/c", "start", "", LINK]] : ["/usr/bin/open", [LINK]];
  execFile(command, args, { windowsHide: true, timeout: 20000 }, (error) => (error ? reject(error) : resolve()));
});

export {
  DOWNLOADS,
  studioAvailable,
  photoshopFromStudio,
  otherAppAvailable,
  isStudioInstalled,
  studioDownloadUrl,
  listStudioDocuments,
  planStudioDocuments,
  saveForStudio,
  writeStudioRequest,
  launchStudio,
};
