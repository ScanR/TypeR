import "./lib/CSInterface";
import { convertTplHexToTypeRFormat } from "./tplConverter";
import { resolveStylePointText } from "./textLayerPayload";
import { findNewerReleases, pickUpdateDownloadUrl } from "./updateLogic";
import { installUpdateInPlace, uint8ToBase64 } from "./updateInstaller";
import { UPDATE_TEST_CONFIG_FILE, parseUpdateTestConfig } from "./updateTestMode";
import {
  PS_EVENT_SELECT,
  PS_EVENT_SET,
  PS_EVENT_MOVE,
  isPhotoshopSelectEvent,
  isPhotoshopMoveEvent,
} from "./photoshopEvents";
import {
  deleteProfileAssets,
  getActiveProfileId,
  getActiveProfileStoragePath,
} from "./profileStorage";

const csInterface = new window.CSInterface();
const path = csInterface.getSystemPath(window.SystemPath.EXTENSION);
const storagePath = getActiveProfileStoragePath();

let locale = {};

const openUrl = window.cep.util.openURLInDefaultBrowser;

const getUpdateTestConfig = () => {
  const result = window.cep.fs.readFile(`${path}/${UPDATE_TEST_CONFIG_FILE}`);
  if (!result || result.err) return null;
  return parseUpdateTestConfig(result.data);
};

const clearUpdateTestConfig = () => {
  const result = window.cep.fs.deleteFile(`${path}/${UPDATE_TEST_CONFIG_FILE}`);
  if (typeof result === "number") return result === 0 || result === 2;
  return !result || !result.err;
};

const checkUpdate = async (currentVersion) => {
  try {
    const testConfig = getUpdateTestConfig();
    const releasesUrl = testConfig
      ? testConfig.releasesUrl
      : "https://api.github.com/repos/ScanR/TypeR/releases";
    const comparisonVersion = testConfig ? testConfig.currentVersion : currentVersion;
    const response = await fetch(
      releasesUrl,
      { headers: { Accept: "application/vnd.github.v3.html+json" } }
    );
    if (!response.ok) return null;
    const releases = await response.json();
    const newerReleases = findNewerReleases(releases, comparisonVersion);
    if (newerReleases.length > 0) {
      return {
        version: newerReleases[0].tag_name,
        downloadUrl: pickUpdateDownloadUrl(newerReleases[0]),
        testMode: !!testConfig,
        releases: newerReleases.map(release => ({
          version: release.tag_name,
          body: release.body_html || release.body,
          published_at: release.published_at
        }))
      };
    }
  } catch (e) {
    console.error("Update check failed", e);
  }
  return null;
};

// One in-flight/completed download per URL, so the zip fetched in the
// background when the update is detected is reused by the Install click
let cachedUpdateZip = { url: null, promise: null };
const fetchUpdateZip = (downloadUrl) => {
  if (cachedUpdateZip.url === downloadUrl && cachedUpdateZip.promise) {
    return cachedUpdateZip.promise;
  }
  const promise = fetch(downloadUrl, { headers: { Accept: "application/octet-stream" } })
    .then((response) => {
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      return response.arrayBuffer();
    })
    .then((arrayBuffer) => new Uint8Array(arrayBuffer));
  cachedUpdateZip = { url: downloadUrl, promise };
  promise.catch(() => {
    if (cachedUpdateZip.promise === promise) {
      cachedUpdateZip = { url: null, promise: null };
    }
  });
  return promise;
};
const prefetchUpdateZip = (downloadUrl) => {
  if (downloadUrl) fetchUpdateZip(downloadUrl).catch(() => {});
};

const getOSType = () => {
  const os = csInterface.getOSInformation();
  if (os && os.toLowerCase().indexOf('mac') !== -1) {
    return 'mac';
  }
  return 'win';
};

const getExtendScriptString = (value) => JSON.stringify(String(value || ""));

// evalScript can return non-JSON strings like "EvalScript error." — a bare
// JSON.parse throw would skip the callback and leave pending flags stuck
const safeJsonParse = (raw, fallback = {}) => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) || fallback;
  } catch (e) {
    return fallback;
  }
};

// Adaptive idle backoff: after a few minutes with no sign of activity
// (Photoshop events, panel interaction, host actions, pressed hotkeys) every
// poller drops to a slow keep-alive rate, so a Photoshop left open in the
// background is not hammered with evalScript calls for hours — each one runs
// on Photoshop's main thread and the constant churn degrades long sessions.
// Any activity restores the fast rates instantly.
const PANEL_IDLE_AFTER = 2 * 60 * 1000;
let lastPanelActivityAt = Date.now();
const notePanelActivity = () => {
  lastPanelActivityAt = Date.now();
};
const isPanelIdle = () => Date.now() - lastPanelActivityAt > PANEL_IDLE_AFTER;

// Every evalScript runs on Photoshop's main thread, and that same thread feeds
// mouse/keyboard events to the panel's CEF window. Background polling firing in
// the middle of a click is what makes buttons (style selection, quick size,
// folder toggles) feel unresponsive. Any direct interaction opens a short
// window during which low-priority pollers stay quiet and let the UI breathe.
const PANEL_INTERACTION_WINDOW = 350;
let lastPanelInteractionAt = 0;
const notePanelInteraction = () => {
  lastPanelInteractionAt = Date.now();
  lastPanelActivityAt = lastPanelInteractionAt;
};
const isPanelInteracting = () => Date.now() - lastPanelInteractionAt < PANEL_INTERACTION_WINDOW;

if (window.addEventListener) {
  window.addEventListener("pointerdown", notePanelInteraction, true);
  window.addEventListener("pointerup", notePanelInteraction, true);
  window.addEventListener("keydown", notePanelActivity, true);
  window.addEventListener("wheel", notePanelInteraction, { capture: true, passive: true });
  window.addEventListener("focus", notePanelActivity);
}

// Tracks in-flight Photoshop actions so low-priority polling (hotkeys, inline
// TextShapeR) can back off instead of contending in the ExtendScript queue
let hostActionsPending = 0;
const isHostActionPending = () => hostActionsPending > 0;
const trackHostAction = (callback) => {
  notePanelActivity();
  hostActionsPending++;
  let settled = false;
  const release = () => {
    if (settled) return false;
    settled = true;
    hostActionsPending--;
    return true;
  };
  // Safety net: never let a lost CEP callback disable polling forever
  const failsafe = setTimeout(release, 15000);
  return (...args) => {
    if (release()) clearTimeout(failsafe);
    return callback(...args);
  };
};

const evalScriptAsync = (script) =>
  new Promise((resolve) => csInterface.evalScript(script, resolve));

