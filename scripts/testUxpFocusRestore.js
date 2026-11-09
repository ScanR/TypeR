const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the host entry point used after paste/style/TextShapeR, rather
// than only the WebView's mouseleave handler (a different focus owner).
const main = fs.readFileSync(path.join(__dirname, "../uxp-src/host/main.js"), "utf8");
const source = main.slice(main.indexOf("let restoringFocus = false;"), main.indexOf("/* ========================= setup"));
assert(source.includes("async function restoreFocus(reason)"));
// The page's request and the reader's report never carry the "call" reason,
// the only one skipped while the user types in the page
assert(main.includes('restoreFocus: () => restoreFocus("panel")'));
assert(main.includes('() => restoreFocus("reader")'));
// Released as the document-changing call starts and once more after it
assert.strictEqual(main.split('if (changesDocument) restoreFocus("call")').length, 3);
assert(main.includes("'focusState'"), "the host accepts the page's focusState message");

async function test() {
  const calls = [];
  let finish;
  let fail = false;
  let platform = "darwin";
  const elements = {};
  const context = {
    view: { blur() { calls.push("native-blur"); } },
    viewOnPanel: true,
    os: { platform: () => platform },
    document: {
      getElementById: (id) => elements[id] || null,
      createElement: () => ({ style: {}, setAttribute() {}, focus() { calls.push("sink-focus"); } }),
      body: { appendChild: (element) => { elements[element.id] = element; calls.push("sink-added"); } },
    },
    keysHelper: { requestFocusRelease: async () => { calls.push("reader"); return true; } },
    photoshop: { _internals: { modal: async (name, fn) => {
      calls.push("modal");
      if (fail) throw new Error("host busy");
      return fn();
    } } },
    ps: { app: { bringToFront: () => {
      calls.push("front");
      return new Promise(resolve => { finish = resolve; });
    } } },
    debugNote: (stage) => calls.push("note:" + stage),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const first = context.restoreFocus("call");
  await context.restoreFocus("call");
  assert.deepStrictEqual(calls, ["native-blur", "modal", "front"], "macOS: native focus is released before activating Photoshop, once per request in flight");
  finish();
  await first;

  // Windows: the panel's own DOM takes the focus and the reader is asked,
  // before Photoshop is brought forward; the sink is made once
  calls.length = 0;
  platform = "win32";
  const windows = context.restoreFocus("call");
  finish();
  await windows;
  assert.deepStrictEqual(calls, ["native-blur", "sink-added", "sink-focus", "reader", "modal", "front"]);
  calls.length = 0;
  const again = context.restoreFocus("panel");
  finish();
  await again;
  assert.deepStrictEqual(calls, ["native-blur", "sink-focus", "reader", "modal", "front"]);

  // The user types in the page: a change made by a shortcut keeps the caret,
  // the page's own request (nothing edited) and a tooltip theft do not wait
  calls.length = 0;
  // Top-level let bindings of the source live in the context's lexical scope
  vm.runInContext("panelEditing = true", context);
  await context.restoreFocus("call");
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(vm.runInContext("focusSkips", context), 1);
  const panel = context.restoreFocus("panel");
  finish();
  await panel;
  const reader = context.restoreFocus("reader");
  finish();
  await reader;
  assert.deepStrictEqual(calls, ["native-blur", "sink-focus", "reader", "modal", "front", "native-blur", "sink-focus", "reader", "modal", "front"]);
  vm.runInContext("panelEditing = false", context);

  // A sink that cannot take the focus, or a reader that cannot be asked, do
  // not stop the restore
  calls.length = 0;
  elements["typer-focus-sink"].focus = () => { throw new Error("not focusable"); };
  context.keysHelper.requestFocusRelease = async () => { throw new Error("no folder"); };
  const broken = context.restoreFocus("call");
  finish();
  await broken;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(calls, ["native-blur", "note:focus.sink", "modal", "front", "note:focus.request"]);

  // No WebView (the panel's own renderer): nothing to release there
  calls.length = 0;
  context.view = null;
  const fallback = context.restoreFocus("call");
  finish();
  await fallback;
  assert.deepStrictEqual(calls, ["modal", "front"]);

  calls.length = 0;
  context.view = { blur() { calls.push("native-blur"); } };
  context.viewOnPanel = false;
  platform = "darwin";
  fail = true;
  await context.restoreFocus("call");
  fail = false;
  const retry = context.restoreFocus("call");
  finish();
  await retry;
  assert.deepStrictEqual(calls, ["native-blur", "modal", "note:focus.restore", "native-blur", "modal", "front"], "a refused modal must not disable future focus restores");
  console.log("UXP native focus: WebView release, Windows sink and reader request, typing, concurrent requests, in-panel fallback and error recovery passed");
}

test().catch(error => { console.error(error); process.exitCode = 1; });
