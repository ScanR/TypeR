// Two Photoshop options that broke TypeR from outside, reported after 3.0.3:
// a selection tool on "Add to selection" in multi-bubble (every bubble was
// stored as the rectangle around all the clicks), and "Auto-Collapse Iconic
// Panels" (a panel in an icon dock closed at every click on the document).
// Both hosts set them back, and the panel says so.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");

/* ------------------------- Legacy host (host.js) ------------------------- */

const ps = { tool: "magicWandTool", options: { selectionEnum: 1, WndT: 32 }, workspace: { autoCollapseDrawers: true, enableLargeTabs: true }, sets: [], failGet: false };
const descriptorOf = (object) => ({
  hasKey: (key) => Object.prototype.hasOwnProperty.call(object, key),
  getInteger: (key) => object[key],
  getBoolean: (key) => object[key],
  getObjectValue: (key) => descriptorOf(object[key]),
  getEnumerationType: (key) => object[key],
});
class ActionReference {
  putProperty(type, property) { this.property = property; }
  putEnumerated(type) { this.target = type; }
  putClass(type) { this.target = type; }
}
class ActionDescriptor {
  constructor() { this.values = {}; }
  putInteger(key, value) { this.values[key] = value; }
  putBoolean(key, value) { this.values[key] = value; }
  putReference(key, reference) { this.reference = reference; }
  putObject(key, type, object) { this.type = type; this.object = object.values; }
}
const doc = { id: 1 };
const box = vm.createContext({
  app: { activeDocument: doc, documents: [doc] }, documents: [doc], jamJSON: JSON,
  charIDToTypeID: (id) => id, stringIDToTypeID: (id) => id, DialogModes: { NO: "no" },
  ActionReference, ActionDescriptor,
  executeActionGet: (reference) => {
    if (ps.failGet) throw new Error("Photoshop refused");
    return descriptorOf({ currentToolOptions: ps.options, tool: ps.tool, workspacePreferences: ps.workspace });
  },
  executeAction: (event, descriptor) => {
    ps.sets.push({ event, target: descriptor.reference.target, property: descriptor.reference.property, type: descriptor.type, object: descriptor.object });
    if (descriptor.type === "currentToolOptions") Object.assign(ps.options, descriptor.object);
    if (descriptor.type === "workspacePreferences") Object.assign(ps.workspace, descriptor.object);
  },
  ScriptUI: { environment: { keyboardState: { shiftKey: false } } },
});
vm.runInContext(fs.readFileSync(path.join(root, "app_src/host.js"), "utf8"), box);

// The tool goes back to "New selection", and only that option is written
assert.strictEqual(box._ensureNewSelectionMode(), true);
assert.strictEqual(ps.sets.length, 1);
assert.strictEqual(ps.sets[0].event, "setd");
assert.strictEqual(ps.sets[0].target, "magicWandTool");
assert.deepStrictEqual(ps.sets[0].object, { selectionEnum: 0 });
assert.deepStrictEqual(ps.options, { selectionEnum: 0, WndT: 32 });
assert.strictEqual(box._ensureNewSelectionMode(), false, "already on New selection");
// Subtract and Intersect too, on any selection tool
[2, 3].forEach((mode) => {
  ps.tool = "lassoTool"; ps.options.selectionEnum = mode;
  assert.strictEqual(box._ensureNewSelectionMode(), true);
  assert.strictEqual(ps.sets[ps.sets.length - 1].target, "lassoTool");
});
// A tool without the option (Move, Brush, Quick Selection) is left alone
ps.sets.length = 0;
ps.tool = "moveTool"; ps.options = { AtSl: true };
assert.strictEqual(box._ensureNewSelectionMode(), false);
ps.failGet = true;
assert.strictEqual(box._ensureNewSelectionMode(), false, "a host that refuses the read changes nothing");
ps.failGet = false;
assert.strictEqual(ps.sets.length, 0);

