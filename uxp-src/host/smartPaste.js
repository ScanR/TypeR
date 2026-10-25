// Smart paste in the UXP host: the shared engine (app_src/oneClick) runs
// here, next to Photoshop, so pixels and paths never cross the WebView.
//   capture  - selection bounds, the local pixels and selection mask
//              (Imaging), the work path of the selection (rolled back)
//   measure  - hidden text layers at 64 px, atlases read as vector outlines
//   commit   - cleanup fill, text layers, stroke: one history state
// The panel calls smartPaste(request) and gets a JSON string back; any
// refusal answers { ok: false, code, message } and the panel falls back to
// the classic paste.

const ps = require("photoshop");
const photoshop = require("./photoshop");
const { prepareSmartPaste } = require("../../app_src/oneClick/smartPaste");
const { fillFromMask, triggerClick, captureSource } = require("../../app_src/oneClick/bubblePlan");
const { solverInternals } = require("../../app_src/oneClick/solver");
const { resolveTypeRFontVariant } = require("../../app_src/fontVariantResolver.jsxinc");

const host = photoshop._internals;
const { play, get, modal, suspendHistory, jamText } = host;

const TARGET_LAYER = { _ref: "layer", _enum: "ordinal", _value: "targetEnum" };
const TARGET_DOCUMENT = { _ref: "document", _enum: "ordinal", _value: "targetEnum" };
const SELECTION = { _ref: "channel", _property: "selection" };
const px = (value) => ({ _unit: "pixelsUnit", _value: value });
const unitValue = (value) => (value !== null && typeof value === "object" && "_value" in value ? value._value : value);
const CLEAN_LAYER_NAME = "TypeR Clean";
const HISTORY_NAME = "TyperTools Smart Paste";

const clone = (value) => JSON.parse(JSON.stringify(value));

const hasDocument = () => {
  try {
    return ps.app.documents.length > 0;
  } catch (error) {
    return false;
  }
};

const documentPixels = (doc) => {
  const toPixels = (value) => (typeof value === "number" ? value : unitValue(value));
  return { width: toPixels(doc.width), height: toPixels(doc.height), resolution: doc.resolution };
};

const boxOf = (descriptor) => {
  if (!descriptor) return null;
  const box = {
    left: Number(unitValue(descriptor.left)),
    top: Number(unitValue(descriptor.top)),
    right: Number(unitValue(descriptor.right)),
    bottom: Number(unitValue(descriptor.bottom)),
  };
  return [box.left, box.top, box.right, box.bottom].every(isFinite) ? box : null;
};

/* ======================== capture ======================== */

