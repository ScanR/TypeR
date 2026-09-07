const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const load = require("./helpers/loadAppModule")();
const { normalizeTrainingFiles, makeTrainingPage, selectedTrainingEntries, trainTextShapeREntries } = load("app_src/textShapeRTraining.js");

async function testLearning() {
  const files = normalizeTrainingFiles(["/pages/10.psd", "/pages/2.psd", "/pages/2.psd", "/pages/no.png", null]);
  assert.deepStrictEqual(files.map((file) => file.name), ["2.psd", "10.psd"]);
  const page = makeTrainingPage(files[0], { entries: [
    { text: "Hello\r\nthere", visible: true },
    { text: "Hidden\rtext", visible: false },
    { text: "Excluded\ntext", visible: true },
    { text: "Unreadable", error: "readFailed" },
    { text: "   " },
  ] });
  page.entries[2].included = false;
  assert.strictEqual(page.entries[0].text, "Hello\nthere");
  assert.strictEqual(page.entries[1].included, false);
  assert.strictEqual(page.entries[3].usable, false);
  const failedPage = makeTrainingPage(files[1], { error: "scanFailed", entries: [{ text: "Should not train" }] });
  const selected = selectedTrainingEntries([page, failedPage]);
  assert.deepStrictEqual(selected.map((entry) => entry.text), ["Hello\nthere"]);

  const calls = [];
  const initial = { samples: 4 };
  const recordFeedback = (text, options, tuning) => {
    calls.push(text);
    return { tuning: { ...tuning, samples: tuning.samples + 1 } };
  };
  const learned = await trainTextShapeREntries(selected, initial, { recordFeedback });
  assert.strictEqual(learned.tuning.samples, 5);
  assert.deepStrictEqual(initial, { samples: 4 }, "Review/training must not mutate persisted learning");
  assert.deepStrictEqual(calls, ["Hello\nthere"], "Only checked, usable layers may train");
  page.entries[1].included = true;
  assert.strictEqual(selectedTrainingEntries([page]).length, 2, "Hidden layers can be opted into");

  let cancel = false;
  const cancelled = await trainTextShapeREntries([{ text: "first" }, { text: "second" }], initial, {
    recordFeedback,
    isCancelled: () => cancel,
    onProgress: () => { cancel = true; },
  });
  assert.strictEqual(cancelled.cancelled, true);
  assert.strictEqual(cancelled.tuning, undefined, "Cancellation must not expose a partial result to commit");
  assert.strictEqual(initial.samples, 4);
  await assert.rejects(trainTextShapeREntries(selected, initial, { recordFeedback: () => { throw new Error("Training failure"); } }));
  assert.strictEqual(initial.samples, 4);

  // Exercise the real ranker and ensure local batch learning leaves its live
  // suggestion state unchanged until the UI commits the result.
  const engine = load("app_src/textShapeR.js");
  const text = "This is a longer dialogue\nwith several words\nto learn from.";
  const before = engine.generateTextShapeRVariants(text);
  const real = await trainTextShapeREntries([{ text }, { text: "We have to\nkeep moving\nforward now." }], null, { recordFeedback: engine.recordTextShapeRFeedback });
  assert.strictEqual(real.learned, 2);
  assert.strictEqual(real.tuning.samples, 2);
  assert.deepStrictEqual(engine.generateTextShapeRVariants(text), before);
}

