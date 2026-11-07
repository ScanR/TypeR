// The panel only exists inside the WebView, so a WebView that never starts
// leaves an empty panel with nothing to tell why (WebView2 on Windows, whose
// runtime Photoshop's installer provides). The host page does not depend on it:
// it says so there, with what is needed to find the cause.
const PANEL_RETRY_MS = 5000;
const PANEL_START_LIMIT_MS = 15000;

// Where Adobe's installer and Microsoft's put the WebView2 runtime (per machine)
const WINDOWS_WEBVIEW_FOLDERS = [
  "C:\\Program Files\\Common Files\\Adobe\\Microsoft\\EdgeWebView",
  "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application",
];

// Microsoft's installer also puts it in the profile when it runs without
// administrator rights
function windowsWebViewFolders(homedir) {
  const folders = WINDOWS_WEBVIEW_FOLDERS.slice();
  if (homedir) folders.push(String(homedir).replace(/[\\/]+$/, "") + "\\AppData\\Local\\Microsoft\\EdgeWebView\\Application");
  return folders;
}

// Microsoft's download page of the Evergreen WebView2 runtime
const WEBVIEW2_DOWNLOAD_URL = "https://developer.microsoft.com/microsoft-edge/webview2/";

// What Photoshop's UXP log says, 2 s after the panel opens, when no WebView2
// runtime can be started (reproduced with WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
// set to a missing folder: no load event ever reaches the host page, and the
// Home screen of Photoshop fails the same way). The log sits in
// <AppData>\Adobe\Adobe Photoshop <year>\Logs\UXPLogs_<date>_<time>_<n>.log,
// one file per Photoshop session.
const WEBVIEW_CREATION_FAILURE = "Failed to create WebView for plugin: ";
// The other lines of the same log that tell which runtime UXP tried and
// whether one started at all in the session (the version line only appears
// once a WebView runs; a session without it never started any)
const RUNTIME_FOLDER_LINE = "UXP will use the WebView2 runtime in the folder: ";
const BROWSER_VERSION_LINE = "WebView2BrowserVersion:";
const UXP_LOG_NAME = /^UXPLogs_.*\.log$/i;
const PHOTOSHOP_FOLDER = /^Adobe Photoshop/i;
// Photoshop's own WebView plugins, named for the user when they fail too
const ADOBE_WEBVIEW_PLUGINS = { "com.adobe.ccx.start": "Home screen" };

// What each folder holds: Microsoft's keep one folder per version, Adobe's
// copy has the runtime's files directly inside (msedgewebview2.exe)
async function readWebViewFolders(readFolder, folders = WINDOWS_WEBVIEW_FOLDERS) {
  const lines = [];
  for (const folder of folders) {
    let content = "missing";
    try {
      const names = await readFolder(folder);
      const found = names.filter((name) => /^\d/.test(name) || /^msedgewebview2\.exe$/i.test(name));
      content = found.join(", ") || "no runtime inside";
    } catch (error) {}
    lines.push(folder + ": " + content);
  }
  return lines;
}

// The newest UXP log of any Photoshop is the running session's (the names
// carry the date and time). Resolves to its path, or null when there is none.
async function findNewestUxpLog({ listFolder, appData }) {
  const adobe = String(appData) + "\\Adobe";
  const folders = (await listFolder(adobe)).filter((entry) => entry.isFolder && PHOTOSHOP_FOLDER.test(entry.name));
  let newest = null;
  for (const folder of folders) {
    let logs = [];
    try { logs = await listFolder(adobe + "\\" + folder.name + "\\Logs"); } catch (error) { continue; }
    for (const entry of logs) {
      if (entry.isFolder || !UXP_LOG_NAME.test(entry.name)) continue;
      if (!newest || entry.name > newest.name) newest = { name: entry.name, path: adobe + "\\" + folder.name + "\\Logs\\" + entry.name };
    }
  }
  return newest;
}

