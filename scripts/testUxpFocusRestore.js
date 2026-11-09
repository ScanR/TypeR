const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the host entry point used after paste/style/TextShapeR, rather
// than only the WebView's mouseleave handler (a different focus owner).
const main = fs.readFileSync(path.join(__dirname, "../uxp-src/host/main.js"), "utf8");
const source = main.slice(main.indexOf("let restoringFocus = false;"), main.indexOf("/* ========================= setup"));
assert(source.includes("async function restoreFocus()"));

async function test() {
  const calls = [];
  let finish;
  let fail = false;
  const context = {
    view: { blur() { calls.push("native-blur"); } },
    photoshop: { _internals: { modal: async (name, fn) => {
      calls.push("modal");
      if (fail) throw new Error("host busy");
      return fn();
    } } },
    ps: { app: { bringToFront: () => {
      calls.push("front");
      return new Promise(resolve => { finish = resolve; });
    } } },
    debugNote: () => calls.push("error"),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const first = context.restoreFocus();
  await context.restoreFocus();
  assert.deepStrictEqual(calls, ["native-blur", "modal", "front"], "native focus is released before activating Photoshop, once per request in flight");
  finish();
  await first;

  calls.length = 0;
  context.view = null; // In-panel renderer / no attached WebView.
  const fallback = context.restoreFocus();
  finish();
  await fallback;
  assert.deepStrictEqual(calls, ["modal", "front"]);

  calls.length = 0;
  fail = true;
  await context.restoreFocus();
  fail = false;
  const retry = context.restoreFocus();
  finish();
  await retry;
  assert.deepStrictEqual(calls, ["modal", "error", "modal", "front"], "a refused modal must not disable future focus restores");
  console.log("UXP native focus: WebView release, concurrent requests, in-panel fallback and error recovery passed");
}

test().catch(error => { console.error(error); process.exitCode = 1; });