// Windows fallback installer: fully unattended. Waits for Photoshop to close,
// installs, relaunches Photoshop, cleans itself up. No Read-Host anywhere.
const buildWindowsInstallScript = () => `# TypeR Auto-Update Script
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$zipPath = Join-Path $ScriptDir "TypeR.zip"
$extractPath = Join-Path $ScriptDir "extracted"
$TargetDir = Join-Path $env:APPDATA "Adobe\\CEP\\extensions\\typertools"

Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|                      TypeR Auto-Updater                          |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

$psProc = Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue | Select-Object -First 1
$psExe = $null
if ($psProc) {
    $psExe = $psProc.Path
    Write-Host "[*] Waiting for Photoshop to close..." -ForegroundColor Yellow
    Write-Host "    Close Photoshop - the update will then install itself automatically."
    while (Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
}

Write-Host "[*] Installing update..." -ForegroundColor Cyan

if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
New-Item -Path $extractPath -ItemType Directory -Force | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

# Locate the folder that contains CSXS (zip may nest content one level down)
if (Test-Path "$extractPath\\CSXS") {
    $sourcePath = $extractPath
} else {
    $contentFolder = Get-ChildItem -Path $extractPath -Directory | Where-Object { Test-Path "$($_.FullName)\\CSXS" } | Select-Object -First 1
    if ($contentFolder) { $sourcePath = $contentFolder.FullName } else { $sourcePath = $extractPath }
}

# Replace only the application folders; user settings (storage*) are never touched
New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null
foreach ($folder in @("app", "CSXS", "icons", "locale")) {
    $src = Join-Path $sourcePath $folder
    $dst = Join-Path $TargetDir $folder
    if (Test-Path $src) {
        if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
        Copy-Item $src -Destination $dst -Recurse -Force
    }
}
if (Test-Path "$sourcePath\\themes") {
    $themeDest = Join-Path $TargetDir "app\\themes"
    New-Item -Path $themeDest -ItemType Directory -Force | Out-Null
    Copy-Item "$sourcePath\\themes\\*" -Destination $themeDest -Recurse -Force
}

Write-Host ""
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host "|                      Update Complete!                            |" -ForegroundColor Green
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""

if ($psExe) {
    Write-Host "[*] Relaunching Photoshop..." -ForegroundColor Cyan
    Start-Process $psExe
}
Start-Sleep -Seconds 3

Set-Location (Split-Path $ScriptDir -Parent)
Remove-Item $ScriptDir -Recurse -Force -ErrorAction SilentlyContinue
`;

// macOS fallback installer: same unattended behavior as the Windows script
const buildMacInstallScript = () => `#!/bin/bash
# TypeR Auto-Update Script

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIP_PATH="$SCRIPT_DIR/TypeR.zip"
EXTRACT_PATH="$SCRIPT_DIR/extracted"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/typertools"

echo "+------------------------------------------------------------------+"
echo "|                      TypeR Auto-Updater                          |"
echo "+------------------------------------------------------------------+"
echo ""

PS_PID=$(pgrep -f "Adobe Photoshop.app/Contents/MacOS" | head -1)
PS_APP=""
if [ -n "$PS_PID" ]; then
    PS_BIN=$(ps -o comm= -p "$PS_PID")
    PS_APP="\${PS_BIN%%.app/*}.app"
    echo "[*] Waiting for Photoshop to close..."
    echo "    Close Photoshop - the update will then install itself automatically."
    while pgrep -f "Adobe Photoshop.app/Contents/MacOS" > /dev/null; do sleep 2; done
fi

echo "[*] Installing update..."

rm -rf "$EXTRACT_PATH"
mkdir -p "$EXTRACT_PATH"
unzip -o -q "$ZIP_PATH" -d "$EXTRACT_PATH"

# Locate the folder that contains CSXS (zip may nest content one level down)
if [ -d "$EXTRACT_PATH/CSXS" ]; then
    SOURCE_PATH="$EXTRACT_PATH"
else
    CONTENT_FOLDER=$(find "$EXTRACT_PATH" -maxdepth 2 -type d -name "CSXS" | head -1 | xargs dirname 2>/dev/null)
    if [ -n "$CONTENT_FOLDER" ]; then SOURCE_PATH="$CONTENT_FOLDER"; else SOURCE_PATH="$EXTRACT_PATH"; fi
fi

# Replace only the application folders; user settings (storage*) are never touched
mkdir -p "$DEST_DIR"
for folder in app CSXS icons locale; do
    if [ -d "$SOURCE_PATH/$folder" ]; then
        rm -rf "$DEST_DIR/$folder"
        cp -R "$SOURCE_PATH/$folder" "$DEST_DIR/"
    fi
done
if [ -d "$SOURCE_PATH/themes" ]; then
    mkdir -p "$DEST_DIR/app/themes"
    cp -R "$SOURCE_PATH/themes/"* "$DEST_DIR/app/themes/"
fi

echo ""
echo "+------------------------------------------------------------------+"
echo "|                      Update Complete!                            |"
echo "+------------------------------------------------------------------+"
echo ""

if [ -n "$PS_APP" ] && [ -d "$PS_APP" ]; then
    echo "[*] Relaunching Photoshop..."
    open "$PS_APP"
fi
sleep 3

cd "$HOME"
rm -rf "$SCRIPT_DIR"
`;

// Fallback when in-place install is impossible: drop the zip and an unattended
// installer script in Downloads/TypeR_Update and launch it. The only remaining
// user action is closing Photoshop whenever convenient.
const runScriptFallback = async (zipBytes, onProgress, onComplete) => {
  const osType = getOSType();
  const userData = csInterface.getSystemPath(window.SystemPath.USER_DATA);
  const userHome = osType === 'win'
    ? userData.split('/AppData/')[0]
    : userData.replace('/Library/Application Support', '');
  const downloadsPath = `${userHome}/Downloads/TypeR_Update`;
  const zipPath = `${downloadsPath}/TypeR.zip`;

  await evalScriptAsync(`deleteFolder(${getExtendScriptString(downloadsPath)})`);
  const mkdirResult = window.cep.fs.makedir(downloadsPath);
  if (mkdirResult.err && mkdirResult.err !== 0 && mkdirResult.err !== 17) { // 17 = already exists
    throw new Error('Failed to create download directory');
  }

  const writeResult = window.cep.fs.writeFile(zipPath, uint8ToBase64(zipBytes), window.cep.encoding.Base64);
  if (writeResult.err) {
    throw new Error('Failed to write ZIP file');
  }

  let launcherPath;
  if (osType === 'win') {
    const psScriptPath = `${downloadsPath}/install_update.ps1`;
    launcherPath = `${downloadsPath}/install_update.cmd`;
    window.cep.fs.writeFile(psScriptPath, buildWindowsInstallScript());
    window.cep.fs.writeFile(launcherPath, `@echo off\r\ncd /d "%~dp0"\r\nPowerShell -NoProfile -ExecutionPolicy Bypass -File "install_update.ps1"\r\n`);
  } else {
    launcherPath = `${downloadsPath}/install_update.command`;
    window.cep.fs.writeFile(launcherPath, buildMacInstallScript());
    await evalScriptAsync(`makeExecutable(${getExtendScriptString(launcherPath)})`);
  }

  onProgress && onProgress(locale.updateReady || 'Update ready to install...');

  const launchResult = await evalScriptAsync(`launchInstaller(${getExtendScriptString(launcherPath)})`);
  if (String(launchResult).indexOf('OK') !== 0) {
    // Could not start the installer: at least show the folder so the user can
    // run it manually
    await evalScriptAsync(`openFolder(${getExtendScriptString(downloadsPath)})`);
  }
  onComplete && onComplete(true); // true = a Photoshop close is still needed
};

