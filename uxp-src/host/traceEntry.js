// Crash trace builds only: the entry that also reports main.js failing to load,
// which would otherwise leave an empty panel and no trace at all.
const uxp = require("uxp");

function showLoadFailure(text) {
  const show = () => {
    const status = document.getElementById("typer-status");
    if (!status) return;
    status.textContent = text;
    status.style.display = "block";
  };
  show();
  uxp.entrypoints.setup({ panels: { typer: { create: show, show } } });
}

try {
  require("./main");
} catch (error) {
  const text = "TypeR failed to load: " + ((error && (error.stack || error.message)) || error);
  console.error(text);
  showLoadFailure(text);
  const crashTrace = require("./crashTrace");
  const files = require("./files");
  crashTrace.install();
  crashTrace.note("load", text);
  files.resolveFolders().then(() => crashTrace.open(files.getStorageRoot())).catch(() => {});
}
