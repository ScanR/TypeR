import { makeBuffer, makeDirectories, homeDirectory } from "./nodeCompat";
// Installs downloaded fonts straight into the per-user font locations, so a
// font picked in the viewer becomes usable in Photoshop without the manual
// download + double-click + install round-trip.
//
// Windows: per-user install (no admin rights) — the file goes to
// %LOCALAPPDATA%\Microsoft\Windows\Fonts and is registered under the HKCU
// Fonts key, then AddFontResource + WM_FONTCHANGE tell running apps about it.
// macOS: copying into ~/Library/Fonts is enough, CoreText watches the folder.

const FONT_REGISTRY_PATH = "HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";

const getNodeRequire = () =>
  (typeof window !== "undefined" && window.cep_node && window.cep_node.require) ||
  (typeof window !== "undefined" && typeof window.require === "function" ? window.require : null);

const getPlatform = () => {
  const platform = (typeof navigator !== "undefined" && navigator.platform) || "";
  if (platform.indexOf("Win") === 0) return "win";
  if (/Mac/i.test(platform)) return "mac";
  return "";
};

const isFontInstallSupported = () => {
  if (!getPlatform()) return false;
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) return false;
  try {
    return !!nodeRequire("fs") && !!nodeRequire("path") && !!nodeRequire("os");
  } catch (e) {
    return false;
  }
};

const registryFontType = (fileName) => (/\.otf$/i.test(String(fileName || "")) ? "OpenType" : "TrueType");

const registryValueName = (displayName, fileName) => {
  const clean = String(displayName || "").replace(/[\u0000-\u001f]/g, " ").trim() || String(fileName || "font");
  return `${clean} (${registryFontType(fileName)})`;
};

const psSingleQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const buildWindowsRegistrationScript = (entries) => {
  const lines = [
    "$ErrorActionPreference = 'Stop';",
    `$reg = ${psSingleQuote(FONT_REGISTRY_PATH)};`,
    "if (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null };",
    "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class TypeRFontApi { [DllImport(\"gdi32.dll\")] public static extern int AddFontResource(string path); [DllImport(\"user32.dll\")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result); }';",
  ];
  (entries || []).forEach((entry) => {
    lines.push(`New-ItemProperty -Path $reg -Name ${psSingleQuote(entry.registryName)} -Value ${psSingleQuote(entry.path)} -PropertyType String -Force | Out-Null;`);
    lines.push(`[void][TypeRFontApi]::AddFontResource(${psSingleQuote(entry.path)});`);
  });
  // HWND_BROADCAST + WM_FONTCHANGE with SMTO_ABORTIFHUNG: a hung window must
  // not stall the install past its 1s timeout.
  lines.push("$out = [IntPtr]::Zero;");
  lines.push("[void][TypeRFontApi]::SendMessageTimeout([IntPtr]0xffff, 0x1D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$out);");
  return lines.join(" ");
};

const runWindowsRegistration = (nodeRequire, script) =>
  new Promise((resolve, reject) => {
    let child;
    try {
      const { spawn } = nodeRequire("child_process");
      const { Buffer } = nodeRequire("buffer");
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", makeBuffer(Buffer, script, "utf16le").toString("base64")],
        { windowsHide: true, stdio: "ignore" }
      );
    } catch (e) {
      reject(e);
      return;
    }
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("registrationFailed"))));
  });

const getInstallDir = (nodeRequire, platform) => {
  const path = nodeRequire("path");
  const os = nodeRequire("os");
  let env = {};
  try { env = nodeRequire("process").env || {}; } catch (error) { /* CEP may not expose process. */ }
  const home = homeDirectory(os, env);
  if (platform === "win") {
    let localAppData = "";
    try {
      localAppData = nodeRequire("process").env.LOCALAPPDATA || "";
    } catch (e) {
      // Fall back to the default profile layout below.
    }
    const base = localAppData || path.join(home, "AppData", "Local");
    return path.join(base, "Microsoft", "Windows", "Fonts");
  }
  return path.join(home, "Library", "Fonts");
};

// files: [{ saveName, displayName, bytes }] — saveName must already be a safe,
// unique file name (the viewer builds it with makeUniqueFileNames).
const installFontFiles = async (files, onProgress) => {
  const platform = getPlatform();
  const nodeRequire = getNodeRequire();
  if (!platform || !nodeRequire) throw new Error("installUnsupported");
  const fs = nodeRequire("fs");
  const path = nodeRequire("path");
  const { Buffer } = nodeRequire("buffer");
  const dir = getInstallDir(nodeRequire, platform);
  makeDirectories(fs, path, dir);
  const entries = [];
  (files || []).forEach((file, index) => {
    const target = path.join(dir, file.saveName);
    fs.writeFileSync(target, makeBuffer(Buffer, file.bytes));
    entries.push({ path: target, registryName: registryValueName(file.displayName, file.saveName) });
    if (onProgress) onProgress(index + 1, files.length);
  });
  if (platform === "win") await runWindowsRegistration(nodeRequire, buildWindowsRegistrationScript(entries));
  return entries.length;
};

export {
  FONT_REGISTRY_PATH,
  buildWindowsRegistrationScript,
  getInstallDir,
  installFontFiles,
  isFontInstallSupported,
  psSingleQuote,
  registryFontType,
  registryValueName,
};
