// TypeR without a WebView. Photoshop refuses every third-party WebView when
// its WebView data storage does not exist, which UXP builds from the signed-in
// Adobe user (docs/uxp-webview-refused.md): Photoshop without an Adobe user
// (Feature Restricted Licensing, offline or modified installations) never has
// one, and others may lack it for the first seconds of a session. The same
// application then runs in the panel's own DOM: uxp/inpanel/inpanel.js, built
// from the panel's sources (webpack.uxp.config.js), with a direct channel to
// the host in place of postMessage (uxp-src/web/bridge.js).
const fs = require("fs");

const BUNDLE = "./inpanel/inpanel.js";
const STYLESHEET = "plugin:/inpanel/inpanel.css";

// The application's stylesheet, once per document
function insertStylesheet(document, text) {
  let style = document.getElementById("typer-inpanel-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "typer-inpanel-style";
    document.head.appendChild(style);
  }
  if (style.textContent !== text) style.textContent = text;
}

// What the application expects in its page (uxp-src/web/index.html)
function insertPageElements(document) {
  if (!document.getElementById("topcoat")) {
    const link = document.createElement("link");
    link.id = "topcoat";
    link.setAttribute("rel", "stylesheet");
    document.head.appendChild(link);
  }
  if (!document.getElementById("hostStyle")) {
    const style = document.createElement("style");
    style.id = "hostStyle";
    document.head.appendChild(style);
  }
  let app = document.getElementById("app");
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
  }
  // A previous run's page, when Photoshop recreated the panel
  while (app.firstChild) app.removeChild(app.firstChild);
  document.body.classList.add("hostElt");
  return app;
}

// Starts the application in the panel. receive(message) gets the
// application's messages, already parsed, as the WebView's would arrive;
// the result's deliver(message) sends the host's messages to it.
// Both directions are asynchronous, like postMessage. Called again when
// Photoshop recreates the panel: each call runs a new instance (the bundle
// exports a function, webpack.uxp.config.js), on a new channel.
function startInPanel({ document, window, receive, requireModule }) {
  let toPanel = null;
  const channel = {
    toHost(text) {
      setTimeout(() => {
        let message = null;
        try { message = JSON.parse(text); } catch (error) { return; }
        receive(message);
      }, 0);
    },
    set toPanel(listener) { toPanel = listener; },
    get toPanel() { return toPanel; },
  };
  window.__typerInPanel = channel;
  const css = fs.readFileSync(STYLESHEET, { encoding: "utf-8" });
  insertStylesheet(document, String(css));
  insertPageElements(document);
  const run = requireModule(BUNDLE);
  if (typeof run !== "function") throw new Error("TypeR: " + BUNDLE + " is not a TypeR panel bundle");
  run();
  return {
    deliver(message) {
      const text = JSON.stringify(message);
      setTimeout(() => { if (toPanel) toPanel(text); }, 0);
    },
  };
}

module.exports = { startInPanel, BUNDLE, STYLESHEET };
