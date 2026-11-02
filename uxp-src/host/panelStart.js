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

function panelStartFailureText({ versions, webViewFolders, loadEvents, viewSize }) {
  return [
    "TypeR could not open: Photoshop's WebView, which displays the panel, did not answer.",
    "The Legacy version may still work: Window > Extensions > TypeR (CEP).",
    "Please send this to the TypeR Discord:",
    versions,
    "View: " + viewSize,
    "Loads: " + (loadEvents.length ? loadEvents.join(" | ") : "none"),
  ].concat(webViewFolders).join("\n");
}

module.exports = { PANEL_RETRY_MS, PANEL_START_LIMIT_MS, WINDOWS_WEBVIEW_FOLDERS, readWebViewFolders, panelStartFailureText };
