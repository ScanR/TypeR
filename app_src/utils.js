import "./lib/CSInterface";

const csInterface = new window.CSInterface();
const path = csInterface.getSystemPath(window.SystemPath.EXTENSION);
const storagePath = path + "/storage";

let locale = {};

const openUrl = window.cep.util.openURLInDefaultBrowser;

const checkUpdate = async (currentVersion) => {
  try {
    const response = await fetch(
      "https://api.github.com/repos/ScanR/TypeR/releases",
      { headers: { Accept: "application/vnd.github.v3.html+json" } }
    );
    if (!response.ok) return null;
    const releases = await response.json();
    
    const parseVersion = (version) => {
      const cleanVersion = version.replace(/^v/, '');
      return cleanVersion.split('.').map(num => parseInt(num, 10));
    };
    
    const compareVersions = (v1, v2) => {
      const version1 = parseVersion(v1);
      const version2 = parseVersion(v2);
      
      for (let i = 0; i < Math.max(version1.length, version2.length); i++) {
        const num1 = version1[i] || 0;
        const num2 = version2[i] || 0;
        
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
      }
      return 0;
    };
    
    const currentVersionClean = currentVersion.replace(/^v/, '');
    const newerReleases = releases.filter(release => {
      const releaseVersion = release.tag_name.replace(/^v/, '');
      return compareVersions(releaseVersion, currentVersionClean) > 0;
    });
    
    if (newerReleases.length > 0) {
      newerReleases.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
      
      // Get the download URL for the latest release ZIP
      const latestRelease = newerReleases[0];
      let downloadUrl = null;
      
      // Try to find TypeR.zip in assets first
      if (latestRelease.assets && latestRelease.assets.length > 0) {
        const zipAsset = latestRelease.assets.find(a => 
          a.name.toLowerCase().endsWith('.zip') && 
          a.name.toLowerCase().includes('typer')
        );
        if (zipAsset) {
          downloadUrl = zipAsset.browser_download_url;
        }
      }
      // Fallback to zipball_url (source code zip)
      if (!downloadUrl) {
        downloadUrl = latestRelease.zipball_url;
      }
      
      return {
        version: newerReleases[0].tag_name,
        downloadUrl: downloadUrl,
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

const getOSType = () => {
  const os = csInterface.getOSInformation();
  if (os && os.toLowerCase().indexOf('mac') !== -1) {
    return 'mac';
  }
  return 'win';
};

const downloadAndInstallUpdate = async (downloadUrl, onProgress, onComplete, onError) => {
  try {
    const osType = getOSType();
    
    // Get user's Downloads folder
    const userHome = osType === 'win' 
      ? csInterface.getSystemPath(window.SystemPath.USER_DATA).split('/AppData/')[0]
      : csInterface.getSystemPath(window.SystemPath.USER_DATA).replace('/Library/Application Support', '');
    
    const downloadsPath = osType === 'win'
      ? `${userHome}/Downloads/TypeR_Update`
      : `${userHome}/Downloads/TypeR_Update`;
    
    const zipPath = `${downloadsPath}/TypeR.zip`;
    
    onProgress && onProgress(locale.updateDownloading || 'Downloading update...');
    
    // Clean and create download directory
    csInterface.evalScript(`deleteFolder("${downloadsPath.replace(/\\/g, '\\\\').replace(/\//g, '\\\\')}")`, () => {
      // Use cep.fs to create directory
      const mkdirResult = window.cep.fs.makedir(downloadsPath);
      if (mkdirResult.err && mkdirResult.err !== 0 && mkdirResult.err !== 17) { // 17 = already exists
        onError && onError('Failed to create download directory');
        return;
      }
      
      // Download the ZIP file
      fetch(downloadUrl, {
        headers: { Accept: 'application/octet-stream' }
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Download failed: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(arrayBuffer => {
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Convert to base64 for file writing
        let binary = '';
        const len = uint8Array.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64Data = window.btoa(binary);
        
        onProgress && onProgress(locale.updateExtracting || 'Extracting files...');
        
        // Write ZIP file using base64 encoding
        const writeResult = window.cep.fs.writeFile(zipPath, base64Data, window.cep.encoding.Base64);
        if (writeResult.err) {
          throw new Error('Failed to write ZIP file');
        }
        
        // Create the auto-install script
        if (osType === 'win') {
          // Windows: Create PowerShell install script
          const installScript = `# TypeR Auto-Update Script
# This script will install the update after Photoshop is closed
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$zipPath = Join-Path $ScriptDir "TypeR.zip"
$extractPath = Join-Path $ScriptDir "extracted"
$AppData = $env:APPDATA
$TargetDir = Join-Path $AppData "Adobe\\CEP\\extensions\\typertools"
$TempBackupContainer = Join-Path $env:TEMP "typer_backup_container"

Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host "|                      TypeR Auto-Updater                          |" -ForegroundColor Cyan
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

# Check if Photoshop is running
$psProcess = Get-Process -Name "Photoshop" -ErrorAction SilentlyContinue
if ($psProcess) {
    Write-Host "[!] Photoshop is running. Please close it first." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter after closing Photoshop..."
}

Write-Host "[*] Installing update..." -ForegroundColor Cyan

# Cleanup temp backup
if (Test-Path $TempBackupContainer) { Remove-Item $TempBackupContainer -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -Path $TempBackupContainer -ItemType Directory -Force | Out-Null

# Backup storage
if (Test-Path "$TargetDir\\storage") {
    Copy-Item "$TargetDir\\storage" -Destination $TempBackupContainer -Recurse -Force -ErrorAction SilentlyContinue
}

# Extract ZIP
if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
New-Item -Path $extractPath -ItemType Directory -Force | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

# Find content folder - check if files are at root or in a subfolder
# If CSXS folder exists at root, files are directly there
# Otherwise, look for a subfolder containing CSXS
if (Test-Path "$extractPath\\CSXS") {
    $sourcePath = $extractPath
} else {
    $contentFolder = Get-ChildItem -Path $extractPath -Directory | Where-Object { Test-Path "$($_.FullName)\\CSXS" } | Select-Object -First 1
    if ($contentFolder) {
        $sourcePath = $contentFolder.FullName
    } else {
        $sourcePath = $extractPath
    }
}

# Clean target directory
if (Test-Path $TargetDir) {
    Remove-Item $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -Path $TargetDir -ItemType Directory -Force | Out-Null

# Copy files
$FoldersToCopy = @("app", "CSXS", "icons", "locale")
foreach ($folder in $FoldersToCopy) {
    $src = Join-Path $sourcePath $folder
    $dst = Join-Path $TargetDir $folder
    if (Test-Path $src) {
        Copy-Item $src -Destination $dst -Recurse -Force
    }
}

# Copy themes
if (Test-Path "$sourcePath\\themes") {
    $ThemeDest = "$TargetDir\\app\\themes"
    if (-not (Test-Path $ThemeDest)) { New-Item $ThemeDest -ItemType Directory -Force | Out-Null }
    Copy-Item "$sourcePath\\themes\\*" -Destination $ThemeDest -Recurse -Force
}

# Restore storage
if (Test-Path "$TempBackupContainer\\storage") {
    Copy-Item "$TempBackupContainer\\storage" -Destination "$TargetDir" -Recurse -Force
}

# Cleanup
if (Test-Path $TempBackupContainer) { Remove-Item $TempBackupContainer -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host "|                      Update Complete!                            |" -ForegroundColor Green
Write-Host "+------------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""
Write-Host "You can now open Photoshop and use TypeR." -ForegroundColor Cyan
Write-Host ""
Write-Host "This folder will be deleted automatically." -ForegroundColor DarkGray
Read-Host "Press Enter to exit..."

# Cleanup update folder - delete the entire TypeR_Update folder
$parentDir = Split-Path $ScriptDir -Parent
$folderName = Split-Path $ScriptDir -Leaf
Set-Location $parentDir
Remove-Item $ScriptDir -Recurse -Force -ErrorAction SilentlyContinue
`;
          
          const cmdScript = `@echo off
cd /d "%~dp0"
PowerShell -NoProfile -ExecutionPolicy Bypass -File "install_update.ps1"
`;
          
          const psScriptPath = `${downloadsPath}/install_update.ps1`;
          const cmdScriptPath = `${downloadsPath}/install_update.cmd`;
          
          window.cep.fs.writeFile(psScriptPath, installScript);
          window.cep.fs.writeFile(cmdScriptPath, cmdScript);
          
          onProgress && onProgress(locale.updateReady || 'Update ready to install...');
          
          // Open the folder in Explorer
          csInterface.evalScript(`openFolder("${downloadsPath.replace(/\\/g, '\\\\').replace(/\//g, '\\\\')}")`, () => {
            onComplete && onComplete(true); // true = needs manual step
          });
          
        } else {
          // macOS: Create shell install script
          const installScript = `#!/bin/bash
# TypeR Auto-Update Script

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIP_PATH="$SCRIPT_DIR/TypeR.zip"
EXTRACT_PATH="$SCRIPT_DIR/extracted"
DEST_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/typertools"
TEMP_STORAGE="$SCRIPT_DIR/__storage_backup"

echo "+------------------------------------------------------------------+"
echo "|                      TypeR Auto-Updater                          |"
echo "+------------------------------------------------------------------+"
echo ""

# Check if Photoshop is running
if pgrep -x "Adobe Photoshop" > /dev/null; then
    echo "[!] Photoshop is running. Please close it first."
    echo ""
    read -p "Press Enter after closing Photoshop..."
fi

echo "[*] Installing update..."

# Backup storage
if [ -e "$DEST_DIR/storage" ]; then
    cp "$DEST_DIR/storage" "$TEMP_STORAGE"
fi

# Extract ZIP
rm -rf "$EXTRACT_PATH"
mkdir -p "$EXTRACT_PATH"
unzip -o "$ZIP_PATH" -d "$EXTRACT_PATH"

# Find content folder - check if files are at root or in a subfolder
if [ -d "$EXTRACT_PATH/CSXS" ]; then
    SOURCE_PATH="$EXTRACT_PATH"
else
    CONTENT_FOLDER=$(find "$EXTRACT_PATH" -maxdepth 2 -type d -name "CSXS" | head -1 | xargs dirname 2>/dev/null)
    if [ -n "$CONTENT_FOLDER" ]; then
        SOURCE_PATH="$CONTENT_FOLDER"
    else
        SOURCE_PATH="$EXTRACT_PATH"
    fi
fi

# Clean and recreate target
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

# Copy files
for folder in app CSXS icons locale; do
    if [ -d "$SOURCE_PATH/$folder" ]; then
        cp -r "$SOURCE_PATH/$folder" "$DEST_DIR/"
    fi
done

# Copy themes
if [ -d "$SOURCE_PATH/themes" ]; then
    mkdir -p "$DEST_DIR/app/themes"
    cp -r "$SOURCE_PATH/themes/"* "$DEST_DIR/app/themes/"
fi

# Restore storage
if [ -f "$TEMP_STORAGE" ]; then
    cp "$TEMP_STORAGE" "$DEST_DIR/storage"
fi

echo ""
echo "+------------------------------------------------------------------+"
echo "|                      Update Complete!                            |"
echo "+------------------------------------------------------------------+"
echo ""
echo "You can now open Photoshop and use TypeR."
echo ""
echo "This folder will be deleted automatically."
read -p "Press Enter to exit..."

# Cleanup - delete the entire TypeR_Update folder
cd "$HOME/Downloads"
rm -rf "$SCRIPT_DIR"
`;
          
          const shScriptPath = `${downloadsPath}/install_update.command`;
          window.cep.fs.writeFile(shScriptPath, installScript);
          
          // Make executable
          csInterface.evalScript(`makeExecutable("${shScriptPath}")`, () => {
            onProgress && onProgress(locale.updateReady || 'Update ready to install...');
            
            // Open the folder in Finder
            csInterface.evalScript(`openFolder("${downloadsPath}")`, () => {
              onComplete && onComplete(true); // true = needs manual step
            });
          });
        }
      })
      .catch(err => {
        console.error('Update failed:', err);
        onError && onError(err.message || 'Update failed');
      });
    });
    
  } catch (e) {
    console.error('Update failed:', e);
    onError && onError(e.message || 'Update failed');
  }
};

const readStorage = (key) => {
  const result = window.cep.fs.readFile(storagePath);
  if (result.err) {
    return key
      ? void 0
      : {
          error: result.err,
          data: {},
        };
  } else {
    const data = JSON.parse(result.data || "{}") || {};
    return key ? data[key] : { data };
  }
};

const writeToStorage = (data, rewrite) => {
  const storage = readStorage();
  if (storage.error || rewrite) {
    const result = window.cep.fs.writeFile(storagePath, JSON.stringify(data));
    return !result.err;
  } else {
    data = Object.assign({}, storage.data, data);
    const result = window.cep.fs.writeFile(storagePath, JSON.stringify(data));
    return !result.err;
  }
};

const deleteStorageFile = () => {
  const result = window.cep.fs.deleteFile(storagePath);
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
const getUserFonts = () => {
  return Array.isArray(userFonts) ? userFonts.concat([]) : [];
};
if (!userFonts) {
  csInterface.evalScript("getUserFonts()", (data) => {
    const dataObj = JSON.parse(data || "{}");
    const fonts = dataObj.fonts || [];
    userFonts = fonts;
  });
}

const getActiveLayerText = (callback) => {
  csInterface.evalScript("getActiveLayerText()", (data) => {
    const dataObj = JSON.parse(data || "{}");
    if (!data || !dataObj.textProps) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    else callback(dataObj);
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

  const walk = (segment, style) => {
    let cursor = 0;
    while (cursor < segment.length) {
      const match = findNextMarker(segment, cursor);
      if (!match) {
        pushRun(segment.slice(cursor), style);
        break;
      }
      if (match.index > cursor) {
        pushRun(segment.slice(cursor, match.index), style);
      }
      const afterOpen = match.index + match.marker.token.length;
      const closeIndex = findUnescapedToken(segment, match.marker.token, afterOpen);
      if (closeIndex === -1) {
        pushRun(segment.slice(match.index, afterOpen), style);
        cursor = afterOpen;
        continue;
      }
      const inner = segment.slice(afterOpen, closeIndex);
      const nextStyle = {
        bold: style.bold || match.marker.bold,
        italic: style.italic || match.marker.italic,
      };
      walk(inner, nextStyle);
      cursor = closeIndex + match.marker.token.length;
    }
  };

  walk(text, { bold: false, italic: false });

  const plainText = runs.map((run) => run.text).join("");
  const hasFormatting = runs.some((run) => run.bold || run.italic);
  return { text: plainText, runs, hasFormatting };
};

const isMarkdownEnabled = () => readStorage("interpretMarkdown") === true;

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
  const data = JSON.stringify({
    text: parsed.text,
    style,
    direction,
    richTextRuns: parsed.richTextRuns,
  });
  csInterface.evalScript("setActiveLayerText(" + data + ")", (error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  });
};

const getCurrentSelection = (callback = () => {}) => {
  csInterface.evalScript("getCurrentSelection()", (result) => {
    const data = JSON.parse(result || "{}");
    if (data.error) {
      callback(null);
    } else {
      callback(data);
    }
  });
};

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

const getSelectionChanged = (callback = () => {}) => {
  csInterface.evalScript("getSelectionChanged()", (result) => {
    const data = JSON.parse(result || "{}");
    if (data.noChange) {
      callback(null);
    } else if (data.error) {
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
  const parsed = buildRichTextPayload(text);
  const data = JSON.stringify({
    text: parsed.text,
    style,
    padding: padding || 0,
    direction,
    richTextRuns: parsed.richTextRuns,
  });
  csInterface.evalScript("createTextLayerInSelection(" + data + ", " + !!pointText + ")", (error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error) nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    callback(!error);
  });
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
    selections,
    padding: padding || 0,
    direction,
  });
  csInterface.evalScript("createTextLayersInStoredSelections(" + data + ", " + !!pointText + ")", (error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error === "noSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error === "invalidSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error && error.indexOf("scriptError:") === 0) nativeAlert(error.replace("scriptError: ", ""), locale.errorTitle, true);
    else if (error) nativeAlert("Error: " + error, locale.errorTitle, true);
    callback(!error);
  });
};

const alignTextLayerToSelection = (resizeTextBox = false, padding = 0) => {
  const data = JSON.stringify({ resizeTextBox: !!resizeTextBox, padding: padding || 0 });
  csInterface.evalScript("alignTextLayerToSelection(" + data + ")", (error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error === "noSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
  });
};

const changeActiveLayerTextSize = (val, callback = () => {}) => {
  csInterface.evalScript("changeActiveLayerTextSize(" + val + ")", (error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  });
};

const getHotkeyPressed = (callback) => {
  csInterface.evalScript("getHotkeyPressed()", callback);
};

const resizeTextArea = () => {
  const textArea = document.querySelector(".text-area");
  const textLines = document.querySelector(".text-lines");
  if (textArea && textLines) {
    textArea.style.height = textLines.offsetHeight + "px";
  }
};

const scrollToLine = (lineIndex, delay = 300) => {
  lineIndex = lineIndex < 5 ? 0 : lineIndex - 5;
  setTimeout(() => {
    const line = document.querySelectorAll(".text-line")[lineIndex];
    if (line) line.scrollIntoView();
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

export { csInterface, locale, openUrl, readStorage, writeToStorage, deleteStorageFile, nativeAlert, nativeConfirm, getUserFonts, getActiveLayerText, setActiveLayerText, getCurrentSelection, getSelectionBoundsHash, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, getHotkeyPressed, resizeTextArea, scrollToLine, scrollToStyle, rgbToHex, getStyleObject, getDefaultStyle, getDefaultStroke, openFile, checkUpdate, downloadAndInstallUpdate, convertHtmlToMarkdown, parseMarkdownRuns };
