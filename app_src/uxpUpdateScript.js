// Updating the UXP plugin without restarting Photoshop. Creative Cloud's plugin
// installer (UPIA) only loads a newer version at Photoshop's next start, unless
// the plugin is removed first: then Photoshop stops the old code and runs the
// new one within a second. Removing the plugin also stops the code driving the
// update, so a script started beforehand does the work.
//
// The script reports only when the plugin is still running to read it: "restart"
// (the removal did not happen, the new version is loaded at the next start) or
// "failed" (nothing changed). Once the plugin is removed, the script is on its
// own: it tries again, then installs the files prepared in fallback/ by hand,
// which takes effect at the next start.
//
// The Windows script holds no path that could need another code page than cmd's:
// it finds its folder through %~dp0 and the rest through %APPDATA%.

export const UPDATE_FOLDER = "update";
export const UPDATE_PACKAGE = "package.ccx";
export const UPDATE_STARTED = "started";
export const UPDATE_STATUS = "status";
export const UPDATE_FALLBACK = "fallback";
export const UPDATE_REGISTRY = "PS.json";
export const UPDATE_STATUS_RESTART = "restart";
export const UPDATE_STATUS_FAILED = "failed";
export const UPDATE_SCRIPT_MAC = "typer-update.sh";
export const UPDATE_SCRIPT_WINDOWS = "typer-update.cmd";

const INSTALL_ATTEMPTS = 3;

const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";

export const buildMacUpdateScript = ({ upia, pluginName, pluginFolder, pluginsFolder, registry }) => [
  "#!/bin/sh",
  'HERE="$(cd "$(dirname "$0")" && pwd)"',
  "UPIA=" + shellQuote(upia),
  // The installer's exit code does not tell: a failure can still exit with 0
  'passed() { [ "$1" -eq 0 ] && ! grep -qi fail "$2"; }',
  'install() { "$UPIA" --install "$HERE/' + UPDATE_PACKAGE + '" > "$HERE/install.log" 2>&1; passed $? "$HERE/install.log"; }',
  'echo started > "$HERE/' + UPDATE_STARTED + '"',
  '"$UPIA" --remove ' + shellQuote(pluginName) + ' > "$HERE/remove.log" 2>&1',
  'if ! passed $? "$HERE/remove.log"; then',
  '  if install; then echo ' + UPDATE_STATUS_RESTART + ' > "$HERE/' + UPDATE_STATUS + '"; else echo ' + UPDATE_STATUS_FAILED + ' > "$HERE/' + UPDATE_STATUS + '"; fi',
  "  exit 0",
  "fi",
  "attempt=0",
  "while [ $attempt -lt " + INSTALL_ATTEMPTS + " ]; do",
  "  attempt=$((attempt + 1))",
  "  if install; then exit 0; fi",
  "  sleep 2",
  "done",
  'cp -R "$HERE/' + UPDATE_FALLBACK + "/" + pluginFolder + '" ' + shellQuote(pluginsFolder) + "/ && cp \"$HERE/" + UPDATE_FALLBACK + "/" + UPDATE_REGISTRY + '" ' + shellQuote(registry),
  "",
].join("\n");

export const buildWindowsUpdateScript = ({ upia, pluginName, pluginFolder }) => [
  "@echo off",
  "setlocal",
  'set "HERE=%~dp0"',
  'set "UPIA=' + upia + '"',
  'echo started> "%HERE%' + UPDATE_STARTED + '"',
  '"%UPIA%" --remove "' + pluginName + '" > "%HERE%remove.log" 2>&1',
  "if errorlevel 1 goto not_removed",
  'findstr /I "fail" "%HERE%remove.log" >nul',
  "if not errorlevel 1 goto not_removed",
  "set ATTEMPT=0",
  ":install",
  "set /A ATTEMPT+=1",
  '"%UPIA%" --install "%HERE%' + UPDATE_PACKAGE + '" > "%HERE%install.log" 2>&1',
  "if errorlevel 1 goto install_failed",
  'findstr /I "fail" "%HERE%install.log" >nul',
  "if errorlevel 1 goto end",
  ":install_failed",
  "if %ATTEMPT% GEQ " + INSTALL_ATTEMPTS + " goto fallback",
  // timeout refuses to run without a console
  "ping -n 3 127.0.0.1 >nul",
  "goto install",
  ":fallback",
  'xcopy /E /I /Y /Q "%HERE%' + UPDATE_FALLBACK + "\\" + pluginFolder + '" "%APPDATA%\\Adobe\\UXP\\Plugins\\External\\' + pluginFolder + '\\" >nul',
  'copy /Y "%HERE%' + UPDATE_FALLBACK + "\\" + UPDATE_REGISTRY + '" "%APPDATA%\\Adobe\\UXP\\PluginsInfo\\v1\\PS.json" >nul',
  "goto end",
  ":not_removed",
  '"%UPIA%" --install "%HERE%' + UPDATE_PACKAGE + '" > "%HERE%install.log" 2>&1',
  "if errorlevel 1 goto report_failed",
  'findstr /I "fail" "%HERE%install.log" >nul',
  "if not errorlevel 1 goto report_failed",
  "echo " + UPDATE_STATUS_RESTART + '> "%HERE%' + UPDATE_STATUS + '"',
  "goto end",
  ":report_failed",
  "echo " + UPDATE_STATUS_FAILED + '> "%HERE%' + UPDATE_STATUS + '"',
  ":end",
  "endlocal",
  "",
].join("\r\n");

// The command that starts the script in the background. Photoshop would wait
// for it otherwise, with its main thread held.
export const macUpdateCommand = (scriptPath) => "( sh " + shellQuote(scriptPath) + " ) >/dev/null 2>&1 &";
export const windowsUpdateCommand = () => 'start "" /B cmd /c "%APPDATA%\\TypeR\\UXP\\' + UPDATE_FOLDER + "\\" + UPDATE_SCRIPT_WINDOWS + '"';
