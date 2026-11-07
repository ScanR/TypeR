// Panel boot: the application reads its storage, locale and host environment
// while its modules evaluate, so the CEP environment is rebuilt from the
// host's init payload first, and only then is the application loaded.
import { request, notify, on, runsInPanel } from "./bridge";
import { installCepEnvironment } from "./cepShim";
import { installErrorReporting, installFetchFallback, installFileInputs, installInputCentering, installLocalStorage } from "./domShims";
import "./webkit.scss";

// The WebView is WebKit on macOS and Chromium (WebView2) on Windows: the
// layout fixes of webkit.scss only apply to the first
const IS_WEBKIT = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
document.documentElement.classList.add("typer-uxp");
if (IS_WEBKIT && !runsInPanel) document.documentElement.classList.add("typer-webkit");
// No WebView: the panel's own DOM, UXP's layout engine (uxp-src/host/inPanel.js)
if (runsInPanel) document.documentElement.classList.add("typer-inpanel");

const report = (text) => notify("panelError", { text: String(text) });

// Development builds: the test harness evaluates code in the panel
if (process.env.TYPER_DEV === "1") {
  on("devEval", async (message) => {
    try {
      // eslint-disable-next-line no-new-func
      const result = await new Function("return (async () => {" + message.code + "\n})()")();
      notify("devResult", { id: message.id, result });
    } catch (error) {
      notify("devResult", { id: message.id, error: String((error && (error.stack || error.message)) || error) });
    }
  });
}

// The host may attach its listener after this page started: ask again until
// it answers (init only reads, so a repeated request is harmless)
async function requestInit() {
  const TIMEOUT = {};
  for (let attempt = 0; attempt < 60; attempt++) {
    notify("ready");
    const result = await Promise.race([request("init"), new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), 1000))]);
    if (result !== TIMEOUT) return result;
  }
  // The host reloads the panel once on this reason (uxp-src/host/main.js)
  const error = new Error("the plugin host does not answer");
  error.reason = "init-timeout";
  throw error;
}

// Startup milestones, in ms since the page started (perf diagnostics)
const startup = (window.__typerStartup = {});
const mark = (name) => {
  startup[name] = Math.round(performance.now());
  if (process.env.TYPER_DIAGNOSTIC === "1" && window.typerDiagnosticNote) window.typerDiagnosticNote('app.' + name, startup[name] + ' ms');
};

async function start() {
  installErrorReporting(report);
  mark("script");
  const init = await requestInit();
  mark("init");
  installCepEnvironment(init);
  const root = new window.CSInterface().getSystemPath(window.SystemPath.EXTENSION);
  installLocalStorage(
    (name) => {
      const result = window.cep.fs.readFile(root + "/" + name);
      return result && !result.err ? result.data : null;
    },
    (name, text) => window.cep.fs.writeFile(root + "/" + name, text)
  );
  installFileInputs();
  // In the panel, fetch is UXP's own, without CORS, and the host's fetchUrl
  // uses it: the fallback would call itself
  if (!runsInPanel) installFetchFallback();
  if (IS_WEBKIT && !runsInPanel) installInputCentering();
  await import(/* webpackMode: "eager" */ "../../app_src/index.jsx");
  mark("app");
  notify("appReady");
  requestAnimationFrame(() => requestAnimationFrame(() => mark("painted")));
}

start().catch((error) => {
  notify("panelError", {
    text: "TypeR could not start: " + ((error && (error.stack || error.message)) || error),
    reason: (error && error.reason) || "start",
  });
  const notice = document.createElement("div");
  notice.style.cssText = "padding:12px;color:#f2bc76;font:12px sans-serif";
  notice.textContent = "TypeR could not start: " + ((error && error.message) || error);
  document.body.appendChild(notice);
});