// In multi-bubble, the selection made in "Add to selection" is the rectangle
// around the previous bubble and the new one: it is not stored, the panel is
// told the tool was set back, and the next click (a new selection) is stored
const bounds = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top, xMid: (left + right) / 2, yMid: (top + bottom) / 2 });
let selection = null;
Object.assign(box, {
  _getCurrentSelectionBounds: () => selection,
  _withTemporaryHistory: (name, fn) => fn(),
  _getAdaptiveOpenedSelectionBounds: (value) => value,
});
const poll = () => JSON.parse(box.getSelectionChanged());
assert.strictEqual(poll().documentChanged, true);
ps.tool = "magicWandTool"; ps.options = { selectionEnum: 1 };
// Before any click: the tool is set back at the first poll
let result = poll();
assert.strictEqual(result.noChange, true);
assert.strictEqual(result.selectionModeReset, true);
assert.strictEqual(ps.options.selectionEnum, 0);
selection = bounds(100, 100, 300, 250);
result = poll();
assert.strictEqual(result.multiSelection.length, 1, "the first bubble is stored");
assert.strictEqual(result.selectionModeReset, undefined);
// The user puts the tool back on "Add to selection" and clicks another bubble
ps.options.selectionEnum = 1;
selection = bounds(100, 100, 700, 900);
result = poll();
assert.strictEqual(result.multipleSelections, true, "the union is not stored");
assert.strictEqual(result.selectionModeReset, true);
assert.strictEqual(result.multiSelection, undefined);
assert.strictEqual(poll().noChange, true, "the union stays out on the next polls");
selection = bounds(500, 700, 700, 900);
result = poll();
assert.strictEqual(result.multiSelection.length, 1, "the bubble clicked again is stored");
assert.strictEqual(result.left, 500);
// Without the tool option, a selection that grows without Shift is stored as before
selection = bounds(450, 650, 750, 950);
assert.strictEqual(poll().multiSelection.length, 1);

// "Auto-Collapse Iconic Panels": turned off, the other workspace options untouched
ps.sets.length = 0;
assert.deepStrictEqual(JSON.parse(box.disableAutoCollapsePanels()), { wasOn: true });
assert.strictEqual(ps.sets.length, 1);
assert.strictEqual(ps.sets[0].property, "workspacePreferences");
assert.deepStrictEqual(ps.sets[0].object, { autoCollapseDrawers: false });
assert.deepStrictEqual(ps.workspace, { autoCollapseDrawers: false, enableLargeTabs: true });
assert.deepStrictEqual(JSON.parse(box.disableAutoCollapsePanels()), { wasOn: false });
ps.workspace = { enableLargeTabs: true };
assert.deepStrictEqual(JSON.parse(box.disableAutoCollapsePanels()), { wasOn: false }, "a Photoshop without the option");
ps.failGet = true;
assert.deepStrictEqual(JSON.parse(box.disableAutoCollapsePanels()), { error: "autoCollapse" });
ps.failGet = false;
assert.strictEqual(ps.sets.length, 1);

/* ------------------------- new TypeR (photoshop.js) ------------------------- */

const uxpState = { tool: { _enum: "magicLassoTool", _value: "targetEnum" }, options: { selectionEnum: 3 }, workspace: { autoCollapseDrawers: true }, sets: [], modals: 0 };
const loadPort = () => {
  const filename = path.join(root, "uxp-src/host/photoshop.js");
  const stubs = {
    photoshop: {
      action: { batchPlay: (commands) => commands.map((command) => {
        if (command._obj === "get") {
          const property = command._target[0]._property;
          if (property === "currentToolOptions") return { currentToolOptions: uxpState.options };
          if (property === "tool") return { tool: uxpState.tool };
          if (property === "workspacePreferences") return { workspacePreferences: uxpState.workspace };
          return {};
        }
        uxpState.sets.push(command);
        if (command.to._obj === "currentToolOptions") uxpState.options = Object.assign({}, uxpState.options, { selectionEnum: command.to.selectionEnum });
        if (command.to._obj === "workspacePreferences") uxpState.workspace = Object.assign({}, uxpState.workspace, { autoCollapseDrawers: command.to.autoCollapseDrawers });
        return {};
      }) },
      app: {}, constants: { LayerKind: {} },
      core: { executeAsModal: async (fn) => { uxpState.modals++; return fn({}); } },
    },
    uxp: { storage: { localFileSystem: {} } },
  };
  const mod = { exports: {} };
  const localRequire = (name) => stubs[name] || require(path.resolve(path.dirname(filename), name));
  new Function("require", "module", "exports", fs.readFileSync(filename, "utf8"))(localRequire, mod, mod.exports);
  return mod.exports;
};

/* ------------------------------- the panel ------------------------------- */