const downloadAndInstallUpdate = async (downloadUrl, onProgress, onComplete, onError, options = {}) => {
  try {
    onProgress && onProgress(locale.updateDownloading || 'Downloading update...');
    const zipBytes = await fetchUpdateZip(downloadUrl);

    // Preferred path: overwrite the extension folder directly. CEF keeps the
    // running panel in memory, so files on disk are not locked; the new
    // version simply takes over at the next Photoshop restart.
    try {
      onProgress && onProgress(locale.updateInstalling || 'Installing update...');
      await installUpdateInPlace(zipBytes, path);
      onComplete && onComplete(false);
      return;
    } catch (inPlaceError) {
      console.error('In-place update failed, falling back to script installer', inPlaceError);
      if (options.inPlaceOnly) {
        onError && onError(inPlaceError.message || 'Update failed');
        return;
      }
    }

    await runScriptFallback(zipBytes, onProgress, onComplete);
  } catch (e) {
    console.error('Update failed:', e);
    onError && onError(e.message || 'Update failed');
  }
};

let storageCache = null;
let storageReadError = null;
let pendingStorageData = null;
let pendingStorageTimer = null;
let pendingStorageIdleDelay = 0;

const loadStorageCache = () => {
  if (storageCache !== null) {
    return { error: storageReadError, data: storageCache };
  }
  const result = window.cep.fs.readFile(storagePath);
  if (result.err) {
    storageReadError = result.err;
    storageCache = {};
  } else {
    storageReadError = null;
    try {
      storageCache = JSON.parse(result.data || "{}") || {};
    } catch (e) {
      storageCache = {};
    }
  }
  return { error: storageReadError, data: storageCache };
};

const readStorage = (key) => {
  const storage = loadStorageCache();
  if (storage.error) {
    return key ? void 0 : { error: storage.error, data: {} };
  }
  return key ? storage.data[key] : { data: storage.data };
};

const commitStorageData = (data, rewrite) => {
  const storage = loadStorageCache();
  const nextData = storage.error || rewrite ? data : Object.assign({}, storage.data, data);
  storageCache = nextData;
  storageReadError = null;
  const result = window.cep.fs.writeFile(storagePath, JSON.stringify(nextData));
  return !result.err;
};

const flushStorageWrite = (force = false) => {
  if (pendingStorageTimer) {
    clearTimeout(pendingStorageTimer);
    pendingStorageTimer = null;
  }
  if (!pendingStorageData) return true;
  if (!force && pendingStorageIdleDelay > 0) {
    const idleFor = Date.now() - lastPanelActivityAt;
    if (idleFor < pendingStorageIdleDelay) {
      pendingStorageTimer = setTimeout(
        flushStorageWrite,
        pendingStorageIdleDelay - idleFor
      );
      return true;
    }
  }
  const data = pendingStorageData;
  pendingStorageData = null;
  pendingStorageIdleDelay = 0;
  const success = commitStorageData(data, false);
  if (!success) {
    pendingStorageData = Object.assign({}, data, pendingStorageData || {});
  }
  return success;
};

const writeToStorage = (data, rewrite, options = {}) => {
  if (rewrite) {
    flushStorageWrite(true);
    return commitStorageData(data, true);
  }
  const debounce = options.debounce || 0;
  if (debounce > 0) {
    pendingStorageData = Object.assign({}, pendingStorageData || {}, data);
    pendingStorageIdleDelay = Math.max(
      pendingStorageIdleDelay,
      options.idle || 0
    );
    storageCache = Object.assign({}, loadStorageCache().data, pendingStorageData);
    storageReadError = null;
    if (pendingStorageTimer) clearTimeout(pendingStorageTimer);
    pendingStorageTimer = setTimeout(flushStorageWrite, debounce);
    return true;
  }
  flushStorageWrite();
  return commitStorageData(data, false);
};

if (window.addEventListener) {
  window.addEventListener("beforeunload", () => flushStorageWrite(true));
}

const deleteStorageFile = () => {
  flushStorageWrite(true);
  const result = window.cep.fs.deleteFile(storagePath);
  deleteProfileAssets(getActiveProfileId());
  storageCache = {};
  storageReadError = null;
  if (typeof result === "number") {
    return (
      result === window.cep.fs.NO_ERROR ||
      result === window.cep.fs.ERR_NOT_FOUND
    );
  }
  if (typeof result === "object" && result) {
    return !result.err || result.err === window.cep.fs.ERR_NOT_FOUND;
  }
  return false;
};

const parseLocaleFile = (str) => {
  const result = {};
  if (!str) return result;
  const lines = str.replace(/\r/g, "").split("\n");
  let key = null;
  let val = "";
  for (let line of lines) {
    if (line.startsWith("#")) continue;
    if (key) {
      val += line;
      if (val.endsWith("\\")) {
        val = val.slice(0, -1) + "\n";
        continue;
      }
      result[key] = val;
      key = null;
      val = "";
      continue;
    }
    const i = line.indexOf("=");
    if (i === -1) continue;
    key = line.slice(0, i).trim();
    val = line.slice(i + 1);
    if (val.endsWith("\\")) {
      val = val.slice(0, -1) + "\n";
      continue;
    }
    result[key] = val;
    key = null;
    val = "";
  }
  return result;
};

const initLocale = () => {
  locale = csInterface.initResourceBundle();
  const loadLocaleFile = (file) => {
    const result = window.cep.fs.readFile(file);
    if (!result.err) {
      const data = parseLocaleFile(result.data);
      locale = Object.assign(locale, data);
    }
  };
  // Always merge default strings to ensure fallbacks for new keys
  loadLocaleFile(`${path}/locale/messages.properties`);
  const lang = readStorage("language");
  if (lang && lang !== "auto") {
    const file = lang === "en_US" ? `${path}/locale/messages.properties` : `${path}/locale/${lang}/messages.properties`;
    loadLocaleFile(file);
  }
};

initLocale();

