// Development builds only (npm run build:uxp:dev): lets the test harness run
// code inside the plugin host or the panel, through files in a temporary
// folder. Never part of a release build.
const fs = require("fs");

const DIR = "/private/tmp/typer-uxp-dev/";

function start(postToPanel, onPanelResult) {
  let busy = false;
  let lastId = null;
  const panelWaiters = new Map();
  onPanelResult((message) => {
    const waiter = panelWaiters.get(message.id);
    if (!waiter) return;
    panelWaiters.delete(message.id);
    waiter(message.error ? "ERR " + message.error : JSON.stringify(message.result === undefined ? null : message.result));
  });
  setInterval(async () => {
    if (busy) return;
    let code = null;
    try {
      code = fs.readFileSync(DIR + "cmd.js", { encoding: "utf-8" });
    } catch (error) {
      return;
    }
    const newline = code.indexOf("\n");
    const header = code.slice(0, newline).split(" ");
    const id = header[0];
    const target = header[1] || "host";
    if (id === lastId) return;
    lastId = id;
    busy = true;
    let out;
    try {
      if (target === "panel") {
        out = await new Promise((resolve) => {
          panelWaiters.set(id, resolve);
          postToPanel({ type: "devEval", id, code: code.slice(newline + 1) });
          setTimeout(() => {
            if (panelWaiters.delete(id)) resolve("TIMEOUT");
          }, 60000);
        });
      } else {
        const fn = new Function("require", "return (async () => {" + code.slice(newline + 1) + "\n})()");
        const result = await fn(__non_webpack_require__);
        out = JSON.stringify(result === undefined ? null : result);
      }
    } catch (error) {
      out = "ERR " + ((error && (error.stack || error.message)) || error);
    }
    try {
      fs.writeFileSync(DIR + "result-" + id + ".txt", String(out));
    } catch (error) {}
    busy = false;
  }, 100);
}

module.exports = { start };
