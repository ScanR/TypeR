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
// Those restores wait in the host call queue: run beside a call, the
// restore's bringToFront made the call's commands fail (3.0.2: every style
// applied to a text layer answered "no text layer selected")
assert(main.includes('restoreFocus: () => queueFocusRestore("panel")'));
assert(main.includes('() => queueFocusRestore("reader")'));
assert(/function queueFocusRestore\(reason\) \{\s*return enqueue\(\(\) => restoreFocus\(reason\)/.test(main));
// Released as the document-changing call starts and once more after it, each
// awaited inside the call so it never overlaps the call's commands
assert.strictEqual(main.split('if (changesDocument) await restoreFocus("call")').length, 3);
assert(!main.includes('if (changesDocument) restoreFocus("call")'), "a call never starts a restore without awaiting it");
assert(main.includes("'focusState'"), "the host accepts the page's focusState message");
assert(main.includes("panelFocused = message.focused !== false;"), "a page that does not say holds the focus, as before");
// The page reports its focus as it starts, before appReady: nothing else may
// set it back to "holds the focus"
assert.strictEqual(main.split("panelFocused = ").length, 3, "only the declaration and the page's report set panelFocused");
const entry = fs.readFileSync(path.join(__dirname, "../uxp-src/web/entry.js"), "utf8");
assert(entry.indexOf("installFocusRelease({") !== -1 && entry.indexOf("installFocusRelease({") < entry.indexOf('notify("appReady")'), "the focus report precedes appReady");

async function test() {
  const calls = [];
  let finish;
  let fail = false;
  let platform = "darwin";
  const context = {
    view: { blur() { calls.push("native-blur"); } },
    viewOnPanel: true,
    os: { platform: () => platform },
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

  // Windows: the reader is asked to take the focus out of the WebView before
  // Photoshop is brought forward. Nothing of the panel's own DOM takes the
  // focus: a UXP panel that holds it keeps Photoshop's keys for itself (3.0.3:
  // tool keys dead after every paste)
  calls.length = 0;
  platform = "win32";
  const windows = context.restoreFocus("call");
  finish();
  await windows;
  assert.deepStrictEqual(calls, ["native-blur", "reader", "modal", "front"]);
  assert(!main.includes("typer-focus-sink") && !/\.focus\(\)/.test(source), "the host never focuses an element of the panel");

  // The page does not hold the focus (a paste by shortcut from the document):
  // a call leaves the focus where it is; the page's own request and a tooltip
  // theft still restore it
  calls.length = 0;
  vm.runInContext("panelFocused = false", context);
  await context.restoreFocus("call");
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(vm.runInContext("focusSkips", context), 1);
  const asked = context.restoreFocus("panel");
  finish();
  await asked;
  assert.deepStrictEqual(calls, ["native-blur", "reader", "modal", "front"]);
  // macOS keeps restoring after every call: its restore changes nothing
  // while the document already holds the focus
  calls.length = 0;
  platform = "darwin";
  const mac = context.restoreFocus("call");
  finish();
  await mac;
  assert.deepStrictEqual(calls, ["native-blur", "modal", "front"]);
  platform = "win32";
  vm.runInContext("panelFocused = true", context);

  // The user types in the page: a change made by a shortcut keeps the caret,
  // the page's own request (nothing edited) and a tooltip theft do not wait
  calls.length = 0;
  // Top-level let bindings of the source live in the context's lexical scope
  vm.runInContext("panelEditing = true", context);
  await context.restoreFocus("call");
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(vm.runInContext("focusSkips", context), 2);
  const panel = context.restoreFocus("panel");
  finish();
  await panel;
  const reader = context.restoreFocus("reader");
  finish();
  await reader;
  assert.deepStrictEqual(calls, ["native-blur", "reader", "modal", "front", "native-blur", "reader", "modal", "front"]);
  vm.runInContext("panelEditing = false", context);

  // A reader that cannot be asked does not stop the restore
  calls.length = 0;
  context.keysHelper.requestFocusRelease = async () => { throw new Error("no folder"); };
  const broken = context.restoreFocus("call");
  finish();
  await broken;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(calls, ["native-blur", "modal", "front", "note:focus.request"]);

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
  console.log("UXP native focus: WebView release, Windows reader request, focus left alone outside the page, typing, concurrent requests, in-panel fallback and error recovery passed");
}

test().catch(error => { console.error(error); process.exitCode = 1; });