const nativeAlert = (text, title, isError) => {
  const data = JSON.stringify({ text, title, isError });
  csInterface.evalScript("nativeAlert(" + data + ")");
};

const nativeConfirm = (text, title, callback) => {
  const data = JSON.stringify({ text, title });
  csInterface.evalScript("nativeConfirm(" + data + ")", (result) => callback(!!result));
};

let userFonts = null;
let userFontsRequestPending = false;
let userFontsCallbacks = [];

const getUserFonts = () => {
  return Array.isArray(userFonts) ? userFonts.concat([]) : [];
};

const refreshUserFonts = (callback, rescanHost) => {
  if (typeof callback === "function") userFontsCallbacks.push(callback);
  if (userFontsRequestPending) return;

  userFontsRequestPending = true;
  // rescanHost runs app.refreshFonts() in Photoshop first, so fonts installed
  // during the session show up without a restart. Reserved for explicit
  // install actions: the rescan briefly blocks the host.
  csInterface.evalScript(rescanHost ? "reloadUserFonts()" : "getUserFonts()", (data) => {
    const dataObj = safeJsonParse(data);
    const fonts = dataObj.fonts || [];
    userFonts = fonts;
    userFontsRequestPending = false;

    const callbacks = userFontsCallbacks;
    userFontsCallbacks = [];
    callbacks.forEach((fontCallback) => fontCallback(fonts.concat([])));
  });
};

const getActiveLayerText = (callback) => {
  csInterface.evalScript("getActiveLayerText()", (data) => {
    const dataObj = safeJsonParse(data);
    if (!data || !dataObj.textProps) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    else callback(dataObj);
  });
};

const getSelectedTextLayers = (callback = () => {}) => {
  csInterface.evalScript("getSelectedTextLayers()", (data) => {
    const dataObj = safeJsonParse(data);
    callback(Array.isArray(dataObj.layers) ? dataObj.layers : []);
  });
};

const getTypeRSelectionSnapshot = (callback = () => {}) => {
  csInterface.evalScript("getTypeRSelectionSnapshot()", (data) => {
    const dataObj = safeJsonParse(data);
    callback({
      selection: dataObj.selection || null,
      layers: Array.isArray(dataObj.layers) ? dataObj.layers : [],
    });
  });
};

const MARKDOWN_MARKERS = [
  { token: "***", bold: true, italic: true },
  { token: "___", bold: true, italic: true },
  { token: "**", bold: true, italic: false },
  { token: "__", bold: true, italic: false },
  { token: "*", bold: false, italic: true },
  { token: "_", bold: false, italic: true },
];

const isEscapedMarkdown = (text, index) => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const findUnescapedToken = (text, token, start) => {
  let index = text.indexOf(token, start);
  while (index !== -1 && isEscapedMarkdown(text, index)) {
    index = text.indexOf(token, index + 1);
  }
  return index;
};

const findNextMarker = (text, start) => {
  let best = null;
  for (const marker of MARKDOWN_MARKERS) {
    const index = findUnescapedToken(text, marker.token, start);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && marker.token.length > best.marker.token.length)) {
      best = { index, marker };
    }
  }
  return best;
};

const unescapeMarkdownText = (text) => {
  return text.replace(/\\\\/g, "\\").replace(/\\\*/g, "*").replace(/\\_/g, "_");
};

const parseMarkdownRuns = (input) => {
  const text = typeof input === "string" ? input : "";
  const runs = [];
  const overlaySegments = [];

  const pushRun = (segment, style) => {
    if (!segment) return;
    const cleaned = unescapeMarkdownText(segment);
    if (!cleaned) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic) {
      last.text += cleaned;
    } else {
      runs.push({ text: cleaned, bold: style.bold, italic: style.italic });
    }
  };

  const pushOverlaySegment = (segment, style, hidden, marker) => {
    if (!segment) return;
    const last = overlaySegments[overlaySegments.length - 1];
    if (
      last &&
      last.hidden === hidden &&
      last.marker === marker &&
      last.bold === style.bold &&
      last.italic === style.italic
    ) {
      last.text += segment;
    } else {
      overlaySegments.push({ text: segment, bold: style.bold, italic: style.italic, hidden, marker });
    }
  };

  const pushOverlayText = (segment, style) => {
    if (!segment) return;
    let buffer = "";
    for (let i = 0; i < segment.length; i++) {
      const char = segment[i];
      const next = segment[i + 1];
      const isEscaped = char === "\\" && (next === "\\" || next === "*" || next === "_");
      if (isEscaped) {
        if (buffer) {
          pushOverlaySegment(buffer, style, false);
          buffer = "";
        }
        // Keep the backslash width for caret alignment but hide it
        pushOverlaySegment("\\", style, true);
        // Render the escaped character visibly
        pushOverlaySegment(next === "\\" ? "\\" : next, style, false);
        i += 1;
        continue;
      }
      buffer += char;
    }
    if (buffer) {
      pushOverlaySegment(buffer, style, false);
    }
  };

  const walk = (segment, style) => {
    let cursor = 0;
    while (cursor < segment.length) {
      const match = findNextMarker(segment, cursor);
      if (!match) {
        const tail = segment.slice(cursor);
        pushRun(tail, style);
        pushOverlayText(tail, style);
        break;
      }
      if (match.index > cursor) {
        const before = segment.slice(cursor, match.index);
        pushRun(before, style);
        pushOverlayText(before, style);
      }
      const afterOpen = match.index + match.marker.token.length;
      const closeIndex = findUnescapedToken(segment, match.marker.token, afterOpen);
      if (closeIndex === -1) {
        const unmatched = segment.slice(match.index, afterOpen);
        pushRun(unmatched, style);
        pushOverlayText(unmatched, style);
        cursor = afterOpen;
        continue;
      }
      // Opening marker: keep width for alignment
      pushOverlaySegment(match.marker.token, style, true, "open");
      const inner = segment.slice(afterOpen, closeIndex);
      const nextStyle = {
        bold: style.bold || match.marker.bold,
        italic: style.italic || match.marker.italic,
      };
      walk(inner, nextStyle);
      // Closing marker: keep width for alignment
      pushOverlaySegment(match.marker.token, style, true, "close");
      cursor = closeIndex + match.marker.token.length;
    }
  };

  walk(text, { bold: false, italic: false });

  const plainText = runs.map((run) => run.text).join("");
  const hasFormatting = runs.some((run) => run.bold || run.italic);
  return { text: plainText, runs, hasFormatting, overlaySegments };
};

const isMarkdownEnabled = () => readStorage("interpretMarkdown") !== false;

const buildRichTextPayload = (text, allowMarkdown = isMarkdownEnabled()) => {
  if (typeof text !== "string" || !allowMarkdown) {
    return { text, richTextRuns: null };
  }
  const parsed = parseMarkdownRuns(text);
  return {
    text: parsed.text,
    richTextRuns: parsed.hasFormatting ? parsed.runs : null,
  };
};

