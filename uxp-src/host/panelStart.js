// The panel only exists inside the WebView, so a WebView that never starts
// leaves an empty panel with nothing to tell why (WebView2 on Windows, whose
// runtime Photoshop's installer provides). The host page does not depend on it:
// it says so there, with what is needed to find the cause.
const PANEL_RETRY_MS = 5000;
const PANEL_START_LIMIT_MS = 15000;

// Where Adobe's installer and Microsoft's put the WebView2 runtime
const WINDOWS_WEBVIEW_FOLDERS = [
  "C:\\Program Files\\Common Files\\Adobe\\Microsoft\\EdgeWebView",
  "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application",
];

// Microsoft's download page of the Evergreen WebView2 runtime
const WEBVIEW2_DOWNLOAD_URL = "https://developer.microsoft.com/microsoft-edge/webview2/";

// What Photoshop's UXP log says, 2 s after the panel opens, when no WebView2
// runtime can be started (reproduced with WEBVIEW2_BROWSER_EXECUTABLE_FOLDER
// set to a missing folder: no load event ever reaches the host page, and the
// Home screen of Photoshop fails the same way). The log sits in
// <AppData>\Adobe\Adobe Photoshop <year>\Logs\UXPLogs_<date>_<time>_<n>.log,
// one file per Photoshop session.
const WEBVIEW_CREATION_FAILURE = "Failed to create WebView for plugin: ";
const UXP_LOG_NAME = /^UXPLogs_.*\.log$/i;
const PHOTOSHOP_FOLDER = /^Adobe Photoshop/i;

async function readWebViewFolders(readFolder, folders = WINDOWS_WEBVIEW_FOLDERS) {
  const lines = [];
  for (const folder of folders) {
    let content = "missing";
    try {
      const names = await readFolder(folder);
      content = names.filter((name) => /^\d/.test(name)).join(", ") || "no version";
    } catch (error) {}
    lines.push(folder + ": " + content);
  }
  return lines;
}

// The newest UXP log of any Photoshop is the running session's (the names
// carry the date and time). Resolves to its line about this plugin's WebView,
// or null when there is none, or the log cannot be read.
async function findWebViewCreationFailure({ listFolder, readText, appData, pluginId }) {
  try {
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
    if (!newest) return null;
    const needle = WEBVIEW_CREATION_FAILURE + String(pluginId);
    const lines = String(await readText(newest.path)).split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index--) {
      if (lines[index].indexOf(needle) !== -1) return { file: newest.path, line: lines[index].trim() };
    }
    return null;
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
  return head + "\n" + remedy;
}

// The report under the notice; the guess at the top is left out once the log
// told the cause (webViewFailureText, placed by the host page under its title)
function panelStartFailureText({ versions, webViewFolders, loadEvents, viewSize, webViewFailure = null }) {
  const lines = webViewFailure ? [] : [
    "TypeR could not open: Photoshop's WebView, which displays the panel, did not answer.",
    "The Legacy version may still work: Window > Extensions > TypeR (CEP).",
  ];
  return lines.concat([
    "Please send this to the TypeR Discord:",
    versions,
    "View: " + viewSize,
    "Loads: " + (loadEvents.length ? loadEvents.join(" | ") : "none"),
  ]).concat(webViewFolders).join("\n");
}

module.exports = {
  PANEL_RETRY_MS, PANEL_START_LIMIT_MS, WINDOWS_WEBVIEW_FOLDERS, WEBVIEW2_DOWNLOAD_URL, WEBVIEW_CREATION_FAILURE,
  readWebViewFolders, findWebViewCreationFailure, webViewFailureText, panelStartFailureText,
};