const afterMarker = (line, marker) => line.slice(line.indexOf(marker) + marker.length).trim();

// What the running session's UXP log says about WebViews: the line about this
// plugin's WebView (failure, or null), the runtime folder UXP chose, the
// version that started (null when none did in the whole session) and the
// other plugins whose WebView failed. Null when the log cannot be read.
async function readUxpLogFacts({ listFolder, readText, appData, pluginId }) {
  try {
    const newest = await findNewestUxpLog({ listFolder, appData });
    if (!newest) return null;
    const facts = { file: newest.path, name: newest.name, failure: null, runtimeFolder: null, browserVersion: null, failedPlugins: [] };
    const needle = WEBVIEW_CREATION_FAILURE + String(pluginId);
    const lines = String(await readText(newest.path)).split(/\r?\n/);
    for (const raw of lines) {
      // The Home screen's console output goes to the same log, with anything
      const line = raw.trim();
      if (line.indexOf("[console]") !== -1) continue;
      if (line.indexOf(needle) !== -1) facts.failure = line;
      else if (line.indexOf(WEBVIEW_CREATION_FAILURE) !== -1) {
        const plugin = afterMarker(line, WEBVIEW_CREATION_FAILURE);
        if (plugin && facts.failedPlugins.indexOf(plugin) === -1) facts.failedPlugins.push(plugin);
      } else if (line.indexOf(RUNTIME_FOLDER_LINE) !== -1) facts.runtimeFolder = afterMarker(line, RUNTIME_FOLDER_LINE);
      else if (line.indexOf(BROWSER_VERSION_LINE) !== -1) facts.browserVersion = afterMarker(line, BROWSER_VERSION_LINE) || facts.browserVersion;
    }
    return facts;
  } catch (error) {
    return null;
  }
}

// The plugin's own failure line, with the facts around it, or null
async function findWebViewCreationFailure(reader) {
  const facts = await readUxpLogFacts(reader);
  if (!facts || !facts.failure) return null;
  return Object.assign({ file: facts.file, line: facts.failure }, facts);
}

// UXP refuses every third-party WebView while its WebView data storage does
// not exist (WebViewManager::createWebView, docs/uxp-webview-refused.md). The
// line does not name the plugin: any refusal means TypeR's WebView will not come.
const WEBVIEW_STORAGE_REFUSAL = "failed to create WebView because webViewDataStorage_ is not available";
// "[2026-11-07_19-25-25][2984][Warn] ...": the local time of the line
const LOG_STAMP = /^\[(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\]/;

function logLineTime(line) {
  const match = LOG_STAMP.exec(String(line));
  if (!match) return null;
  return new Date(+match[1], match[2] - 1, +match[3], +match[4], +match[5], +match[6]).getTime();
}

// The newest line of the running session's UXP log, written at or after
// `since` (ms, a second's tolerance: the log has whole seconds), by which
// UXP refused a WebView TypeR asked for: its storage refusal, or the failure
// line naming TypeR. Null when there is none or the log cannot be read.
async function findWebViewRefusalSince({ listFolder, readText, appData, pluginId, since }) {
  try {
    const newest = await findNewestUxpLog({ listFolder, appData });
    if (!newest) return null;
    const failure = WEBVIEW_CREATION_FAILURE + String(pluginId);
    const lines = String(await readText(newest.path)).split(/\r?\n/);
    let found = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.indexOf("[console]") !== -1) continue;
      const storage = line.indexOf(WEBVIEW_STORAGE_REFUSAL) !== -1;
      if (!storage && line.indexOf(failure) === -1) continue;
      const time = logLineTime(line);
      if (time === null || time < since - 1000) continue;
      found = { file: newest.path, line, kind: storage ? "storage" : "creation" };
    }
    return found;
  } catch (error) {
    return null;
  }
}