const escapeMarkdownText = (text) => {
  return text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_");
};

const applyMarkdownStyle = (text, bold, italic) => {
  if (!bold && !italic) return text;
  const marker = bold && italic ? "***" : bold ? "**" : "*";
  const parts = text.split("\n");
  return parts.map((part) => (part === "" ? part : `${marker}${part}${marker}`)).join("\n");
};

const convertHtmlToMarkdown = (html) => {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const runs = [];

  const pushRun = (text, style) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic) {
      last.text += text;
    } else {
      runs.push({ text, bold: style.bold, italic: style.italic });
    }
  };

  const walk = (node, style) => {
    if (node.nodeType === 3) {
      const value = (node.nodeValue || "").replace(/\u00a0/g, " ");
      pushRun(value, style);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      pushRun("\n", style);
      return;
    }

    const nextStyle = { bold: style.bold, italic: style.italic };
    if (tag === "b" || tag === "strong") nextStyle.bold = true;
    if (tag === "i" || tag === "em") nextStyle.italic = true;

    const inlineStyle = node.getAttribute("style") || "";
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(inlineStyle)) nextStyle.bold = true;
    if (/font-weight\s*:\s*(normal|[1-5]00)/i.test(inlineStyle)) nextStyle.bold = false;
    if (/font-style\s*:\s*italic/i.test(inlineStyle)) nextStyle.italic = true;
    if (/font-style\s*:\s*normal/i.test(inlineStyle)) nextStyle.italic = false;

    const isBlock = /^(p|div|li|ul|ol|tr)$/i.test(tag);
    if (isBlock && runs.length && !runs[runs.length - 1].text.endsWith("\n")) {
      pushRun("\n", style);
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child, nextStyle);
    }
    if (isBlock) {
      pushRun("\n", style);
    }
  };

  walk(doc.body, { bold: false, italic: false });

  let markdown = runs
    .map((run) => {
      const escaped = escapeMarkdownText(run.text);
      return applyMarkdownStyle(escaped, run.bold, run.italic);
    })
    .join("");

  markdown = markdown.replace(/\n{3,}/g, "\n\n");
  return markdown;
};

const setActiveLayerText = (text, style, direction, callback = () => {}) => {
  // Support legacy calls where direction is omitted and callback is 3rd parameter
  if (typeof direction === "function") {
    callback = direction;
    direction = undefined;
  }
  if (!text && !style) {
    nativeAlert(locale.errorNoTextNoStyle, locale.errorTitle, true);
    callback(false);
    return false;
  }
  const parsed = buildRichTextPayload(text);
  const contentOnly = !style;
  const data = JSON.stringify(contentOnly
    ? {
        text: parsed.text,
        style: null,
        contentOnly: true,
        richTextRuns: parsed.richTextRuns,
      }
    : {
        text: parsed.text,
        style,
        direction,
        richTextRuns: parsed.richTextRuns,
      });
  csInterface.evalScript("setActiveLayerText(" + data + ")", trackHostAction((error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  }));
};

const setSelectedTextLayers = (items, direction, callback = () => {}, restoreLayerIds = []) => {
  if (!Array.isArray(items) || items.length < 2) {
    nativeAlert(locale.errorSelectMultipleTextLayers, locale.errorTitle, true);
    callback(false);
    return false;
  }

  const normalizedItems = items.map((item) => {
    const parsed = buildRichTextPayload(item.text);
    return {
      layerId: item.layerId,
      text: parsed.text,
      style: item.style || { textProps: getDefaultStyle(), stroke: getDefaultStroke() },
      direction,
      richTextRuns: parsed.richTextRuns,
    };
  });
  const data = JSON.stringify({
    items: normalizedItems,
    restoreLayerIds: Array.isArray(restoreLayerIds) ? restoreLayerIds : [],
  });
  csInterface.evalScript("setSelectedTextLayers(" + data + ")", trackHostAction((error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  }));
};

// Fast text-only apply for TextShapeR: passes the layer style snapshot the
// panel already holds so the host can skip its full layer re-read and every
// style/stroke re-apply — only the line breaking changes
const setLayerTextFast = (text, layerSnapshotStyle, direction, callback = () => {}) => {
  if (!text || !layerSnapshotStyle) {
    setActiveLayerText(text, layerSnapshotStyle, direction, callback);
    return;
  }
  const parsed = buildRichTextPayload(text);
  const data = JSON.stringify({
    text: parsed.text,
    style: layerSnapshotStyle,
    direction,
    richTextRuns: parsed.richTextRuns,
  });
  csInterface.evalScript("setTextShapeRLayerText(" + data + ")", trackHostAction((error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  }));
};

const getCurrentSelection = (callback = () => {}) => {
  csInterface.evalScript("getCurrentSelection()", (result) => {
    const data = safeJsonParse(result);
    if (data.error) {
      callback(null);
    } else {
      callback(data);
    }
  });
};

const photoshopEventCallbacks = new Set();
let photoshopEventsRegistered = false;
let photoshopEventsReceived = false;

const registerPhotoshopEvents = () => {
  if (photoshopEventsRegistered || !window.CSEvent) return;
  photoshopEventsRegistered = true;
  const extensionId = csInterface.getExtensionID();
  csInterface.addEventListener("com.adobe.PhotoshopJSONCallback" + extensionId, (event) => {
    photoshopEventsReceived = true;
    // A real Photoshop event means the user is working: leave idle backoff
    notePanelActivity();
    photoshopEventCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        // Listener errors must not break the CEP event bridge
      }
    });
  });
  const registerEvent = new window.CSEvent("com.adobe.PhotoshopRegisterEvent", "APPLICATION");
  registerEvent.extensionId = extensionId;
  // 'move' is registered as well so TextShapeR can acknowledge geometry-only
  // history states without discovering them later through the heavy poller.
  registerEvent.data = `${PS_EVENT_SELECT}, ${PS_EVENT_SET}, ${PS_EVENT_MOVE}`;
  csInterface.dispatchEvent(registerEvent);
};

const addPhotoshopEventListener = (callback) => {
  registerPhotoshopEvents();
  photoshopEventCallbacks.add(callback);
  return () => {
    photoshopEventCallbacks.delete(callback);
  };
};

const hasReceivedPhotoshopEvents = () => photoshopEventsReceived;

const getSelectionBoundsHash = (selection) => {
  if (!selection) return null;
  return `${selection.xMid}_${selection.yMid}_${selection.width}_${selection.height}`;
};

const startSelectionMonitoring = () => {
  csInterface.evalScript("startSelectionMonitoring()");
};