async function captureSelection(trigger, wants) {
  if (!hasDocument()) throw Object.assign(new Error("No document"), { code: "doc" });
  const doc = ps.app.activeDocument;
  const selectionDescriptor = get([{ _property: "selection" }, TARGET_DOCUMENT]).selection;
  const raw = boxOf(selectionDescriptor);
  if (!raw || raw.right - raw.left < 8 || raw.bottom - raw.top < 8) throw Object.assign(new Error("No selection"), { code: "noSelection" });
  const page = documentPixels(doc);
  const selectionBounds = {
    left: Math.max(0, Math.floor(raw.left)),
    top: Math.max(0, Math.floor(raw.top)),
    right: Math.min(page.width, Math.ceil(raw.right)),
    bottom: Math.min(page.height, Math.ceil(raw.bottom)),
  };
  const sw = selectionBounds.right - selectionBounds.left;
  const sh = selectionBounds.bottom - selectionBounds.top;
  const margin = Math.max(24, Math.ceil(Math.min(sw, sh) * 0.04));
  const crop = {
    left: Math.max(0, selectionBounds.left - margin),
    top: Math.max(0, selectionBounds.top - margin),
    right: Math.min(page.width, selectionBounds.right + margin),
    bottom: Math.min(page.height, selectionBounds.bottom + margin),
  };
  let pixels = null;
  let components = 0;
  let pixelBounds = null;
  let mask = null;
  let rawPath = null;
  let activeTextSize = null;
  await modal("TypeR Read Bubble", async (context) => {
    // Local pixels and the selection mask: the fill and the cleanup checks
    if (ps.imaging && ps.imaging.getPixels) {
      let pixelResult = null;
      let maskResult = null;
      try {
        pixelResult = await ps.imaging.getPixels({ documentID: doc.id, sourceBounds: crop, componentSize: 8, colorSpace: "RGB" });
        pixels = new Uint8Array(await pixelResult.imageData.getData({ chunky: true }));
        components = pixelResult.imageData.components;
        pixelBounds = pixelResult.sourceBounds || crop;
        maskResult = await ps.imaging.getSelection({ documentID: doc.id, sourceBounds: selectionBounds });
        mask = new Uint8Array(await maskResult.imageData.getData({ chunky: true }));
        if (pixelResult.level || (maskResult.level && maskResult.level !== 0)) pixels = null;
      } catch (imagingError) {
        pixels = null;
        mask = null;
      } finally {
        if (pixelResult) pixelResult.imageData.dispose();
        if (maskResult) maskResult.imageData.dispose();
      }
    }
    if (wants.keepSize && host._layerIsTextLayer()) activeTextSize = host._getTextLayerSize();
    if (trigger.source === "rectangle") return;
    // The selection's outline as a work path, read and rolled back: the
    // document (and any unsaved work path) is left untouched
    await suspendHistory(context, "TypeR Read Bubble", () => {
      const replies = ps.action.batchPlay([
        { _obj: "make", _target: [{ _ref: "path" }], from: SELECTION, tolerance: px(2), _options: { dialogOptions: "silent" } },
        { _obj: "get", _target: [{ _ref: "path", _property: "workPath" }], _options: { dialogOptions: "silent" } },
      ], { synchronousExecution: true, immediateRedraw: false });
      if (!replies || replies.length !== 2 || replies.some((reply) => reply && reply._obj === "error")) {
        throw Object.assign(new Error("Photoshop did not return the selection outline"), { code: "shape" });
      }
      rawPath = replies[1];
    }, { rollback: true });
  });
  let sample = null;
  if (pixels && pixelBounds) {
    const width = pixelBounds.right - pixelBounds.left;
    const height = pixelBounds.bottom - pixelBounds.top;
    if (width * height * components === pixels.length && components >= 1) {
      sample = (point) => {
        const x = Math.floor(point[0]) - pixelBounds.left;
        const y = Math.floor(point[1]) - pixelBounds.top;
        if (x < 0 || y < 0 || x >= width || y >= height) throw new Error("Outside the bubble crop");
        const at = (y * width + x) * components;
        const red = pixels[at];
        return { red, green: components === 1 ? red : pixels[at + 1], blue: components === 1 ? red : pixels[at + 2] };
      };
    }
  }
  let fill = null;
  if (sample && mask) {
    try {
      fill = fillFromMask(selectionBounds, mask, sample);
    } catch (outside) {
      fill = null;
    }
  }
  const source = captureSource(trigger, rawPath);
  const click = source === "wand" ? triggerClick(trigger, page.resolution) : null;
  return {
    documentId: doc.id,
    width: page.width,
    height: page.height,
    resolution: page.resolution,
    source,
    click,
    selectionBounds,
    rawPath,
    fill,
    sample,
    activeTextSize,
  };
}

/* ======================== measure ======================== */

const textObject = (params) => jamText.toLayerTextObject(params);