function testPhotoshopScan() {
  const original = { name: "User PSD", fullName: { fsName: "/pages/existing.psd" }, layers: [], selected: [10, 12], saved: false };
  const closed = [];
  let duplicated = 0;
  let failRead = false;
  let failOpen = false;
  const layer = (id, overrides = {}) => ({ id, name: `Layer ${id}`, kind: "text", visible: true, typename: "ArtLayer", text: `Line ${id}\rSecond line`, ...overrides });
  const layers = Array.from({ length: 90 }, (_, index) => layer(index + 1));
  layers.push({ name: "Hidden group", typename: "LayerSet", visible: false, layers: [layer(101), layer(102, { paragraph: true })] });
  layers.push(layer(103, { broken: true }));
  layers.push(layer(104, { kind: "image" }));
  original.layers = layers;
  const app = { activeDocument: original, documents: [original], displayDialogs: "all" };
  const box = vm.createContext({ app, documents: app.documents, LayerKind: { TEXT: "text" }, DialogModes: { NO: "none" }, SaveOptions: { DONOTSAVECHANGES: "no-save" }, jamJSON: JSON });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app_src/host.js"), "utf8"), box);
  function workDocument() {
    const doc = {
      layers,
      close(mode) { closed.push(mode); },
      suspendHistory(name, script) {
        if (failRead) throw new Error("Read failed");
        vm.runInContext(script, box);
      },
    };
    return doc;
  }
  original.duplicate = () => { duplicated++; return workDocument(); };
  const opened = [];
  app.open = (file) => { opened.push(file.fsName); if (failOpen) throw new Error("Open failed"); return workDocument(); };
  let activeLayer;
  const flatLayers = layers.slice(0, 90).concat(layers[90].layers, layers.slice(91));
  Object.assign(box, {
    File: function (filePath) { this.fsName = filePath; this.exists = filePath !== "/missing.psd"; },
    _selectLayerById(id) { activeLayer = flatLayers.find((item) => item.id === id); if (activeLayer.broken) throw new Error("Unreadable layer"); },
    _textLayerIsPointText: () => !activeLayer.paragraph,
    jamText: { getLayerText: () => ({ layerText: { textKey: activeLayer.text } }) },
    _getRenderedTextLines() { box._hostState.getRenderedTextLines.result = "Automatically\nwrapped text"; },
  });

  const result = JSON.parse(box.scanTextShapeRTraining("/pages/existing.psd"));
  assert.strictEqual(result.entries.length, 93, "No 80-layer truncation; include hidden and nested text layers");
  assert.strictEqual(result.entries[90].visible, false, "Parent visibility must be inherited");
  assert.strictEqual(result.entries[90].layerPath, "Hidden group / Layer 101");
  assert.strictEqual(result.entries[91].text, "Automatically\nwrapped text");
  assert.strictEqual(result.entries[92].error, "readFailed");
  assert.strictEqual(duplicated, 1);
  assert.deepStrictEqual(closed, ["no-save"]);
  assert.strictEqual(app.activeDocument, original);
  assert.strictEqual(app.displayDialogs, "all");
  assert.deepStrictEqual(original.selected, [10, 12]);
  assert.strictEqual(original.saved, false);
  assert.strictEqual(opened.length, 0, "Already-open PSDs must use their unsaved in-memory version");

  box.scanTextShapeRTraining("");
  assert.strictEqual(duplicated, 2, "Shift-click scans a duplicate of the active page");
  box.scanTextShapeRTraining('/pages/quote" and slash\\.psd');
  assert.deepStrictEqual(opened, ['/pages/quote" and slash\\.psd']);
  assert.strictEqual(app.activeDocument, original);
  failRead = true;
  assert.strictEqual(JSON.parse(box.scanTextShapeRTraining("/pages/new.psd")).error, "scanFailed");
  assert.strictEqual(closed.length, 4, "A failed read still closes its temporary document without saving");
  assert.strictEqual(app.activeDocument, original);
  assert.strictEqual(app.displayDialogs, "all");
  failRead = false;
  failOpen = true;
  assert.strictEqual(JSON.parse(box.scanTextShapeRTraining("/pages/new.psd")).error, "scanFailed");
  assert.strictEqual(app.displayDialogs, "all");
  assert.strictEqual(JSON.parse(box.scanTextShapeRTraining("/missing.psd")).error, "notFound");
  assert.strictEqual(JSON.parse(box.scanTextShapeRTraining("/pages/no.png")).error, "badPath");
  app.activeDocument = null;
  assert.strictEqual(JSON.parse(box.scanTextShapeRTraining("")).error, "document");
}

(async () => {
  testPhotoshopScan();
  await testLearning();
  console.log("TextShapeR training selection, cancellation, ranker and PSD safety tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