const stopSelectionMonitoring = () => {
  csInterface.evalScript("stopSelectionMonitoring()");
};

// After an explicit deselect, in-flight selection polls may still report the
// old marquee: drop their results until the deselect has really completed so
// cleared selections are never re-added behind the user's back. ExtendScript
// runs calls in queue order, so once the deselect callback fires every later
// poll reflects the post-deselect document.
let selectionResultsSuppressedUntil = 0;

const deselectDocument = (callback = () => {}) => {
  selectionResultsSuppressedUntil = Date.now() + 5000;
  csInterface.evalScript("deselectDocumentSelection()", () => {
    selectionResultsSuppressedUntil = Date.now();
    callback();
  });
};

const undoLastTextChange = (callback = () => {}) => {
  csInterface.evalScript("undoLastTyperChange()", trackHostAction((error) => {
    callback(!error);
  }));
};

// Text of the active layer with its rendered line breaks: box text wraps
// automatically and those wraps are invisible in textKey, so the host reads
// them off a throwaway point-text copy of the layer
const getActiveLayerRenderedText = (callback = () => {}) => {
  csInterface.evalScript("getRenderedTextLines()", trackHostAction((result) => {
    const data = safeJsonParse(result);
    callback(typeof data.text === "string" && data.text ? data.text : null);
  }));
};

// Rendered text of every visible text layer in the document, for the "learn
// my style from the whole page" batch feedback. scanBubbles re-detects the
// bubble outline around each layer (slower but context-precise).
const getAllLayersRenderedTexts = (scanBubbles, callback = () => {}) => {
  csInterface.evalScript(`getAllRenderedTextLines(${JSON.stringify({ scanBubbles: !!scanBubbles })})`, trackHostAction((result) => {
    const data = safeJsonParse(result);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    callback(entries.filter((entry) => entry && typeof entry.text === "string" && entry.text));
  }));
};

const getSelectionChanged = (callback = () => {}) => {
  csInterface.evalScript("getSelectionChanged()", (result) => {
    const data = safeJsonParse(result);
    if (Date.now() < selectionResultsSuppressedUntil || data.noChange || data.error) {
      callback(null);
    } else if (data.multipleSelections) {
      // The host saw one selection grow around the previous one (Shift-add):
      // no bounds are usable, the panel should only warn the user
      callback({ multipleSelections: true });
    } else if (typeof data.width !== "number") {
      callback(null);
    } else {
      callback(data);
    }
  });
};

const createTextLayerInSelection = (text, style, pointText, padding, direction, callback = () => {}) => {
  // Support legacy calls where padding/direction are omitted and callback may be 4th or 5th parameter
  if (typeof padding === "function") {
    callback = padding;
    padding = 0;
    direction = undefined;
  } else if (typeof direction === "function") {
    callback = direction;
    direction = undefined;
  }
  if (!text) {
    nativeAlert(locale.errorNoText, locale.errorTitle, true);
    callback(false);
    return false;
  }
  if (!style) {
    style = { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
  }
  const resolvedPointText = resolveStylePointText(style, pointText);
  const parsed = buildRichTextPayload(text);
  const data = JSON.stringify({
    text: parsed.text,
    style,
    padding: padding || 0,
    direction,
    richTextRuns: parsed.richTextRuns,
  });
  csInterface.evalScript("createTextLayerInSelection(" + data + ", " + resolvedPointText + ")", trackHostAction((error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error) nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    callback(!error);
  }));
};

const createTextLayersInStoredSelections = (texts, styles, selections, pointText, padding, direction, callback = () => {}) => {
  // Support legacy calls where padding/direction are omitted and callback may be 5th or 6th parameter
  if (typeof padding === "function") {
    callback = padding;
    padding = 0;
    direction = undefined;
  } else if (typeof direction === "function") {
    callback = direction;
    direction = undefined;
  }
  if (!Array.isArray(texts) || texts.length === 0) {
    nativeAlert(locale.errorNoText, locale.errorTitle, true);
    callback(false);
    return false;
  }
  if (!Array.isArray(styles) || styles.length === 0) {
    styles = [{ textProps: getDefaultStyle(), stroke: getDefaultStroke() }];
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    callback(false);
    return false;
  }
  const parsedTexts = texts.map((line) => buildRichTextPayload(line));
  const data = JSON.stringify({
    texts: parsedTexts.map((entry) => entry.text),
    richTextRuns: parsedTexts.map((entry) => entry.richTextRuns),
    styles,
    pointModes: styles.map((style) => resolveStylePointText(style, pointText)),
    selections,
    padding: padding || 0,
    direction,
  });
  csInterface.evalScript("createTextLayersInStoredSelections(" + data + ", " + !!pointText + ")", trackHostAction((error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error === "noSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error === "invalidSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error && error.indexOf("scriptError:") === 0) nativeAlert(error.replace("scriptError: ", ""), locale.errorTitle, true);
    else if (error) nativeAlert("Error: " + error, locale.errorTitle, true);
    callback(!error);
  }));
};

