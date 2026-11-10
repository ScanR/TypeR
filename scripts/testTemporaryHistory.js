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

const makeHost = ({ deferredHistory = false, publishOnSelect = true } = {}) => {
  let activeIndex = 2;
  let dirty = false;
  let pixels = "original selection";
  let scanCalls = 0;
  let refreshCalls = 0;
  let restoreCalls = 0;
  let selectLayerCalls = 0;
  let pendingState = null;
  // Like Photoshop, a state remembers the layers selected when it was made
  // and going back to it selects them again: the selection was made on the
  // clean layer, every state so far holds it
  let targetLayers = ["clean"];
  const states = ["Open", "Paint", "Selection"].map((name) => ({ name, pixels, layers: targetLayers }));
  const publish = (state) => {
    states.splice(activeIndex + 1);
    states.push({ ...state, layers: targetLayers });
    while (states.length > context.app.preferences.numberOfHistoryStates) states.shift();
    activeIndex = states.length - 1;
  };
  const doc = {
    historyStates: states,
    get activeHistoryState() { return states[activeIndex]; },
    set activeHistoryState(state) {
      restoreCalls++;
      activeIndex = states.indexOf(state);
      pixels = state.pixels;
      if (state.layers) targetLayers = state.layers;
    },
    suspendHistory(name, script) {
      dirty = false;
      vm.runInContext(script, context);
      if (dirty) {
        if (deferredHistory) pendingState = { name, pixels };
        else publish({ name, pixels });
      }
    },
  };
  function ActionReference() {}
  ActionReference.prototype.putIndex = function (type, index) { this.index = index; };
  function ActionDescriptor() {}
  ActionDescriptor.prototype.putReference = function (key, reference) { this.reference = reference; };
  const context = vm.createContext({
    app: {
      activeDocument: doc,
      documents: [doc],
      preferences: { numberOfHistoryStates: 50 },
      refresh() {
        refreshCalls++;
        if (pendingState) {
          publish(pendingState);
          pendingState = null;
        }
      },
    },
    documents: [doc],
    _hostState: { suspendedRun: null },
    _getActiveHistoryIndex: () => activeIndex,
    ActionReference, ActionDescriptor,
    charID: { Null: "null", Delete: "delete", Select: "select", Make: "make", Set: "set" },
    DialogModes: { NO: "no" },
    stringIDToTypeID: (name) => name,
    executeAction(action, descriptor) {
      const index = descriptor.reference.index - 1;
      if (action === "select") {
        if (publishOnSelect && pendingState) {
          publish(pendingState);
          pendingState = null;
        }
        doc.activeHistoryState = states[index];
        return;
      }
      assert.strictEqual(action, "delete");
      assert.strictEqual(index, activeIndex + 1, "Only the new redo state may be deleted");
      assert.strictEqual(index, states.length - 1, "User history must remain intact");
      states.splice(index, 1);
    },
    jamJSON: JSON,
    _getTargetLayerIds: () => targetLayers.slice(),
    _selectLayersById: (ids) => {
      selectLayerCalls++;
      targetLayers = ids.slice();
    },
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
  ["_sameIds", "_suspendedHistoryIndex", "_withTemporaryHistory", "getCurrentSelectionShape", "getActiveLayerBubbleShape", "_smartPageLeak", "smartPasteCapture", "smartPasteMeasure"].forEach((name) => {
    vm.runInContext(extract(name), context);
  });
  return {
    context, doc, states, getPixels: () => pixels, getScanCalls: () => scanCalls,
    getRefreshCalls: () => refreshCalls,
    getRestoreCalls: () => restoreCalls,
    getSelectLayerCalls: () => selectLayerCalls,
    getTargetLayers: () => targetLayers.slice(),
    selectLayers(ids) { targetLayers = ids.slice(); },
    mutate(value) { dirty = true; pixels = value; },
  };
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
assert.strictEqual(host.getRefreshCalls(), 0, "Hosts with up-to-date history must not pay for a refresh on each read");
assert.strictEqual(host.getSelectLayerCalls(), 0, "A scan on the layer of the last state must not reselect anything");

// The report: a wand selection on the clean layer, then a click on a text
// layer (no history state). The revert after the scan selects the clean
// layer again; the scan must give the text layer back, without a new state.
const clicked = makeHost();
clicked.selectLayers(["text"]);
assert.strictEqual(JSON.parse(clicked.context.getCurrentSelectionShape({ samples: 21 })).scan, "path");
assert.deepStrictEqual(clicked.getTargetLayers(), ["text"], "The scan must leave the layer the user selected active");
assert.strictEqual(clicked.getSelectLayerCalls(), 1);
assert.strictEqual(clicked.states.length, 3);
assert.deepStrictEqual(clicked.states.map((state) => state.name), names);
clicked.selectLayers(["text", "text 2"]);
clicked.context._withTemporaryHistory("Read", () => clicked.mutate("temporary channel"));
assert.deepStrictEqual(clicked.getTargetLayers(), ["text", "text 2"], "Several selected layers come back too");
assert.strictEqual(clicked.getSelectLayerCalls(), 2);
clicked.selectLayers(["clean"]);
clicked.context._withTemporaryHistory("Read", () => clicked.mutate("temporary channel"));
assert.strictEqual(clicked.getSelectLayerCalls(), 2, "No reselection when the revert keeps the user's layer");
// A host that cannot read the selected layers scans as before
const unreadable = makeHost();
unreadable.context._getTargetLayerIds = () => { throw new Error("no targetLayers"); };
unreadable.selectLayers(["text"]);
assert.strictEqual(JSON.parse(unreadable.context.getCurrentSelectionShape({})).scan, "path");
assert.strictEqual(unreadable.getSelectLayerCalls(), 0);

// PS 2019-style deferred publication: the DOM still shows the previous
// history state until an Action Manager selection (or app.refresh()). Exercise the real capture/measurement
// entry points, including repeated batches ending with different fragments.
const deferred = makeHost({ deferredHistory: true });
const deferredNames = deferred.states.map((state) => state.name);
Object.assign(deferred.context, {
  _getDocumentPixelSize: () => ({ width: 1000, height: 1500 }),
  _getDocumentResolution: () => 72,
  _smartSelectionHistograms: () => { deferred.mutate("temporary merged layer"); return [[1]]; },
  _makeWorkPathFromSelection: () => deferred.mutate("visible work path"),
  _smartReadWorkPath: () => ({ pathContents: {} }),
  jamEngine: { jsonToActionDescriptor: (data) => data },
  jamText: {
    toLayerTextObject: (params) => params,
  },
  _currentLayerBox: () => ({ left: 400, top: 700, right: 600, bottom: 764 }),
});
let measuringGroup = null;
deferred.context._smartCreateMeasureGroup = () => (measuringGroup = { opacity: 0, remove: () => deferred.mutate("original selection") });
const historyAction = deferred.context.executeAction;
deferred.context.executeAction = (action, data) => {
  if (action !== "make" && action !== "set") return historyAction(action, data);
  assert.strictEqual(measuringGroup.opacity, 0, "Temporary text must never be visible, even before rollback");
  deferred.mutate((data.using || data.to).text);
};
const capture = JSON.parse(deferred.context.smartPasteCapture({ trigger: { source: "wand" } }));
assert.ok(capture.rawPath);
assert.strictEqual(deferred.getPixels(), "original selection", "Capture must remove the work path and merged layer");
// A selection that leaks into the page: its page-wide outline is never read.
// The host says so at once; asked again with the polygon of a disc around the
// click, it reads the outline inside it (rolled back like any capture).
const { isPageLeak } = require("./helpers/loadAppModule")()("app_src/oneClick/openBubble.js");
[[0, 0, 1000, 1500], [0, 0, 950, 1000], [0, 0, 930, 1500], [0, 20, 610, 1470], [0, 0, 590, 1500], [100, 100, 500, 400], [0, 0, 1000, 590]].forEach(([left, top, right, bottom]) => {
  const bounds = { left, top, right, bottom };
  assert.strictEqual(deferred.context._smartPageLeak(bounds, 1000, 1500), isPageLeak(bounds, 1000, 1500), "the host and the engine share the leak rule: " + JSON.stringify(bounds));
});
const closedBounds = deferred.context._getCurrentSelectionBounds;
deferred.context._getCurrentSelectionBounds = () => ({ left: 0, top: 0, right: 1000, bottom: 1500, width: 1000, height: 1500 });
const restoresBefore = deferred.getRestoreCalls();
const leak = JSON.parse(deferred.context.smartPasteCapture({ trigger: { source: "wand", x: 400, y: 500 } }));
assert.strictEqual(leak.leak, true);
assert.strictEqual(leak.rawPath, null);
assert.strictEqual(deferred.getRestoreCalls(), restoresBefore, "nothing is read, nothing to roll back");
const intersected = [];
deferred.context._smartIntersectPolygon = (polygon) => intersected.push(polygon);
const local = JSON.parse(deferred.context.smartPasteCapture({ trigger: { source: "wand", x: 400, y: 500 }, local: [[300, 400], [500, 400], [400, 600]] }));
assert.deepStrictEqual(intersected, [[[300, 400], [500, 400], [400, 600]]], "the selection is cut to the disc before it is read");
assert.ok(local.rawPath && !local.leak);
assert.strictEqual(deferred.getPixels(), "original selection", "The local capture leaves the selection as it was");
assert.deepStrictEqual(deferred.states.map((state) => state.name), deferredNames);
assert.strictEqual(JSON.parse(deferred.context.smartPasteCapture({ trigger: { source: "rectangle" } })).leak, undefined, "a rectangle is pasted in as it is");
assert.ok(JSON.parse(deferred.context.smartPasteCapture({ trigger: { source: "manual", lastSource: "wand" } })).rawPath, "without a click the outline is read as before (Select All is a rectangle)");
assert.strictEqual(JSON.parse(deferred.context.smartPasteCapture({ trigger: { source: "manual", lastSource: "wand", lastClick: { x: 4, y: 5 } } })).leak, true);
deferred.context._getCurrentSelectionBounds = closedBounds;
for (const text of ["a little to fit.", "fit.", "next bubble"]) {
  const measured = JSON.parse(deferred.context.smartPasteMeasure({ requests: [{ params: { text: "first candidate" } }, { params: { text } }] }));
  assert.strictEqual(measured.length, 2);
  assert.strictEqual(deferred.getPixels(), "original selection", "No measurement text may remain at the document centre");
  assert.deepStrictEqual(deferred.states.map((state) => state.name), deferredNames);
}
assert.strictEqual(deferred.getRefreshCalls(), 0, "PS 2019 history selection should avoid repainting after every batch");
assert.strictEqual(deferred.getRestoreCalls(), 7, "Each capture/measurement restores history exactly once, without a redundant setter");
deferred.context._currentLayerBox = () => { throw new Error("measurement failed"); };
assert.strictEqual(JSON.parse(deferred.context.smartPasteMeasure({ requests: [{ params: { text: "failed candidate" } }] })).error, "measure");
assert.strictEqual(deferred.getPixels(), "original selection", "Failed measurements must also clean up deferred history");
assert.deepStrictEqual(deferred.states.map((state) => state.name), deferredNames);

// Align first reads an oval as a work path, then centres a previously moved
// text. PS 2019 must restore the original selection and remove that path
// before the positioning step, just as it does for smart paste captures.
const align = makeHost({ deferredHistory: true });
const selection = { left: 420, top: 400, right: 680, bottom: 560, width: 260, height: 160, xMid: 550, yMid: 480 };
let textBox = { left: 250, top: 180, right: 450, bottom: 240, xMid: 350, yMid: 210 };
const outline = { pathContents: { pathComponents: [] } };
align.doc.id = 7;
Object.assign(align.context, {
  _getDocumentPixelSize: () => ({ width: 1200, height: 1000 }),
  _getDocumentResolution: () => 72,
  _targetLayerEntries: () => [{ id: 42, text: true }],
  _selectLayerById: () => {},
  _layerStackIndex: () => 2,
  _currentLayerBox: () => textBox,
  _currentDisplayedTextPixels: () => 20,
  _liveSelectionBounds: () => selection,
  _makeWorkPathFromSelection: () => align.mutate("temporary selected work path"),
  _smartReadWorkPath: () => outline,
  _safeActiveLayerId: () => 42,
  _layerIsTextLayer: () => true,
  _textLayerIsPointText: () => true,
  _getCurrentTextLayerBounds: () => textBox,
  _checkSelection: () => {
    assert.strictEqual(align.getPixels(), "original selection", "Align must use the restored selection, with no temporary path selected");
    return selection;
  },
  _deselect: () => {},
  _changeToPointText: () => {},
  _moveLayer: (dx, dy) => { textBox = { ...textBox, xMid: textBox.xMid + dx, yMid: textBox.yMid + dy }; },
});
align.context._hostState.alignTextLayerToSelection = { placements: {}, resize: false, padding: 0 };
["alignCapture", "_alignCaptureRun", "_alignReadOutline", "_alignCurrentTextLayerToSelection", "_positionLayerWithinSelection"].forEach(name => vm.runInContext(extract(name), align.context));
const alignRead = JSON.parse(align.context.alignCapture());
assert.strictEqual(alignRead.texts[0].id, 42);
assert.deepStrictEqual(alignRead.bubbles[0].textIds, [42]);
assert.strictEqual(align.getPixels(), "original selection", "Align capture must remove its oval work path on deferred-history hosts");
assert.deepStrictEqual(align.states.map(state => state.name), names);
assert.strictEqual(align.context._alignCurrentTextLayerToSelection(), "");
assert.strictEqual(textBox.xMid, selection.xMid);
assert.strictEqual(textBox.yMid, selection.yMid);

const deferredFull = makeHost({ deferredHistory: true });
deferredFull.context.app.preferences.numberOfHistoryStates = 3;
assert.strictEqual(JSON.parse(deferredFull.context.getCurrentSelectionShape({})).scan, "path");
assert.strictEqual(deferredFull.getPixels(), "original selection");
assert.deepStrictEqual(deferredFull.states.map((state) => state.name), names);
assert.strictEqual(deferredFull.context.app.preferences.numberOfHistoryStates, 3);

const refreshFallback = makeHost({ deferredHistory: true, publishOnSelect: false });
assert.strictEqual(JSON.parse(refreshFallback.context.getCurrentSelectionShape({})).scan, "path");
assert.strictEqual(refreshFallback.getPixels(), "original selection");
assert.strictEqual(refreshFallback.getRefreshCalls(), 1, "Keep refresh for hosts that do not publish history after selecting it");
assert.strictEqual(refreshFallback.getRestoreCalls(), 2, "Refresh fallback must still restore the newly published state");
assert.deepStrictEqual(refreshFallback.states.map((state) => state.name), names);

const afterUndo = makeHost({ deferredHistory: true });
afterUndo.doc.activeHistoryState = afterUndo.states[1];
assert.strictEqual(afterUndo.context._withTemporaryHistory("Measure after Undo", () => {
  afterUndo.mutate("temporary layer");
  return 42;
}, { discardRedo: true }), 42);
assert.strictEqual(afterUndo.getPixels(), "original selection");
assert.deepStrictEqual(afterUndo.states.map(state => state.name), ["Open", "Paint"]);

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
