// A few things UXP cannot do at all: start a process (the keyboard helper),
// make a file executable, rescan the installed fonts. ExtendScript still can,
// and Photoshop runs a .jsx file through its Scripts event, which batchPlay
// may play from a modal scope. Used for those one-off calls only: running a
// script costs a few hundred milliseconds of Photoshop's main thread.
const ps = require("photoshop");
const uxp = require("uxp");

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

// app.system(command): the command runs through /bin/sh (cmd.exe on
// Windows), whose parent process is Photoshop
function systemCall(command) {
  return runJsx("app.system(" + JSON.stringify(String(command)) + ");");
}

module.exports = { runJsx, systemCall };