const panelTests = async () => {
  const port = loadPort();
  assert.strictEqual(await port._internals._ensureNewSelectionMode(), true);
  assert.strictEqual(uxpState.modals, 1);
  assert.deepStrictEqual(uxpState.sets[0]._target, [{ _ref: "magicLassoTool" }]);
  assert.deepStrictEqual(uxpState.sets[0].to, { _obj: "currentToolOptions", selectionEnum: 0 });
  assert.strictEqual(await port._internals._ensureNewSelectionMode(), false);
  uxpState.options = { toolPreset: "x" };
  assert.strictEqual(await port._internals._ensureNewSelectionMode(), false, "a tool without the option");
  assert.strictEqual(uxpState.modals, 1, "no modal scope when nothing changes");
  const portSource = fs.readFileSync(path.join(root, "uxp-src/host/photoshop.js"), "utf8");
  assert(portSource.includes("if ((shiftPressed || modeReset) && !isSame && monitor.lastBounds && merged.length === 1 &&"), "the port leaves the union out too");
  assert(portSource.includes("if (modeReset) result.selectionModeReset = true;"));

  uxpState.sets.length = 0;
  assert.deepStrictEqual(JSON.parse(await port.methods.disableAutoCollapsePanels()), { wasOn: true });
  assert.strictEqual(uxpState.sets[0]._target[0]._property, "workspacePreferences");
  assert.deepStrictEqual(uxpState.sets[0].to, { _obj: "workspacePreferences", autoCollapseDrawers: false });
  assert.deepStrictEqual(JSON.parse(await port.methods.disableAutoCollapsePanels()), { wasOn: false });
  assert.strictEqual(uxpState.sets.length, 1);

  // The panel: the host's answer reaches the multi-bubble poll, a union made
  // in "Add to selection" shows the tool's notice and not the Shift tip
  let reply = {};
  const csInterface = { evalScript: (script, callback) => callback(JSON.stringify(reply[script.replace(/\(.*/, "")] || {})) };
  const load = require("./helpers/loadAppModule")({
    "./utils": { csInterface, locale: { autoCollapseTurnedOff: "collapse notice" }, readStorage: () => undefined, writeToStorage: () => {} },
  });
  const utilsSource = fs.readFileSync(path.join(root, "app_src/utils.js"), "utf8");
  assert(utilsSource.includes("if (data.selectionModeReset) onModeReset();"));
  assert(utilsSource.includes("callback({ multipleSelections: true, selectionModeReset: !!data.selectionModeReset });"));
  const preview = fs.readFileSync(path.join(root, "app_src/components/previewBlock/previewBlock.jsx"), "utf8");
  assert(preview.includes("if (!selection.selectionModeReset) showShiftTip();"));
  assert(preview.includes('text: locale.multiBubbleNewSelectionMode, kind: "warning"'));

  // Auto-collapse: turned off once, remembered, said; never asked again
  const { guardAutoCollapse } = load("app_src/autoCollapse.js");
  const run = async (done, answer) => {
    const seen = { asked: 0, remembered: 0, notices: 0 };
    reply = { disableAutoCollapsePanels: answer };
    const outcome = await guardAutoCollapse({
      alreadyDone: () => done,
      evalHost: (script) => new Promise((resolve) => { seen.asked++; csInterface.evalScript(script, resolve); }),
      remember: () => { seen.remembered++; },
      notify: () => { seen.notices++; },
    });
    return Object.assign(seen, { outcome });
  };
  assert.deepStrictEqual(await run(false, { wasOn: true }), { asked: 1, remembered: 1, notices: 1, outcome: "turnedOff" });
  assert.deepStrictEqual(await run(false, { wasOn: false }), { asked: 1, remembered: 0, notices: 0, outcome: "off" });
  assert.deepStrictEqual(await run(false, { error: "autoCollapse" }), { asked: 1, remembered: 0, notices: 0, outcome: "off" });
  assert.deepStrictEqual(await run(true, { wasOn: true }), { asked: 0, remembered: 0, notices: 0, outcome: "done" }, "the user's choice is kept after the first time");
  // A host without the function (TypeR Web) answers something that is not JSON
  const guard = await guardAutoCollapse({ alreadyDone: () => false, evalHost: async () => "EvalScript error.", remember: assert.fail, notify: assert.fail });
  assert.strictEqual(guard, "off");
  const context = fs.readFileSync(path.join(root, "app_src/context.jsx"), "utf8");
  assert(context.includes("useAutoCollapseGuard(dispatch);"));
  console.log("Selection mode and auto-collapse: New selection restored in both hosts, union left out, panel notices and one-time auto-collapse passed");
};

panelTests().catch((error) => { console.error(error); process.exitCode = 1; });
