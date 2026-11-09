// A few things UXP cannot do at all: start a process (the keyboard helper),
// make a file executable, rescan the installed fonts. ExtendScript still can,
// and Photoshop runs a .jsx file through its Scripts event, which batchPlay
// may play from a modal scope. Used for those one-off calls only: running a
// script costs a few hundred milliseconds of Photoshop's main thread.
const ps = require("photoshop");
const uxp = require("uxp");
const os = require('os');
const { createWindowsLauncher } = require('./windowsLauncher');
const { encodeCommand } = require('./webViewRepair');

const lfs = uxp.storage.localFileSystem;
let counter = 0;

async function runJsx(code, commandName = "TypeR") {
  const temporary = await lfs.getTemporaryFolder();
  const file = await temporary.createFile("typer-" + Date.now().toString(36) + "-" + ++counter + ".jsx", { overwrite: true });
  // An uncaught ExtendScript error would surface as a Photoshop alert
  await file.write("try {\n" + String(code) + "\n} catch (typerError) { 'ERR ' + typerError; }");
  const token = lfs.createSessionToken(file);
  try {
    const [result] = await ps.core.executeAsModal(
      () => ps.action.batchPlay([{
        _obj: "AdobeScriptAutomation Scripts",
        javaScript: { _path: token, _kind: "local" },
        javaScriptMessage: "JSM",
        _options: { dialogOptions: "dontDisplay" },
      }], {}),
      { commandName }
    );
    if (result && result._obj === "error") throw new Error(result.message || "ExtendScript error");
    return result && typeof result.javaScriptMessage === "string" ? result.javaScriptMessage : "";
  } finally {
    try {
      await file.delete();
    } catch (error) {}
  }
}

// Windows commands go through a GUI launcher with CreateNoWindow. Only macOS
// keeps app.system; File.execute opens the Windows launcher without a shell.
let windowsLauncher = null;
function launchWindows(command, options) {
  if (!windowsLauncher) windowsLauncher = createWindowsLauncher({
    files: require('./files'), runJsx,
    packed: typeof TYPER_WINDOWS_LAUNCHER !== 'undefined' ? TYPER_WINDOWS_LAUNCHER : null,
    decodeBase64: value => atob(value), wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  });
  return windowsLauncher(command, options);
}
function systemCall(command, options) {
  if (os.platform() === 'win32') return launchWindows(command, options);
  return runJsx("app.system(" + JSON.stringify(String(command)) + ");");
}
function runPowerShell(command, options) {
  return launchWindows(encodeCommand(command, value => btoa(value)), Object.assign({}, options, { mode: 'powershell' }));
}

module.exports = { runJsx, systemCall, runPowerShell };