async function measureRequests(requests) {
  const replies = new Array(requests.length).fill(null);
  if (!requests.length) return replies;
  await modal("TypeR text measurement", (context) => suspendHistory(context, "TypeR text measurement", () => {
    let staging = false;
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      if (request.kind === "atlas") {
        try {
          play({ _obj: "make", _target: [{ _ref: "textLayer" }], using: textObject(request.params) });
          // Convert to shape: the outlines tell each row's ink bounds
          play({ _obj: "make", _target: [{ _ref: "contentLayer" }], using: { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" } });
          const path = get([{ _ref: "path", _enum: "path", _value: "vectorMask" }]);
          replies[i] = { path };
          play({ _obj: "delete", _target: [TARGET_LAYER] });
        } catch (atlasError) {
          replies[i] = null;
          staging = false;
        }
        continue;
      }
      const using = textObject(request.params);
      if (!staging) {
        play({ _obj: "make", _target: [{ _ref: "textLayer" }], using });
        staging = true;
      } else {
        play({ _obj: "set", _target: [TARGET_LAYER], to: using });
      }
      const bounds = boxOf(get([{ _property: "boundsNoEffects" }, TARGET_LAYER]).boundsNoEffects || get([{ _property: "bounds" }, TARGET_LAYER]).bounds);
      replies[i] = bounds ? { bounds } : null;
    }
  }, { rollback: true }));
  return replies;
}

/* ======================== commit ======================== */

// The document's "TypeR Clean" layer, created above the topmost pixel layer
// (under every text layer) the first time
function ensureCleanLayer(doc) {
  const layers = Array.from(doc.layers || []);
  for (const layer of layers) if (layer.name === CLEAN_LAYER_NAME && layer.kind === "pixel") return layer.id;
  let anchor = null;
  for (const layer of layers) {
    if (layer.kind !== "text" && layer.kind !== "group") {
      anchor = layer;
      break;
    }
  }
  if (anchor) play({ _obj: "select", _target: [{ _ref: "layer", _id: anchor.id }], makeVisible: false });
  play({ _obj: "make", _target: [{ _ref: "layer" }], using: { _obj: "layer", name: CLEAN_LAYER_NAME } });
  return host._getActiveLayerId();
}

function polygonSelection(polygon) {
  return {
    _obj: "set",
    _target: [SELECTION],
    to: { _obj: "polygon", points: polygon.map((p) => ({ _obj: "paint", horizontal: px(p[0]), vertical: px(p[1]) })) },
  };
}

function paintCleanup(doc, plan, previousLayerId) {
  const cleanId = ensureCleanLayer(doc);
  play({ _obj: "select", _target: [{ _ref: "layer", _id: cleanId }], makeVisible: false });
  play(polygonSelection(plan.cleanupPolygon));
  if (plan.cleanupInset > 0) play({ _obj: "contract", by: px(plan.cleanupInset) });
  const rgb = plan.fillRGB || { red: 255, green: 255, blue: 255 };
  play({
    _obj: "fill",
    using: { _enum: "fillContents", _value: "color" },
    color: { _obj: "RGBColor", red: rgb.red, grain: rgb.green, blue: rgb.blue },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
  });
  play({ _obj: "set", _target: [SELECTION], to: { _enum: "ordinal", _value: "none" } });
  if (previousLayerId != null) play({ _obj: "select", _target: [{ _ref: "layer", _id: previousLayerId }], makeVisible: false });
  return cleanId;
}

// Layer ink inside the chamber: the fast band test, then an alpha test
function inkFits(plan, bounds, pad) {
  if (!bounds) return false;
  const rows = solverInternals.band(plan.cleanPolygon, bounds.top, bounds.bottom, pad + 1);
  if (rows.some((row) => bounds.left >= row[0] && bounds.right <= row[1])) return true;
  try {
    play(polygonSelection(plan.cleanPolygon));
    play({ _obj: "contract", by: px(Math.max(1, Math.ceil(pad))) });
    play({ _obj: "inverse" });
    play({
      _obj: "intersect",
      _target: [{ _ref: "channel", _enum: "channel", _value: "transparencyEnum" }],
      with: SELECTION,
    });
    const selection = get([{ _property: "selection" }, TARGET_DOCUMENT]).selection;
    return !selection;
  } catch (error) {
    return true;
  } finally {
    try {
      play({ _obj: "set", _target: [SELECTION], to: { _enum: "ordinal", _value: "none" } });
    } catch (ignored) {}
  }
}

const layerInk = () => {
  const descriptor = get([{ _property: "boundsNoEffects" }, TARGET_LAYER]);
  return boxOf(descriptor.boundsNoEffects);
};

const translateLayer = (dx, dy) => {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  play({ _obj: "move", _target: [TARGET_LAYER], to: { _obj: "offset", horizontal: px(dx), vertical: px(dy) } });
};

function placeText(session, pointText) {
  const { plan, text } = session;
  const params = clone(text.params);
  host._makeTextLayer(params);
  const firstStyle = params.layerText.textStyleRange[0] && params.layerText.textStyleRange[0].textStyle;
  host._applyMiddleEast(firstStyle);
  // Paragraph text keeps the composed lines: convert, then restore the ink
  if (!pointText) {
    const before = layerInk();
    host._changeToBoxText();
    const after = layerInk();
    if (before && after) {
      // The box must not re-wrap the composed lines; point text otherwise
      if (Math.abs(before.right - before.left - (after.right - after.left)) > 1.5 ||
          Math.abs(before.bottom - before.top - (after.bottom - after.top)) > 1.5) {
        host._changeToPointText();
        const back = layerInk();
        if (back) translateLayer(before.left - back.left, before.top - back.top);
      } else {
        translateLayer(before.left - after.left, before.top - after.top);
      }
    }
  }
  let ink = layerInk();
  if (!inkFits(plan, ink, text.pad) && ink) {
    const dx = Math.max(-2, Math.min(2, text.axis - (ink.left + ink.right) / 2));
    const dy = Math.max(-2, Math.min(2, (text.top + text.bottom - ink.top - ink.bottom) / 2));
    translateLayer(dx, dy);
  } else if (text.terminalPause && ink) {
    // A lone "…" line: centre the whole ink if it still fits
    const dx = plan.selection.xMid - (ink.left + ink.right) / 2;
    const dy = plan.selection.yMid - (ink.top + ink.bottom) / 2;
    for (const scale of [1, 0.5]) {
      translateLayer(dx * scale, dy * scale);
      ink = layerInk();
      if (inkFits(plan, ink, text.pad)) break;
      translateLayer(-dx * scale, -dy * scale);
    }
  }
  if (text.stroke) host._setLayerStroke(text.stroke);
  return host._getActiveLayerId();
}

async function commitSessions(prepared) {
  const doc = ps.app.activeDocument;
  if (!doc || doc.id !== prepared.documentId) throw Object.assign(new Error("The document changed"), { code: "doc" });
  const historyBefore = doc.activeHistoryState && doc.activeHistoryState.id;
  const layerIds = [];
  await modal("TypeR", (context) => suspendHistory(context, HISTORY_NAME, () => {
    let previous = null;
    try {
      previous = host._getActiveLayerId();
    } catch (noLayer) {}
    for (const session of prepared.sessions) {
      if (session.plan.autoClean && session.plan.cleanupPolygon) paintCleanup(doc, session.plan, previous);
      play({ _obj: "set", _target: [SELECTION], to: { _enum: "ordinal", _value: "none" } });
      const id = placeText(session, prepared.pointText);
      layerIds.push(id);
      previous = id;
    }
  }));
  const historyAfter = doc.activeHistoryState && doc.activeHistoryState.id;
  return { layerIds, history: { documentId: doc.id, before: historyBefore, after: historyAfter } };
}

/* ====================== public surface ====================== */

const resolveRunStyle = () => {
  let fonts = null;
  return (base, run) => {
    const style = clone(base);
    if (run.bold || run.italic) {
      try {
        if (!fonts) fonts = host._getFontList();
        resolveTypeRFontVariant(style, run, fonts);
      } catch (noFonts) {
        if (run.bold) style.syntheticBold = true;
        if (run.italic) style.syntheticItalic = true;
      }
    }
    return style;
  };
};

async function smartPaste(request) {
  try {
    if (!request || !Array.isArray(request.lines)) return JSON.stringify({ ok: false, code: "noText" });
    const settings = request.settings || {};
    const prepared = await prepareSmartPaste(request, {
      capture: (trigger) => captureSelection(trigger, { keepSize: !!settings.keepSize }),
      measure: measureRequests,
      resolveRunStyle: resolveRunStyle(),
      useAtlas: true,
    });
    const done = await commitSessions(prepared);
    return JSON.stringify({
      ok: true,
      consumed: prepared.consumed,
      layerIds: done.layerIds,
      history: done.history,
      cleanupSkipped: prepared.cleanupSkipped,
      sessions: prepared.sessions.map((session) => ({ kind: session.plan.kind, role: session.role, styleId: session.styleId, size: session.text.size, tier: session.text.tier, hyphenated: session.text.hyphenated })),
    });
  } catch (error) {
    return JSON.stringify({ ok: false, code: (error && error.code) || "error", message: String((error && error.message) || error) });
  }
}

function getHistorySnapshot() {
  if (!hasDocument()) return JSON.stringify(null);
  try {
    const doc = ps.app.activeDocument;
    return JSON.stringify({
      documentId: doc.id,
      current: doc.activeHistoryState && doc.activeHistoryState.id,
      states: Array.from(doc.historyStates || []).map((state) => state.id),
    });
  } catch (error) {
    return JSON.stringify(null);
  }
}

// The CEP host's three steps, for parity: the UXP panel itself calls
// smartPaste, which runs them all here
async function smartPasteCapture(data) {
  try {
    const input = await captureSelection((data && data.trigger) || { source: "manual" }, { keepSize: !!(data && data.keepSize) });
    const out = Object.assign({}, input);
    delete out.sample;
    return JSON.stringify(out);
  } catch (error) {
    return JSON.stringify({ error: (error && error.code) || "error" });
  }
}

async function smartPasteMeasure(data) {
  try {
    const requests = ((data && data.requests) || []).map((request) => ({ kind: request.kind || "line", params: request.params, count: request.count }));
    return JSON.stringify(await measureRequests(requests));
  } catch (error) {
    return JSON.stringify({ error: "measure" });
  }
}

async function smartPasteCommit(prepared) {
  try {
    return JSON.stringify(await commitSessions(prepared));
  } catch (error) {
    return JSON.stringify({ error: "commit", message: String((error && error.message) || error) });
  }
}

// Select again what a stored multi-bubble selection remembers (see host.js)
async function replaySelectionTrigger(trigger) {
  if (!hasDocument()) return JSON.stringify({ error: "doc" });
  if (!trigger) return JSON.stringify({ error: "trigger" });
  let to = null;
  const extra = {};
  if (trigger.source === "wand") {
    const scale = trigger.unit === "distanceUnit" ? ps.app.activeDocument.resolution / 72 : 1;
    to = { _obj: "paint", horizontal: px(trigger.x * scale), vertical: px(trigger.y * scale) };
    const options = trigger.options || {};
    extra.tolerance = typeof options.tolerance === "number" ? options.tolerance : 32;
    extra.antiAlias = options.antiAlias !== false;
    if (options.contiguous === false) extra.contiguous = false;
    if (options.merged === true) extra.merged = true;
  } else if (trigger.source === "rectangle" && typeof trigger.left === "number") {
    to = { _obj: "rectangle", top: px(trigger.top), left: px(trigger.left), bottom: px(trigger.bottom), right: px(trigger.right) };
  } else {
    return JSON.stringify({ error: "trigger" });
  }
  try {
    await modal("TypeR", () => play(Object.assign({ _obj: "set", _target: [SELECTION], to }, extra)));
    return JSON.stringify({ ok: true });
  } catch (error) {
    return JSON.stringify({ error: "replay" });
  }
}

module.exports = {
  methods: { smartPaste, smartPasteCapture, smartPasteMeasure, smartPasteCommit, getHistorySnapshot, replaySelectionTrigger },
  _internals: { captureSelection, measureRequests, commitSessions, inkFits },
};
