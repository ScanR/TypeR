const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "../app_src/host.js"), "utf8");
const extract = (name) => {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `${name} must exist`);
  return match[0];
};

const makeHost = () => {
  let activeIndex = 2;
  let dirty = false;
  let pixels = "original selection";
  let scanCalls = 0;
  const states = ["Open", "Paint", "Selection"].map((name) => ({ name, pixels }));
  const doc = {
    historyStates: states,
    get activeHistoryState() { return states[activeIndex]; },
    set activeHistoryState(state) {
      activeIndex = states.indexOf(state);
      pixels = state.pixels;
    },
    suspendHistory(name, script) {
      dirty = false;
      vm.runInContext(script, context);
      if (dirty) {
        states.splice(activeIndex + 1);
        states.push({ name, pixels });
        while (states.length > context.app.preferences.numberOfHistoryStates) states.shift();
        activeIndex = states.length - 1;
      }
    },
  };
  function ActionReference() {}
  ActionReference.prototype.putIndex = function (type, index) { this.index = index; };
  function ActionDescriptor() {}
  ActionDescriptor.prototype.putReference = function (key, reference) { this.reference = reference; };
  const context = vm.createContext({
    app: { activeDocument: doc, preferences: { numberOfHistoryStates: 50 } },
    documents: [doc],
    _hostState: { suspendedRun: null },
    _getActiveHistoryIndex: () => activeIndex,
    ActionReference, ActionDescriptor,
    charID: { Null: "null", Delete: "delete" },
    DialogModes: { NO: "no" },
    stringIDToTypeID: (name) => name,
    executeAction(action, descriptor) {
      const index = descriptor.reference.index - 1;
      assert.strictEqual(action, "delete");
      assert.strictEqual(index, activeIndex + 1, "Only the new redo state may be deleted");
      assert.strictEqual(index, states.length - 1, "User history must remain intact");
      states.splice(index, 1);
    },
    jamJSON: JSON,
    _getCurrentSelectionBounds: () => ({ width: 100, height: 120 }),
    _normalizeShapeSampleCount: () => 21,
    _withDialogsSuppressed: (fn) => fn(),
    _sampleSelectionShapeViaPath() {
      scanCalls++;
      dirty = true;
      pixels = "temporary channel and path";
      return { bounds: { width: 100, height: 120 }, rows: [{ width: 1 }], scan: "path" };
    },
  });
  ["_withTemporaryHistory", "getCurrentSelectionShape", "getActiveLayerBubbleShape"].forEach((name) => {
    vm.runInContext(extract(name), context);
  });
  return { context, doc, states, getPixels: () => pixels, getScanCalls: () => scanCalls };
};

const host = makeHost();
const names = host.states.map((state) => state.name);
for (let i = 0; i < 10000; i++) {
  const shape = JSON.parse(host.context.getCurrentSelectionShape({ samples: 21 }));
  assert.strictEqual(shape.scan, "path");
  assert.strictEqual(host.states.length, 3, "Repeated reads must not accumulate Photoshop history");
  assert.strictEqual(host.getPixels(), "original selection", "Each scan must restore the document");
  assert.strictEqual(host.context._hostState.suspendedRun, null, "Scan closures must be released");
}
assert.deepStrictEqual(host.states.map((state) => state.name), names);
assert.strictEqual(host.getScanCalls(), 10000);

host.doc.activeHistoryState = host.states[1];
assert.strictEqual(JSON.parse(host.context.getCurrentSelectionShape({})).error, "historyBusy");
assert.strictEqual(host.getScanCalls(), 10000, "A scan after Undo must not discard redo");
assert.deepStrictEqual(host.states.map((state) => state.name), names);
host.doc.activeHistoryState = host.states[2];
host.context.app.preferences.numberOfHistoryStates = 3;
assert.strictEqual(JSON.parse(host.context.getCurrentSelectionShape({})).scan, "path");
assert.strictEqual(host.getScanCalls(), 10001);
assert.deepStrictEqual(host.states.map((state) => state.name), names, "A full history must retain every user state");
assert.strictEqual(host.context.app.preferences.numberOfHistoryStates, 3, "The temporary history reservation must be restored");
const capacityUnavailable = makeHost();
Object.defineProperty(capacityUnavailable.context.app.preferences, "numberOfHistoryStates", {
  get: () => 3,
  set: () => { throw new Error("Maximum history capacity"); },
});
assert.strictEqual(JSON.parse(capacityUnavailable.context.getCurrentSelectionShape({})).error, "historyBusy");
assert.strictEqual(capacityUnavailable.getScanCalls(), 0);

const failed = makeHost();
failed.context._withTemporaryHistory("Read", () => {
  failed.context._sampleSelectionShapeViaPath();
  throw new Error("scan failed");
});
assert.strictEqual(failed.states.length, 3);
assert.strictEqual(failed.getPixels(), "original selection");
failed.doc.suspendHistory = () => { throw new Error("unsupported"); };
failed.context._withTemporaryHistory("Read", () => { throw new Error("must not retry"); });
assert.strictEqual(failed.getScanCalls(), 1);
assert.strictEqual(failed.context._hostState.suspendedRun, null);

const noOp = makeHost();
noOp.states[2].name = "Read";
assert.strictEqual(noOp.context._withTemporaryHistory("Read", () => 42), 42);
assert.strictEqual(noOp.states.length, 3, "A no-op must not delete an existing state with the same name");
const cleanupFailed = makeHost();
cleanupFailed.context.executeAction = () => { throw new Error("delete unavailable"); };
assert.strictEqual(JSON.parse(cleanupFailed.context.getCurrentSelectionShape({})).error, "historyBusy");
cleanupFailed.doc.activeHistoryState = cleanupFailed.states[cleanupFailed.states.length - 1];
cleanupFailed.context.getCurrentSelectionShape({});
assert.strictEqual(cleanupFailed.getScanCalls(), 1, "Failed cleanup must stop further accumulation");

const bubble = makeHost();
Object.assign(bubble.context, {
  _layerIsTextLayer: () => true,
  _getCurrentSelectionBounds: () => null,
  _getTargetLayerCount: () => 1,
  _scanActiveLayerBubble: bubble.context._sampleSelectionShapeViaPath,
});
assert.strictEqual(JSON.parse(bubble.context.getActiveLayerBubbleShape({})).scan, "path");
assert.strictEqual(bubble.states.length, 3);
bubble.doc.activeHistoryState = bubble.states[1];
assert.strictEqual(JSON.parse(bubble.context.getActiveLayerBubbleShape({})).error, "historyBusy");
assert.strictEqual(bubble.getScanCalls(), 1);
console.log("Temporary history tests passed (10,000 scans, undo/redo, capacity, failures and bubble integration)");
