// UXP port of app_src/host.js. Every public function keeps the name, the
// arguments and the string result of its ExtendScript counterpart, so the
// panel calls it through the same evalScript strings. ActionManager calls
// become synchronous batchPlay calls: inside executeAsModal they run back to
// back on Photoshop's main thread, like a suspendHistory block did.
//
// Keep this file in step with host.js: the sections and helper names follow it.

const ps = require("photoshop");
const uxp = require("uxp");
const jamText = require("./jamText");
const { resolveTypeRFontVariant } = require("../../app_src/fontVariantResolver.jsxinc");
const keyboard = require("./keyboard");

const { batchPlay } = ps.action;

/* ========================================================= */
/* ===================== batchPlay core ==================== */
/* ========================================================= */

// "silent": a failing command returns an error descriptor. "dontDisplay"
// still raises Photoshop's modal alert, which blocks the whole host.
const SILENT = { dialogOptions: "silent" };

class PhotoshopError extends Error {
  constructor(descriptor, result) {
    super((result && result.message) || "Photoshop " + descriptor._obj + " error " + (result && result.result));
    this.name = "PhotoshopError";
    this.code = result && result.result;
  }
}

// executeAction / executeActionGet: throws when Photoshop refuses the command
function play(descriptor) {
  const result = batchPlay([Object.assign({ _options: SILENT }, descriptor)], { synchronousExecution: true })[0];
  if (result && result._obj === "error") throw new PhotoshopError(descriptor, result);
  return result || {};
}

function playMany(descriptors) {
  const results = batchPlay(descriptors.map((descriptor) => Object.assign({ _options: SILENT }, descriptor)), { synchronousExecution: true });
  for (let i = 0; i < results.length; i++) {
    if (results[i] && results[i]._obj === "error") throw new PhotoshopError(descriptors[i], results[i]);
  }
  return results;
}

function get(target) {
  return play({ _obj: "get", _target: target });
}

