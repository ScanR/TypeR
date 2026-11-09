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
const enter = tag => { focused = true; document.activeElement = element(tag); events.mouseenter(); events.focusin(); };
const leave = () => events.mouseleave({ buttons: 0 });
leave(); handlers.psEvent(canvas); flush();
assert.equal(restores, 0, "unfocused panel must not request modals during ordinary Photoshop work");
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
console.log("UXP focus: armed release, no repeated modals, native focus, typing, IME, drag and Cmd-Tab passed");
