const assert = require("assert");
const load = require("./helpers/loadAppModule")();
const { installFocusRelease, isHostSelection } = load("uxp-src/web/focus.js");
const message = (eventID, eventData) => ({ data: "ver1," + JSON.stringify({ eventID, eventData }) });
const canvas = message(1936028772, { _target: [{ _ref: "channel", _property: "selection" }] });
assert(isHostSelection(canvas));
assert(!isHostSelection(message(1936028772, { _isCommand: true, _target: [{ _ref: "channel", _property: "selection" }] })));
assert(!isHostSelection(message(1936028772, { _target: [{ _ref: "textLayer" }] })));
assert(!isHostSelection({ data: "bad" }));
const events = {}, handlers = {}, timers = new Map();
let nextTimer = 0, restores = 0, blurs = 0, focused = true;
const element = (tag) => ({ tagName: tag, blur() { blurs++; } });
const document = { activeElement: element("BODY"), hidden: false, hasFocus: () => focused,
  documentElement: { addEventListener: (name, fn) => { events[name] = fn; } },
  addEventListener: (name, fn) => { events[name] = fn; },
};
const window = { addEventListener: (name, fn) => { events[name] = fn; },
  setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
  clearTimeout: (id) => timers.delete(id),
};
const flush = () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); };
installFocusRelease({ document, window, on: (name, fn) => { handlers[name] = fn; }, request: async (method) => { assert.equal(method, "restoreFocus"); restores++; } });
// A click in the panel: Photoshop shows it, the WebView takes the focus, the user clicks an element
const enter = tag => { focused = true; document.activeElement = element(tag); events.mouseenter(); events.focus(); events.focusin(); events.mousedown(); };
// Photoshop shows the panel and focuses it, the pointer only passes over it
const shown = tag => { focused = true; document.activeElement = element(tag); events.focus(); events.focusin(); events.mouseenter(); };
const leave = () => events.mouseleave({ buttons: 0 });
leave(); handlers.psEvent(canvas); flush();
assert.equal(restores, 0, "unfocused panel must not request modals during ordinary Photoshop work");
shown("BODY"); leave(); flush();
assert.equal(restores, 0, "a panel Photoshop has just shown and focused is not released as the pointer leaves: a panel expanded from an icon dock would collapse");
shown("BUTTON"); leave(); flush(); handlers.psEvent(canvas);
assert.equal(restores, 0, "a focused button without a click does not arm the release either");
shown("TEXTAREA"); leave(); flush(); assert.equal(restores, 0, "an editor given the focus is kept while the pointer leaves");
handlers.psEvent(canvas); assert.equal(restores, 1, "an editor given the focus is released by a selection in Photoshop");
restores = 0;
enter("BUTTON"); leave(); flush(); assert.equal(restores, 1);
for (let i = 0; i < 20; i++) handlers.psEvent(canvas);
assert.equal(restores, 1, "released focus stays disarmed across repeated native events");
enter("BUTTON"); leave(); events.mouseenter(); flush(); assert.equal(restores, 1);
enter("TEXTAREA"); leave(); flush(); assert.equal(restores, 1, "moving away while typing preserves the editor");
handlers.psEvent(canvas); assert.equal(restores, 2);
handlers.psEvent(canvas); assert.equal(restores, 2, "editor focus is restored only once");
enter("TEXTAREA"); handlers.psEvent(canvas); assert.equal(restores, 2, "panel activity must not steal typing");
events.compositionstart(); leave(); handlers.psEvent(canvas); assert.equal(restores, 2, "IME composition must not be interrupted");
events.compositionend();
const beforeAppSwitch = blurs;
focused = false; events.blur(); handlers.psEvent(canvas); flush();
assert.equal(restores, 2); assert.equal(blurs, beforeAppSwitch, "Cmd-Tab must preserve the editor and caret");
focused = true; events.focus(); handlers.psEvent(canvas); assert.equal(restores, 3, "returning to the panel re-arms focus");
enter("BUTTON"); events.mouseleave({ buttons: 1 }); handlers.psEvent(canvas); flush();
assert.equal(restores, 3, "dragging must retain its source even during native events");
enter("BUTTON"); document.hidden = true; leave(); handlers.psEvent(canvas); flush(); assert.equal(restores, 3);
document.hidden = false;
enter("TEXTAREA"); leave(); focused = false; handlers.psEvent(canvas);
assert.equal(restores, 3, "Photoshop already owns focus: no modal restore");
focused = true; handlers.psEvent(canvas); assert.equal(restores, 3, "native focus departure disarms the release");
focused = false; events.mouseenter(); events.mousedown(); leave(); flush();
assert.equal(restores, 3, "hovering an inactive Photoshop window must not activate it");

// The host hears whether an editor has the focus: it leaves the caret alone
// after a change made by a shortcut while typing (main.js restoreFocus)
{
  const ev = {}, reports = [], pending = new Map();
  let id = 0, owns = true;
  const doc = { activeElement: element("BODY"), hidden: false, hasFocus: () => owns,
    documentElement: { addEventListener: (name, fn) => { ev["root:" + name] = fn; } },
    addEventListener: (name, fn) => { ev[name] = fn; },
  };
  const win = { addEventListener: (name, fn) => { ev["win:" + name] = fn; },
    setTimeout: (fn) => { pending.set(++id, fn); return id; }, clearTimeout: (timer) => pending.delete(timer),
  };
  const run = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); };
  installFocusRelease({ document: doc, window: win, on: () => {}, request: async () => {}, notify: (type, payload) => reports.push(type + ":" + payload.editing) });
  doc.activeElement = element("BUTTON"); ev.focusin();
  assert.deepStrictEqual(reports, ["focusState:false"]);
  doc.activeElement = element("TEXTAREA"); ev.focusin();
  assert.deepStrictEqual(reports, ["focusState:false", "focusState:true"]);
  ev.focusin(); assert.equal(reports.length, 2, "reported on change only");
  doc.activeElement = element("BODY"); ev.focusout();
  assert.equal(reports.length, 2, "focusout waits for the new active element");
  run(); assert.deepStrictEqual(reports.slice(2), ["focusState:false"]);
  doc.activeElement = element("INPUT"); ev.focusin(); owns = false; ev["win:blur"]();
  assert.deepStrictEqual(reports.slice(3), ["focusState:true", "focusState:false"], "an editor left behind by Cmd-Tab is not being typed in");
  owns = true; ev["win:focus"](); assert.deepStrictEqual(reports.slice(5), ["focusState:true"]);
}
console.log("UXP focus: armed release, no repeated modals, native focus, typing, IME, drag, Cmd-Tab and editing reports passed");