const TARGET_LAYER = { _ref: "layer", _enum: "ordinal", _value: "targetEnum" };
const TARGET_TEXT_LAYER = { _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" };
const TARGET_DOCUMENT = { _ref: "document", _enum: "ordinal", _value: "targetEnum" };
const SELECTION = { _ref: "channel", _property: "selection" };
const px = (value) => ({ _unit: "pixelsUnit", _value: value });
const unitValue = (value) => (value !== null && typeof value === "object" && "_value" in value ? value._value : value);
// ActionDescriptor.getInteger on a unit value truncates it
const integerValue = (value) => Math.trunc(Number(unitValue(value)));

function hasDocument() {
  try {
    return ps.app.documents.length > 0;
  } catch (error) {
    return false;
  }
}

// app.activeDocument throws without a document, like ExtendScript's
function activeDocument() {
  const doc = ps.app.activeDocument;
  if (!doc) throw new Error("No document");
  return doc;
}

/* ========================================================= */
/* =================== modal / history ===================== */
/* ========================================================= */

const MODAL_RETRY_MS = 4000;
const isModalBusyError = (error) => /modal|busy/i.test(String((error && error.message) || error));

// ExtendScript calls queue behind whatever Photoshop is doing; executeAsModal
// refuses to start while another modal scope runs, so wait for it instead.
async function modal(name, fn) {
  const started = Date.now();
  for (;;) {
    try {
      return await ps.core.executeAsModal((context) => fn(context), { commandName: name });
    } catch (error) {
      if (!isModalBusyError(error) || Date.now() - started > MODAL_RETRY_MS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

// doc.suspendHistory(name, fn): one history state for the whole run. With
// rollback, the run leaves no history state and no document change at all.
async function suspendHistory(context, name, fn, options = {}) {
  const documentID = activeDocument().id;
  const suspensionID = await context.hostControl.suspendHistory({ documentID, name });
  let commit = !options.rollback;
  let result;
  try {
    result = await fn();
    if (options.shouldCommit) commit = options.shouldCommit(result);
  } finally {
    await context.hostControl.resumeHistory(suspensionID, commit);
  }
  return result;
}

/* ========================================================= */
/* ======================= constants ======================= */
/* ========================================================= */

const _SAFE_PARAGRAPH_PROPS = [
  "align",
  "alignment",
  "firstLineIndent",
  "startIndent",
  "endIndent",
  "spaceBefore",
  "spaceAfter",
  "autoLeadingPercentage",
  "leadingType",
  "hyphenate",
  "hyphenateWordSize",
  "hyphenatePreLength",
  "hyphenatePostLength",
  "hyphenateLimit",
  "hyphenationZone",
  "hyphenateCapitalized",
  "hangingRoman",
  "burasagari",
  "textEveryLineComposer",
  "textComposerEngine",
];

const _DEFAULT_SELECTION_SCALE = 0.9;
const _MIN_TEXTBOX_WIDTH = 10;
const _TEMP_SELECTION_CHANNEL = "__TyperSelectionTemp__";
const _SELECTION_OPEN_RATIO = 0.1;
const _MIN_SELECTION_OPEN_RADIUS = 4;

const _hostState = {
  fallbackTextSize: 20,
  selectionMonitor: {
    lastBoundsKey: null,
    lastBounds: null,
    multiWarnBounds: null,
    documentKey: undefined,
  },
  hiddenCleaningLayerIdsByDocument: {},
  documentSession: String(new Date().getTime()) + ":" + String(Math.random()),
  lastOpenedDocId: null,
};

function _clone(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(_clone);
  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) result[key] = _clone(obj[key]);
  }
  return result;
}

function _normalizeTextKey(text) {
  return String(text || "").replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

function _getHostDefaultStyle() {
  return {
    layerText: {
      textGridding: "none",
      orientation: "horizontal",
      antiAlias: "antiAliasSmooth",
      textStyleRange: [
        {
          from: 0,
          to: 100,
          textStyle: {
            fontPostScriptName: "Tahoma",
            fontName: "Tahoma",
            fontStyleName: "Regular",
            fontScript: 0,
            fontTechnology: 1,
            fontAvailable: true,
            size: 14,
            impliedFontSize: 14,
            horizontalScale: 100,
            verticalScale: 100,
            autoLeading: true,
            tracking: 0,
            baselineShift: 0,
            impliedBaselineShift: 0,
            autoKern: "metricsKern",
            fontCaps: "normal",
            digitSet: "defaultDigits",
            diacXOffset: 0,
            markYDistFromBaseline: 100,
            otbaseline: "normal",
            ligature: false,
            altligature: false,
            connectionForms: false,
            contextualLigatures: false,
            baselineDirection: "withStream",
            color: { red: 0, green: 0, blue: 0 },
          },
        },
      ],
      paragraphStyleRange: [
        {
          from: 0,
          to: 100,
          paragraphStyle: {
            burasagari: "burasagariNone",
            singleWordJustification: "justifyAll",
            justificationMethodType: "justifMethodAutomatic",
            textEveryLineComposer: false,
            alignment: "center",
            hangingRoman: true,
            hyphenate: true,
          },
        },
      ],
    },
    typeUnit: "pixelsUnit",
  };
}

function _getHostDefaultStroke() {
  return {
    enabled: false,
    size: 0,
    opacity: 100,
    position: "outer",
    color: { r: 255, g: 255, b: 255 },
  };
}

function _ensureStyle(style) {
  const normalized = style ? _clone(style) : {};
  if (!normalized.textProps || !normalized.textProps.layerText) {
    normalized.textProps = _getHostDefaultStyle();
  }
  if (typeof normalized.stroke === "undefined") {
    normalized.stroke = _getHostDefaultStroke();
  }
  return normalized;
}

function _overrideStyleTextSize(style, size) {
  if (!style || !(size > 0)) return style;
  const ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges.length) return style;
  for (let i = 0; i < ranges.length; i++) {
    if (!ranges[i] || !ranges[i].textStyle) continue;
    ranges[i].textStyle.size = size;
    if (ranges[i].textStyle.impliedFontSize != null) {
      ranges[i].textStyle.impliedFontSize = size;
    }
  }
  return style;
}

function _getDocumentPixelSize() {
  const doc = get([{ _property: "width" }, TARGET_DOCUMENT]);
  const height = get([{ _property: "height" }, TARGET_DOCUMENT]);
  const resolution = _getDocumentResolution();
  // Document width/height come back in points (distance units at 72 dpi)
  const toPixels = (value) => {
    if (value && typeof value === "object" && value._unit === "pixelsUnit") return value._value;
    return (unitValue(value) * resolution) / 72;
  };
  return { width: toPixels(doc.width), height: toPixels(height.height) };
}

function _resolveStyleSizeForDocument(style) {
  if (!style || style.autoSizeByPageWidth !== true || !hasDocument()) return style;
  const presets = style.sizePresets;
  if (!presets || presets.length < 2) return style;

  let pageWidth;
  try {
    pageWidth = _getDocumentPixelSize().width;
  } catch (widthError) {
    return style;
  }
  if (isNaN(pageWidth) || pageWidth <= 0) return style;

  let defaultIndex = parseInt(style.sizePresetDefaultIndex, 10);
  if (isNaN(defaultIndex) || defaultIndex < 0 || defaultIndex >= presets.length) defaultIndex = 0;
  let selectedSize = parseFloat(presets[defaultIndex]);
  let selectedThreshold = -1;
  const minWidths = style.sizePresetMinWidths || [];
  for (let i = 0; i < presets.length; i++) {
    if (i === defaultIndex) continue;
    const threshold = parseFloat(minWidths[i]);
    const presetSize = parseFloat(presets[i]);
    if (!isNaN(threshold) && threshold > 0 && !isNaN(presetSize) && presetSize > 0 &&
        pageWidth >= threshold && threshold > selectedThreshold) {
      selectedThreshold = threshold;
      selectedSize = presetSize;
    }
  }
  if (isNaN(selectedSize) || selectedSize <= 0) return style;

  const ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges[0] || !ranges[0].textStyle) return style;
  ranges[0].textStyle.size = selectedSize;
  if (ranges[0].textStyle.impliedFontSize != null) {
    ranges[0].textStyle.impliedFontSize = selectedSize;
  }
  return style;
}

/* ========================================================= */
/* ================== layer / text helpers ================= */
/* ========================================================= */

function _setTextShapeType(type) {
  play({
    _obj: "set",
    _target: [{ _ref: "property", _property: "textType" }, TARGET_TEXT_LAYER],
    to: { _enum: "textType", _value: type },
  });
}

function _changeToPointText() {
  _setTextShapeType("point");
}

function _changeToBoxText() {
  _setTextShapeType("box");
}

function _getLayerTextKey() {
  const result = get([{ _property: "textKey" }, TARGET_LAYER]);
  return result.textKey || null;
}

function _layerIsTextLayer() {
  const result = get([{ _property: "textKey" }, TARGET_LAYER]);
  return !!result.textKey;
}

function _getActiveLayerId() {
  return integerValue(get([{ _property: "layerID" }, TARGET_LAYER]).layerID);
}

function _duplicateActiveLayer() {
  play({ _obj: "duplicate", _target: [TARGET_LAYER] });
}

function _deleteActiveLayer() {
  play({ _obj: "delete", _target: [TARGET_LAYER] });
}

function _selectLayerById(layerId) {
  play({ _obj: "select", _target: [{ _ref: "layer", _id: layerId }] });
}

function _selectLayersById(layerIds) {
  if (!layerIds || !layerIds.length) return;
  for (let i = 0; i < layerIds.length; i++) {
    const descriptor = { _obj: "select", _target: [{ _ref: "layer", _id: layerIds[i] }], makeVisible: false };
    if (i > 0) descriptor.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
    play(descriptor);
  }
}

function _textKeyIsPointText(textKey) {
  const shape = textKey && textKey.textShape && textKey.textShape[0];
  const type = shape && (shape.char || shape.textType);
  return !!type && type._value === "paint";
}

function _textLayerIsPointText() {
  return _textKeyIsPointText(_getLayerTextKey());
}

function _resolveStylePointText(style, fallbackPointText) {
  if (style && style.textType === "point") return true;
  if (style && style.textType === "paragraph") return false;
  return !!fallbackPointText;
}

// jamText.getLayerText / setLayerText on the target layer
function _getLayerText() {
  try {
    const textKey = _getLayerTextKey();
    return textKey ? jamText.fromLayerTextObject(textKey) : null;
  } catch (error) {
    return null;
  }
}

function _setLayerText(layerText) {
  let isTextLayer = false;
  try {
    isTextLayer = _layerIsTextLayer();
  } catch (error) {}
  if (isTextLayer) {
    play({ _obj: "set", _target: [TARGET_LAYER], to: jamText.toLayerTextObject(layerText) });
  } else {
    play({ _obj: "make", _target: [{ _ref: "textLayer" }], using: jamText.toLayerTextObject(layerText) });
  }
}

function _getTextLayerSize() {
  try {
    const textParams = _getLayerText();
    if (textParams && textParams.layerText &&
        textParams.layerText.textStyleRange &&
        textParams.layerText.textStyleRange[0] &&
        textParams.layerText.textStyleRange[0].textStyle &&
        textParams.layerText.textStyleRange[0].textStyle.size) {
      return textParams.layerText.textStyleRange[0].textStyle.size;
    }
  } catch (e) {}
  return _hostState.fallbackTextSize || 20;
}

function _getDocumentResolution() {
  return unitValue(get([{ _property: "resolution" }, TARGET_DOCUMENT]).resolution);
}

function _convertPixelToPoint(value) {
  return (parseInt(value, 10) / _getDocumentResolution()) * 72;
}

function _convertPixelToPointExact(value) {
  return (value / _getDocumentResolution()) * 72;
}

// Span (in points) for the temporary measuring box used while re-flowing
// box text: derived from the document size and capped in pixels, so the type
// engine never lays out a huge box (see host.js).
function _getMeasureBoxSpanPoints() {
  let spanPx = 20000;
  try {
    const size = _getDocumentPixelSize();
    const docSpanPx = 2 * Math.max(size.width, size.height);
    if (docSpanPx > 0 && docSpanPx < spanPx) spanPx = docSpanPx;
  } catch (spanError) {}
  return _convertPixelToPointExact(spanPx);
}

function _getCurrentDocumentId() {
  return integerValue(get([{ _property: "documentID" }, TARGET_DOCUMENT]).documentID);
}

function _documentHasBackgroundLayer() {
  try {
    return !!get([{ _property: "hasBackgroundLayer" }, TARGET_DOCUMENT]).hasBackgroundLayer;
  } catch (error) {
    return false;
  }
}

function _layerExistsById(id) {
  try {
    get([{ _property: "layerID" }, { _ref: "layer", _id: id }]);
    return true;
  } catch (e) {
    return false;
  }
}

function _setLayerVisibilityByIds(ids, visible) {
  if (!ids || !ids.length) return 0;
  const references = [];
  for (let i = 0; i < ids.length; i++) {
    // A cleaning layer may have been deleted while hidden: skip stale IDs
    if (visible && !_layerExistsById(ids[i])) continue;
    references.push({ _ref: "layer", _id: ids[i] });
  }
  if (!references.length) return 0;
  play({ _obj: visible ? "show" : "hide", null: references });
  return references.length;
}

function _getLayerPropertyByIndex(property, index) {
  return get([{ _property: property }, { _ref: "layer", _index: index }])[property];
}

function _collectVisibleCleaningLayerIds() {
  let index = integerValue(get([{ _property: "numberOfLayers" }, TARGET_DOCUMENT]).numberOfLayers);
  // Preserve the real background, or the bottom-most layer when the document
  // has no formal background layer, exactly as Typesetterer did.
  const stopIndex = _documentHasBackgroundLayer() ? 0 : 1;
  const parentVisibility = [];
  const ids = [];

  while (index > stopIndex) {
    const layer = get([{ _ref: "layer", _index: index }]);
    const section = layer.layerSection && layer.layerSection._value;
    if (section === "layerSectionStart") {
      parentVisibility.push(!!layer.visible);
    } else if (section === "layerSectionEnd") {
      parentVisibility.pop();
    } else {
      let parentsVisible = true;
      for (let i = 0; i < parentVisibility.length; i++) {
        parentsVisible = parentsVisible && parentVisibility[i];
      }
      if (
        parentsVisible &&
        !layer.textKey &&
        !layer.background &&
        layer.visible &&
        !layer.adjustment
      ) {
        ids.push(integerValue(layer.layerID));
      }
    }
    index--;
  }
  return ids;
}

function _deselect() {
  play({ _obj: "set", _target: [SELECTION], to: { _enum: "ordinal", _value: "none" } });
}

function _getBoundsFromDescriptor(bounds) {
  const top = integerValue(bounds.top);
  const left = integerValue(bounds.left);
  const right = integerValue(bounds.right);
  const bottom = integerValue(bounds.bottom);
  return {
    top,
    left,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
}

function _getCurrentSelectionBounds() {
  const doc = get([{ _property: "selection" }, TARGET_DOCUMENT]);
  if (doc.selection) return _getBoundsFromDescriptor(doc.selection);
  return undefined;
}

function _getCurrentTextLayerBounds() {
  return _getBoundsFromDescriptor(get([{ _property: "bounds" }, TARGET_LAYER]).bounds);
}

function _modifySelectionBounds(amount) {
  if (amount == 0) return;
  play({ _obj: amount > 0 ? "expand" : "contract", by: px(Math.abs(amount)) });
}

function _deleteTempSelectionChannel() {
  try {
    play({ _obj: "delete", _target: [{ _ref: "channel", _name: _TEMP_SELECTION_CHANNEL }] });
  } catch (removeError) {}
}

// doc.selection.store(channel): the selection is parked in a named channel
function _createTempSelectionChannel() {
  _deleteTempSelectionChannel();
  try {
    play({ _obj: "duplicate", _target: [SELECTION], name: _TEMP_SELECTION_CHANNEL });
    return true;
  } catch (error) {
    _deleteTempSelectionChannel();
    return false;
  }
}

function _loadTempSelectionChannel() {
  play({ _obj: "set", _target: [SELECTION], to: { _ref: "channel", _name: _TEMP_SELECTION_CHANNEL } });
}

function _getAdjustedSelectionBounds(bounds, amount) {
  if (!bounds || amount === 0) return bounds;
  if (!hasDocument()) return _getAdjustedSelectionBoundsFallback(bounds, amount);
  if (!_createTempSelectionChannel()) return _getAdjustedSelectionBoundsFallback(bounds, amount);

  let adjusted = null;
  try {
    _modifySelectionBounds(amount);
    adjusted = _getCurrentSelectionBounds();
  } catch (error2) {
    adjusted = null;
  } finally {
    try {
      _loadTempSelectionChannel();
    } catch (restoreError) {}
    _deleteTempSelectionChannel();
  }

  if (!adjusted) return _getAdjustedSelectionBoundsFallback(bounds, amount);
  return adjusted;
}

function _getAdjustedSelectionBoundsFallback(bounds, amount) {
  if (!bounds || amount === 0) return bounds;
  const delta = Math.abs(amount);
  if (amount < 0) {
    if (bounds.width <= delta * 2 || bounds.height <= delta * 2) return null;
    const contracted = {
      top: bounds.top + delta,
      left: bounds.left + delta,
      right: bounds.right - delta,
      bottom: bounds.bottom - delta,
    };
    contracted.width = contracted.right - contracted.left;
    contracted.height = contracted.bottom - contracted.top;
    contracted.xMid = (contracted.left + contracted.right) / 2;
    contracted.yMid = (contracted.top + contracted.bottom) / 2;
    return contracted;
  }
  const expanded = {
    top: Math.max(bounds.top - delta, 0),
    left: Math.max(bounds.left - delta, 0),
    right: bounds.right + delta,
    bottom: bounds.bottom + delta,
  };
  expanded.width = expanded.right - expanded.left;
  expanded.height = expanded.bottom - expanded.top;
  expanded.xMid = (expanded.left + expanded.right) / 2;
  expanded.yMid = (expanded.top + expanded.bottom) / 2;
  return expanded;
}

function _clampAdjustAmount(bounds, amount) {
  if (!bounds || amount >= 0) return amount;
  // Avoid over-contracting small selections: keep at least 2px margin per side
  const maxContract = Math.floor(Math.min(bounds.width, bounds.height) / 2 - 1);
  if (maxContract <= 0) return 0;
  return -Math.min(Math.abs(amount), maxContract);
}

function _getAdaptiveSelectionOpenRadius(bounds) {
  if (!bounds) return 0;
  const shortestSide = Math.min(bounds.width, bounds.height);
  const maxRadius = Math.floor(shortestSide / 2 - 1);
  if (maxRadius <= 0) return 0;
  const radius = Math.max(_MIN_SELECTION_OPEN_RADIUS, Math.round(shortestSide * _SELECTION_OPEN_RATIO));
  return Math.min(radius, maxRadius);
}

// Morphological opening of the selection (contract then expand by the same
// radius): closes the wand's holes on the letters and cuts the bubble's tail
function _getAdaptiveOpenedSelectionBounds(bounds) {
  if (!bounds) return bounds;

  const radius = _getAdaptiveSelectionOpenRadius(bounds);
  if (radius <= 0) return bounds;
  if (!hasDocument()) return bounds;
  if (!_createTempSelectionChannel()) return bounds;

  let opened = null;
  let attemptRadius = radius;
  try {
    while (attemptRadius >= 1 && !opened) {
      if (attemptRadius !== radius) {
        try {
          _loadTempSelectionChannel();
        } catch (retryRestoreError) {
          break;
        }
      }

      let candidate = null;
      try {
        _modifySelectionBounds(-attemptRadius);
        const contracted = _getCurrentSelectionBounds();
        if (contracted && contracted.width > 1 && contracted.height > 1) {
          _modifySelectionBounds(attemptRadius);
          candidate = _getCurrentSelectionBounds();
        }
      } catch (openError) {
        candidate = null;
      }

      if (candidate && candidate.width * candidate.height >= 200) {
        opened = candidate;
      } else {
        attemptRadius = Math.floor(attemptRadius / 2);
      }
    }
  } finally {
    try {
      _loadTempSelectionChannel();
    } catch (restoreError) {}
    _deleteTempSelectionChannel();
  }

  return opened || bounds;
}

function _selectionBoundsKey(bounds) {
  if (!bounds) return "";
  return bounds.xMid + "_" + bounds.yMid + "_" + bounds.width + "_" + bounds.height;
}

function _calculateSelectionDimensions(selection, padding) {
  if (!selection) return { width: 0, height: 0 };
  let width = selection.width * _DEFAULT_SELECTION_SCALE;
  if (padding > 0) {
    width = Math.max(width - padding * 2, _MIN_TEXTBOX_WIDTH);
  }
  return {
    width,
    height: selection.height,
  };
}

function _resizeTextBoxToContent(width, currentBounds) {
  const textParams = _getLayerText();
  const textSize = textParams.layerText.textStyleRange[0].textStyle.size;
  _setTextBoxSize(width, currentBounds.height + textSize + 2);
}

function _positionLayerWithinSelection(selection, bounds) {
  if (!selection || !bounds) return;
  const offsetX = selection.xMid - bounds.xMid;
  const offsetY = selection.yMid - bounds.yMid;
  _moveLayer(offsetX, offsetY);
}

function _createMagicWandSelection(tolerance) {
  try {
    const bounds = _getCurrentTextLayerBounds();
    const x = Math.max(bounds.left - 5, 0);
    const y = Math.max(bounds.yMid, 0);
    play({
      _obj: "set",
      _target: [SELECTION],
      to: { _obj: "paint", horizontal: px(x), vertical: px(y) },
      tolerance: tolerance || 20,
      contiguous: true,
      merged: true,
      antiAlias: true,
    });
  } catch (e) {}
}

function _moveLayer(offsetX, offsetY) {
  play({
    _obj: "move",
    _target: [TARGET_LAYER],
    to: { _obj: "offset", horizontal: px(offsetX), vertical: px(offsetY) },
  });
}

// Stroke of the active layer (or of the layer at layerIndex, so FontScanR
// never changes the active layer). Never throws.
function _getLayerStroke(layerIndex) {
  try {
    const reference = typeof layerIndex === "number" ? { _ref: "layer", _index: layerIndex } : TARGET_LAYER;
    const desc = get([{ _property: "layerEffects" }, reference]);
    const fx = desc.layerEffects;
    if (!fx) return null;

    let fr = fx.frameFX || null;
    if (!fr) {
      // Newer Photoshop versions store duplicated strokes in a list
      const multi = fx.frameFXMulti;
      if (Array.isArray(multi) && multi.length > 0) fr = multi[0];
    }
    if (!fr) return null;

    // Gradient/pattern strokes have no solid color, and grayscale documents
    // store the color as gray instead of RGB
    let color = { r: 0, g: 0, b: 0 };
    try {
      const col = fr.color;
      if (col && "red" in col) {
        color = { r: unitValue(col.red), g: unitValue("grain" in col ? col.grain : col.green), b: unitValue(col.blue) };
      } else if (col && "gray" in col) {
        const grayValue = Math.round(255 * (1 - unitValue(col.gray) / 100));
        color = { r: grayValue, g: grayValue, b: grayValue };
      }
    } catch (colorError) {}

    const enabled = typeof fr.enabled === "boolean" ? fr.enabled : true;
    let position = "other";
    try {
      position = fr.style && fr.style._value === "outsetFrame" ? "outer" : "other";
    } catch (positionError) {}
    let size = 0;
    if (fr.size != null) size = unitValue(fr.size);
    let opacity = 100;
    if (fr.opacity != null) opacity = unitValue(fr.opacity);

    return { enabled, position, size, opacity, color };
  } catch (strokeError) {
    return null;
  }
}

// Apply or update a stroke on the active layer; position is forced to outer
function _setLayerStroke(stroke) {
  if (!stroke || (stroke.size <= 0 && stroke.enabled !== true)) return;
  play({
    _obj: "set",
    _target: [{ _ref: "property", _property: "layerEffects" }, TARGET_LAYER],
    to: {
      _obj: "layerEffects",
      scale: { _unit: "percentUnit", _value: 100 },
      frameFX: {
        _obj: "frameFX",
        enabled: true,
        present: true,
        showInDialog: true,
        style: { _enum: "frameStyle", _value: "outsetFrame" },
        paintType: { _enum: "frameFill", _value: "solidColor" },
        mode: { _enum: "blendMode", _value: "normal" },
        size: px(stroke.size || 3),
        opacity: { _unit: "percentUnit", _value: stroke.opacity || 100 },
        color: { _obj: "RGBColor", red: stroke.color.r, grain: stroke.color.g, blue: stroke.color.b },
      },
    },
  });
}

function _setTextStyleOverride(featureName, key, value) {
  play({
    _obj: "set",
    _target: [{ _ref: "property", _property: "textStyle" }, TARGET_TEXT_LAYER],
    to: { _obj: "textStyle", textOverrideFeatureName: featureName, typeStyleOperationType: 3, [key]: px(value) },
  });
}

function _setDiacXOffset(val) {
  _setTextStyleOverride(808466486, "diacXOffset", val);
}

function _setMarkYOffset(val) {
  _setTextStyleOverride(808466488, "markYDistFromBaseline", val);
}

function _applyMiddleEast(textStyle) {
  if (!textStyle) return;
  if (textStyle.diacXOffset != null) _setDiacXOffset(textStyle.diacXOffset);
  if (textStyle.markYDistFromBaseline != null) _setMarkYOffset(textStyle.markYDistFromBaseline);
}

function _applyTextDirection(direction, textLength) {
  if (!direction) return;
  const psDirection = direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";

  try {
    const currentText = _getLayerText();
    if (
      !currentText ||
      !currentText.layerText ||
      !currentText.layerText.paragraphStyleRange ||
      !currentText.layerText.paragraphStyleRange.length
    ) {
      return;
    }

    const updatedText = _clone(currentText);
    const paragraphRanges = updatedText.layerText.paragraphStyleRange;
    let targetLength = textLength;
    if (targetLength == null && updatedText.layerText && updatedText.layerText.textKey) {
      targetLength = updatedText.layerText.textKey.length;
    }

    for (let i = 0; i < paragraphRanges.length; i++) {
      const range = paragraphRanges[i] || {};
      const paragraphStyle = range.paragraphStyle || {};

      paragraphStyle.directionType = psDirection;
      paragraphStyle.textComposerEngine = "textOptycaComposer";

      range.paragraphStyle = paragraphStyle;
      if (targetLength != null) {
        range.from = typeof range.from === "number" ? range.from : 0;
        range.to = targetLength;
      }
      paragraphRanges[i] = range;
    }

    updatedText.layerText.paragraphStyleRange = paragraphRanges;
    _setLayerText(updatedText);
  } catch (e) {
    // Ignore errors if directionType is not supported on this PS version
  }
}

let fontListCache = null;

// app.fonts, as plain records. The application's fontList property returns
// the same list in one call; reading it through the DOM costs a native round
// trip per property and font (about a minute for a thousand fonts).
function _getFontList() {
  if (fontListCache) return fontListCache;
  const fontList = get([{ _property: "fontList" }, { _ref: "application", _enum: "ordinal", _value: "targetEnum" }]).fontList || {};
  const names = fontList.fontName || [];
  const list = [];
  for (let i = 0; i < names.length; i++) {
    list.push({
      name: names[i],
      postScriptName: fontList.fontPostScriptName[i],
      family: fontList.fontFamilyName[i],
      style: fontList.fontStyleName[i],
    });
  }
  fontListCache = list;
  return list;
}

function _buildRichTextRanges(baseRange, textRuns, textLength) {
  if (!baseRange || !baseRange.textStyle || !textRuns || !textRuns.length) return null;
  const ranges = [];
  let offset = 0;
  for (let i = 0; i < textRuns.length; i++) {
    const run = textRuns[i] || {};
    const runText = run.text || "";
    const runLength = runText.length;
    if (!runLength) continue;
    const textStyle = _clone(baseRange.textStyle);
    resolveTypeRFontVariant(textStyle, run, _getFontList());
    ranges.push({
      from: offset,
      to: offset + runLength,
      textStyle,
    });
    offset += runLength;
  }
  if (offset < textLength) {
    ranges.push({
      from: offset,
      to: textLength,
      textStyle: _clone(baseRange.textStyle),
    });
  }
  return ranges.length ? ranges : null;
}

function _applyRichTextRanges(textParams, textRuns, textLength) {
  if (!textParams || !textParams.layerText || !textRuns || !textRuns.length) return false;
  const baseRange = textParams.layerText.textStyleRange && textParams.layerText.textStyleRange[0];
  const ranges = _buildRichTextRanges(baseRange, textRuns, textLength);
  if (!ranges) return false;
  textParams.layerText.textStyleRange = ranges;
  return true;
}

function _bakeDirection(paragraphRanges, direction) {
  const psDirection = direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
  for (let p = 0; p < paragraphRanges.length; p++) {
    const paragraphRange = paragraphRanges[p] || {};
    const bakedStyle = paragraphRange.paragraphStyle || {};
    bakedStyle.directionType = psDirection;
    bakedStyle.textComposerEngine = "textOptycaComposer";
    paragraphRange.paragraphStyle = bakedStyle;
    paragraphRanges[p] = paragraphRange;
  }
}

function _stripDirection(paragraphRanges) {
  for (let q = 0; q < paragraphRanges.length; q++) {
    const retryStyle = paragraphRanges[q].paragraphStyle || {};
    delete retryStyle.directionType;
    delete retryStyle.textComposerEngine;
  }
}

function _makeTextLayer(textProps) {
  play({ _obj: "make", _target: [{ _ref: "textLayer" }], using: jamText.toLayerTextObject(textProps) });
}

function _createAndSetLayerText(data, width, height) {
  const style = _resolveStyleSizeForDocument(_ensureStyle(data.style));
  if (data.textSizeOverride > 0) {
    _overrideStyleTextSize(style, data.textSizeOverride);
  }
  style.textProps.layerText.textKey = _normalizeTextKey(data.text);
  style.textProps.layerText.textStyleRange[0].to = data.text.length;
  style.textProps.layerText.paragraphStyleRange[0].to = data.text.length;
  _applyRichTextRanges(style.textProps, data.richTextRuns, data.text.length);
  const sizeProp = style.textProps.layerText.textStyleRange[0].textStyle.size;
  if (typeof sizeProp !== "number") {
    try {
      const textParams = _getLayerText();
      _hostState.fallbackTextSize = textParams.layerText.textStyleRange[0].textStyle.size;
    } catch (error) {}
    style.textProps.layerText.textStyleRange[0].textStyle.size = _hostState.fallbackTextSize;
  }
  style.textProps.layerText.textShape = [
    {
      textType: "box",
      orientation: "horizontal",
      bounds: {
        top: 0,
        left: 0,
        right: _convertPixelToPoint(width),
        bottom: _convertPixelToPoint(height),
      },
    },
  ];
  // Direction baked into the make call (see host.js)
  let directionBaked = false;
  if (data.direction && style.textProps.layerText.paragraphStyleRange) {
    _bakeDirection(style.textProps.layerText.paragraphStyleRange, data.direction);
    directionBaked = true;
  }
  try {
    _makeTextLayer(style.textProps);
  } catch (makeError) {
    if (!directionBaked) throw makeError;
    _stripDirection(style.textProps.layerText.paragraphStyleRange);
    _makeTextLayer(style.textProps);
    directionBaked = false;
  }
  _applyMiddleEast(style.textProps.layerText.textStyleRange[0].textStyle);
  if (style.stroke) {
    _setLayerStroke(style.stroke);
  }
  if (data.direction && !directionBaked) {
    _applyTextDirection(data.direction, data.text.length);
  }
}

function _setTextBoxSize(width, height) {
  const box = [
    {
      textType: "box",
      orientation: "horizontal",
      bounds: {
        top: 0,
        left: 0,
        right: _convertPixelToPoint(width),
        bottom: _convertPixelToPoint(height),
      },
    },
  ];
  _setLayerText({ layerText: { textShape: box } });
}

function _checkSelection(options) {
  const selection = _getCurrentSelectionBounds();
  if (selection === undefined) {
    return { error: "noSelection" };
  }

  let adjustAmount = 0;
  let adaptiveOpen = false;
  if (options && options.adjustAmount !== undefined) adjustAmount = options.adjustAmount;
  if (options && options.adaptiveOpen) adaptiveOpen = true;

  let adjustedSelection = selection;
  if (adaptiveOpen) {
    adjustedSelection = _getAdaptiveOpenedSelectionBounds(selection);
  } else if (adjustAmount !== 0) {
    adjustedSelection = _getAdjustedSelectionBounds(selection, adjustAmount);
  }
  if (!adjustedSelection || adjustedSelection.width * adjustedSelection.height < 200) {
    return { error: "smallSelection" };
  }

  return adjustedSelection;
}

function _getTargetLayerIds() {
  const doc = get([{ _property: "targetLayersIDs" }, TARGET_DOCUMENT]);
  if (!Array.isArray(doc.targetLayersIDs)) return null;
  return doc.targetLayersIDs.map((reference) => reference._id);
}

function _forEachSelectedLayer(action) {
  const selectedLayers = _getTargetLayerIds() || [];
  if (selectedLayers.length > 1) {
    for (let j = 0; j < selectedLayers.length; j++) {
      _selectLayerById(selectedLayers[j]);
      action(selectedLayers[j]);
    }
    play({ _obj: "select", _target: selectedLayers.map((id) => ({ _ref: "layer", _id: id })) });
  } else if (selectedLayers.length === 1) {
    action(selectedLayers[0]);
  }
  return selectedLayers.length;
}

/* ========================================================= */
/* =================== full apply methods ================== */
/* ========================================================= */

function _setActiveLayerText(payload) {
  if (!payload) return "";
  if (!hasDocument()) return "doc";
  if (!_layerIsTextLayer()) return "layer";
  const dataText = payload.text;
  const dataStyle = payload.style
    ? _resolveStyleSizeForDocument(_clone(payload.style))
    : payload.style;
  const dataRuns = payload.richTextRuns;
  let targetTextLength = 0;

  // "Paste text to the current layer" is deliberately content-only: only the
  // contents change, never a font, size, paragraph, direction, box or position
  if (payload.contentOnly && (!dataRuns || !dataRuns.length)) {
    _forEachSelectedLayer(() => {
      _setTextContentsOnly(_normalizeTextKey(dataText));
    });
    return "";
  }

  _forEachSelectedLayer(() => {
    let oldBounds = _getCurrentTextLayerBounds();
    const isPoint = _textLayerIsPointText();
    const targetPoint = _resolveStylePointText(dataStyle, isPoint);
    if (isPoint) _changeToBoxText();
    const oldTextParams = _getLayerText();
    if (payload.preserveActiveTextSize && dataStyle && oldTextParams.layerText.textStyleRange &&
        oldTextParams.layerText.textStyleRange[0] && oldTextParams.layerText.textStyleRange[0].textStyle) {
      _overrideStyleTextSize(dataStyle, oldTextParams.layerText.textStyleRange[0].textStyle.size);
    }
    let newTextParams;
    if (dataText && dataStyle) {
      newTextParams = dataStyle.textProps;
      if (newTextParams.layerText.textStyleRange[0].textStyle.size == null &&
          oldTextParams.layerText.textStyleRange &&
          oldTextParams.layerText.textStyleRange[0] &&
          oldTextParams.layerText.textStyleRange[0].textStyle.size != null) {
        newTextParams.layerText.textStyleRange[0].textStyle.size = oldTextParams.layerText.textStyleRange[0].textStyle.size;
      }
      newTextParams.layerText.textKey = _normalizeTextKey(dataText);
      newTextParams.layerText.textStyleRange[0].to = dataText.length;
      newTextParams.layerText.paragraphStyleRange[0].to = dataText.length;
      targetTextLength = dataText.length;
      _applyRichTextRanges(newTextParams, dataRuns, targetTextLength);
    } else if (dataText) {
      newTextParams = {
        layerText: {
          textKey: _normalizeTextKey(dataText),
        },
      };
      if (oldTextParams.layerText.textStyleRange && oldTextParams.layerText.textStyleRange[0]) {
        newTextParams.layerText.textStyleRange = [oldTextParams.layerText.textStyleRange[0]];
        newTextParams.layerText.textStyleRange[0].to = dataText.length;
      }
      if (oldTextParams.layerText.paragraphStyleRange && oldTextParams.layerText.paragraphStyleRange[0]) {
        // Minimal paragraph style without directionType to avoid RTL issues
        const oldParagraphStyle = oldTextParams.layerText.paragraphStyleRange[0].paragraphStyle || {};
        const newParagraphStyle = {};
        for (let i = 0; i < _SAFE_PARAGRAPH_PROPS.length; i++) {
          const prop = _SAFE_PARAGRAPH_PROPS[i];
          if (oldParagraphStyle[prop] !== undefined) newParagraphStyle[prop] = oldParagraphStyle[prop];
        }
        newTextParams.layerText.paragraphStyleRange = [{
          from: 0,
          to: dataText.length,
          paragraphStyle: newParagraphStyle,
        }];
      }
      targetTextLength = dataText.length;
      _applyRichTextRanges(newTextParams, dataRuns, targetTextLength);
    } else if (dataStyle) {
      const text = oldTextParams.layerText.textKey || "";
      newTextParams = dataStyle.textProps;
      newTextParams.layerText.textStyleRange[0].to = text.length;
      newTextParams.layerText.paragraphStyleRange[0].to = text.length;
      targetTextLength = text.length;
    }
    const retainedShape = oldTextParams.layerText.textShape && oldTextParams.layerText.textShape[0];
    if (isPoint && retainedShape && retainedShape.bounds) {
      const oldTextStyle = oldTextParams.layerText.textStyleRange &&
        oldTextParams.layerText.textStyleRange[0] &&
        oldTextParams.layerText.textStyleRange[0].textStyle;
      const styleTextStyle = dataStyle &&
        dataStyle.textProps &&
        dataStyle.textProps.layerText &&
        dataStyle.textProps.layerText.textStyleRange &&
        dataStyle.textProps.layerText.textStyleRange[0] &&
        dataStyle.textProps.layerText.textStyleRange[0].textStyle;
      const oldSize = oldTextStyle && oldTextStyle.size;
      const newSize = styleTextStyle && styleTextStyle.size != null ? styleTextStyle.size : oldSize;
      let widthScale = oldSize && newSize ? newSize / oldSize : 1;
      if (!(widthScale > 0)) widthScale = 1;
      if (widthScale < 1) widthScale = 1;
      const bounds = retainedShape.bounds;
      const currentWidth = bounds.right - bounds.left;
      const currentHeight = bounds.bottom - bounds.top;
      const oldWidthPoints = typeof oldBounds.width === "number" ? _convertPixelToPoint(oldBounds.width) : currentWidth;
      const oldHeightPoints = typeof oldBounds.height === "number" ? _convertPixelToPoint(oldBounds.height) : currentHeight;
      let targetWidth = currentWidth * widthScale;
      let targetHeight = currentHeight * widthScale;
      if (targetWidth < oldWidthPoints * widthScale) targetWidth = oldWidthPoints * widthScale;
      const minWidthPadding = (newSize || oldSize || 12) * 0.5;
      if (targetWidth < oldWidthPoints + minWidthPadding) targetWidth = oldWidthPoints + minWidthPadding;
      const minHeightPadding = (newSize || oldSize || 12) * 0.75;
      if (targetHeight < oldHeightPoints * widthScale) targetHeight = oldHeightPoints * widthScale;
      if (targetHeight < oldHeightPoints + minHeightPadding) targetHeight = oldHeightPoints + minHeightPadding;
      bounds.right = bounds.left + targetWidth;
      bounds.bottom = bounds.top + targetHeight;
    }
    // Applying a style carries its anti-aliasing mode to the layer; legacy
    // styles without one keep the layer's
    const styleAntiAlias = dataStyle && dataStyle.textProps && dataStyle.textProps.layerText &&
      dataStyle.textProps.layerText.antiAlias;
    newTextParams.layerText.antiAlias = styleAntiAlias || oldTextParams.layerText.antiAlias || "antiAliasSmooth";
    if (retainedShape) {
      newTextParams.layerText.textShape = [retainedShape];
    }
    newTextParams.typeUnit = oldTextParams.typeUnit;

    let userDirection = payload.direction;
    if (userDirection === "") userDirection = null;
    let directionBaked = false;
    if (userDirection && newTextParams.layerText.paragraphStyleRange) {
      _bakeDirection(newTextParams.layerText.paragraphStyleRange, userDirection);
      directionBaked = true;
    }

    // Non-point layers are measured in an oversized box set in the same call
    // when the text itself changes (see host.js)
    const boxShapeRef = newTextParams.layerText.textShape && newTextParams.layerText.textShape[0];
    let measureBoxBounds = null;
    if (!isPoint && boxShapeRef && boxShapeRef.bounds && dataText) {
      const measureSpan = _getMeasureBoxSpanPoints();
      measureBoxBounds = {
        top: boxShapeRef.bounds.top || 0,
        left: boxShapeRef.bounds.left || 0,
        right: boxShapeRef.bounds.right,
        bottom: boxShapeRef.bounds.bottom,
      };
      boxShapeRef.bounds.right = measureBoxBounds.left + measureSpan;
      boxShapeRef.bounds.bottom = measureBoxBounds.top + measureSpan;
    }

    try {
      _setLayerText(newTextParams);
    } catch (setError) {
      if (!directionBaked) throw setError;
      _stripDirection(newTextParams.layerText.paragraphStyleRange);
      _setLayerText(newTextParams);
      _applyTextDirection(userDirection, targetTextLength);
    }
    _applyMiddleEast(newTextParams.layerText.textStyleRange[0].textStyle);
    if (dataStyle && dataStyle.stroke) {
      _setLayerStroke(dataStyle.stroke);
    }
    if (targetPoint) {
      _changeToPointText();
    } else {
      let textSize = 12;
      const styleSize = dataStyle && dataStyle.textProps.layerText.textStyleRange[0].textStyle.size;
      if (styleSize != null) {
        textSize = styleSize;
      } else if (oldTextParams.layerText.textStyleRange && oldTextParams.layerText.textStyleRange[0] && oldTextParams.layerText.textStyleRange[0].textStyle.size != null) {
        textSize = oldTextParams.layerText.textStyleRange[0].textStyle.size;
      }
      const boxShape = newTextParams.layerText.textShape && newTextParams.layerText.textShape[0];
      let boxFitted = false;
      if (boxShape && boxShape.bounds && measureBoxBounds) {
        // Shrink the oversized measuring box around the real text extent
        try {
          const textExtent = _getCurrentTextLayerBounds();
          if (textExtent.width > 0 && textExtent.height > 0) {
            const widthPadding = Math.max(2, textSize * 0.4);
            boxShape.bounds.right = measureBoxBounds.left + _convertPixelToPointExact(textExtent.width) + widthPadding;
            boxShape.bounds.bottom = measureBoxBounds.top + _convertPixelToPointExact(textExtent.height) + textSize + 2;
            _setLayerText({ layerText: { textShape: [boxShape] } });
            boxFitted = true;
          }
        } catch (fitError) {}
      }
      if (!boxFitted && boxShape) {
        // Fallback: restore the retained box and only grow its height
        if (measureBoxBounds) {
          boxShape.bounds.right = measureBoxBounds.right;
          boxShape.bounds.bottom = measureBoxBounds.bottom;
          _setLayerText({ layerText: { textShape: newTextParams.layerText.textShape } });
        }
        const fallbackBounds = _getCurrentTextLayerBounds();
        boxShape.bounds.bottom = _convertPixelToPoint(fallbackBounds.height + textSize + 2);
        _setLayerText({ layerText: { textShape: newTextParams.layerText.textShape } });
      }
    }
    const newBounds = _getCurrentTextLayerBounds();
    if (!oldBounds.bottom) oldBounds = newBounds;
    const offsetX = oldBounds.xMid - newBounds.xMid;
    const offsetY = oldBounds.yMid - newBounds.yMid;
    if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
  });

  return "";
}

// textItem.contents = text: the text changes, the first character's style is
// kept for all of it, nothing else is touched
function _setTextContentsOnly(text) {
  const textKey = _getLayerTextKey();
  if (!textKey) return;
  const textStyleRange = Array.isArray(textKey.textStyleRange) && textKey.textStyleRange[0]
    ? [Object.assign({}, textKey.textStyleRange[0], { from: 0, to: text.length })]
    : undefined;
  const paragraphStyleRange = Array.isArray(textKey.paragraphStyleRange) && textKey.paragraphStyleRange[0]
    ? [Object.assign({}, textKey.paragraphStyleRange[0], { from: 0, to: text.length })]
    : undefined;
  const to = { _obj: "textLayer", textKey: text };
  if (textStyleRange) to.textStyleRange = textStyleRange;
  if (paragraphStyleRange) to.paragraphStyleRange = paragraphStyleRange;
  play({ _obj: "set", _target: [TARGET_LAYER], to });
}

// Lean text-only apply for TextShapeR (see host.js): the panel holds a full
// style snapshot, only the line breaking changes
function _setTextShapeRText(payload) {
  if (!payload) return "";
  if (!hasDocument()) return "doc";
  if (!_layerIsTextLayer()) return "layer";
  let convertedToPoint = false;
  try {
    const resolvedStyle = _resolveStyleSizeForDocument(_clone(payload.style));
    const snapshot = resolvedStyle.textProps;
    const dataText = payload.text;
    let oldBounds = _getCurrentTextLayerBounds();
    const isPoint = _textLayerIsPointText();

    const newTextParams = { layerText: { textKey: _normalizeTextKey(dataText) } };
    const baseRange = _clone(snapshot.layerText.textStyleRange[0]);
    baseRange.from = 0;
    baseRange.to = dataText.length;
    newTextParams.layerText.textStyleRange = [baseRange];

    const snapshotParagraph = snapshot.layerText.paragraphStyleRange && snapshot.layerText.paragraphStyleRange[0];
    const oldParagraphStyle = (snapshotParagraph && snapshotParagraph.paragraphStyle) || {};
    const newParagraphStyle = {};
    for (let propIndex = 0; propIndex < _SAFE_PARAGRAPH_PROPS.length; propIndex++) {
      const prop = _SAFE_PARAGRAPH_PROPS[propIndex];
      if (oldParagraphStyle[prop] !== undefined) newParagraphStyle[prop] = oldParagraphStyle[prop];
    }
    newTextParams.layerText.paragraphStyleRange = [{ from: 0, to: dataText.length, paragraphStyle: newParagraphStyle }];

    _applyRichTextRanges(newTextParams, payload.richTextRuns, dataText.length);

    // Carried over verbatim: dropping these made Photoshop reinterpret the
    // size unit and reset the anti-aliasing mode
    newTextParams.layerText.antiAlias = snapshot.layerText.antiAlias || "antiAliasSmooth";
    newTextParams.typeUnit = snapshot.typeUnit;

    let userDirection = payload.direction;
    if (userDirection === "") userDirection = null;
    let directionBaked = false;
    if (userDirection) {
      _bakeDirection(newTextParams.layerText.paragraphStyleRange, userDirection);
      directionBaked = true;
    }

    // Box layers hop through point text for the swap (see host.js)
    if (!isPoint) {
      _changeToPointText();
      convertedToPoint = true;
    }

    try {
      _setLayerText(newTextParams);
    } catch (setError) {
      if (!directionBaked) throw setError;
      _stripDirection(newTextParams.layerText.paragraphStyleRange);
      _setLayerText(newTextParams);
    }

    if (convertedToPoint) {
      _changeToBoxText();
      convertedToPoint = false;
    }

    const newBounds = _getCurrentTextLayerBounds();
    if (!oldBounds.bottom) oldBounds = newBounds;
    const offsetX = oldBounds.xMid - newBounds.xMid;
    const offsetY = oldBounds.yMid - newBounds.yMid;
    if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
    return "";
  } catch (leanError) {
    if (convertedToPoint) {
      try {
        _changeToBoxText();
      } catch (revertError) {}
    }
    // Any surprise falls back to the full apply path within the same state
    return _setActiveLayerText(payload);
  }
}

function _createTextLayerInSelection(state) {
  if (!hasDocument()) return "doc";
  if (state.data.preserveActiveTextSize) {
    if (!_layerIsTextLayer()) return "sizeSource";
    state.data.textSizeOverride = _getTextLayerSize();
  }

  const selection = _checkSelection({ adaptiveOpen: true });
  if (selection.error) return selection.error;
  const dimensions = _calculateSelectionDimensions(selection, state.padding);
  _createAndSetLayerText(state.data, dimensions.width, dimensions.height);
  let bounds = _getCurrentTextLayerBounds();
  if (state.point) {
    _changeToPointText();
  } else {
    _resizeTextBoxToContent(dimensions.width, bounds);
  }
  bounds = _getCurrentTextLayerBounds();
  _positionLayerWithinSelection(selection, bounds);
  return "";
}

function _alignCurrentTextLayerToSelection(state) {
  if (!_layerIsTextLayer()) return "layer";

  let selection = _checkSelection({ adaptiveOpen: true });
  if (selection.error) {
    if (selection.error === "noSelection") {
      _createMagicWandSelection(20);
      selection = _checkSelection({ adaptiveOpen: true });
    }
    if (selection.error) return selection.error;
  }
  const wasPoint = _textLayerIsPointText();
  let bounds = _getCurrentTextLayerBounds();

  if (state.resize && !wasPoint) {
    const dimensions = _calculateSelectionDimensions(selection, state.padding);
    _setTextBoxSize(dimensions.width, dimensions.height);
    const textBounds = _getCurrentTextLayerBounds();
    _resizeTextBoxToContent(dimensions.width, textBounds);
    bounds = _getCurrentTextLayerBounds();
  }

  _deselect();
  _positionLayerWithinSelection(selection, bounds);
  if (wasPoint) {
    _changeToPointText();
  }
  return "";
}

function _alignTextLayerToSelection(state) {
  if (!hasDocument()) return "doc";

  let alignedCount = 0;
  let firstError = "";
  const selectedCount = _forEachSelectedLayer(() => {
    const result = _alignCurrentTextLayerToSelection(state);
    if (result) {
      if (!firstError) firstError = result;
      return;
    }
    alignedCount++;
  });

  if (!selectedCount) {
    firstError = _alignCurrentTextLayerToSelection(state);
    if (!firstError) alignedCount++;
  }

  return alignedCount > 0 ? "" : firstError;
}

function _changeActiveLayerTextSize(value) {
  if (!hasDocument()) return "doc";
  if (!_layerIsTextLayer()) return "layer";
  if (!value) return "";

  let result = "";
  _forEachSelectedLayer(() => {
    try {
      // Fast path: set the size directly through the layer's text style
      const currentTextStyle = get([{ _property: "textStyle" }, TARGET_TEXT_LAYER]);
      if (currentTextStyle.textStyle) {
        const size = currentTextStyle.textStyle.size;
        const currentSize = unitValue(size);
        const sizeUnit = size && size._unit ? size._unit : "pointsUnit";
        play({
          _obj: "set",
          _target: [{ _ref: "property", _property: "textStyle" }, TARGET_TEXT_LAYER],
          to: { _obj: "textStyle", size: { _unit: sizeUnit, _value: currentSize + value } },
        });
      }
    } catch (e) {
      // Older text replacement path when the fast path fails
      const oldTextParams = _getLayerText();
      const text = _normalizeTextKey(oldTextParams.layerText.textKey);
      if (!text) {
        result = "layer";
        return;
      }
      const oldBounds = _getCurrentTextLayerBounds();
      const isPoint = _textLayerIsPointText();
      // Every style range keeps its own font and style: the CEP host kept only
      // the first one, so a size change flattened bold/italic runs
      const ranges = oldTextParams.layerText.textStyleRange && oldTextParams.layerText.textStyleRange.length
        ? oldTextParams.layerText.textStyleRange
        : [];
      const newTextParams = {
        typeUnit: oldTextParams.typeUnit,
        layerText: {
          textKey: text,
          textGridding: oldTextParams.layerText.textGridding || "none",
          orientation: oldTextParams.layerText.orientation || "horizontal",
          antiAlias: oldTextParams.layerText.antiAlias || "antiAliasSmooth",
          textStyleRange: ranges,
        },
      };
      if (oldTextParams.layerText.paragraphStyleRange) {
        const paragraphRanges = oldTextParams.layerText.paragraphStyleRange;
        paragraphRanges.forEach((range) => {
          const paragraphStyle = range.paragraphStyle || (range.paragraphStyle = {});
          paragraphStyle.textEveryLineComposer = paragraphStyle.textEveryLineComposer || false;
          paragraphStyle.burasagari = paragraphStyle.burasagari || "burasagariNone";
        });
        paragraphRanges[paragraphRanges.length - 1].to = text.length;
        newTextParams.layerText.paragraphStyleRange = paragraphRanges;
      }
      const oldSize = ranges[0].textStyle.size;
      const newTextSize = oldSize + value;
      ranges.forEach((range) => {
        const textStyle = range.textStyle;
        textStyle.size = textStyle.size + value;
        if (textStyle.autoLeading || textStyle.leading === undefined) {
          textStyle.autoLeading = true;
          delete textStyle.leading;
        } else {
          textStyle.leading = textStyle.leading + value;
          textStyle.autoLeading = false;
        }
      });

      ranges[ranges.length - 1].to = text.length;
      if (!isPoint) {
        const ratio = newTextSize / oldSize;
        newTextParams.layerText.textShape = [oldTextParams.layerText.textShape[0]];
        const shapeBounds = newTextParams.layerText.textShape[0].bounds;
        shapeBounds.top *= ratio;
        shapeBounds.left *= ratio;
        shapeBounds.bottom *= ratio;
        shapeBounds.right *= ratio;
      }
      _setLayerText(newTextParams);
      _applyMiddleEast(newTextParams.layerText.textStyleRange[0].textStyle);
      const newBounds = _getCurrentTextLayerBounds();
      _moveLayer(oldBounds.xMid - newBounds.xMid, oldBounds.yMid - newBounds.yMid);
    }
  });

  return result;
}

/* ======================================================== */
/* ==================== public methods ==================== */
/* ======================================================== */

// nativeAlert / nativeConfirm are answered by the plugin entry, which owns
// the dialogs (uxp-src/host/main.js)

function getUserFonts() {
  return JSON.stringify({ fonts: _getFontList().map((font) => Object.assign({}, font)) });
}

function invalidateFontList() {
  fontListCache = null;
}

function getActiveLayerText() {
  if (!hasDocument()) return "";
  // ActionManager only: the DOM collapses a multi-layer selection
  const textKey = _getLayerTextKey();
  if (!textKey) return "";
  let layerId = null;
  try {
    layerId = _getActiveLayerId();
  } catch (idError) {}
  // Rendered pixel bounds let the panel calibrate its text measurements
  let bounds = null;
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {}
  let stroke = null;
  try {
    stroke = _getLayerStroke();
  } catch (strokeError) {}
  return JSON.stringify({
    layerId,
    bounds,
    textType: _textKeyIsPointText(textKey) ? "point" : "paragraph",
    textProps: jamText.fromLayerTextObject(textKey),
    stroke,
  });
}

// Converting box text to point text makes Photoshop materialize its
// automatic wraps as hard returns: done on a throwaway duplicate
function _readRenderedTextLines() {
  let originalId = null;
  try {
    originalId = _getActiveLayerId();
  } catch (idError) {}
  let duplicated = false;
  let text = "";
  try {
    _duplicateActiveLayer();
    duplicated = true;
    _changeToPointText();
    const textParams = _getLayerText();
    if (textParams && textParams.layerText && typeof textParams.layerText.textKey === "string") {
      text = textParams.layerText.textKey;
    }
  } catch (readError) {}
  if (duplicated) {
    try {
      _deleteActiveLayer();
    } catch (deleteError) {}
  }
  if (originalId !== null) {
    try {
      _selectLayerById(originalId);
    } catch (selectError) {}
  }
  return text;
}

async function getRenderedTextLines() {
  if (!hasDocument() || !_layerIsTextLayer()) {
    return JSON.stringify({ error: "layer" });
  }
  if (_textLayerIsPointText()) {
    const textParams = _getLayerText();
    const text = textParams && textParams.layerText ? textParams.layerText.textKey : "";
    return JSON.stringify({ text: text || "" });
  }
  // The duplicate never reaches the history: the read is rolled back
  const text = await modal("TypeR", (context) => suspendHistory(context, "TyperTools Read Shape", _readRenderedTextLines, { rollback: true }));
  return JSON.stringify({ text });
}

function _collectTextLayerIds(container, ids, limit) {
  const layers = container.layers || [];
  for (let index = 0; index < layers.length; index++) {
    if (ids.length >= limit) return;
    const layer = layers[index];
    if (layer.kind === ps.constants.LayerKind.GROUP) {
      _collectTextLayerIds(layer, ids, limit);
    } else if (layer.kind === ps.constants.LayerKind.TEXT && layer.visible) {
      ids.push(layer.id);
    }
  }
}

async function _getAllRenderedTextLines(scanBubbles) {
  let originalId = null;
  try {
    originalId = _getActiveLayerId();
  } catch (idError) {}
  // Bubble scans destroy the current selection: never sacrifice one the user
  // drew
  let canScanBubbles = false;
  if (scanBubbles) {
    try {
      canScanBubbles = !_getCurrentSelectionBounds();
    } catch (selectionError) {}
  }
  const ids = [];
  try {
    _collectTextLayerIds(activeDocument(), ids, 80);
  } catch (collectError) {}
  const entries = [];
  for (let index = 0; index < ids.length; index++) {
    try {
      _selectLayerById(ids[index]);
      if (!_layerIsTextLayer()) continue;
      let bubble = null;
      if (canScanBubbles) {
        try {
          const scan = await _scanActiveLayerBubble(20, 17);
          if (scan && !scan.error && scan.bounds && scan.rows && scan.rows.length) {
            bubble = { rows: scan.rows, width: scan.bounds.width, height: scan.bounds.height };
          }
        } catch (bubbleScanError) {}
      }
      let text = "";
      if (_textLayerIsPointText()) {
        const textParams = _getLayerText();
        text = textParams && textParams.layerText ? textParams.layerText.textKey : "";
      } else {
        let duplicated = false;
        try {
          _duplicateActiveLayer();
          duplicated = true;
          _changeToPointText();
          const dupParams = _getLayerText();
          if (dupParams && dupParams.layerText && typeof dupParams.layerText.textKey === "string") {
            text = dupParams.layerText.textKey;
          }
        } catch (readError) {}
        if (duplicated) {
          try {
            _deleteActiveLayer();
          } catch (deleteError) {}
        }
      }
      if (text) entries.push({ text, bubble });
    } catch (layerError) {}
  }
  if (originalId !== null) {
    try {
      _selectLayerById(originalId);
    } catch (selectError) {}
  }
  return entries;
}

async function getAllRenderedTextLines(data) {
  if (!hasDocument()) return JSON.stringify({ error: "document" });
  const scanBubbles = !!(data && data.scanBubbles);
  const entries = await modal("TypeR", (context) =>
    suspendHistory(context, "TyperTools Read Shapes", () => _getAllRenderedTextLines(scanBubbles), { rollback: true }));
  return JSON.stringify({ entries: entries || [] });
}

function _collectTrainingTextLayers(container, entries, parentPath, parentVisible) {
  const layers = container.layers || [];
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    const layerPath = parentPath ? parentPath + " / " + layer.name : layer.name;
    const visible = parentVisible && layer.visible;
    if (layer.kind === ps.constants.LayerKind.GROUP) {
      _collectTrainingTextLayers(layer, entries, layerPath, visible);
    } else if (layer.kind === ps.constants.LayerKind.TEXT) {
      entries.push({ layerId: layer.id, name: layer.name, layerPath, visible });
    }
  }
}

function _readTextShapeRTrainingLayers(doc) {
  const entries = [];
  _collectTrainingTextLayers(doc, entries, "", true);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    entry.text = "";
    try {
      _selectLayerById(entry.layerId);
      if (_textLayerIsPointText()) {
        const params = _getLayerText();
        entry.text = params && params.layerText ? params.layerText.textKey || "" : "";
      } else {
        entry.text = _readRenderedTextLines() || "";
        if (!entry.text) entry.error = "readFailed";
      }
    } catch (readError) {
      entry.error = "readFailed";
    }
  }
  return entries;
}

function _findOpenDocumentByPath(path) {
  const target = normalizeFsPath(path);
  const documents = ps.app.documents;
  for (let index = 0; index < documents.length; index++) {
    try {
      const docPath = documents[index].path;
      if (docPath && normalizeFsPath(docPath) === target) return documents[index];
    } catch (unsavedDocument) {}
  }
  return null;
}

function normalizeFsPath(path) {
  let value = String(path || "").replace(/^file:\/\//, "").replace(/^file:/, "");
  if (/^[A-Za-z]:[\\/]/.test(value) || value.indexOf("\\") !== -1) value = value.replace(/\//g, "\\").toLowerCase();
  return value;
}

async function _fileEntry(path) {
  const fs = uxp.storage.localFileSystem;
  const url = /^file:/.test(path) ? path : "file:" + path;
  return fs.getEntryWithUrl(url);
}

async function _fileExists(path) {
  try {
    const entry = await _fileEntry(path);
    return !!entry && entry.isFile;
  } catch (error) {
    return false;
  }
}

// app.open(file) with dialogs suppressed: missing-font and text-update
// prompts would block the host
async function _openDocument(path) {
  const entry = await _fileEntry(path);
  const token = uxp.storage.localFileSystem.createSessionToken(entry);
  play({ _obj: "open", null: { _path: token, _kind: "local" } });
  return ps.app.activeDocument;
}

async function _closeWithoutSaving(doc) {
  await doc.closeWithoutSaving();
}

// An empty path means the current page, including unsaved edits. A supplied
// path reuses the open document when present, otherwise opens it without
// saving. Training reads run on a disposable document.
async function scanTextShapeRTraining(path) {
  try {
    if (path) {
      if (!/\.psd$/i.test(path)) return JSON.stringify({ error: "badPath" });
      if (!(await _fileExists(path))) return JSON.stringify({ error: "notFound" });
    } else if (!hasDocument()) {
      return JSON.stringify({ error: "document" });
    }
    return await modal("TypeR", async (context) => {
      let previousDoc = null;
      let workDoc = null;
      try { previousDoc = ps.app.activeDocument; } catch (noDocument) {}
      try {
        const source = path ? _findOpenDocumentByPath(path) : previousDoc;
        if (source) {
          ps.app.activeDocument = source;
          workDoc = await source.duplicate("TypeR Training Preview", false);
        } else {
          workDoc = await _openDocument(path);
        }
        ps.app.activeDocument = workDoc;
        const entries = await suspendHistory(context, "TypeR Read Training", () => _readTextShapeRTrainingLayers(workDoc));
        return JSON.stringify({ entries });
      } finally {
        if (workDoc) {
          try { await _closeWithoutSaving(workDoc); } catch (closeError) {}
        }
        if (previousDoc) {
          try { ps.app.activeDocument = previousDoc; } catch (restoreError) {}
        }
      }
    });
  } catch (scanError) {
    return JSON.stringify({ error: "scanFailed" });
  }
}

async function setActiveLayerText(data) {
  return modal("TypeR", (context) => suspendHistory(context, "TyperTools Change", () => _setActiveLayerText(data)));
}

function _setSelectedTextLayers(data) {
  const items = data && data.items ? data.items : [];
  const requestedRestoreIds = data && data.restoreLayerIds ? data.restoreLayerIds : [];
  const restoreIds = [];
  let result = "";

  if (!hasDocument()) return "doc";
  if (items.length < 2) return "layer";

  const restoreSource = requestedRestoreIds.length ? requestedRestoreIds : items;
  for (let restoreIndex = 0; restoreIndex < restoreSource.length; restoreIndex++) {
    const restoreValue = requestedRestoreIds.length ? restoreSource[restoreIndex] : restoreSource[restoreIndex].layerId;
    const restoreId = parseInt(restoreValue, 10);
    if (!isNaN(restoreId)) restoreIds.push(restoreId);
  }

  // Validate every target before changing any layer
  for (let validateIndex = 0; validateIndex < items.length; validateIndex++) {
    const validateId = parseInt(items[validateIndex].layerId, 10);
    if (isNaN(validateId)) {
      result = "layer";
      break;
    }
    try {
      _selectLayerById(validateId);
      if (!_layerIsTextLayer() || _activeLayerAllLocked()) {
        result = "layer";
        break;
      }
    } catch (validateError) {
      result = "scriptError: " + (validateError && validateError.message ? validateError.message : validateError);
      break;
    }
  }

  if (result) {
    if (restoreIds.length) {
      try {
        _selectLayersById(restoreIds);
      } catch (validateRestoreError) {}
    }
    return result;
  }

  for (let i = 0; i < items.length; i++) {
    const layerId = parseInt(items[i].layerId, 10);
    if (isNaN(layerId)) {
      result = "layer";
      break;
    }
    try {
      _selectLayerById(layerId);
      if (!_layerIsTextLayer()) {
        result = "layer";
        break;
      }
      const applyResult = _setActiveLayerText(items[i]);
      if (applyResult) {
        result = applyResult;
        break;
      }
    } catch (applyError) {
      result = "scriptError: " + (applyError && applyError.message ? applyError.message : applyError);
      break;
    }
  }

  if (restoreIds.length) {
    try {
      _selectLayersById(restoreIds);
    } catch (restoreError) {}
  }
  return result;
}

function _activeLayerAllLocked() {
  const locking = get([{ _property: "layerLocking" }, TARGET_LAYER]).layerLocking;
  return !!(locking && locking.protectAll);
}

async function setSelectedTextLayers(data) {
  if (!hasDocument()) return "doc";
  return modal("TypeR", async (context) => {
    // A failed batch is rolled back whole, then the panel's layer selection
    // is restored
    const result = await suspendHistory(context, "TyperTools Multiple Paste", () => _setSelectedTextLayers(data), {
      shouldCommit: (value) => !value,
    });
    if (result) {
      const restoreIds = data && data.restoreLayerIds ? data.restoreLayerIds : [];
      if (restoreIds.length) {
        try {
          _selectLayersById(restoreIds);
        } catch (rollbackRestoreError) {}
      }
    }
    return result;
  });
}

async function setTextShapeRLayerText(data) {
  const valid = data && data.text && data.style && data.style.textProps && data.style.textProps.layerText &&
    data.style.textProps.layerText.textStyleRange && data.style.textProps.layerText.textStyleRange[0];
  if (!valid) return setActiveLayerText(data);
  if (!hasDocument()) return "doc";
  // Same history state name as the classic apply so undoLastTyperChange works
  return modal("TypeR", (context) => suspendHistory(context, "TyperTools Change", () => _setTextShapeRText(data)));
}

async function createTextLayerInSelection(data, point) {
  const state = { data, point, padding: data.padding || 0 };
  return modal("TypeR", (context) => suspendHistory(context, "TyperTools Paste", () => _createTextLayerInSelection(state)));
}

async function alignTextLayerToSelection(data) {
  const state = { resize: !!data.resizeTextBox, padding: data.padding || 0 };
  return modal("TypeR", (context) => suspendHistory(context, "TyperTools Align", () => _alignTextLayerToSelection(state)));
}

async function changeActiveLayerTextSize(val) {
  return modal("TypeR", (context) => suspendHistory(context, "TyperTools Resize", () => _changeActiveLayerTextSize(val)));
}

async function toggleCleaningLayers() {
  if (!hasDocument()) return "doc";
  return modal("TypeR", () => {
    const documentKey = String(_getCurrentDocumentId());
    const hiddenByDocument = _hostState.hiddenCleaningLayerIdsByDocument;
    if (Object.prototype.hasOwnProperty.call(hiddenByDocument, documentKey)) {
      const idsToRestore = hiddenByDocument[documentKey];
      _setLayerVisibilityByIds(idsToRestore, true);
      delete hiddenByDocument[documentKey];
      return "shown:" + idsToRestore.length;
    }
    const idsToHide = _collectVisibleCleaningLayerIds();
    _setLayerVisibilityByIds(idsToHide, false);
    hiddenByDocument[documentKey] = idsToHide;
    return "hidden:" + idsToHide.length;
  });
}

function getCurrentSelection() {
  if (!hasDocument()) return JSON.stringify({ error: "doc" });
  const selection = _checkSelection({ adjustAmount: 0 });
  if (selection.error) return JSON.stringify({ error: selection.error });
  return JSON.stringify(selection);
}

function _buildBoundsShapeRows(bounds, sampleCount) {
  const rows = [];
  for (let i = 0; i < sampleCount; i++) {
    const y = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
    rows.push({ y, left: 0, right: 1, width: 1 });
  }
  return { bounds, rows, fallback: true };
}

function _normalizeShapeSampleCount(value, fallback) {
  let sampleCount = value ? parseInt(value, 10) : fallback;
  if (isNaN(sampleCount)) sampleCount = fallback;
  if (sampleCount < 5) sampleCount = 5;
  if (sampleCount > 31) sampleCount = 31;
  return sampleCount;
}

// The selection mask, read straight from Photoshop: it replaces both the
// work-path conversion and the legacy slice-and-intersect sampler of the CEP
// host, with no temporary channel, path or history state.
async function _readSelectionMask(bounds) {
  const doc = activeDocument();
  const selection = await ps.imaging.getSelection({
    documentID: doc.id,
    sourceBounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
  });
  const imageData = selection.imageData;
  try {
    const data = await imageData.getData();
    return {
      data,
      width: imageData.width,
      height: imageData.height,
      left: selection.sourceBounds.left,
      top: selection.sourceBounds.top,
    };
  } finally {
    imageData.dispose();
  }
}

// Leftmost/rightmost selected pixel edge on one pixel row of the mask
function _maskRowSpan(mask, row) {
  if (row < 0 || row >= mask.height) return null;
  const offset = row * mask.width;
  let left = -1;
  let right = -1;
  for (let x = 0; x < mask.width; x++) {
    if (mask.data[offset + x] >= 128) {
      left = x;
      break;
    }
  }
  if (left < 0) return null;
  for (let x = mask.width - 1; x >= left; x--) {
    if (mask.data[offset + x] >= 128) {
      right = x + 1;
      break;
    }
  }
  return { left: mask.left + left, right: mask.left + right };
}

// Same sampling as host.js _buildPathShapeRows: the widest extent of three
// scanlines per band, normalized against the outline's own bounding box
function _buildMaskShapeRows(mask, bounds, sampleCount) {
  const minY = bounds.top;
  const height = bounds.height;
  const width = bounds.width;
  if (!(width > 0) || !(height > 0)) return null;
  const sliceHeight = height / sampleCount;
  const rows = [];
  let covered = 0;
  for (let r = 0; r < sampleCount; r++) {
    const yRatio = sampleCount <= 1 ? 0.5 : r / (sampleCount - 1);
    const yMid = minY + height * yRatio;
    let left = null;
    let right = null;
    const offsets = [-sliceHeight / 2, 0, sliceHeight / 2];
    for (let k = 0; k < offsets.length; k++) {
      let y = yMid + offsets[k];
      if (y <= minY) y = minY + height * 0.002;
      if (y >= minY + height) y = minY + height - height * 0.002;
      const span = _maskRowSpan(mask, Math.floor(y) - mask.top);
      if (span) {
        if (left === null || span.left < left) left = span.left;
        if (right === null || span.right > right) right = span.right;
      }
    }
    if (left !== null && right > left) {
      covered++;
      rows.push({
        y: yRatio,
        left: Math.max(0, Math.min(1, (left - bounds.left) / width)),
        right: Math.max(0, Math.min(1, (right - bounds.left) / width)),
        width: Math.max(0, Math.min(1, (right - left) / width)),
      });
    } else {
      rows.push({ y: yRatio, left: 0.5, right: 0.5, width: 0 });
    }
  }
  if (!covered) return null;
  return rows;
}

async function _sampleSelectionShape(bounds, sampleCount) {
  try {
    const mask = await _readSelectionMask(bounds);
    const rows = _buildMaskShapeRows(mask, bounds, sampleCount);
    if (rows) return { scan: "mask", bounds, rows, fallback: false };
  } catch (maskError) {}
  return null;
}

// _withTemporaryHistory: the scan runs in a rolled back suspension, so no
// history state, channel or selection change survives it. Starting a new
// operation after an Undo would still discard the redo branch.
async function _withTemporaryHistory(name, fn) {
  return modal("TypeR", async (context) => {
    let busy = false;
    try {
      const doc = activeDocument();
      const states = doc.historyStates;
      if (states.length < 2 || _getActiveHistoryIndex() !== states.length - 1) busy = true;
    } catch (historyError) {
      busy = true;
    }
    if (busy) return { error: "historyBusy" };
    const documentID = activeDocument().id;
    const suspensionID = await context.hostControl.suspendHistory({ documentID, name });
    try {
      return await fn();
    } catch (scanError) {
      return null;
    } finally {
      await context.hostControl.resumeHistory(suspensionID, false);
    }
  });
}

async function getCurrentSelectionShape(data) {
  if (!hasDocument()) return JSON.stringify({ error: "doc" });
  const bounds = _getCurrentSelectionBounds();
  if (!bounds) return JSON.stringify({ error: "noSelection" });
  const sampleCount = _normalizeShapeSampleCount(data && data.samples, 17);
  // Reading the mask changes nothing: no history suspension or guard, but
  // the imaging API only runs inside a modal scope
  let shape = await modal("TypeR", () => _sampleSelectionShape(bounds, sampleCount));
  shape = shape || _buildBoundsShapeRows(bounds, sampleCount);
  return JSON.stringify({ scan: shape.scan || "legacy", bounds: shape.bounds, rows: shape.rows, fallback: shape.fallback });
}

// Core wand scan around the active text layer. Destroys any selection:
// callers run it inside a rolled back suspension.
async function _scanActiveLayerBubble(tolerance, sampleCount) {
  let scanResult = null;
  try {
    const textBounds = _getCurrentTextLayerBounds();
    _createMagicWandSelection(tolerance);
    let bounds = _getCurrentSelectionBounds();
    if (!bounds || bounds.width * bounds.height < 200) {
      _deselect();
      return { error: "noBubble" };
    }
    // A wand escaping the bubble grabs a huge area: reject implausible bubbles
    if (textBounds && textBounds.width > 0 && textBounds.height > 0) {
      const areaRatio = (bounds.width * bounds.height) / (textBounds.width * textBounds.height);
      if (areaRatio > 60) {
        _deselect();
        return { error: "noBubble" };
      }
    }
    // Close the text holes and smooth the outline before sampling
    const smoothAmount = Math.max(4, Math.round(_getTextLayerSize() / 2));
    _modifySelectionBounds(smoothAmount);
    const expanded = _getCurrentSelectionBounds();
    const contractAmount = _clampAdjustAmount(expanded, -smoothAmount);
    if (contractAmount !== 0) _modifySelectionBounds(contractAmount);
    bounds = _getCurrentSelectionBounds() || bounds;
    scanResult = (await _sampleSelectionShape(bounds, sampleCount)) || _buildBoundsShapeRows(bounds, sampleCount);
  } catch (bubbleError) {
    scanResult = null;
  }
  try {
    _deselect();
  } catch (deselectError) {}
  return scanResult;
}

async function getActiveLayerBubbleShape(data) {
  if (!hasDocument()) return JSON.stringify({ error: "doc" });
  if (!_layerIsTextLayer()) return JSON.stringify({ error: "layer" });
  if (_getCurrentSelectionBounds()) return JSON.stringify({ error: "hasSelection" });
  // With several layers targeted the wand origin is ambiguous
  if (_getTargetLayerCount() > 1) return JSON.stringify({ error: "multi" });

  let tolerance = data && data.tolerance ? parseInt(data.tolerance, 10) : 20;
  if (isNaN(tolerance)) tolerance = 20;
  const sampleCount = _normalizeShapeSampleCount(data && data.samples, 21);

  const result = await _withTemporaryHistory("TypeR Bubble Scan", () => _scanActiveLayerBubble(tolerance, sampleCount));
  if (!result) return JSON.stringify({ error: "shape" });
  if (result.error) return JSON.stringify({ error: result.error });
  return JSON.stringify({ scan: result.scan || "legacy", bounds: result.bounds, rows: result.rows, fallback: result.fallback });
}

function getSelectedTextLayers() {
  if (!hasDocument()) return JSON.stringify({ error: "doc" });
  const layers = [];
  const ids = _getTargetLayerIds();
  const references = ids ? ids.map((id) => ({ _ref: "layer", _id: id })) : [TARGET_LAYER];
  for (let j = 0; j < references.length; j++) {
    try {
      // Per-property gets: the full layer descriptor drags the whole text
      // descriptor along for every selected layer
      if (get([{ _property: "layerKind" }, references[j]]).layerKind !== 3) continue;
      layers.push({ id: integerValue(get([{ _property: "layerID" }, references[j]]).layerID) });
    } catch (layerError) {}
  }
  return JSON.stringify({ layers });
}

function getActiveLayerTextIfChanged(data) {
  if (!hasDocument() || !_layerIsTextLayer()) {
    return JSON.stringify({ error: "layer", signature: "" });
  }
  let layerId = null;
  let historyIndex = null;
  try {
    layerId = _getActiveLayerId();
  } catch (layerError) {}
  try {
    historyIndex = _getActiveHistoryIndex();
  } catch (historyError) {}
  const signature = String(layerId) + ":" + String(historyIndex);
  if (layerId !== null && historyIndex !== null && data && data.signature === signature) {
    return JSON.stringify({ unchanged: true, signature });
  }
  let snapshot = null;
  try {
    snapshot = JSON.parse(getActiveLayerText());
  } catch (snapshotError) {}
  if (!snapshot) return JSON.stringify({ error: "layer", signature });
  snapshot.signature = signature;
  return JSON.stringify(snapshot);
}

// Geometry-only acknowledgement for Photoshop 'move' events: no text read
function getActiveTextLayerGeometry() {
  if (!hasDocument()) return JSON.stringify({ error: "layer", signature: "" });
  let layerId = null;
  let historyIndex = null;
  let bounds = null;
  try {
    layerId = _getActiveLayerId();
  } catch (layerError) {}
  try {
    historyIndex = _getActiveHistoryIndex();
  } catch (historyError) {}
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {}
  if (layerId === null || !bounds) return JSON.stringify({ error: "layer", signature: "" });
  return JSON.stringify({ layerId, bounds, signature: String(layerId) + ":" + String(historyIndex) });
}

function getTypeRSelectionSnapshot() {
  let selection = null;
  let selectedLayers = { layers: [] };
  try {
    selection = JSON.parse(getCurrentSelection());
  } catch (selectionError) {}
  try {
    selectedLayers = JSON.parse(getSelectedTextLayers()) || selectedLayers;
  } catch (layersError) {}
  return JSON.stringify({
    selection: selection && !selection.error ? selection : null,
    layers: selectedLayers.layers || [],
  });
}

function getTypeRPanelSnapshot(data) {
  let activeLayer = null;
  let selectionSnapshot = { selection: null, layers: [] };
  try {
    activeLayer = JSON.parse(getActiveLayerTextIfChanged(data || {}));
  } catch (activeLayerError) {}
  try {
    selectionSnapshot = JSON.parse(getTypeRSelectionSnapshot()) || selectionSnapshot;
  } catch (selectionSnapshotError) {}
  return JSON.stringify({
    activeLayer,
    selection: selectionSnapshot.selection,
    layers: selectionSnapshot.layers || [],
  });
}

function _getTargetLayerCount() {
  const ids = _getTargetLayerIds();
  return ids ? ids.length : 1;
}

async function selectLayerById(id) {
  try {
    const layerId = parseInt(id, 10);
    if (isNaN(layerId)) return "error";
    await modal("TypeR", () => {
      play({ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false });
    });
    return "";
  } catch (selectError) {
    return "error";
  }
}

function _resetSelectionMonitor() {
  const monitor = _hostState.selectionMonitor;
  monitor.lastBoundsKey = null;
  monitor.lastBounds = null;
  monitor.multiWarnBounds = null;
}

function startSelectionMonitoring() {
  return "";
}

function stopSelectionMonitoring() {
  _resetSelectionMonitor();
  return "";
}

async function deselectDocumentSelection() {
  try {
    if (!hasDocument()) return "doc";
    try {
      await modal("TypeR", () => _deselect());
    } catch (deselectError) {}
    _resetSelectionMonitor();
    return "";
  } catch (e) {
    return "error";
  }
}

function _getActiveHistoryIndex() {
  const descriptor = get([{ _ref: "historyState", _enum: "ordinal", _value: "targetEnum" }]);
  return integerValue(descriptor.itemIndex) - 1;
}

// Jumps back to just before the most recent "TyperTools Change" history
// state, searched by name (see host.js)
async function undoLastTyperChange() {
  try {
    if (!hasDocument()) return "doc";
    const doc = activeDocument();
    const states = doc.historyStates;
    if (!states.length) return "none";
    let activeIndex;
    try {
      activeIndex = _getActiveHistoryIndex();
    } catch (indexError) {
      activeIndex = states.length - 1;
    }
    if (activeIndex < 0) activeIndex = 0;
    if (activeIndex > states.length - 1) activeIndex = states.length - 1;
    for (let search = activeIndex; search > 0; search--) {
      if (states[search].name === "TyperTools Change") {
        const target = states[search - 1];
        await modal("TypeR", () => {
          doc.activeHistoryState = target;
        });
        return "";
      }
    }
    return "none";
  } catch (e) {
    return "error";
  }
}

function getTypeRDocumentKey() {
  return hasDocument() ? _hostState.documentSession + ":" + String(activeDocument().id) : "";
}

async function getSelectionChanged() {
  const monitor = _hostState.selectionMonitor;
  const documentKey = getTypeRDocumentKey();
  if (monitor.documentKey !== documentKey) {
    monitor.documentKey = documentKey;
    _resetSelectionMonitor();
    return JSON.stringify({ documentChanged: true, documentKey });
  }
  const result = JSON.parse(await _getSelectionChanged());
  result.documentKey = documentKey;
  const selections = result.multiSelection || [];
  for (let i = 0; i < selections.length; i++) selections[i].documentKey = documentKey;
  return JSON.stringify(result);
}

async function _getSelectionChanged() {
  try {
    const monitor = _hostState.selectionMonitor;
    const shiftPressed = keyboard.isShiftDown();

    const rawSelection = hasDocument() ? _getCurrentSelectionBounds() : undefined;
    if (!rawSelection) {
      monitor.multiWarnBounds = null;
      return JSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    const selectionArray = Array.isArray(rawSelection) ? rawSelection : [rawSelection];
    const groups = [];

    for (let i = 0; i < selectionArray.length; i++) {
      if (selectionArray[i].width < 2 && selectionArray[i].height < 2) continue;
      groups.push([selectionArray[i]]);
    }

    let changed = true;
    const margin = 30;
    while (changed) {
      changed = false;
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        for (let compareIndex = groupIndex + 1; compareIndex < groups.length; compareIndex++) {
          let overlap = false;
          for (let a = 0; a < groups[groupIndex].length; a++) {
            for (let b = 0; b < groups[compareIndex].length; b++) {
              const firstBounds = groups[groupIndex][a];
              const secondBounds = groups[compareIndex][b];
              if (!(firstBounds.right + margin < secondBounds.left - margin ||
                firstBounds.left - margin > secondBounds.right + margin ||
                firstBounds.bottom + margin < secondBounds.top - margin ||
                firstBounds.top - margin > secondBounds.bottom + margin)) {
                overlap = true;
                break;
              }
            }
            if (overlap) break;
          }

          if (overlap) {
            groups[groupIndex] = groups[groupIndex].concat(groups[compareIndex]);
            groups.splice(compareIndex, 1);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }

    const merged = [];
    for (let mergedIndex = 0; mergedIndex < groups.length; mergedIndex++) {
      const group = groups[mergedIndex];
      let minLeft = 99999;
      let minTop = 99999;
      let maxRight = -99999;
      let maxBottom = -99999;
      for (let boundIndex = 0; boundIndex < group.length; boundIndex++) {
        if (group[boundIndex].left < minLeft) minLeft = group[boundIndex].left;
        if (group[boundIndex].top < minTop) minTop = group[boundIndex].top;
        if (group[boundIndex].right > maxRight) maxRight = group[boundIndex].right;
        if (group[boundIndex].bottom > maxBottom) maxBottom = group[boundIndex].bottom;
      }

      const width = maxRight - minLeft;
      const height = maxBottom - minTop;
      if (width > 2 && height > 2) {
        merged.push({
          top: minTop,
          left: minLeft,
          right: maxRight,
          bottom: maxBottom,
          width,
          height,
          xMid: (minLeft + maxRight) / 2,
          yMid: (minTop + maxBottom) / 2,
        });
      }
    }

    if (merged.length === 0) {
      return JSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    let isSame = false;
    if (monitor.lastBounds && merged.length === 1) {
      const diffTop = Math.abs(merged[0].top - monitor.lastBounds.top);
      const diffLeft = Math.abs(merged[0].left - monitor.lastBounds.left);
      const diffRight = Math.abs(merged[0].right - monitor.lastBounds.right);
      const diffBottom = Math.abs(merged[0].bottom - monitor.lastBounds.bottom);
      if (diffTop <= 5 && diffLeft <= 5 && diffRight <= 5 && diffBottom <= 5) isSame = true;
    }

    if (isSame && !shiftPressed) {
      return JSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    // The union of a flagged Shift-add stays suppressed until a fresh selection
    if (monitor.multiWarnBounds && merged.length === 1 &&
      Math.abs(merged[0].top - monitor.multiWarnBounds.top) <= 5 &&
      Math.abs(merged[0].left - monitor.multiWarnBounds.left) <= 5 &&
      Math.abs(merged[0].right - monitor.multiWarnBounds.right) <= 5 &&
      Math.abs(merged[0].bottom - monitor.multiWarnBounds.bottom) <= 5) {
      return JSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    // Shift-adding a second outline reports a single union rectangle that
    // still contains the previous bounds: warn instead of capturing it
    if (shiftPressed && !isSame && monitor.lastBounds && merged.length === 1 &&
      merged[0].top <= monitor.lastBounds.top + 5 &&
      merged[0].left <= monitor.lastBounds.left + 5 &&
      merged[0].right >= monitor.lastBounds.right - 5 &&
      merged[0].bottom >= monitor.lastBounds.bottom - 5) {
      monitor.multiWarnBounds = merged[0];
      return JSON.stringify({ multipleSelections: true, shiftKey: shiftPressed });
    }
    monitor.multiWarnBounds = null;

    // Stored multi-bubble selections only keep bounds: clean a newly captured
    // selection while its real outline is still available
    let payloadBounds = merged;
    if (merged.length === 1) {
      const openedBounds = await _withTemporaryHistory("TypeR Selection Capture", () => _getAdaptiveOpenedSelectionBounds(merged[0]));
      payloadBounds = [openedBounds && !openedBounds.error ? openedBounds : merged[0]];
    }

    monitor.lastBounds = merged[0];
    monitor.lastBoundsKey = _selectionBoundsKey(merged[0]);

    const multiResults = [];
    for (let payloadIndex = 0; payloadIndex < payloadBounds.length; payloadIndex++) {
      multiResults.push({
        shiftKey: shiftPressed,
        top: payloadBounds[payloadIndex].top,
        left: payloadBounds[payloadIndex].left,
        right: payloadBounds[payloadIndex].right,
        bottom: payloadBounds[payloadIndex].bottom,
        width: payloadBounds[payloadIndex].width,
        height: payloadBounds[payloadIndex].height,
        xMid: payloadBounds[payloadIndex].xMid,
        yMid: payloadBounds[payloadIndex].yMid,
      });
    }

    return JSON.stringify({
      multiSelection: multiResults,
      shiftKey: shiftPressed,
      top: payloadBounds[0].top,
      left: payloadBounds[0].left,
      right: payloadBounds[0].right,
      bottom: payloadBounds[0].bottom,
      width: payloadBounds[0].width,
      height: payloadBounds[0].height,
      xMid: payloadBounds[0].xMid,
      yMid: payloadBounds[0].yMid,
    });
  } catch (e) {
    return JSON.stringify({ error: true, message: "getSelectionChanged inner error: " + (e && e.message), shiftKey: false });
  }
}

function _createTextLayersInStoredSelections(state) {
  if (!hasDocument()) return "doc";
  let textSizeOverride = null;
  if (state.data.preserveActiveTextSize) {
    if (!_layerIsTextLayer()) return "sizeSource";
    textSizeOverride = _getTextLayerSize();
  }

  const texts = state.data.texts || [];
  const styles = state.data.styles || [];

  if (texts.length === 0 || state.selections.length === 0) return "noSelection";

  const maxCount = Math.min(texts.length, state.selections.length);

  for (let i = 0; i < maxCount; i++) {
    try {
      const text = texts[i] || texts[texts.length - 1] || "";
      const textRuns = state.data.richTextRuns
        ? (state.data.richTextRuns[i] || state.data.richTextRuns[state.data.richTextRuns.length - 1])
        : null;
      const baseStyle = styles[i] || styles[styles.length - 1] || null;
      const style = _ensureStyle(baseStyle);
      const selection = state.selections[i];

      if (!selection || typeof selection.width !== "number" || typeof selection.height !== "number") {
        return "invalidSelection";
      }

      if (!text) continue;

      const dimensions = _calculateSelectionDimensions(selection, state.padding);
      if (!dimensions || isNaN(dimensions.width) || isNaN(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
        return "invalidSelection";
      }

      const data = { text, style, direction: state.data.direction, richTextRuns: textRuns, textSizeOverride };
      _createAndSetLayerText(data, dimensions.width, dimensions.height);

      let bounds = _getCurrentTextLayerBounds();
      const pointModes = state.data.pointModes || [];
      const pointText = pointModes[i] === undefined ? state.point : !!pointModes[i];
      if (pointText) {
        _changeToPointText();
      } else {
        _resizeTextBoxToContent(dimensions.width, bounds);
      }
      bounds = _getCurrentTextLayerBounds();
      _positionLayerWithinSelection(selection, bounds);
    } catch (e) {
      return "scriptError: " + (e && e.message ? e.message : e);
    }
  }

  return "";
}

async function createTextLayersInStoredSelections(data, point) {
  const state = {
    data,
    point,
    padding: data.padding || 0,
    selections: data && data.selections ? data.selections : [],
  };

  if (!hasDocument()) return "doc";
  const documentKey = getTypeRDocumentKey();
  const count = state.selections.length;
  if (!count || !data.texts || data.texts.length !== count) return "noSelection";
  for (let index = 0; index < count; index++) {
    const selection = state.selections[index];
    if (!selection || !selection.documentKey || selection.documentKey !== documentKey) return "wrongDocument";
    if (!data.texts[index]) return "noText";
    const dimensions = _calculateSelectionDimensions(selection, state.padding);
    if (!dimensions || !isFinite(dimensions.width) || !isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) return "invalidSelection";
  }
  try {
    // A failed batch leaves the document exactly as it was
    return await modal("TypeR", (context) => suspendHistory(context, "TyperTools Multiple Paste", () => _createTextLayersInStoredSelections(state), {
      shouldCommit: (value) => !value,
    }));
  } catch (error) {
    return "scriptError: " + (error && error.message ? error.message : error);
  }
}

async function openFile(path, autoClose) {
  try {
    if (!(await _fileExists(path))) throw new Error("File not found");
    const previousId = _hostState.lastOpenedDocId;
    let newDocId = null;
    await modal("TypeR", async () => {
      const newDoc = await _openDocument(path);
      newDocId = newDoc.id;
      if (autoClose && previousId !== null && previousId !== newDoc.id) {
        const documents = ps.app.documents;
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];
          if (doc.id === previousId) {
            try {
              await doc.close(ps.constants.SaveOptions.SAVECHANGES);
            } catch (saveError) {
              ps.app.activeDocument = doc;
              throw saveError;
            }
            break;
          }
        }
      }
      ps.app.activeDocument = newDoc;
    });
    _hostState.lastOpenedDocId = newDocId;
    return JSON.stringify({ ok: true, path, documentKey: getTypeRDocumentKey() });
  } catch (error) {
    return JSON.stringify({ ok: false, path, error: String((error && error.message) || error) });
  }
}

// Font data of every text layer of the active document. Flat iteration over
// layer indexes: no tree walk and no active layer switching.
function _collectDocumentFontData() {
  const results = [];
  let layerCount = 0;
  try {
    layerCount = integerValue(get([{ _property: "numberOfLayers" }, TARGET_DOCUMENT]).numberOfLayers);
  } catch (countError) {
    return results;
  }
  const hasBackground = _documentHasBackgroundLayer();
  // Layer indexes are 0-based when a background layer exists, 1-based otherwise
  const firstIndex = hasBackground ? 0 : 1;
  const lastIndex = hasBackground ? layerCount - 1 : layerCount;

  for (let i = firstIndex; i <= lastIndex; i++) {
    try {
      if (_getLayerPropertyByIndex("layerKind", i) !== 3) continue;
      const textKey = _getLayerPropertyByIndex("textKey", i);
      if (!textKey) continue;
      const textParams = jamText.fromLayerTextObject(textKey);
      if (!textParams || !textParams.layerText) continue;
      const layerText = textParams.layerText;
      const ranges = layerText.textStyleRange || [];
      const runs = [];
      for (let r = 0; r < ranges.length; r++) {
        if (ranges[r] && ranges[r].textStyle) runs.push(ranges[r].textStyle);
      }
      if (!runs.length) continue;
      let paragraphStyle = null;
      if (layerText.paragraphStyleRange && layerText.paragraphStyleRange[0]) {
        paragraphStyle = layerText.paragraphStyleRange[0].paragraphStyle || null;
      }
      let stroke = null;
      try {
        stroke = _getLayerStroke(i);
      } catch (strokeError) {}
      let layerName = "";
      try {
        layerName = _getLayerPropertyByIndex("name", i) || "";
      } catch (nameError) {}
      results.push({
        layerName,
        antiAlias: layerText.antiAlias || "antiAliasSmooth",
        typeUnit: textParams.typeUnit || "pixelsUnit",
        paragraphStyle,
        stroke,
        runs,
      });
    } catch (layerError) {}
  }
  return results;
}

// FontScanR: open a .psd file, extract font/style data from all its text
// layers, then close it (unless it was already open in Photoshop)
async function scanPsdFonts(path) {
  if (!path) return JSON.stringify({ error: "badPath" });
  if (!(await _fileExists(path))) return JSON.stringify({ error: "notFound", file: path });
  try {
    return await modal("TypeR", async () => {
      let doc = _findOpenDocumentByPath(path);
      const wasOpen = !!doc;
      let previousDoc = null;
      try {
        previousDoc = ps.app.activeDocument;
      } catch (noDocError) {}
      try {
        if (doc) {
          ps.app.activeDocument = doc;
        } else {
          doc = await _openDocument(path);
        }
        const layers = _collectDocumentFontData();
        if (!wasOpen) {
          await _closeWithoutSaving(doc);
          doc = null;
          if (previousDoc) {
            try {
              ps.app.activeDocument = previousDoc;
            } catch (restoreError) {}
          }
        } else if (previousDoc && previousDoc.id !== doc.id) {
          try {
            ps.app.activeDocument = previousDoc;
          } catch (restoreError) {}
        }
        return JSON.stringify({ file: path, layers });
      } catch (scanError) {
        if (doc && !wasOpen) {
          try {
            await _closeWithoutSaving(doc);
          } catch (closeError) {}
        }
        return JSON.stringify({ error: "scanFailed", file: path, message: scanError && scanError.message ? scanError.message : String(scanError) });
      }
    });
  } catch (error) {
    return JSON.stringify({ error: "scanFailed", file: path, message: String((error && error.message) || error) });
  }
}

module.exports = {
  // evalScript surface, same names as host.js
  methods: {
    getUserFonts,
    reloadUserFonts: null, // provided by main.js (needs the ExtendScript bridge)
    getActiveLayerText,
    getRenderedTextLines,
    getAllRenderedTextLines,
    scanTextShapeRTraining,
    setActiveLayerText,
    setSelectedTextLayers,
    setTextShapeRLayerText,
    createTextLayerInSelection,
    alignTextLayerToSelection,
    changeActiveLayerTextSize,
    toggleCleaningLayers,
    getCurrentSelection,
    getCurrentSelectionShape,
    getActiveLayerBubbleShape,
    getSelectedTextLayers,
    getActiveLayerTextIfChanged,
    getActiveTextLayerGeometry,
    getTypeRSelectionSnapshot,
    getTypeRPanelSnapshot,
    selectLayerById,
    startSelectionMonitoring,
    stopSelectionMonitoring,
    deselectDocumentSelection,
    undoLastTyperChange,
    getTypeRDocumentKey,
    getSelectionChanged,
    createTextLayersInStoredSelections,
    openFile,
    scanPsdFonts,
  },
  invalidateFontList,
  // internals, for tests
  _internals: { play, get, modal, suspendHistory, jamText, _hostState, _getLayerStroke, _getLayerText, _getCurrentTextLayerBounds, _getCurrentSelectionBounds, _getActiveHistoryIndex },
};
