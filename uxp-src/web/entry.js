// Panel boot: the application reads its storage, locale and host environment
// while its modules evaluate, so the CEP environment is rebuilt from the
// host's init payload first, and only then is the application loaded.
import { request, notify, on } from "./bridge";
import { installCepEnvironment } from "./cepShim";
import { installErrorReporting, installFetchFallback, installFileInputs, installInputCentering, installLocalStorage } from "./domShims";
import "./webkit.scss";

// The WebView is WebKit on macOS and Chromium (WebView2) on Windows: the
// layout fixes of webkit.scss only apply to the first
const IS_WEBKIT = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent);
document.documentElement.classList.add("typer-uxp");
if (IS_WEBKIT) document.documentElement.classList.add("typer-webkit");

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
  throw new Error("the plugin host does not answer");
}

async function start() {
  installErrorReporting(report);
  const init = await requestInit();
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
  installFetchFallback();
  if (IS_WEBKIT) installInputCentering();
  await import(/* webpackMode: "eager" */ "../../app_src/index.jsx");
}

start().catch((error) => {
  report("TypeR could not start: " + ((error && (error.stack || error.message)) || error));
  const notice = document.createElement("div");
  notice.style.cssText = "padding:12px;color:#f2bc76;font:12px sans-serif";
  notice.textContent = "TypeR could not start: " + ((error && error.message) || error);
  document.body.appendChild(notice);
});