// What the log line means, and the remedy, for the user
function webViewFailureText(webViewFailure, french) {
  const head = french
    ? "Photoshop n’a pas pu créer la WebView qui affiche TypeR (son journal UXP dit : « " + webViewFailure.line + " »). Inutile d’attendre."
    : "Photoshop could not create the WebView that displays TypeR (its UXP log says: “" + webViewFailure.line + "”). There is nothing to wait for.";
  const remedy = french
    ? "Le composant Microsoft Edge WebView2 est absent, endommagé ou trop ancien pour cette version de Photoshop (une version antérieure de Photoshop peut s’en contenter). Installez-le avec le bouton Installer WebView2 (l’installateur de Microsoft, qui le tient à jour), puis redémarrez Photoshop. Le réparer dans Creative Cloud ou réinstaller Photoshop le remet aussi en place."
    : "The Microsoft Edge WebView2 component is missing, damaged or too old for this version of Photoshop (an earlier Photoshop may still accept it). Install it with the Install WebView2 button (Microsoft’s installer, which keeps it up to date), then restart Photoshop. Repairing Photoshop in Creative Cloud, or reinstalling it, also puts it back.";
  const lines = [head, remedy];
  // Where Photoshop looked, so that the user (and support) can check the folder
  if (webViewFailure.runtimeFolder) {
    lines.push(french
      ? "Photoshop cherche ce composant dans : " + webViewFailure.runtimeFolder
      : "Photoshop looks for this component in: " + webViewFailure.runtimeFolder);
  }
  const others = (webViewFailure.failedPlugins || []).filter((plugin) => ADOBE_WEBVIEW_PLUGINS[plugin]);
  if (others.length) {
    const names = others.map((plugin) => ADOBE_WEBVIEW_PLUGINS[plugin]).join(", ");
    lines.push(french
      ? "Ce n’est pas propre à TypeR : Photoshop n’a pas pu afficher non plus " + names + "."
      : "This is not specific to TypeR: Photoshop could not display its " + names + " either.");
  }
  return lines.join("\n");
}

// The facts read in the UXP log, as lines of the report
function uxpLogLines(logFacts) {
  if (!logFacts) return ["UXP log: not found"];
  const lines = ["UXP log: " + (logFacts.name || logFacts.file)];
  lines.push("Runtime folder UXP uses: " + (logFacts.runtimeFolder || "the system's (no folder line)"));
  lines.push("WebView2 started in this Photoshop session: " + (logFacts.browserVersion || "none"));
  if (logFacts.failedPlugins && logFacts.failedPlugins.length) lines.push("WebView failed for other plugins: " + logFacts.failedPlugins.join(", "));
  return lines;
}

// The report under the notice; the guess at the top is left out once the log
// told the cause (webViewFailureText, placed by the host page under its title)
function panelStartFailureText({ versions, webViewFolders, loadEvents, viewSize, webViewFailure = null, logFacts = webViewFailure }) {
  const lines = webViewFailure ? [] : [
    "TypeR could not open: Photoshop's WebView, which displays the panel, did not answer.",
    "The Legacy version may still work: Window > Extensions > TypeR (CEP).",
  ];
  return lines.concat([
    "Please send this to the TypeR Discord:",
    versions,
    "View: " + viewSize,
    "Loads: " + (loadEvents.length ? loadEvents.join(" | ") : "none"),
  ]).concat(uxpLogLines(logFacts)).concat(webViewFolders).join("\n");
}

module.exports = {
  PANEL_RETRY_MS, PANEL_START_LIMIT_MS, WINDOWS_WEBVIEW_FOLDERS, WEBVIEW2_DOWNLOAD_URL, WEBVIEW_CREATION_FAILURE,
  WEBVIEW_STORAGE_REFUSAL, logLineTime, findWebViewRefusalSince,
  windowsWebViewFolders, readWebViewFolders, findNewestUxpLog, readUxpLogFacts, findWebViewCreationFailure,
  webViewFailureText, uxpLogLines, panelStartFailureText,
};