const alignTextLayerToSelection = (resizeTextBox = false, padding = 0, callback = () => {}) => {
  const data = JSON.stringify({ resizeTextBox: !!resizeTextBox, padding: padding || 0 });
  csInterface.evalScript("alignTextLayerToSelection(" + data + ")", trackHostAction((error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error === "noSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  }));
};

const changeActiveLayerTextSize = (val, callback = () => {}) => {
  csInterface.evalScript("changeActiveLayerTextSize(" + val + ")", trackHostAction((error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  }));
};

const toggleCleaningLayers = (callback = () => {}) => {
  csInterface.evalScript("toggleCleaningLayers()", trackHostAction(callback));
};

// On macOS host.jsx checks the frontmost app itself (via lsappinfo), but
// ExtendScript has no such option on Windows. There we run a hidden
// persistent PowerShell watcher that prints the foreground process name
// every 250ms, and gate the hotkey poll on it. Requires Node (see manifest
// --enable-nodejs); if anything is unavailable we fail open to the old
// behavior so hotkeys never break.
//
// The same watcher also reports the mouse side buttons (XBUTTON1/XBUTTON2).
// They are the one input the panel cannot see for itself: ScriptUI's
// keyboardState has no mouse state at all, and a DOM listener only fires
// while the cursor sits over the panel -- useless when the user is working
// on the canvas, which is exactly when the shortcut is wanted. GetAsyncKeyState
// reads them globally, so binding them needs no setup from the user.
const foregroundWatcher = {
  name: "",
  time: 0,
  started: false,
  restartTimer: null,
  child: null,
  stopped: false,
};

// The watcher is a real OS process, and CEP does not clean it up for us: the
// panel reloads on several settings changes and is torn down when the user
// closes it, so without this every reload left another hidden powershell.exe
// polling GetForegroundWindow four times a second for the rest of the
// Photoshop session. A few of those is enough to make a long session drag.
const stopForegroundWatcher = () => {
  foregroundWatcher.stopped = true;
  if (foregroundWatcher.restartTimer) {
    clearTimeout(foregroundWatcher.restartTimer);
    foregroundWatcher.restartTimer = null;
  }
  const child = foregroundWatcher.child;
  foregroundWatcher.child = null;
  foregroundWatcher.started = false;
  if (!child) return;
  try {
    child.kill();
  } catch (e) {
    // A watcher that refuses to die must not block the panel from unloading
  }
};

if (window.addEventListener) {
  window.addEventListener("beforeunload", stopForegroundWatcher);
  window.addEventListener("unload", stopForegroundWatcher);
}

const toBase64Utf16le = (str) => {
  let bin = "";
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    bin += String.fromCharCode(c & 0xff) + String.fromCharCode(c >> 8);
  }
  return window.btoa(bin);
};

// Mouse side-button presses arrive as discrete events rather than as polled
// state, so consumers subscribe instead of sampling.
const mouseShortcutListeners = [];
const onMouseShortcut = (listener) => {
  mouseShortcutListeners.push(listener);
  return () => {
    const index = mouseShortcutListeners.indexOf(listener);
    if (index !== -1) mouseShortcutListeners.splice(index, 1);
  };
};

// Emitted in the same order the settings recorder stores modifiers, so a
// binding captured in the UI reads identically to what the watcher reports
const WATCHER_MODIFIERS = [["W", "WIN"], ["C", "CTRL"], ["A", "ALT"], ["S", "SHIFT"]];

const emitMouseShortcut = (button, mods, processName) => {
  // A side button pressed in a browser or file explorer must not drive the
  // panel: these are global reads, so the foreground check is what scopes them
  if (!/photoshop/i.test(processName || "")) return;
  const keys = [];
  WATCHER_MODIFIERS.forEach(([flag, name]) => {
    if (String(mods || "").indexOf(flag) !== -1) keys.push(name);
  });
  keys.push(button === "6" ? "MOUSE5" : "MOUSE4");
  notePanelActivity();
  mouseShortcutListeners.forEach((listener) => {
    try {
      listener(keys);
    } catch (error) {
      // A listener error must not tear down the watcher bridge
    }
  });
};

const handleWatcherLine = (rawLine) => {
  const line = rawLine.trim();
  if (!line) return;
  if (line.indexOf("MB|") === 0) {
    const parts = line.split("|");
    emitMouseShortcut(parts[1], parts[2], parts.slice(3).join("|"));
    return;
  }
  foregroundWatcher.name = line.indexOf("FG|") === 0 ? line.slice(3).trim() : line;
  foregroundWatcher.time = Date.now();
};

const startForegroundWatcher = () => {
  if (foregroundWatcher.started || foregroundWatcher.stopped) return;
  if (!navigator.platform || navigator.platform.indexOf("Win") !== 0) return;
  const nodeRequire = (window.cep_node && window.cep_node.require) || (typeof window.require === "function" ? window.require : null);
  if (!nodeRequire) return;
  let spawn;
  try {
    spawn = nodeRequire("child_process").spawn;
  } catch (e) {
    return;
  }
  // The loop ticks at 50ms for the mouse buttons, but the expensive part
  // (Get-Process) now only runs when the foreground window actually changes,
  // so this polls the side buttons 5x more often than the old script polled
  // the process name while doing strictly less work per second.
  const psScript = [
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class FW { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport(\"user32.dll\")] public static extern short GetAsyncKeyState(int vk); }';",
    // GetAsyncKeyState's low bit means "pressed since the previous call", so
    // prime it once: otherwise a click made before the panel opened replays here
    "[void][FW]::GetAsyncKeyState(5); [void][FW]::GetAsyncKeyState(6);",
    "$lastH = [IntPtr]::Zero; $n = ''; $tick = 0;",
    "while ($true) {",
    "$h = [FW]::GetForegroundWindow();",
    // Re-resolve on focus change, and keep retrying while the name is empty so
    // a transient Get-Process failure cannot wedge the gate shut
    "if ($h -ne $lastH -or $n -eq '') { $lastH = $h; $procId = [uint32]0; [void][FW]::GetWindowThreadProcessId($h, [ref]$procId); $n = ''; try { $n = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {} }",
    // 5 = XBUTTON1 (button4), 6 = XBUTTON2 (button5). The low bit is an edge,
    // so a click shorter than one tick is still caught and holding never repeats
    "foreach ($b in 5, 6) {",
    "if (([FW]::GetAsyncKeyState($b) -band 1) -ne 0) {",
    "$m = '';",
    "if (([FW]::GetAsyncKeyState(0x5B) -band 0x8000) -ne 0 -or ([FW]::GetAsyncKeyState(0x5C) -band 0x8000) -ne 0) { $m += 'W' }",
    "if (([FW]::GetAsyncKeyState(0x11) -band 0x8000) -ne 0) { $m += 'C' }",
    "if (([FW]::GetAsyncKeyState(0x12) -band 0x8000) -ne 0) { $m += 'A' }",
    "if (([FW]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0) { $m += 'S' }",
    "[Console]::Out.WriteLine('MB|' + $b + '|' + $m + '|' + $n) } }",
    "$tick++;",
    "if ($tick -ge 5) { $tick = 0; [Console]::Out.WriteLine('FG|' + $n) }",
    "[Console]::Out.Flush();",
    "Start-Sleep -Milliseconds 50 }",
  ].join(" ");
  foregroundWatcher.started = true;
  try {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", toBase64Utf16le(psScript)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    foregroundWatcher.child = child;
    // Button presses are one-shot events, so a chunk split mid-line can no
    // longer be dropped the way a repeated status line could be: buffer the
    // tail until its newline arrives.
    let pending = "";
    child.stdout.on("data", (data) => {
      pending += data.toString();
      if (pending.length > 8192) pending = pending.slice(-8192);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      lines.forEach(handleWatcherLine);
    });
    const scheduleRestart = () => {
      if (foregroundWatcher.stopped) return;
      foregroundWatcher.child = null;
      foregroundWatcher.started = false;
      foregroundWatcher.time = 0;
      if (foregroundWatcher.restartTimer) return;
      foregroundWatcher.restartTimer = setTimeout(() => {
        foregroundWatcher.restartTimer = null;
        startForegroundWatcher();
      }, 5000);
    };
    child.on("error", scheduleRestart);
    child.on("exit", scheduleRestart);
  } catch (e) {
    foregroundWatcher.started = false;
  }
};

const isHostAppInForeground = () => {
  // Stale or missing data (watcher unavailable, killed, or non-Windows
  // where macOS is handled host-side): fail open
  if (!foregroundWatcher.time || Date.now() - foregroundWatcher.time > 2000) return true;
  return /photoshop/i.test(foregroundWatcher.name);
};

const getHotkeyPressed = (callback) => {
  startForegroundWatcher();
  if (!isHostAppInForeground()) {
    callback("a");
    return;
  }
  csInterface.evalScript("getHotkeyPressed()", callback);
};

let resizeTextAreaFrame = null;
const resizeTextArea = (defer = false) => {
  if (defer && window.requestAnimationFrame) {
    if (resizeTextAreaFrame) return;
    resizeTextAreaFrame = window.requestAnimationFrame(() => {
      resizeTextAreaFrame = null;
      resizeTextArea();
    });
    return;
  }
  const textArea = document.querySelector(".text-area");
  const textLines = document.querySelector(".text-lines");
  if (textArea && textLines) {
    // A hidden panel measures 0: applying it would collapse the textarea and
    // make it unclickable until the next sync, so keep the previous height
    const height = textLines.offsetHeight;
    if (!height) return;
    textArea.style.height = height + "px";
  }
};

const scrollToLine = (lineIndex, delay = 100) => {
  lineIndex = lineIndex < 5 ? 0 : lineIndex - 5;
  setTimeout(() => {
    const line = document.querySelector(`.text-line[data-line-index="${lineIndex}"]`);
    if (line) {
      line.scrollIntoView();
      return;
    }
    const textLines = document.querySelector(".text-lines");
    const layout = textLines && textLines.__typerRowLayout;
    const scrollContainer = textLines && textLines.parentElement;
    if (layout && scrollContainer && layout.offsets[lineIndex] != null) {
      scrollContainer.scrollTop = layout.offsets[lineIndex];
    }
  }, delay);
};

const scrollToStyle = (styleId, delay = 100) => {
  setTimeout(() => {
    const style = document.getElementById(styleId);
    if (style) style.scrollIntoView();
  }, delay);
};

const rgbToHex = (rgb = {}) => {
  const componentToHex = (c = 0) => ("0" + Math.round(c).toString(16)).substr(-2).toUpperCase();
  const r = rgb.red != null ? rgb.red : rgb.r;
  const g = rgb.green != null ? rgb.green : rgb.g;
  const b = rgb.blue != null ? rgb.blue : rgb.b;
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const getStyleObject = (textStyle) => {
  const styleObj = {};
  if (textStyle.fontName) styleObj.fontFamily = textStyle.fontName;
  if (textStyle.fontPostScriptName) styleObj.fontFileFamily = textStyle.fontPostScriptName;
  if (textStyle.syntheticBold) styleObj.fontWeight = "bold";
  if (textStyle.syntheticItalic) styleObj.fontStyle = "italic";
  if (textStyle.fontCaps === "allCaps") styleObj.textTransform = "uppercase";
  if (textStyle.fontCaps === "smallCaps") styleObj.textTransform = "lowercase";
  if (textStyle.underline && textStyle.underline !== "underlineOff") styleObj.textDecoration = "underline";
  if (textStyle.strikethrough && textStyle.strikethrough !== "strikethroughOff") {
    if (styleObj.textDecoration) styleObj.textDecoration += " line-through";
    else styleObj.textDecoration = "line-through";
  }
  return styleObj;
};

const getDefaultStyle = () => {
  return {
    layerText: {
      textGridding: "none",
      orientation: "horizontal",
      antiAlias: "antiAliasSmooth",
      textStyleRange: [
        {
          from: 0,
          to: 100,
          textStyle: {
            fontPostScriptName: "Tahoma",
            fontName: "Tahoma",
            fontStyleName: "Regular",
            fontScript: 0,
            fontTechnology: 1,
            fontAvailable: true,
            size: 14,
            impliedFontSize: 14,
            horizontalScale: 100,
            verticalScale: 100,
            autoLeading: true,
            tracking: 0,
            baselineShift: 0,
            impliedBaselineShift: 0,
            autoKern: "metricsKern",
            fontCaps: "normal",
            digitSet: "defaultDigits",
            diacXOffset: 0,
            markYDistFromBaseline: 100,
            otbaseline: "normal",
            ligature: false,
            altligature: false,
            connectionForms: false,
            contextualLigatures: false,
            baselineDirection: "withStream",
            color: { red: 0, green: 0, blue: 0 },
          },
        },
      ],
      paragraphStyleRange: [
        {
          from: 0,
          to: 100,
          paragraphStyle: {
            burasagari: "burasagariNone",
            singleWordJustification: "justifyAll",
            justificationMethodType: "justifMethodAutomatic",
            textEveryLineComposer: false,
            alignment: "center",
            hangingRoman: true,
            hyphenate: true,
          },
        },
      ],
    },
    typeUnit: "pixelsUnit",
  };
};

const getDefaultStroke = () => {
  return {
    enabled: false,
    size: 0,
    opacity: 100,
    position: "outer",
    color: { r: 255, g: 255, b: 255 },
  };
};

const openFile = (path, autoClose = false) => {
  const encodedPath = JSON.stringify(path);
  csInterface.evalScript(
    "openFile(" + encodedPath + ", " + (autoClose ? "true" : "false") + ")"
  );
};

// FontScanR: scan one .psd file for text-layer font data
const scanPsdFonts = (path, callback) => {
  csInterface.evalScript(
    "scanPsdFonts(" + getExtendScriptString(path) + ")",
    trackHostAction((data) => {
      callback(safeJsonParse(data, { error: "parseFailed", file: path }));
    })
  );
};

export { csInterface, locale, openUrl, readStorage, writeToStorage, flushStorageWrite, deleteStorageFile, nativeAlert, nativeConfirm, getUserFonts, refreshUserFonts, getActiveLayerText, getSelectedTextLayers, getTypeRSelectionSnapshot, setActiveLayerText, setSelectedTextLayers, setLayerTextFast, getCurrentSelection, getSelectionBoundsHash, addPhotoshopEventListener, hasReceivedPhotoshopEvents, isPhotoshopSelectEvent, isPhotoshopMoveEvent, isHostActionPending, notePanelActivity, isPanelIdle, notePanelInteraction, isPanelInteracting, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, deselectDocument, undoLastTextChange, getActiveLayerRenderedText, getAllLayersRenderedTexts, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, toggleCleaningLayers, getHotkeyPressed, onMouseShortcut, startForegroundWatcher, resizeTextArea, scrollToLine, scrollToStyle, rgbToHex, getStyleObject, getDefaultStyle, getDefaultStroke, openFile, scanPsdFonts, getUpdateTestConfig, clearUpdateTestConfig, checkUpdate, prefetchUpdateZip, downloadAndInstallUpdate, convertHtmlToMarkdown, parseMarkdownRuns, convertTplHexToTypeRFormat };
