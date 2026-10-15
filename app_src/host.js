/* globals app, documents, activeDocument, ScriptUI, DialogModes, LayerKind, ActionReference, ActionDescriptor, ActionList, executeAction, executeActionGet, charIDToTypeID, stringIDToTypeID, jamEngine, jamJSON, jamText */

var charID = {
  AdjustmentLayer: 1097099891, // 'AdjL'
  Back: 1113678699, // 'Back'
  Background: 1113811815, // 'Bckg'
  Bottom: 1114926957, // 'Btom'
  By: 1115234336, // 'By  '
  Channel: 1130917484, // 'Chnl'
  Contract: 1131312227, // 'Cntc'
  Delete: 1147958304, // 'Dlt '
  Document: 1147366766, // 'Dcmn'
  Expand: 1165521006, // 'Expn'
  FrameSelect: 1718838636, // 'fsel'
  From: 1181904749, // 'From'
  Hide: 1214521376, // 'Hd  '
  Horizontal: 1215461998, // 'Hrzn'
  Layer: 1283027488, // 'Lyr '
  LayerID: 1283027529, // 'LyrI'
  Left: 1281713780, // 'Left'
  Make: 1298866208, // 'Mk  '
  Move: 1836021349, // 'move'
  None: 1315925605, // 'None'
  Null: 1853189228, // 'null'
  Offset: 1332114292, // 'Ofst'
  Ordinal: 1332896878, // 'Ordn'
  Path: 1348564072, // 'Path'
  PixelUnit: 592476268, // '#Pxl'
  Point: 1349415968, // 'Pnt '
  Property: 1349677170, // 'Prpr'
  Right: 1382508660, // 'Rght'
  Select: 1936483188, // 'slct'
  SelectionClass: 1668506988, // 'csel'
  Set: 1936028772, // 'setd'
  Show: 1399355168, // 'Shw '
  Size: 1400512544, // 'Sz  '
  Target: 1416783732, // 'Trgt'
  Text: 1417180192, // 'Txt '
  TextLayer: 1417170034, // 'TxLr'
  TextShapeType: 1413830740, // 'TEXT'
  TextStyle: 1417180243, // 'TxtS'
  TextStyleRange: 1417180276, // 'Txtt'
  To: 1411391520, // 'T   '
  Tolerance: 1416393326, // 'Tlrn'
  Top: 1416589344, // 'Top '
  Vertical: 1450341475, // 'Vrtc'
  Visible: 1450402412, // 'Vsbl'
  WorkPath: 1467116368, // 'WrkP'
};

var _SAFE_PARAGRAPH_PROPS = [
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

var _DEFAULT_SELECTION_SCALE = 0.9;
var _MIN_TEXTBOX_WIDTH = 10;
var _TEMP_SELECTION_CHANNEL = "__TyperSelectionTemp__";
var _SELECTION_OPEN_RATIO = 0.1;
var _MIN_SELECTION_OPEN_RADIUS = 4;

var _hostState = {
  fallbackTextSize: 20,
  setActiveLayerText: {
    data: null,
    result: "",
  },
  setSelectedTextLayers: {
    data: null,
    result: "",
  },
  setTextShapeRText: {
    data: null,
    result: "",
  },
  getRenderedTextLines: {
    result: "",
  },
  getAllRenderedTextLines: {
    result: "",
    scanBubbles: false,
  },
  createTextLayerInSelection: {
    data: null,
    result: "",
    point: false,
    padding: 0,
  },
  alignTextLayerToSelection: {
    result: "",
    resize: false,
    padding: 0,
  },
  alignTextLayersToDoubleBubble: {
    result: "",
    resize: false,
    padding: 0,
    entries: null,
  },
  changeActiveLayerTextSize: {
    value: 0,
    result: "",
  },
  selectionMonitor: {
    lastBoundsKey: null,
    lastBounds: null,
    multiWarnBounds: null,
    callback: null,
  },
  createTextLayersInStoredSelections: {
    data: null,
    result: "",
    point: false,
    padding: 0,
    selections: [],
  },
  hiddenCleaningLayerIdsByDocument: {},
  documentSession: String(new Date().getTime()) + ":" + String(Math.random()),
  lastOpenedDocId: null,
  suspendedRun: null,
  pathScanFails: 0,
  pathScanBackoffAt: 0,
};

// How long the fast path-based shape scan stays disabled after 3 failures
var _PATH_SCAN_RETRY_MS = 3 * 60 * 1000;

// Bubble detection and outline sampling fire dozens of selection, channel
// and modify operations, and Photoshop records every one of them as a
// history state: on a full-resolution page each state holds a snapshot, so
// repeated detections wipe the user's undo stack and keep the scratch file
// churning until the whole session crawls. suspendHistory collapses each
// scan into a single history state.
function _withSuspendedHistory(name, fn) {
  var result = null;
  _hostState.suspendedRun = function () {
    try {
      result = fn();
    } catch (runError) {
      result = null;
    }
  };
  try {
    app.activeDocument.suspendHistory(name, "_hostState.suspendedRun()");
  } catch (suspendError) {
    _hostState.suspendedRun();
  }
  _hostState.suspendedRun = null;
  return result;
}

// Shape detection reads pixels through temporary channels, paths and selections.
// Grouping those operations still retains a full scan in Photoshop history.
// Roll back and delete only that new state, never the user's undo/redo states.
function _withTemporaryHistory(name, fn) {
  var doc = app.activeDocument;
  var scanName = name;
  var historyLimit = null;
  var reservedHistorySlot = false;
  try {
    var count = doc.historyStates.length;
    // Starting a new operation after Undo would discard the redo branch.
    if (_hostState.temporaryHistoryFailed || count < 2 ||
        _getActiveHistoryIndex() !== count - 1) {
      return { error: "historyBusy" };
    }
    // A no-op or failed suspension must never match an existing user state.
    if (doc.historyStates[count - 1].name === scanName) scanName += " (temporary)";
    // Reserve room only when needed, then restore the preference in finally.
    // Otherwise the scan itself could evict a real undo state at capacity.
    historyLimit = app.preferences.numberOfHistoryStates;
    if (!(historyLimit > 0)) return { error: "historyBusy" };
    if (count >= historyLimit) {
      reservedHistorySlot = true;
      app.preferences.numberOfHistoryStates = count + 1;
      if (app.preferences.numberOfHistoryStates <= count) throw new Error("historyCapacity");
    }
  } catch (historyError) {
    if (reservedHistorySlot) {
      try { app.preferences.numberOfHistoryStates = historyLimit; } catch (limitError) {}
    }
    return { error: "historyBusy" };
  }

  var result = null;
  var previousRun = _hostState.suspendedRun;
  _hostState.suspendedRun = function () {
    try {
      result = fn();
    } catch (scanError) {
      result = null;
    }
  };
  try {
    // Never retry unsuspended: one failed scan could otherwise leave dozens
    // of history entries and evict the user's work before cleanup runs.
    doc.suspendHistory(scanName, "_hostState.suspendedRun()");
  } catch (suspendError) {
    result = null;
  } finally {
    _hostState.suspendedRun = previousRun;
    try {
      var scanIndex = doc.historyStates.length - 1;
      if (scanIndex > 0 && doc.historyStates[scanIndex].name === scanName) {
        doc.activeHistoryState = doc.historyStates[scanIndex - 1];
        var reference = new ActionReference();
        reference.putIndex(stringIDToTypeID("historyState"), scanIndex + 1);
        var descriptor = new ActionDescriptor();
        descriptor.putReference(charID.Null, reference);
        executeAction(charID.Delete, descriptor, DialogModes.NO);
      }
    } catch (restoreError) {
      // A host that cannot clean up must not accumulate more scan states.
      _hostState.temporaryHistoryFailed = true;
      result = { error: "historyBusy" };
    } finally {
      if (reservedHistorySlot) {
        try {
          app.preferences.numberOfHistoryStates = historyLimit;
        } catch (limitError) {
          _hostState.temporaryHistoryFailed = true;
          result = { error: "historyBusy" };
        }
      }
    }
  }
  return result;
}

function _clone(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (obj instanceof Array) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) {
      arr[i] = _clone(obj[i]);
    }
    return arr;
  }
  var result = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = _clone(obj[key]);
    }
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
            color: { red: 0, green: 0, blue: 0 }
          }
        }
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
            hyphenate: true
          }
        }
      ]
    },
    typeUnit: "pixelsUnit"
  };
}

function _getHostDefaultStroke() {
  return {
    enabled: false,
    size: 0,
    opacity: 100,
    position: "outer",
    color: { r: 255, g: 255, b: 255 }
  };
}

function _ensureStyle(style) {
  var normalized = style ? _clone(style) : {};
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
  var ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges.length) return style;
  for (var i = 0; i < ranges.length; i++) {
    if (!ranges[i] || !ranges[i].textStyle) continue;
    ranges[i].textStyle.size = size;
    if (ranges[i].textStyle.impliedFontSize != null) {
      ranges[i].textStyle.impliedFontSize = size;
    }
  }
  return style;
}

function _resolveStyleSizeForDocument(style) {
  if (!style || style.autoSizeByPageWidth !== true || !documents.length) return style;
  var presets = style.sizePresets;
  if (!presets || presets.length < 2) return style;

  var pageWidth;
  try {
    pageWidth = activeDocument.width && activeDocument.width.as
      ? activeDocument.width.as("px")
      : parseFloat(activeDocument.width);
  } catch (widthError) {
    return style;
  }
  if (isNaN(pageWidth) || pageWidth <= 0) return style;

  var defaultIndex = parseInt(style.sizePresetDefaultIndex, 10);
  if (isNaN(defaultIndex) || defaultIndex < 0 || defaultIndex >= presets.length) defaultIndex = 0;
  var selectedSize = parseFloat(presets[defaultIndex]);
  var selectedThreshold = -1;
  var minWidths = style.sizePresetMinWidths || [];
  for (var i = 0; i < presets.length; i++) {
    if (i === defaultIndex) continue;
    var threshold = parseFloat(minWidths[i]);
    var presetSize = parseFloat(presets[i]);
    if (!isNaN(threshold) && threshold > 0 && !isNaN(presetSize) && presetSize > 0 &&
        pageWidth >= threshold && threshold > selectedThreshold) {
      selectedThreshold = threshold;
      selectedSize = presetSize;
    }
  }
  if (isNaN(selectedSize) || selectedSize <= 0) return style;

  var ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges[0] || !ranges[0].textStyle) return style;
  ranges[0].textStyle.size = selectedSize;
  if (ranges[0].textStyle.impliedFontSize != null) {
    ranges[0].textStyle.impliedFontSize = selectedSize;
  }
  return style;
}

function _changeToPointText() {
  try {
    if (app.activeDocument && app.activeDocument.activeLayer && app.activeDocument.activeLayer.textItem) {
      app.activeDocument.activeLayer.textItem.kind = TextType.POINTTEXT;
      return;
    }
  } catch (e) {}
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextShapeType);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.TextShapeType, charID.Point);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _changeToBoxText() {
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextShapeType);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.TextShapeType, stringIDToTypeID("box"));
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _layerIsTextLayer() {
  var layer = _getCurrent(charID.Layer, charID.Text);
  return layer.hasKey(charID.Text);
}

function _getActiveLayerId() {
  var layerIdProp = stringIDToTypeID("layerID");
  var reference = new ActionReference();
  reference.putProperty(charID.Property, layerIdProp);
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
  return executeActionGet(reference).getInteger(layerIdProp);
}

function _duplicateActiveLayer() {
  var reference = new ActionReference();
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  executeAction(stringIDToTypeID("duplicate"), descriptor, DialogModes.NO);
}

function _deleteActiveLayer() {
  var reference = new ActionReference();
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  executeAction(charID.Delete, descriptor, DialogModes.NO);
}

function _selectLayerById(layerId) {
  var reference = new ActionReference();
  reference.putIdentifier(charID.Layer, layerId);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  executeAction(charID.Select, descriptor, DialogModes.NO);
}

function _selectLayersById(layerIds) {
  if (!layerIds || !layerIds.length) return;
  for (var i = 0; i < layerIds.length; i++) {
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, layerIds[i]);
    var descriptor = new ActionDescriptor();
    descriptor.putReference(charID.Null, reference);
    descriptor.putBoolean(stringIDToTypeID("makeVisible"), false);
    if (i > 0) {
      descriptor.putEnumerated(
        stringIDToTypeID("selectionModifier"),
        stringIDToTypeID("selectionModifierType"),
        stringIDToTypeID("addToSelection")
      );
    }
    executeAction(charID.Select, descriptor, DialogModes.NO);
  }
}

function _textLayerIsPointText() {
  var textKey = _getCurrent(charID.Layer, charID.Text).getObjectValue(charID.Text);
  var textType = textKey.getList(stringIDToTypeID("textShape")).getObjectValue(0).getEnumerationValue(charID.TextShapeType);
  return textType === charID.Point;
}

function _resolveStylePointText(style, fallbackPointText) {
  if (style && style.textType === "point") return true;
  if (style && style.textType === "paragraph") return false;
  return !!fallbackPointText;
}

function _getTextLayerSize() {
  try {
    var textParams = jamText.getLayerText();
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

function _convertPixelToPoint(value) {
  return (parseInt(value) / activeDocument.resolution) * 72;
}

function _convertPixelToPointExact(value) {
  return (value / activeDocument.resolution) * 72;
}

// Span (in points) for the temporary measuring box used while re-flowing
// box text. The type engine's cost scales with the box's PIXEL size, and an
// oversized box makes Photoshop pop its "Processing text" progress dialog
// on every relayout — so derive the span from the document size and cap it
// in pixels instead of using a huge fixed point value.
function _getMeasureBoxSpanPoints() {
  var spanPx = 20000;
  try {
    var oldUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    var docSpanPx = 2 * Math.max(parseFloat(activeDocument.width), parseFloat(activeDocument.height));
    app.preferences.rulerUnits = oldUnits;
    if (docSpanPx > 0 && docSpanPx < spanPx) spanPx = docSpanPx;
  } catch (spanError) {}
  return _convertPixelToPointExact(spanPx);
}

function _createCurrent(target, id) {
  var reference = new ActionReference();
  if (id > 0) reference.putProperty(charID.Property, id);
  reference.putEnumerated(target, charID.Ordinal, charID.Target);
  return reference;
}

function _getCurrent(target, id) {
  return executeActionGet(_createCurrent(target, id));
}

function _getCurrentDocumentId() {
  var documentId = stringIDToTypeID("documentID");
  return _getCurrent(charID.Document, documentId).getInteger(documentId);
}

function _documentHasBackgroundLayer() {
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.Background);
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
  return executeActionGet(reference).getBoolean(charID.Background);
}

function _getLayerByIndex(index) {
  var reference = new ActionReference();
  reference.putIndex(charID.Layer, index);
  return executeActionGet(reference);
}

function _layerExistsById(id) {
  try {
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, id);
    executeActionGet(reference);
    return true;
  } catch (e) {
    return false;
  }
}

function _setLayerVisibilityByIds(ids, visible) {
  if (!ids || !ids.length) return 0;
  var references = new ActionList();
  var added = 0;
  for (var i = 0; i < ids.length; i++) {
    // A cleaning layer may have been deleted while hidden. Typesetterer
    // silently skipped those stale IDs when restoring them.
    if (visible && !_layerExistsById(ids[i])) continue;
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, ids[i]);
    references.putReference(reference);
    added++;
  }
  if (!added) return 0;
  var descriptor = new ActionDescriptor();
  descriptor.putList(charID.Null, references);
  executeAction(visible ? charID.Show : charID.Hide, descriptor, DialogModes.NO);
  return added;
}

function _collectVisibleCleaningLayerIds() {
  var numberOfLayers = stringIDToTypeID("numberOfLayers");
  var layerSection = stringIDToTypeID("layerSection");
  var layerSectionStart = stringIDToTypeID("layerSectionStart");
  var layerSectionEnd = stringIDToTypeID("layerSectionEnd");
  var index = _getCurrent(charID.Document, numberOfLayers).getInteger(numberOfLayers);
  // Preserve the real background, or the bottom-most layer when the document
  // has no formal background layer, exactly as Typesetterer did.
  var stopIndex = _documentHasBackgroundLayer() ? 0 : 1;
  var parentVisibility = [];
  var ids = [];

  while (index > stopIndex) {
    var layer = _getLayerByIndex(index);
    var section = layer.getEnumerationValue(layerSection);
    if (section === layerSectionStart) {
      parentVisibility.push(layer.getBoolean(charID.Visible));
    } else if (section === layerSectionEnd) {
      parentVisibility.pop();
    } else {
      var parentsVisible = true;
      for (var i = 0; i < parentVisibility.length; i++) {
        parentsVisible = parentsVisible && parentVisibility[i];
      }
      if (
        parentsVisible &&
        !layer.hasKey(charID.Text) &&
        !layer.getBoolean(charID.Background) &&
        layer.getBoolean(charID.Visible) &&
        !layer.hasKey(charID.AdjustmentLayer)
      ) {
        ids.push(layer.getInteger(charID.LayerID));
      }
    }
    index--;
  }
  return ids;
}

function toggleCleaningLayers() {
  if (!documents.length) return "doc";
  var documentKey = String(_getCurrentDocumentId());
  var hiddenByDocument = _hostState.hiddenCleaningLayerIdsByDocument;
  if (hiddenByDocument.hasOwnProperty(documentKey)) {
    var idsToRestore = hiddenByDocument[documentKey];
    _setLayerVisibilityByIds(idsToRestore, true);
    delete hiddenByDocument[documentKey];
    return "shown:" + idsToRestore.length;
  }
  var idsToHide = _collectVisibleCleaningLayerIds();
  _setLayerVisibilityByIds(idsToHide, false);
  hiddenByDocument[documentKey] = idsToHide;
  return "hidden:" + idsToHide.length;
}

function _deselect() {
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.Ordinal, charID.None);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _getBoundsFromDescriptor(bounds) {
  var top = bounds.getInteger(charID.Top);
  var left = bounds.getInteger(charID.Left);
  var right = bounds.getInteger(charID.Right);
  var bottom = bounds.getInteger(charID.Bottom);
  return {
    top: top,
    left: left,
    right: right,
    bottom: bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
}

function _getCurrentSelectionBounds() {
  var doc = _getCurrent(charID.Document, charID.FrameSelect);
  if (doc.hasKey(charID.FrameSelect)) {
    var bounds = doc.getObjectValue(charID.FrameSelect);
    return _getBoundsFromDescriptor(bounds);
  }
}

function _getCurrentTextLayerBounds() {
  var boundsTypeId = stringIDToTypeID("bounds");
  var bounds = _getCurrent(charID.Layer, boundsTypeId).getObjectValue(boundsTypeId);
  return _getBoundsFromDescriptor(bounds);
}

function _modifySelectionBounds(amount) {
  if (amount == 0) return;
  var size = new ActionDescriptor();
  size.putUnitDouble(charID.By, charID.PixelUnit, Math.abs(amount));
  executeAction(amount > 0 ? charID.Expand : charID.Contract, size, DialogModes.NO);
}


function _getAdjustedSelectionBounds(bounds, amount) {
  if (!bounds || amount === 0) return bounds;

  var doc;
  try {
    doc = app.activeDocument;
  } catch (error) {
    doc = null;
  }

  if (!doc || !doc.selection) {
    return _getAdjustedSelectionBoundsFallback(bounds, amount);
  }

  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) {
    return _getAdjustedSelectionBoundsFallback(bounds, amount);
  }

  var adjusted = null;
  try {
    _modifySelectionBounds(amount);
    adjusted = _getCurrentSelectionBounds();
  } catch (error2) {
    adjusted = null;
  } finally {
    try {
      doc.selection.load(tempChannel);
    } catch (restoreError) {}
    try {
      tempChannel.remove();
    } catch (removeError) {}
  }

  if (!adjusted) {
    return _getAdjustedSelectionBoundsFallback(bounds, amount);
  }
  return adjusted;
}

function _createTempSelectionChannel(doc) {
  var channel = null;
  try {
    channel = doc.channels.getByName(_TEMP_SELECTION_CHANNEL);
    channel.remove();
  } catch (e) {}

  try {
    channel = doc.channels.add();
    channel.name = _TEMP_SELECTION_CHANNEL;
    doc.selection.store(channel);
    return channel;
  } catch (error) {
    if (channel) {
      try {
        channel.remove();
      } catch (removeError) {}
    }
    return null;
  }
}

function _getAdjustedSelectionBoundsFallback(bounds, amount) {
  if (!bounds || amount === 0) return bounds;
  var delta = Math.abs(amount);
  if (amount < 0) {
    if (bounds.width <= delta * 2 || bounds.height <= delta * 2) {
      return null;
    }
    var contracted = {
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
  } else {
    var expanded = {
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
}

function _clampAdjustAmount(bounds, amount) {
  if (!bounds || amount >= 0) return amount;
  // Avoid over-contracting small selections: keep at least 2px margin per side
  var maxContract = Math.floor(Math.min(bounds.width, bounds.height) / 2 - 1);
  if (maxContract <= 0) return 0;
  return -Math.min(Math.abs(amount), maxContract);
}

function _getAdaptiveSelectionOpenRadius(bounds) {
  if (!bounds) return 0;
  var shortestSide = Math.min(bounds.width, bounds.height);
  var maxRadius = Math.floor(shortestSide / 2 - 1);
  if (maxRadius <= 0) return 0;
  var radius = Math.max(_MIN_SELECTION_OPEN_RADIUS, Math.round(shortestSide * _SELECTION_OPEN_RATIO));
  return Math.min(radius, maxRadius);
}

function _getAdaptiveOpenedSelectionBounds(bounds) {
  if (!bounds) return bounds;

  var radius = _getAdaptiveSelectionOpenRadius(bounds);
  if (radius <= 0) return bounds;

  var doc;
  try {
    doc = app.activeDocument;
  } catch (error) {
    doc = null;
  }

  if (!doc || !doc.selection) {
    return bounds;
  }

  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) {
    return bounds;
  }

  var opened = null;
  var attemptRadius = radius;
  try {
    while (attemptRadius >= 1 && !opened) {
      if (attemptRadius !== radius) {
        try {
          doc.selection.load(tempChannel);
        } catch (retryRestoreError) {
          break;
        }
      }

      var candidate = null;
      try {
        _modifySelectionBounds(-attemptRadius);
        var contracted = _getCurrentSelectionBounds();
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
      doc.selection.load(tempChannel);
    } catch (restoreError) {}
    try {
      tempChannel.remove();
    } catch (removeError) {}
  }

  return opened || bounds;
}

function _selectionBoundsKey(bounds) {
  if (!bounds) return "";
  return bounds.xMid + "_" + bounds.yMid + "_" + bounds.width + "_" + bounds.height;
}

function _calculateSelectionDimensions(selection, padding) {
  if (!selection) return { width: 0, height: 0 };
  var width = selection.width * _DEFAULT_SELECTION_SCALE;
  if (padding > 0) {
    width = Math.max(width - padding * 2, _MIN_TEXTBOX_WIDTH);
  }
  return {
    width: width,
    height: selection.height,
  };
}

function _resizeTextBoxToContent(width, currentBounds) {
  var textParams = jamText.getLayerText();
  var textSize = textParams.layerText.textStyleRange[0].textStyle.size;
  _setTextBoxSize(width, currentBounds.height + textSize + 2);
}

function _positionLayerWithinSelection(selection, bounds) {
  if (!selection || !bounds) return;
  var offsetX = selection.xMid - bounds.xMid;
  var offsetY = selection.yMid - bounds.yMid;
  _moveLayer(offsetX, offsetY);
}

function _createMagicWandSelection(tolerance) {
  try {
    var bounds = _getCurrentTextLayerBounds();
    var x = Math.max(bounds.left - 5, 0);
    var y = Math.max(bounds.yMid, 0);
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putProperty(charID.Channel, charID.FrameSelect);
    desc.putReference(charID.Null, ref);

    var pos = new ActionDescriptor();
    pos.putUnitDouble(charID.Horizontal, charID.PixelUnit, x);
    pos.putUnitDouble(charID.Vertical, charID.PixelUnit, y);
  desc.putObject(charID.To, stringIDToTypeID("paint"), pos);

  desc.putInteger(stringIDToTypeID("tolerance"), tolerance || 20);
  desc.putBoolean(stringIDToTypeID("contiguous"), true);
  desc.putBoolean(stringIDToTypeID("merged"), true);
  desc.putBoolean(stringIDToTypeID("antiAlias"), true);
  executeAction(charID.Set, desc, DialogModes.NO);
  } catch (e) {}
}

function _moveLayer(offsetX, offsetY) {
  var amount = new ActionDescriptor();
  amount.putUnitDouble(charID.Horizontal, charID.PixelUnit, offsetX);
  amount.putUnitDouble(charID.Vertical, charID.PixelUnit, offsetY);
  var target = new ActionDescriptor();
  target.putReference(charID.Null, _createCurrent(charID.Layer));
  target.putObject(charID.To, charID.Offset, amount);
  executeAction(charID.Move, target, DialogModes.NO);
}

/* ========================================================= */
/* ===== bubble detection: auto-centre and double bubble ==== */
/* ========================================================= */
// Auto-centre after a paste (off / single / multi) and "centre double
// bubble". uxp-src/host/photoshop.js mirrors this section function for
// function; scripts/testUxpHost.js compares the pure helpers.
// Every wand probe replaces the live selection: the callers park the user's
// selection in a channel first (_saveSelectionState) and put it back after.
// The optional double-bubble wand mode may override
// _getAdaptiveOpenedSelectionBounds and answer {error}: _openedBubble checks
// every answer and falls back on the probed bubble itself.

var _AUTO_CENTER_MODES = { single: true, multi: true };
var _BUBBLE_WAND_TOLERANCE = 20;
var _MAX_BUBBLE_RATIO = 40;
var _MIN_BUBBLE_AREA = 200;
// A probe that lands on a glyph straddling the text centre selects that
// glyph: a bubble covers at least half the area of its text
var _MIN_BUBBLE_TEXT_COVER = 0.5;
var _MIN_DISPLAYED_TEXT_SIZE = 1;
var _SAVED_SELECTION_CHANNEL = "__TyperSavedSelection__";

/* ----------------------- pure helpers ----------------------- */

function _rectFrom(left, top, right, bottom) {
  left = Number(left);
  top = Number(top);
  right = Number(right);
  bottom = Number(bottom);
  if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) return null;
  if (right <= left || bottom <= top) return null;
  return {
    top: top,
    left: left,
    right: right,
    bottom: bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
}

function _unionRect(rects) {
  if (!rects || !rects.length) return null;
  var left = rects[0].left, top = rects[0].top, right = rects[0].right, bottom = rects[0].bottom;
  for (var i = 1; i < rects.length; i++) {
    if (rects[i].left < left) left = rects[i].left;
    if (rects[i].top < top) top = rects[i].top;
    if (rects[i].right > right) right = rects[i].right;
    if (rects[i].bottom > bottom) bottom = rects[i].bottom;
  }
  return _rectFrom(left, top, right, bottom);
}

function _sameRect(a, b) {
  return !!(a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);
}

// A bubble is neither a speck nor most of the page
function _usableBubble(rect, docSize) {
  if (!rect) return null;
  var area = rect.width * rect.height;
  if (docSize && docSize.width && docSize.height && area > docSize.width * docSize.height * 0.45) return null;
  if (area < _MIN_BUBBLE_AREA) return null;
  return rect;
}

function _containsPoint(rect, x, y, tolerance) {
  var t = tolerance || 0;
  return x >= rect.left - t && x <= rect.right + t && y >= rect.top - t && y <= rect.bottom + t;
}

function _containsBox(rect, box, tolerance) {
  var t = tolerance === undefined ? 2 : tolerance;
  return box.left >= rect.left - t && box.right <= rect.right + t && box.top >= rect.top - t && box.bottom <= rect.bottom + t;
}

// A wand probe can leak into a neighbouring bubble, a merged double bubble or
// the page background: a candidate is the bubble of a text only when it holds
// the text centre, is not absurdly larger than the text and holds no centre
// that must stay out (the other half of a double bubble).
function _bubbleCandidateValid(rect, box, docSize, exclude, sizePixels) {
  if (!_usableBubble(rect, docSize) || !box) return false;
  if (!_containsPoint(rect, box.xMid, box.yMid, 1)) return false;
  if (rect.width * rect.height < box.width * box.height * _MIN_BUBBLE_TEXT_COVER) return false;
  var pad = 4 * (sizePixels > 0 ? sizePixels : 20);
  var reference = (box.width + pad) * (box.height + pad);
  if (rect.width * rect.height > reference * _MAX_BUBBLE_RATIO) return false;
  var others = exclude || [];
  for (var i = 0; i < others.length; i++) {
    if (_containsPoint(rect, others[i].xMid, others[i].yMid)) return false;
  }
  return true;
}

// Left, right, above, below the text, then its centre
function _probePoints(box, margin) {
  return [
    [box.left - margin, box.yMid],
    [box.right + margin, box.yMid],
    [box.xMid, box.top - margin],
    [box.xMid, box.bottom + margin],
    [box.xMid, box.yMid],
  ];
}

function _probeMargin(size) {
  var value = Number(size);
  if (!isFinite(value) || !value) value = 20;
  return Math.max(5, Math.min(40, Math.round(value * 0.25)));
}

// A candidate holding the whole text wins at once; otherwise the smallest
function _pickBubble(current, candidate, box) {
  if (current && current.whole) return current;
  if (_containsBox(candidate, box)) {
    candidate.whole = true;
    return candidate;
  }
  return !current || candidate.width * candidate.height < current.width * current.height ? candidate : current;
}

function _copyProbe(found, x, y) {
  var copy = _rectFrom(found.left, found.top, found.right, found.bottom);
  copy.probeX = x;
  copy.probeY = y;
  return copy;
}

function _sortByKey(entries, key) {
  // Insertion sort: stable, and clearer than a comparator over a few items
  for (var i = 1; i < entries.length; i++) {
    var current = entries[i];
    var j = i - 1;
    while (j >= 0 && entries[j][key] > current[key]) {
      entries[j + 1] = entries[j];
      j--;
    }
    entries[j + 1] = current;
  }
  return entries;
}

function _separatedOrder(boxes, lo, hi) {
  var order = [];
  for (var i = 0; i < boxes.length; i++) {
    order.push({ box: boxes[i], index: i, sum: boxes[i][lo] + boxes[i][hi] });
  }
  _sortByKey(order, "sum");
  for (var k = 1; k < order.length; k++) {
    if (order[k].box[lo] < order[k - 1].box[hi]) return null;
  }
  return order;
}

function _cutLimits(rect, boxes, order, lo, hi, loValue, hiValue) {
  var limits = [];
  for (var i = 0; i < boxes.length; i++) limits.push([rect[lo], rect[hi]]);
  for (var k = 1; k < order.length; k++) {
    var cut = (loValue(order[k - 1]) + hiValue(order[k])) / 2;
    limits[order[k - 1].index][1] = cut;
    limits[order[k].index][0] = cut;
  }
  return limits;
}

function _boxRight(entry) {
  return entry.box.right;
}

function _boxLeft(entry) {
  return entry.box.left;
}

function _boxBottom(entry) {
  return entry.box.bottom;
}

function _boxTop(entry) {
  return entry.box.top;
}

function _entryCentre(entry) {
  return entry.centre;
}

// Cuts a merged bubble into one part per text, only along the axes where the
// texts are apart, in the middle of the gap between neighbouring texts.
// Overlapping texts are cut between their centres, on the axis they are
// furthest apart. Parts come back in the order of `boxes`.
function _splitBubble(rect, boxes) {
  var parts = [];
  var i;
  var byX = _separatedOrder(boxes, "left", "right");
  var byY = _separatedOrder(boxes, "top", "bottom");
  if (!byX && !byY) {
    var minX = boxes[0].xMid, maxX = boxes[0].xMid, minY = boxes[0].yMid, maxY = boxes[0].yMid;
    for (i = 1; i < boxes.length; i++) {
      minX = Math.min(minX, boxes[i].xMid);
      maxX = Math.max(maxX, boxes[i].xMid);
      minY = Math.min(minY, boxes[i].yMid);
      maxY = Math.max(maxY, boxes[i].yMid);
    }
    var horizontal = maxX - minX >= maxY - minY;
    var mid = horizontal ? "xMid" : "yMid";
    var centres = [];
    for (i = 0; i < boxes.length; i++) centres.push({ box: boxes[i], index: i, centre: boxes[i][mid] });
    _sortByKey(centres, "centre");
    var limits = horizontal
      ? _cutLimits(rect, boxes, centres, "left", "right", _entryCentre, _entryCentre)
      : _cutLimits(rect, boxes, centres, "top", "bottom", _entryCentre, _entryCentre);
    for (i = 0; i < boxes.length; i++) {
      parts.push((horizontal
        ? _rectFrom(limits[i][0], rect.top, limits[i][1], rect.bottom)
        : _rectFrom(rect.left, limits[i][0], rect.right, limits[i][1])) || rect);
    }
    return parts;
  }
  var xs = byX ? _cutLimits(rect, boxes, byX, "left", "right", _boxRight, _boxLeft) : null;
  var ys = byY ? _cutLimits(rect, boxes, byY, "top", "bottom", _boxBottom, _boxTop) : null;
  for (i = 0; i < boxes.length; i++) {
    var left = xs ? xs[i][0] : rect.left;
    var right = xs ? xs[i][1] : rect.right;
    var top = ys ? ys[i][0] : rect.top;
    var bottom = ys ? ys[i][1] : rect.bottom;
    parts.push(_rectFrom(left, top, right, bottom) || rect);
  }
  return parts;
}

function _idInList(id, ids) {
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] === id) return true;
  }
  return false;
}

function _autoCenterEnabled(data) {
  return !!(data && _AUTO_CENTER_MODES[data.autoCenter] === true);
}

// "Centre double bubble" needs at least two layers, all of them text
function _doubleBubbleEntriesValid(entries) {
  if (!entries || entries.length < 2) return false;
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i] || !entries[i].text) return false;
  }
  return true;
}

function _transformScale(layerText) {
  var t = layerText && layerText.transform;
  if (!t) return 1;
  var xx = Number(t.xx) || 0, xy = Number(t.xy) || 0, yx = Number(t.yx) || 0, yy = Number(t.yy) || 0;
  var sx = Math.sqrt(xx * xx + xy * xy);
  var sy = Math.sqrt(yx * yx + yy * yy);
  var scale = sy || sx;
  return isFinite(scale) && scale > 0 ? scale : 1;
}

function _typeValueToPixels(value, unit, resolution) {
  if (unit === "pixelsUnit") return value;
  if (unit === "millimetersUnit") return value * resolution / 25.4;
  return value * resolution / 72;
}

function _typeValueToPoints(value, unit, resolution) {
  if (unit === "pixelsUnit") return value * 72 / (resolution || 72);
  if (unit === "millimetersUnit") return value * 72 / 25.4;
  return value;
}

function _pointsToTypeUnit(value, unit, resolution) {
  if (unit === "pixelsUnit") return value * (resolution || 72) / 72;
  if (unit === "millimetersUnit") return value * 25.4 / 72;
  return value;
}

// The size Photoshop shows is the stored size times the layer transform
function _displayedTextSize(textParams, resolution) {
  var result = { value: NaN, unit: "pointsUnit", pixels: NaN };
  var layerText = textParams && textParams.layerText;
  var range = layerText && layerText.textStyleRange && layerText.textStyleRange[0];
  var style = range && range.textStyle;
  if (!style) return result;
  result.unit = textParams.typeUnit || "pointsUnit";
  var base = Number(style.size);
  var implied = Number(style.impliedFontSize);
  var value = isFinite(implied) && implied > 0 ? implied : (isFinite(base) ? base * _transformScale(layerText) : NaN);
  if (!isFinite(value) || value <= 0) return result;
  result.value = value;
  result.pixels = _typeValueToPixels(value, result.unit, resolution || 72);
  return result;
}

// A box frame scaled with its text. Point text has no frame: null.
function _scaleTextShape(shape, ratio) {
  if (!shape || shape.textType !== "box" || !shape.bounds) return null;
  var scaled = _clone(shape);
  var keys = ["top", "left", "right", "bottom"];
  for (var i = 0; i < keys.length; i++) {
    var value = Number(scaled.bounds[keys[i]]);
    if (isFinite(value)) scaled.bounds[keys[i]] = value * ratio;
  }
  return scaled;
}

// Size +/-: the step applies to the displayed size (stored size x layer
// transform), so a scaled layer moves by what the user sees; the stored size
// changes by the same ratio. The fast path is only safe when every run has
// the same size, and a fixed leading only scales when it is shared too.
// `frame` is the box frame before the change: the caller scales it by the
// ratio Photoshop really applied (see _fitFrameToTextSize).
function _textResizePlan(textParams, delta, resolution) {
  var layerText = textParams && textParams.layerText;
  var ranges = layerText && layerText.textStyleRange;
  if (!ranges || !ranges.length) return null;
  var sized = [];
  for (var i = 0; i < ranges.length; i++) {
    if (ranges[i] && ranges[i].textStyle && Number(ranges[i].textStyle.size) > 0) sized.push(ranges[i].textStyle);
  }
  if (!sized.length) return null;
  var first = sized[0];
  var base = Number(first.size);
  var shown = _displayedTextSize(textParams, resolution).value;
  if (!(base > 0) || !(shown > 0) || !isFinite(delta)) return null;
  var nextShown = Math.max(_MIN_DISPLAYED_TEXT_SIZE, shown + delta);
  var uniform = true;
  var scaleLeading = !first.autoLeading && first.leading !== undefined && first.leading !== null;
  for (var k = 0; k < sized.length; k++) {
    if (Number(sized[k].size) !== base) uniform = false;
    if (sized[k].autoLeading || sized[k].leading === undefined || Number(sized[k].leading) !== Number(first.leading)) scaleLeading = false;
  }
  var shape = layerText.textShape && layerText.textShape[0];
  return {
    ratio: nextShown / shown,
    nextShown: nextShown,
    base: base,
    unit: textParams.typeUnit || "pointsUnit",
    uniform: uniform,
    scaleLeading: scaleLeading,
    leading: Number(first.leading),
    frame: shape && shape.textType === "box" && shape.bounds ? _clone(shape) : null,
  };
}

// Photoshop may round the size it stores: the frame follows the size it
// really applied, read back before and after the change. Frame and size then
// keep the same proportion whatever the series of +/- presses.
function _appliedSizeRatio(before, after, fallback) {
  if (before && after && before.unit === after.unit && before.value > 0 && after.value > 0) {
    return after.value / before.value;
  }
  return fallback;
}

var _KNOWN_TYPE_UNITS = { pointsUnit: true, pixelsUnit: true, millimetersUnit: true };

// TextShapeR only changes line breaks: the size, leading and auto-leading the
// layer has right now win over the snapshot (which may be stale or in another
// unit).
function _keepLiveTextSize(newTextParams, liveParams, resolution) {
  var liveRange = liveParams && liveParams.layerText && liveParams.layerText.textStyleRange && liveParams.layerText.textStyleRange[0];
  var live = liveRange && liveRange.textStyle;
  var ranges = newTextParams && newTextParams.layerText && newTextParams.layerText.textStyleRange;
  if (!live || !ranges) return newTextParams;
  var liveUnit = liveParams.typeUnit;
  var targetUnit = newTextParams.typeUnit;
  var convert = false;
  if (!targetUnit && liveUnit) {
    newTextParams.typeUnit = liveUnit;
  } else if (liveUnit && targetUnit && liveUnit !== targetUnit) {
    if (!_KNOWN_TYPE_UNITS[liveUnit] || !_KNOWN_TYPE_UNITS[targetUnit]) return newTextParams;
    convert = true;
  }
  var keys = ["size", "leading", "autoLeading"];
  for (var i = 0; i < ranges.length; i++) {
    var style = ranges[i] && ranges[i].textStyle;
    if (!style) continue;
    for (var k = 0; k < keys.length; k++) {
      var value = live[keys[k]];
      if (value === undefined) continue;
      if (convert && keys[k] !== "autoLeading") {
        value = _pointsToTypeUnit(_typeValueToPoints(Number(value), liveUnit, resolution), targetUnit, resolution);
      }
      style[keys[k]] = _clone(value);
    }
    if (live.autoLeading === true) delete style.leading;
    delete style.impliedFontSize;
    delete style.impliedLeading;
  }
  return newTextParams;
}


/* --------------------- Photoshop helpers --------------------- */

function _getDocumentPixelSize() {
  var size = { width: 0, height: 0 };
  try {
    var doc = app.activeDocument;
    size.width = doc.width && doc.width.as ? doc.width.as("px") : parseFloat(doc.width);
    size.height = doc.height && doc.height.as ? doc.height.as("px") : parseFloat(doc.height);
  } catch (sizeError) {}
  if (!isFinite(size.width)) size.width = 0;
  if (!isFinite(size.height)) size.height = 0;
  return size;
}

function _getDocumentResolution() {
  try {
    var resolution = Number(app.activeDocument.resolution);
    if (resolution > 0) return resolution;
  } catch (resolutionError) {}
  return 72;
}

function _magicWandAt(x, y, tolerance) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putProperty(charID.Channel, charID.FrameSelect);
  desc.putReference(charID.Null, ref);
  var pos = new ActionDescriptor();
  pos.putUnitDouble(charID.Horizontal, charID.PixelUnit, Math.max(x, 0));
  pos.putUnitDouble(charID.Vertical, charID.PixelUnit, Math.max(y, 0));
  desc.putObject(charID.To, stringIDToTypeID("paint"), pos);
  desc.putInteger(stringIDToTypeID("tolerance"), tolerance || _BUBBLE_WAND_TOLERANCE);
  desc.putBoolean(stringIDToTypeID("contiguous"), true);
  desc.putBoolean(stringIDToTypeID("merged"), true);
  desc.putBoolean(stringIDToTypeID("antiAlias"), true);
  executeAction(charID.Set, desc, DialogModes.NO);
}

function _liveSelectionBounds() {
  try {
    var bounds = _getCurrentSelectionBounds();
    return bounds ? _rectFrom(bounds.left, bounds.top, bounds.right, bounds.bottom) : null;
  } catch (selectionError) {
    return null;
  }
}

function _intersectSelectionWithRect(rect) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putProperty(charID.Channel, charID.FrameSelect);
  desc.putReference(charID.Null, ref);
  var area = new ActionDescriptor();
  area.putUnitDouble(charID.Top, charID.PixelUnit, rect.top);
  area.putUnitDouble(charID.Left, charID.PixelUnit, rect.left);
  area.putUnitDouble(charID.Bottom, charID.PixelUnit, rect.bottom);
  area.putUnitDouble(charID.Right, charID.PixelUnit, rect.right);
  desc.putObject(charID.To, stringIDToTypeID("rectangle"), area);
  executeAction(stringIDToTypeID("intersectWith"), desc, DialogModes.NO);
}

function _channelExists(name) {
  try {
    var reference = new ActionReference();
    reference.putName(charID.Channel, name);
    executeActionGet(reference);
    return true;
  } catch (missingError) {
    return false;
  }
}

function _deleteChannelByName(name) {
  if (!_channelExists(name)) return;
  try {
    var reference = new ActionReference();
    reference.putName(charID.Channel, name);
    var descriptor = new ActionDescriptor();
    descriptor.putReference(charID.Null, reference);
    executeAction(charID.Delete, descriptor, DialogModes.NO);
  } catch (deleteError) {}
}

// Select > Save Selection: an alpha channel that does not become the target
// channel, so the wand keeps sampling the image
function _storeSelectionChannel(name) {
  _deleteChannelByName(name);
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putString(stringIDToTypeID("name"), name);
  executeAction(stringIDToTypeID("duplicate"), descriptor, DialogModes.NO);
}

function _loadSelectionChannel(name) {
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  var source = new ActionReference();
  source.putName(charID.Channel, name);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putReference(charID.To, source);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _saveSelectionState() {
  var saved = { had: false, stored: false };
  try {
    saved.had = !!_getCurrentSelectionBounds();
  } catch (readError) {
    saved.had = false;
  }
  if (saved.had) {
    try {
      _storeSelectionChannel(_SAVED_SELECTION_CHANNEL);
      saved.stored = true;
    } catch (storeError) {
      _deleteChannelByName(_SAVED_SELECTION_CHANNEL);
    }
  }
  return saved;
}

// The user's selection comes back as it was (none stays none). With
// `consumed`, the selection was used like Align uses it: it is dropped.
function _restoreSelectionState(saved, consumed) {
  var restored = false;
  if (saved && saved.stored) {
    if (!consumed) {
      try {
        _loadSelectionChannel(_SAVED_SELECTION_CHANNEL);
        restored = true;
      } catch (loadError) {}
    }
    _deleteChannelByName(_SAVED_SELECTION_CHANNEL);
  }
  if (!restored) {
    try {
      _deselect();
    } catch (deselectError) {}
  }
}

// Bounds without the layer style (a stroke would widen the box), falling back
// on the plain bounds where Photoshop has no such key
function _layerBoxFromDescriptor(descriptor) {
  var keys = ["boundsNoEffects", "bounds"];
  for (var i = 0; i < keys.length; i++) {
    var key = stringIDToTypeID(keys[i]);
    if (descriptor && descriptor.hasKey && descriptor.hasKey(key)) {
      var b = _getBoundsFromDescriptor(descriptor.getObjectValue(key));
      return _rectFrom(b.left, b.top, b.right, b.bottom);
    }
  }
  return null;
}

function _currentLayerBox() {
  var key = stringIDToTypeID("boundsNoEffects");
  try {
    var descriptor = _getCurrent(charID.Layer, key);
    if (descriptor.hasKey(key)) return _layerBoxFromDescriptor(descriptor);
  } catch (noEffectsError) {}
  var b = _getCurrentTextLayerBounds();
  return b ? _rectFrom(b.left, b.top, b.right, b.bottom) : null;
}

function _currentDisplayedTextPixels() {
  try {
    return _displayedTextSize(jamText.getLayerText(), _getDocumentResolution()).pixels;
  } catch (sizeError) {
    return NaN;
  }
}

function _safeActiveLayerId() {
  try {
    return _getActiveLayerId();
  } catch (idError) {
    return null;
  }
}

// Five wand probes around the text. `best` is the bubble (left as the live
// marquee); `loose` is what the probes chose with nothing excluded, i.e. the
// merged double bubble, and has to be wanded again before use.
function _probeBubble(box, sizePixels, exclude, docSize) {
  var found = { best: null, loose: null };
  if (!box) return found;
  var others = exclude || [];
  var points = _probePoints(box, _probeMargin(isFinite(sizePixels) ? sizePixels : 20));
  for (var i = 0; i < points.length; i++) {
    try {
      _magicWandAt(points[i][0], points[i][1], _BUBBLE_WAND_TOLERANCE);
      var live = _liveSelectionBounds();
      if (!live || !_bubbleCandidateValid(live, box, docSize, [], sizePixels)) continue;
      found.loose = _pickBubble(found.loose, _copyProbe(live, points[i][0], points[i][1]), box);
      var excluded = false;
      for (var j = 0; j < others.length; j++) {
        if (_containsPoint(live, others[j].xMid, others[j].yMid)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
      found.best = _pickBubble(found.best, _copyProbe(live, points[i][0], points[i][1]), box);
      if (found.best.whole) break;
    } catch (wandError) {}
  }
  if (found.best && !_sameRect(found.best, _liveSelectionBounds())) {
    try {
      _magicWandAt(found.best.probeX, found.best.probeY, _BUBBLE_WAND_TOLERANCE);
    } catch (rearmError) {}
  }
  return found;
}

// Opens the live marquee, which must be `rect` (closes the glyph holes the
// wand leaves, cuts a tail): the text is centred on the opened bounds. Any
// answer that is not a plausible part of `rect` holding the text keeps `rect`.
function _openedBubble(rect, box) {
  var opened = null;
  try {
    opened = _getAdaptiveOpenedSelectionBounds(rect);
  } catch (openError) {
    opened = null;
  }
  if (!opened || opened.error) return rect;
  var candidate = _rectFrom(opened.left, opened.top, opened.right, opened.bottom);
  if (!candidate || candidate.width * candidate.height < _MIN_BUBBLE_AREA) return rect;
  if (!_containsBox(rect, candidate, 2)) return rect;
  if (box && !_containsPoint(candidate, box.xMid, box.yMid, 1)) return rect;
  return candidate;
}

// The bounding rectangle of a wand marquee can hold a text that sits outside
// the shape (an L-shaped merge, a neighbouring panel): the marquee itself must
// run under the text, i.e. keep most of its box once intersected with it.
// Leaves the live selection changed.
function _wandCoversBox(probe, box) {
  try {
    _magicWandAt(probe.probeX, probe.probeY, _BUBBLE_WAND_TOLERANCE);
    _intersectSelectionWithRect(box);
    var inside = _liveSelectionBounds();
    return !!(inside && inside.width >= box.width * 0.5 && inside.height >= box.height * 0.5);
  } catch (coverError) {
    return false;
  }
}

// A round lobe is narrower than the merged shape across the cut: the wand
// marquee intersected with the cut gives its real extent. Any failure keeps
// the rectangular cut.
function _tightLobe(probe, lobe, box, docSize) {
  if (!lobe || !probe) return null;
  try {
    _magicWandAt(probe.probeX, probe.probeY, _BUBBLE_WAND_TOLERANCE);
    _intersectSelectionWithRect(lobe);
    var tight = _liveSelectionBounds();
    if (tight && _usableBubble(tight, docSize) && _containsPoint(tight, box.xMid, box.yMid, 1)) return tight;
  } catch (lobeError) {}
  return null;
}

function _layerLockedByDescriptor(layer) {
  try {
    var lockingKey = stringIDToTypeID("layerLocking");
    if (!layer.hasKey(lockingKey)) return false;
    var locking = layer.getObjectValue(lockingKey);
    var keys = ["protectAll", "protectPosition"];
    for (var i = 0; i < keys.length; i++) {
      var key = stringIDToTypeID(keys[i]);
      if (locking.hasKey(key) && locking.getBoolean(key)) return true;
    }
  } catch (lockError) {}
  return false;
}

// Visible text layers other than `skipIds`, with their bounds. A hidden one
// (or one in a hidden group) is ignored; a locked one (or one in a locked
// group) still counts as the other half of a bubble but is never moved.
function _textNeighbours(skipIds) {
  var found = [];
  try {
    var numberOfLayers = stringIDToTypeID("numberOfLayers");
    var layerSection = stringIDToTypeID("layerSection");
    var layerSectionStart = stringIDToTypeID("layerSectionStart");
    var layerSectionEnd = stringIDToTypeID("layerSectionEnd");
    var index = _getCurrent(charID.Document, numberOfLayers).getInteger(numberOfLayers);
    var parents = [];
    for (; index >= 1; index--) {
      try {
        var layer = _getLayerByIndex(index);
        var section = layer.getEnumerationValue(layerSection);
        if (section === layerSectionStart) {
          parents.push({ visible: layer.getBoolean(charID.Visible), locked: _layerLockedByDescriptor(layer) });
          continue;
        }
        if (section === layerSectionEnd) {
          parents.pop();
          continue;
        }
        var shown = layer.getBoolean(charID.Visible);
        var locked = _layerLockedByDescriptor(layer);
        for (var i = 0; i < parents.length; i++) {
          shown = shown && parents[i].visible;
          locked = locked || parents[i].locked;
        }
        if (!shown || !layer.hasKey(charID.Text)) continue;
        var id = layer.getInteger(charID.LayerID);
        if (_idInList(id, skipIds)) continue;
        var box = _layerBoxFromDescriptor(layer);
        if (box) found.push({ id: id, box: box, neighbour: true, locked: locked, rect: null });
      } catch (layerError) {}
    }
  } catch (walkError) {}
  return found;
}

// Centres the active text layer on `rect`, fitting a box frame to it first
// when asked. Point text has no frame: it is only moved. False when the text
// has no visible pixels to centre.
function _placeLayerInRect(rect, resize, padding) {
  if (resize && !_textLayerIsPointText()) {
    var width = _calculateSelectionDimensions(rect, padding).width;
    // Laid out in a frame taller than the bubble so no line is hidden, then
    // the frame hugs the text: box text sits at the top of its frame, so a
    // frame taller than the text would stick out of the bubble
    _setTextBoxSize(width, rect.height * 3);
    var measured = _currentLayerBox();
    if (measured) {
      var size = _currentDisplayedTextPixels();
      if (!(size > 0)) size = 20;
      _setTextBoxSize(width, measured.height + size + 2);
    }
  }
  var current = _currentLayerBox();
  if (!current) return false;
  var offsetX = rect.xMid - current.xMid;
  var offsetY = rect.yMid - current.yMid;
  if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
  return true;
}

// Finds the bubble of each new text and centres it. "single": the bubble
// around the text. "multi": a bubble shared with another text (pasted with it
// or already on the page, if visible) is cut between them, and that
// neighbour is centred in its part unless it is locked.
function _autoCenterLayers(created, data) {
  var mode = data.autoCenter;
  var resize = !!data.resizeTextBox;
  var padding = data.padding || 0;
  var docSize = _getDocumentPixelSize();
  var items = [];
  var i, j;
  for (i = 0; i < created.length; i++) {
    try {
      _selectLayerById(created[i]);
      var box = _currentLayerBox();
      if (box) items.push({ id: created[i], box: box, sizePixels: _currentDisplayedTextPixels(), rect: null, merged: null });
    } catch (readError) {}
  }
  if (!items.length) return;
  var neighbours = mode === "multi" ? _textNeighbours(created) : [];
  for (i = 0; i < items.length; i++) {
    var exclude = [];
    if (mode === "multi") {
      for (j = 0; j < items.length; j++) if (j !== i) exclude.push(items[j].box);
      for (j = 0; j < neighbours.length; j++) exclude.push(neighbours[j].box);
    }
    try {
      var probed = _probeBubble(items[i].box, items[i].sizePixels, exclude, docSize);
      if (probed.best) items[i].rect = _openedBubble(probed.best, items[i].box);
      else items[i].merged = probed.loose;
    } catch (probeError) {}
  }
  var moves = [];
  if (mode === "multi") {
    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.rect || !item.merged) continue;
      var merged = item.merged;
      var candidates = [];
      for (j = 0; j < items.length; j++) if (j !== i && !items[j].rect) candidates.push(items[j]);
      for (j = 0; j < neighbours.length; j++) if (!neighbours[j].rect) candidates.push(neighbours[j]);
      var group = [item];
      for (j = 0; j < candidates.length; j++) {
        var other = candidates[j];
        if (_containsPoint(merged, other.box.xMid, other.box.yMid, 1) && _wandCoversBox(merged, other.box)) group.push(other);
      }
      try {
        _magicWandAt(merged.probeX, merged.probeY, _BUBBLE_WAND_TOLERANCE);
      } catch (rearmError) {
        continue;
      }
      var rect = _openedBubble(merged, item.box);
      if (group.length === 1) {
        item.rect = rect;
        continue;
      }
      var groupBoxes = [];
      for (j = 0; j < group.length; j++) groupBoxes.push(group[j].box);
      var lobes = _splitBubble(rect, groupBoxes);
      for (j = 0; j < group.length; j++) {
        group[j].rect = _tightLobe(merged, lobes[j], group[j].box, docSize) || lobes[j];
        if (group[j].neighbour && !group[j].locked) moves.push(group[j]);
      }
    }
  }
  try {
    _deselect();
  } catch (deselectError) {}
  var targets = items.concat(moves);
  for (i = 0; i < targets.length; i++) {
    if (!targets[i].rect) continue;
    try {
      _selectLayerById(targets[i].id);
      _placeLayerInRect(targets[i].rect, resize, padding);
    } catch (placeError) {}
  }
}

// Centring right after a paste, inside the paste's own history state. A text
// whose bubble is not found keeps its paste position, one failure never stops
// the rest, and the selection and active layer end as the paste left them.
function _autoCenterCreated(ids, data) {
  if (!_autoCenterEnabled(data)) return;
  var created = [];
  for (var i = 0; i < (ids || []).length; i++) {
    if (ids[i] !== null && ids[i] !== undefined) created.push(ids[i]);
  }
  if (!created.length) return;
  var active = _safeActiveLayerId();
  var saved = _saveSelectionState();
  try {
    _autoCenterLayers(created, data);
  } catch (autoCenterError) {}
  _restoreSelectionState(saved, false);
  try {
    _selectLayerById(active !== null ? active : created[created.length - 1]);
  } catch (reselectError) {}
}

// Selected layers as {id, text}; the active layer when nothing is reported
function _targetLayerEntries() {
  var entries = [];
  var targetLayers = stringIDToTypeID("targetLayers");
  var layerIdProp = stringIDToTypeID("layerID");
  var indexes = [];
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (doc.hasKey(targetLayers)) {
    var list = doc.getList(targetLayers);
    var offset = _documentHasBackgroundLayer() ? 0 : 1;
    for (var i = 0; i < list.count; i++) indexes.push(list.getReference(i).getIndex() + offset);
  } else {
    indexes.push(-1);
  }
  for (var j = 0; j < indexes.length; j++) {
    var textRef = new ActionReference();
    textRef.putProperty(charID.Property, charID.Text);
    var idRef = new ActionReference();
    idRef.putProperty(charID.Property, layerIdProp);
    if (indexes[j] === -1) {
      textRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    } else {
      textRef.putIndex(charID.Layer, indexes[j]);
      idRef.putIndex(charID.Layer, indexes[j]);
    }
    var isText = false;
    try {
      isText = executeActionGet(textRef).hasKey(charID.Text);
    } catch (textError) {
      isText = false;
    }
    entries.push({ id: executeActionGet(idRef).getInteger(layerIdProp), text: isText });
  }
  return entries;
}

// Double (or chained) bubble: one selected text per lobe. A user selection
// holding every text centre is the whole bubble (and is used up, as Align
// uses it); otherwise each text gets its own probe that must not reach
// another text's centre, and when the lobes are merged that shape is cut
// between the texts. Answers an error code for the panel, "" when done.
function _splitDoubleBubble(entries, resize, padding) {
  var outcome = { result: "", consumed: false };
  var docSize = _getDocumentPixelSize();
  var user = _usableBubble(_liveSelectionBounds(), docSize);
  var items = [];
  var i, j;
  for (i = 0; i < entries.length; i++) {
    _selectLayerById(entries[i].id);
    var box = _currentLayerBox();
    if (!box) {
      outcome.result = "doubleBubbleEmpty";
      return outcome;
    }
    items.push({ id: entries[i].id, box: box, sizePixels: _currentDisplayedTextPixels(), rect: null });
  }
  var boxes = [];
  for (i = 0; i < items.length; i++) boxes.push(items[i].box);
  var merged = null;
  var userHoldsAll = !!user;
  for (i = 0; userHoldsAll && i < items.length; i++) {
    userHoldsAll = _containsPoint(user, items[i].box.xMid, items[i].box.yMid, 1);
  }
  if (userHoldsAll) {
    merged = { rect: _openedBubble(user, null), probe: null };
    outcome.consumed = true;
  } else {
    var missing = false;
    for (i = 0; i < items.length; i++) {
      var exclude = [];
      for (j = 0; j < items.length; j++) if (j !== i) exclude.push(items[j].box);
      var own = _probeBubble(items[i].box, items[i].sizePixels, exclude, docSize).best;
      if (own) items[i].rect = _openedBubble(own, items[i].box);
      else missing = true;
    }
    if (missing) {
      var whole = _probeBubble(_unionRect(boxes), items[0].sizePixels, [], docSize).best;
      for (i = 0; whole && i < items.length; i++) {
        if (!_containsPoint(whole, items[i].box.xMid, items[i].box.yMid, 1)) whole = null;
      }
      if (!whole) {
        outcome.result = "doubleBubbleNotFound";
        return outcome;
      }
      merged = { rect: _openedBubble(whole, null), probe: whole };
    }
  }
  if (merged) {
    var lobes = _splitBubble(merged.rect, boxes);
    for (i = 0; i < items.length; i++) {
      items[i].rect = (merged.probe && _tightLobe(merged.probe, lobes[i], items[i].box, docSize)) || lobes[i];
    }
  }
  try {
    _deselect();
  } catch (deselectError) {}
  var ids = [];
  for (i = 0; i < items.length; i++) {
    _selectLayerById(items[i].id);
    if (!_placeLayerInRect(items[i].rect, resize, padding)) {
      outcome.result = "doubleBubbleEmpty";
      return outcome;
    }
    ids.push(items[i].id);
  }
  _selectLayersById(ids);
  return outcome;
}

function _alignTextLayersToDoubleBubble() {
  var state = _hostState.alignTextLayersToDoubleBubble;
  var saved = _saveSelectionState();
  var outcome = { result: "", consumed: false };
  try {
    outcome = _splitDoubleBubble(state.entries || [], state.resize, state.padding);
  } catch (splitError) {
    outcome.result = "scriptError: " + (splitError && splitError.message ? splitError.message : splitError);
  }
  _restoreSelectionState(saved, outcome.consumed && !outcome.result);
  state.result = outcome.result;
}

/**
 * Retrieve stroke information from the active layer.
 * Returns null if no stroke is found.
 */
function _getLayerStroke(layerIndex) {
  // Must never throw: getActiveLayerText() serializes its result straight to
  // the panel, and an exception here would make the whole call fail and show
  // "select a text layer" even though a text layer is active.
  // When layerIndex is provided, the layer is addressed by index so callers
  // (FontScanR) never have to change the active layer.
  try {
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("Lefx"));
    if (typeof layerIndex === "number") {
      ref.putIndex(charIDToTypeID("Lyr "), layerIndex);
    } else {
      ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    }
    var desc = executeActionGet(ref);
    if (!desc.hasKey(charIDToTypeID("Lefx"))) return null;

    var fx = desc.getObjectValue(charIDToTypeID("Lefx"));
    var fr = null;
    if (fx.hasKey(charIDToTypeID("FrFX"))) {
      try {
        fr = fx.getObjectValue(charIDToTypeID("FrFX"));
      } catch (frError) {
        fr = null;
      }
    }
    if (!fr) {
      // Newer Photoshop versions store duplicated strokes in a
      // "frameFXMulti" list instead of a single FrFX object
      var multiId = stringIDToTypeID("frameFXMulti");
      if (fx.hasKey(multiId)) {
        var frList = fx.getList(multiId);
        if (frList.count > 0) fr = frList.getObjectValue(0);
      }
    }
    if (!fr) return null;

    // Gradient/pattern strokes have no solid "Clr " descriptor, and
    // grayscale documents store the color as "Gry " instead of RGB
    var color = { r: 0, g: 0, b: 0 };
    try {
      var col = fr.getObjectValue(charIDToTypeID("Clr "));
      if (col.hasKey(charIDToTypeID("Rd  "))) {
        color = {
          r: col.getDouble(charIDToTypeID("Rd  ")),
          g: col.getDouble(charIDToTypeID("Grn ")),
          b: col.getDouble(charIDToTypeID("Bl  ")),
        };
      } else if (col.hasKey(charIDToTypeID("Gry "))) {
        var grayValue = Math.round(255 * (1 - col.getDouble(charIDToTypeID("Gry ")) / 100));
        color = { r: grayValue, g: grayValue, b: grayValue };
      }
    } catch (colorError) {}

    var enabled = true;
    try {
      enabled = fr.getBoolean(charIDToTypeID("enab"));
    } catch (enabledError) {}
    var position = "other";
    try {
      position = fr.getEnumerationValue(charIDToTypeID("Styl")) == charIDToTypeID("OutF") ? "outer" : "other";
    } catch (positionError) {}
    var size = 0;
    try {
      size = fr.getUnitDoubleValue(charIDToTypeID("Sz  "));
    } catch (sizeError) {}
    var opacity = 100;
    try {
      opacity = fr.getUnitDoubleValue(charIDToTypeID("Opct"));
    } catch (opacityError) {}

    return {
      enabled: enabled,
      position: position,
      size: size,
      opacity: opacity,
      color: color,
    };
  } catch (strokeError) {
    return null;
  }
}

/**
 * Apply or update a stroke on the active layer.
 * @param {Object} stroke - {size, color:{r,g,b}, opacity, enabled}
 *                          position is forced to "outer".
 */
function _setLayerStroke(stroke) {
  if (!stroke || (stroke.size <= 0 && stroke.enabled !== true)) return;

  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("Lefx"));
  r.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  d.putReference(charIDToTypeID("null"), r);

  var fx = new ActionDescriptor();
  fx.putUnitDouble(charIDToTypeID("Scl "), charIDToTypeID("#Prc"), 100);

  var fr = new ActionDescriptor();
  fr.putBoolean(charIDToTypeID("enab"), true);
  fr.putBoolean(stringIDToTypeID("present"), true);
  fr.putBoolean(stringIDToTypeID("showInDialog"), true);

  fr.putEnumerated(charIDToTypeID("Styl"), charIDToTypeID("FStl"), charIDToTypeID("OutF"));
  fr.putEnumerated(charIDToTypeID("PntT"), charIDToTypeID("FrFl"), charIDToTypeID("SClr"));
  fr.putEnumerated(charIDToTypeID("Md  "), charIDToTypeID("BlnM"), charIDToTypeID("Nrml"));

  fr.putUnitDouble(charIDToTypeID("Sz  "), charIDToTypeID("#Pxl"), stroke.size || 3);
  fr.putUnitDouble(charIDToTypeID("Opct"), charIDToTypeID("#Prc"), stroke.opacity || 100);

  var c = new ActionDescriptor();
  c.putDouble(charIDToTypeID("Rd  "), stroke.color.r);
  c.putDouble(charIDToTypeID("Grn "), stroke.color.g);
  c.putDouble(charIDToTypeID("Bl  "), stroke.color.b);
  fr.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), c);

  fx.putObject(charIDToTypeID("FrFX"), charIDToTypeID("FrFX"), fr);
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("Lefx"), fx);

  executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function _setDiacXOffset(val) {
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("TxtS"));
  r.putEnumerated(charIDToTypeID("TxLr"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  d.putReference(charIDToTypeID("null"), r);

  var t = new ActionDescriptor();
  t.putInteger(stringIDToTypeID("textOverrideFeatureName"), 808466486);
  t.putInteger(stringIDToTypeID("typeStyleOperationType"), 3);
  t.putUnitDouble(stringIDToTypeID("diacXOffset"), charIDToTypeID("#Pxl"), val);
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("TxtS"), t);

  executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function _setMarkYOffset(val) {
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("TxtS"));
  r.putEnumerated(charIDToTypeID("TxLr"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  d.putReference(charIDToTypeID("null"), r);

  var t = new ActionDescriptor();
  t.putInteger(stringIDToTypeID("textOverrideFeatureName"), 808466488);
  t.putInteger(stringIDToTypeID("typeStyleOperationType"), 3);
  t.putUnitDouble(stringIDToTypeID("markYDistFromBaseline"), charIDToTypeID("#Pxl"), val);
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("TxtS"), t);

  executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function _applyMiddleEast(textStyle) {
  if (!textStyle) return;
  if (textStyle.diacXOffset != null) _setDiacXOffset(textStyle.diacXOffset);
  if (textStyle.markYDistFromBaseline != null) _setMarkYOffset(textStyle.markYDistFromBaseline);
}

function _applyTextDirection(direction, textLength) {
  if (!direction) return;
  var psDirection = direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";

  try {
    var currentText = jamText.getLayerText();
    if (
      !currentText ||
      !currentText.layerText ||
      !currentText.layerText.paragraphStyleRange ||
      !currentText.layerText.paragraphStyleRange.length
    ) {
      return;
    }

    var updatedText = _clone(currentText);
    var paragraphRanges = updatedText.layerText.paragraphStyleRange;
    var targetLength = textLength;
    if (targetLength == null && updatedText.layerText && updatedText.layerText.textKey) {
      targetLength = updatedText.layerText.textKey.length;
    }

    for (var i = 0; i < paragraphRanges.length; i++) {
      var range = paragraphRanges[i] || {};
      var paragraphStyle = range.paragraphStyle || {};

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
    jamText.setLayerText(updatedText);
  } catch (e) {
    // Ignore errors if directionType is not supported on this PS version
  }
}

function _buildRichTextRanges(baseRange, textRuns, textLength) {
  if (!baseRange || !baseRange.textStyle || !textRuns || !textRuns.length) return null;
  var ranges = [];
  var offset = 0;
  for (var i = 0; i < textRuns.length; i++) {
    var run = textRuns[i] || {};
    var runText = run.text || "";
    var runLength = runText.length;
    if (!runLength) continue;
    var textStyle = _clone(baseRange.textStyle);
    resolveTypeRFontVariant(textStyle, run, app.fonts);
    ranges.push({
      from: offset,
      to: offset + runLength,
      textStyle: textStyle,
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
  var baseRange = textParams.layerText.textStyleRange && textParams.layerText.textStyleRange[0];
  var ranges = _buildRichTextRanges(baseRange, textRuns, textLength);
  if (!ranges) return false;
  textParams.layerText.textStyleRange = ranges;
  return true;
}

function _createAndSetLayerText(data, width, height) {
  var style = _resolveStyleSizeForDocument(_ensureStyle(data.style));
  if (data.textSizeOverride > 0) {
    _overrideStyleTextSize(style, data.textSizeOverride);
  }
  style.textProps.layerText.textKey = _normalizeTextKey(data.text);
  style.textProps.layerText.textStyleRange[0].to = data.text.length;
  style.textProps.layerText.paragraphStyleRange[0].to = data.text.length;
  _applyRichTextRanges(style.textProps, data.richTextRuns, data.text.length);
  var sizeProp = style.textProps.layerText.textStyleRange[0].textStyle.size;
  if (typeof sizeProp !== "number") {
    try {
      var textParams = jamText.getLayerText();
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
  // Bake the direction into the make call: the legacy post-make
  // _applyTextDirection pass costs a full extra layer-text read plus a
  // second complete relayout
  var directionBaked = false;
  if (data.direction && style.textProps.layerText.paragraphStyleRange) {
    var psDirection = data.direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
    var paragraphRanges = style.textProps.layerText.paragraphStyleRange;
    for (var p = 0; p < paragraphRanges.length; p++) {
      var paragraphRange = paragraphRanges[p] || {};
      var bakedStyle = paragraphRange.paragraphStyle || {};
      bakedStyle.directionType = psDirection;
      bakedStyle.textComposerEngine = "textOptycaComposer";
      paragraphRange.paragraphStyle = bakedStyle;
      paragraphRanges[p] = paragraphRange;
    }
    directionBaked = true;
  }
  try {
    jamEngine.jsonPlay("make", {
      target: ["<reference>", [["textLayer", ["<class>", null]]]],
      using: jamText.toLayerTextObject(style.textProps),
    });
  } catch (makeError) {
    if (!directionBaked) throw makeError;
    // Some Photoshop versions reject directionType/textComposerEngine in a
    // make: strip them, retry, then use the legacy post-make pass
    for (var q = 0; q < style.textProps.layerText.paragraphStyleRange.length; q++) {
      var retryStyle = style.textProps.layerText.paragraphStyleRange[q].paragraphStyle || {};
      delete retryStyle.directionType;
      delete retryStyle.textComposerEngine;
    }
    jamEngine.jsonPlay("make", {
      target: ["<reference>", [["textLayer", ["<class>", null]]]],
      using: jamText.toLayerTextObject(style.textProps),
    });
    directionBaked = false;
  }
  _applyMiddleEast(style.textProps.layerText.textStyleRange[0].textStyle);
  if (style.stroke) {
    _setLayerStroke(style.stroke);
  }
  // Apply text direction if it could not be baked into the make call
  if (data.direction && !directionBaked) {
    _applyTextDirection(data.direction, data.text.length);
  }
}

function _setTextBoxSize(width, height) {
  var box = [
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
  jamText.setLayerText({ layerText: { textShape: box } });
}

function _checkSelection(options) {
  var selection = _getCurrentSelectionBounds();
  if (selection === undefined) {
    return { error: "noSelection" };
  }

  var adjustAmount = 0;
  var adaptiveOpen = false;
  if (options && options.adjustAmount !== undefined) {
    adjustAmount = options.adjustAmount;
  }
  if (options && options.adaptiveOpen) {
    adaptiveOpen = true;
  }

  var adjustedSelection = selection;
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

function _forEachSelectedLayer(action) {
  var selectedLayers = [];
  var reference = new ActionReference();
  var targetLayers = stringIDToTypeID("targetLayers");
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (doc.hasKey(targetLayers)) {
    doc = doc.getList(targetLayers);
    var ref2 = new ActionReference();
    ref2.putProperty(charID.Property, charID.Background);
    ref2.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
    var offset = executeActionGet(ref2).getBoolean(charID.Background) ? 0 : 1;
    for (var i = 0; i < doc.count; i++) {
      selectedLayers.push(doc.getReference(i).getIndex() + offset);
    }
  }
  if (selectedLayers.length > 1) {
    for (var j = 0; j < selectedLayers.length; j++) {
      var descr = new ActionDescriptor();
      var ref3 = new ActionReference();
      ref3.putIndex(charID.Layer, selectedLayers[j]);
      descr.putReference(charID.Null, ref3);
      executeAction(charID.Select, descr, DialogModes.NO);
      action(selectedLayers[j]);
    }
    var ref4 = new ActionReference();
    for (var k = 0; k < selectedLayers.length; k++) {
      ref4.putIndex(charID.Layer, selectedLayers[k]);
    }
    var descr2 = new ActionDescriptor();
    descr2.putReference(charID.Null, ref4);
    executeAction(charID.Select, descr2, DialogModes.NO);
  } else if (selectedLayers.length === 1) {
    action(selectedLayers[0]);
  }
  return selectedLayers.length;
}

/* ========================================================= */
/* ============ full methods for suspendHistory ============ */
/* ========================================================= */

function _setActiveLayerText() {
  var state = _hostState.setActiveLayerText;
  var payload = state.data;
  state.result = "";
  if (!payload) {
    return;
  } else if (!documents.length) {
    state.result = "doc";
    return;
  } else if (!_layerIsTextLayer()) {
    state.result = "layer";
    return;
  }
  var dataText = payload.text;
  var dataStyle = payload.style
    ? _resolveStyleSizeForDocument(_clone(payload.style))
    : payload.style;
  var dataRuns = payload.richTextRuns;
  var targetTextLength = 0;

  // "Paste text to the current layer" is deliberately content-only. Assigning
  // contents directly avoids writing any font, size, paragraph, direction,
  // text-box or position property.
  if (payload.contentOnly && (!dataRuns || !dataRuns.length)) {
    _forEachSelectedLayer(function () {
      app.activeDocument.activeLayer.textItem.contents = _normalizeTextKey(dataText);
    });
    state.result = "";
    return;
  }

  _forEachSelectedLayer(function () {
    var oldBounds = _getCurrentTextLayerBounds();
    var isPoint = _textLayerIsPointText();
    var targetPoint = _resolveStylePointText(dataStyle, isPoint);
    if (isPoint) _changeToBoxText();
    var oldTextParams = jamText.getLayerText();
    if (payload.preserveActiveTextSize && dataStyle && oldTextParams.layerText.textStyleRange &&
        oldTextParams.layerText.textStyleRange[0] && oldTextParams.layerText.textStyleRange[0].textStyle) {
      _overrideStyleTextSize(dataStyle, oldTextParams.layerText.textStyleRange[0].textStyle.size);
    }
    var newTextParams;
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
        // Create a minimal paragraphStyleRange without directionType to avoid RTL issues
        var oldParagraphStyle = oldTextParams.layerText.paragraphStyleRange[0].paragraphStyle || {};
        var newParagraphStyle = {};

        // Copy only safe properties, explicitly excluding directionType
        for (var i = 0; i < _SAFE_PARAGRAPH_PROPS.length; i++) {
          var prop = _SAFE_PARAGRAPH_PROPS[i];
          if (oldParagraphStyle[prop] !== undefined) {
            newParagraphStyle[prop] = oldParagraphStyle[prop];
          }
        }

        newTextParams.layerText.paragraphStyleRange = [{
          from: 0,
          to: dataText.length,
          paragraphStyle: newParagraphStyle
        }];
      }
      targetTextLength = dataText.length;
      _applyRichTextRanges(newTextParams, dataRuns, targetTextLength);
    } else if (dataStyle) {
      var text = oldTextParams.layerText.textKey || "";
      newTextParams = dataStyle.textProps;
      newTextParams.layerText.textStyleRange[0].to = text.length;
      newTextParams.layerText.paragraphStyleRange[0].to = text.length;
      targetTextLength = text.length;
    }
    var retainedShape = oldTextParams.layerText.textShape && oldTextParams.layerText.textShape[0];
    if (isPoint && retainedShape && retainedShape.bounds) {
      var oldTextStyle = oldTextParams.layerText.textStyleRange &&
        oldTextParams.layerText.textStyleRange[0] &&
        oldTextParams.layerText.textStyleRange[0].textStyle;
      var styleTextStyle = dataStyle &&
        dataStyle.textProps &&
        dataStyle.textProps.layerText &&
        dataStyle.textProps.layerText.textStyleRange &&
        dataStyle.textProps.layerText.textStyleRange[0] &&
        dataStyle.textProps.layerText.textStyleRange[0].textStyle;
      var oldSize = oldTextStyle && oldTextStyle.size;
      var newSize = styleTextStyle && styleTextStyle.size != null ? styleTextStyle.size : oldSize;
      var widthScale = oldSize && newSize ? newSize / oldSize : 1;
      if (!(widthScale > 0)) widthScale = 1;
      if (widthScale < 1) widthScale = 1;
      var bounds = retainedShape.bounds;
      var currentWidth = bounds.right - bounds.left;
      var currentHeight = bounds.bottom - bounds.top;
      var oldWidthPoints = typeof oldBounds.width === "number" ? _convertPixelToPoint(oldBounds.width) : currentWidth;
      var oldHeightPoints = typeof oldBounds.height === "number" ? _convertPixelToPoint(oldBounds.height) : currentHeight;
      var targetWidth = currentWidth * widthScale;
      var targetHeight = currentHeight * widthScale;
      if (targetWidth < oldWidthPoints * widthScale) targetWidth = oldWidthPoints * widthScale;
      var minWidthPadding = (newSize || oldSize || 12) * 0.5;
      if (targetWidth < oldWidthPoints + minWidthPadding) targetWidth = oldWidthPoints + minWidthPadding;
      var minHeightPadding = (newSize || oldSize || 12) * 0.75;
      if (targetHeight < oldHeightPoints * widthScale) targetHeight = oldHeightPoints * widthScale;
      if (targetHeight < oldHeightPoints + minHeightPadding) targetHeight = oldHeightPoints + minHeightPadding;
      bounds.right = bounds.left + targetWidth;
      bounds.bottom = bounds.top + targetHeight;
    }
    // Applying a style must carry its configured anti-aliasing mode to the
    // layer. Keep the current value only for legacy styles that do not store
    // an antiAlias setting.
    var styleAntiAlias = dataStyle && dataStyle.textProps && dataStyle.textProps.layerText &&
      dataStyle.textProps.layerText.antiAlias;
    newTextParams.layerText.antiAlias = styleAntiAlias || oldTextParams.layerText.antiAlias || "antiAliasSmooth";
    if (retainedShape) {
      newTextParams.layerText.textShape = [retainedShape];
    }
    newTextParams.typeUnit = oldTextParams.typeUnit;

    var userDirection = payload.direction;
    if (userDirection === "") userDirection = null;
    // Bake the direction into the ranges of the main set call: the legacy
    // post-set _applyTextDirection pass costs a full extra layer-text read
    // plus a second complete relayout on every apply
    var directionBaked = false;
    if (userDirection && newTextParams.layerText.paragraphStyleRange) {
      var psDirection = userDirection === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
      var paragraphRanges = newTextParams.layerText.paragraphStyleRange;
      for (var p = 0; p < paragraphRanges.length; p++) {
        var paragraphRange = paragraphRanges[p] || {};
        var bakedStyle = paragraphRange.paragraphStyle || {};
        bakedStyle.directionType = psDirection;
        bakedStyle.textComposerEngine = "textOptycaComposer";
        paragraphRange.paragraphStyle = bakedStyle;
        paragraphRanges[p] = paragraphRange;
      }
      directionBaked = true;
    }

    // Non-point layers are measured in an oversized box right after the text
    // lands; putting that box in the same set call skips one relayout with
    // the stale retained bounds in between. Only needed when the text itself
    // changes — a style-only apply keeps the same line breaks, and skipping
    // the measure pass there keeps it as fast as the legacy path.
    var boxShapeRef = newTextParams.layerText.textShape && newTextParams.layerText.textShape[0];
    var measureBoxBounds = null;
    if (!isPoint && boxShapeRef && boxShapeRef.bounds && dataText) {
      var measureSpan = _getMeasureBoxSpanPoints();
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
      jamText.setLayerText(newTextParams);
    } catch (setError) {
      if (!directionBaked) throw setError;
      // Some Photoshop versions reject directionType/textComposerEngine in a
      // plain set: strip them, retry, then use the legacy post-set pass
      for (var q = 0; q < newTextParams.layerText.paragraphStyleRange.length; q++) {
        var retryStyle = newTextParams.layerText.paragraphStyleRange[q].paragraphStyle || {};
        delete retryStyle.directionType;
        delete retryStyle.textComposerEngine;
      }
      jamText.setLayerText(newTextParams);
      _applyTextDirection(userDirection, targetTextLength);
    }
    _applyMiddleEast(newTextParams.layerText.textStyleRange[0].textStyle);
    if (dataStyle && dataStyle.stroke) {
      _setLayerStroke(dataStyle.stroke);
    }
    if (targetPoint) {
      _changeToPointText();
    } else {
      var textSize = 12;
      var styleSize = dataStyle && dataStyle.textProps.layerText.textStyleRange[0].textStyle.size;
      if (styleSize != null) {
        textSize = styleSize;
      } else if (oldTextParams.layerText.textStyleRange && oldTextParams.layerText.textStyleRange[0] && oldTextParams.layerText.textStyleRange[0].textStyle.size != null) {
        textSize = oldTextParams.layerText.textStyleRange[0].textStyle.size;
      }
      var boxShape = newTextParams.layerText.textShape && newTextParams.layerText.textShape[0];
      var boxFitted = false;
      if (boxShape && boxShape.bounds && measureBoxBounds) {
        // The retained box can be narrower than the new longest line, which
        // makes Photoshop soft-wrap it and break the intended line shape.
        // The layer already sits in the oversized measuring box from the main
        // set call: read the real text extent and shrink the box around it.
        try {
          var textExtent = _getCurrentTextLayerBounds();
          if (textExtent.width > 0 && textExtent.height > 0) {
            var widthPadding = Math.max(2, textSize * 0.4);
            boxShape.bounds.right = measureBoxBounds.left + _convertPixelToPointExact(textExtent.width) + widthPadding;
            boxShape.bounds.bottom = measureBoxBounds.top + _convertPixelToPointExact(textExtent.height) + textSize + 2;
            jamText.setLayerText({ layerText: { textShape: [boxShape] } });
            boxFitted = true;
          }
        } catch (fitError) {}
      }
      if (!boxFitted && boxShape) {
        // Fallback: restore the retained box and only grow its height. The
        // restore set is only needed when a measure box was actually applied;
        // on a style-only apply the layer still holds the retained box.
        if (measureBoxBounds) {
          boxShape.bounds.right = measureBoxBounds.right;
          boxShape.bounds.bottom = measureBoxBounds.bottom;
          jamText.setLayerText({ layerText: { textShape: newTextParams.layerText.textShape } });
        }
        var fallbackBounds = _getCurrentTextLayerBounds();
        boxShape.bounds.bottom = _convertPixelToPoint(fallbackBounds.height + textSize + 2);
        jamText.setLayerText({ layerText: { textShape: newTextParams.layerText.textShape } });
      }
    }
    var newBounds = _getCurrentTextLayerBounds();
    if (!oldBounds.bottom) oldBounds = newBounds;
    var offsetX = oldBounds.xMid - newBounds.xMid;
    var offsetY = oldBounds.yMid - newBounds.yMid;
    if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
  });

  state.result = "";
}

// Lean text-only apply for TextShapeR: the panel already holds a full style
// snapshot of the layer (read when it was selected), so this path skips the
// expensive jamText.getLayerText() re-read, the Middle-East override actions,
// and the stroke re-apply — none of them can have changed since only the
// line breaking changes. Point text also skips both box conversions since it
// can never soft-wrap: one relayout instead of four.
function _setTextShapeRText() {
  var state = _hostState.setTextShapeRText;
  var payload = state.data;
  state.result = "";
  if (!payload) {
    return;
  } else if (!documents.length) {
    state.result = "doc";
    return;
  } else if (!_layerIsTextLayer()) {
    state.result = "layer";
    return;
  }
  var convertedToPoint = false;
  try {
    var resolvedStyle = _resolveStyleSizeForDocument(_clone(payload.style));
    var snapshot = resolvedStyle.textProps;
    var dataText = payload.text;
    var oldBounds = _getCurrentTextLayerBounds();
    var isPoint = _textLayerIsPointText();
    // Size, leading and auto-leading are read on the layer right before the
    // write: applying a shape must never change the text size
    var liveParams = null;
    try {
      liveParams = jamText.getLayerText();
    } catch (liveReadError) {}

    var newTextParams = { layerText: { textKey: _normalizeTextKey(dataText) } };
    var baseRange = _clone(snapshot.layerText.textStyleRange[0]);
    baseRange.from = 0;
    baseRange.to = dataText.length;
    newTextParams.layerText.textStyleRange = [baseRange];

    var snapshotParagraph = snapshot.layerText.paragraphStyleRange && snapshot.layerText.paragraphStyleRange[0];
    var oldParagraphStyle = (snapshotParagraph && snapshotParagraph.paragraphStyle) || {};
    var newParagraphStyle = {};
    for (var propIndex = 0; propIndex < _SAFE_PARAGRAPH_PROPS.length; propIndex++) {
      var prop = _SAFE_PARAGRAPH_PROPS[propIndex];
      if (oldParagraphStyle[prop] !== undefined) {
        newParagraphStyle[prop] = oldParagraphStyle[prop];
      }
    }
    newTextParams.layerText.paragraphStyleRange = [{ from: 0, to: dataText.length, paragraphStyle: newParagraphStyle }];

    _applyRichTextRanges(newTextParams, payload.richTextRuns, dataText.length);

    // Carried over verbatim: dropping these made Photoshop reinterpret the
    // size unit (text size jumps) and reset the anti-aliasing mode
    newTextParams.layerText.antiAlias = snapshot.layerText.antiAlias || "antiAliasSmooth";
    newTextParams.typeUnit = snapshot.typeUnit;
    _keepLiveTextSize(newTextParams, liveParams, _getDocumentResolution());

    var userDirection = payload.direction;
    if (userDirection === "") userDirection = null;
    var directionBaked = false;
    if (userDirection) {
      var psDirection = userDirection === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
      var paragraphRanges = newTextParams.layerText.paragraphStyleRange;
      for (var p = 0; p < paragraphRanges.length; p++) {
        var paragraphRange = paragraphRanges[p] || {};
        var bakedStyle = paragraphRange.paragraphStyle || {};
        bakedStyle.directionType = psDirection;
        bakedStyle.textComposerEngine = "textOptycaComposer";
        paragraphRange.paragraphStyle = bakedStyle;
        paragraphRanges[p] = paragraphRange;
      }
      directionBaked = true;
    }

    // Box layers hop through point text for the swap: point text never
    // soft-wraps so no measuring box is needed, and converting back to box
    // rebuilds a box fitted around the new text automatically — that kills
    // both the giant measure box and the second fitting relayout
    if (!isPoint) {
      _changeToPointText();
      convertedToPoint = true;
    }

    try {
      jamText.setLayerText(newTextParams);
    } catch (setError) {
      if (!directionBaked) throw setError;
      for (var q = 0; q < newTextParams.layerText.paragraphStyleRange.length; q++) {
        var retryStyle = newTextParams.layerText.paragraphStyleRange[q].paragraphStyle || {};
        delete retryStyle.directionType;
        delete retryStyle.textComposerEngine;
      }
      jamText.setLayerText(newTextParams);
    }

    if (convertedToPoint) {
      _changeToBoxText();
      convertedToPoint = false;
    }

    var newBounds = _getCurrentTextLayerBounds();
    if (!oldBounds.bottom) oldBounds = newBounds;
    var offsetX = oldBounds.xMid - newBounds.xMid;
    var offsetY = oldBounds.yMid - newBounds.yMid;
    if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
    state.result = "";
  } catch (leanError) {
    // Restore the layer kind first so the fallback sees the original state
    if (convertedToPoint) {
      try {
        _changeToBoxText();
      } catch (revertError) {}
    }
    // Any surprise (stale snapshot, unexpected layer state) falls back to
    // the battle-tested full apply path within the same history state
    // and still keeps the layer's current size
    payload.preserveActiveTextSize = true;
    _hostState.setActiveLayerText.data = payload;
    _setActiveLayerText();
    state.result = _hostState.setActiveLayerText.result;
  }
}

function setTextShapeRLayerText(data) {
  var valid = data && data.text && data.style && data.style.textProps && data.style.textProps.layerText &&
    data.style.textProps.layerText.textStyleRange && data.style.textProps.layerText.textStyleRange[0];
  if (!valid) return setActiveLayerText(data);
  if (!documents.length) return "doc";
  var state = _hostState.setTextShapeRText;
  state.data = data;
  state.result = "";
  // Same history state name as the classic apply so undoLastTyperChange works
  app.activeDocument.suspendHistory("TyperTools Change", "_setTextShapeRText()");
  return state.result;
}

function _createTextLayerInSelection() {
  var state = _hostState.createTextLayerInSelection;
  if (!documents.length) {
    state.result = "doc";
    return;
  }
  if (state.data.preserveActiveTextSize) {
    if (!_layerIsTextLayer()) {
      state.result = "sizeSource";
      return;
    }
    state.data.textSizeOverride = _getTextLayerSize();
  }
  
  var selection = _checkSelection({ adaptiveOpen: true });
  if (selection.error) {
    state.result = selection.error;
    return;
  }
  var dimensions = _calculateSelectionDimensions(selection, state.padding);
  _createAndSetLayerText(state.data, dimensions.width, dimensions.height);
  var bounds = _getCurrentTextLayerBounds();
  if (state.point) {
    _changeToPointText();
  } else {
    _resizeTextBoxToContent(dimensions.width, bounds);
  }
  bounds = _getCurrentTextLayerBounds();
  _positionLayerWithinSelection(selection, bounds);
  if (_autoCenterEnabled(state.data)) {
    _autoCenterCreated([_safeActiveLayerId()], {
      autoCenter: state.data.autoCenter,
      resizeTextBox: state.data.resizeTextBox,
      padding: state.padding,
    });
  }
  state.result = "";
}

function _alignCurrentTextLayerToSelection() {
  var state = _hostState.alignTextLayerToSelection;
  if (!_layerIsTextLayer()) {
    return "layer";
  }
  
  var selection = _checkSelection({ adaptiveOpen: true });
  if (selection.error) {
    if (selection.error === "noSelection") {
      _createMagicWandSelection(20);
      selection = _checkSelection({ adaptiveOpen: true });
    }
    if (selection.error) {
      return selection.error;
    }
  }
  var wasPoint = _textLayerIsPointText();
  var bounds = _getCurrentTextLayerBounds();

  if (state.resize && !wasPoint) {
    var dimensions = _calculateSelectionDimensions(selection, state.padding);
    _setTextBoxSize(dimensions.width, dimensions.height);
    var textBounds = _getCurrentTextLayerBounds();
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

function _alignTextLayerToSelection() {
  var state = _hostState.alignTextLayerToSelection;
  if (!documents.length) {
    state.result = "doc";
    return;
  }

  var alignedCount = 0;
  var firstError = "";
  var selectedCount = _forEachSelectedLayer(function () {
    var result = _alignCurrentTextLayerToSelection();
    if (result) {
      if (!firstError) firstError = result;
      return;
    }
    alignedCount++;
  });

  if (!selectedCount) {
    firstError = _alignCurrentTextLayerToSelection();
    if (!firstError) alignedCount++;
  }

  state.result = alignedCount > 0 ? "" : firstError;
}

function _changeActiveLayerTextSize() {
  var state = _hostState.changeActiveLayerTextSize;
  if (!documents.length) {
    state.result = "doc";
    return;
  } else if (!_layerIsTextLayer()) {
    state.result = "layer";
    return;
  } else if (!state.value) {
    state.result = "";
    return;
  }

  var resolution = _getDocumentResolution();
  var resized = 0;
  var failure = "";
  _forEachSelectedLayer(function () {
    var oldBox = null;
    try {
      oldBox = _currentLayerBox();
    } catch (boxError) {}
    var textParams = null;
    try {
      textParams = jamText.getLayerText();
    } catch (readError) {}
    // No readable displayed size: keep the historical raw delta on the stored size
    var plan = textParams ? _textResizePlan(textParams, state.value, resolution) : null;
    var sizeBefore = _readTextStyleSize();
    var fast = false;
    if (!plan || plan.uniform) {
      try {
        _resizeTextStyleFast(plan, state.value);
        fast = true;
      } catch (fastError) {}
    }
    if (!fast) {
      try {
        if (!textParams) textParams = jamText.getLayerText();
      } catch (rereadError) {
        failure = "layer";
        return;
      }
      if (!_resizeTextRebuild(textParams, plan, state.value)) {
        failure = "layer";
        return;
      }
    }
    if (plan && plan.frame) {
      // The fast path leaves the frame as it was; the rebuild wrote it with
      // the planned ratio
      try {
        _fitFrameToTextSize(plan, sizeBefore, fast ? null : plan.ratio, textParams.typeUnit);
      } catch (frameError) {}
    }
    _recentreOnBox(oldBox);
    resized++;
  });

  state.result = resized > 0 ? "" : failure;
}

// Size of the layer's text style, as the fast path reads and writes it
function _readTextStyleSize() {
  try {
    var ref = new ActionReference();
    ref.putProperty(charID.Property, charID.TextStyle);
    ref.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
    var descriptor = executeActionGet(ref);
    if (!descriptor.hasKey(charID.TextStyle)) return null;
    var textStyle = descriptor.getObjectValue(charID.TextStyle);
    if (!textStyle.hasKey(charID.Size)) return null;
    return { value: textStyle.getUnitDoubleValue(charID.Size), unit: textStyle.getUnitDoubleType(charID.Size) };
  } catch (sizeError) {
    return null;
  }
}

// Fast path: one "set textStyle" action on the whole layer. With a plan the
// stored size (and a shared fixed leading) follow the plan ratio, in the
// descriptor's own unit; without one the raw delta is added as before.
function _resizeTextStyleFast(plan, delta) {
  var current = _readTextStyleSize();
  if (!current) throw new Error("no textStyle");
  var newSize = plan ? current.value * plan.ratio : current.value + delta;
  if (!(newSize > 0)) throw new Error("bad size");

  var newTextStyle = new ActionDescriptor();
  newTextStyle.putUnitDouble(charID.Size, current.unit, newSize);
  if (plan && plan.scaleLeading) {
    var leadingKey = stringIDToTypeID("leading");
    var ref = new ActionReference();
    ref.putProperty(charID.Property, charID.TextStyle);
    ref.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
    var textStyle = executeActionGet(ref).getObjectValue(charID.TextStyle);
    if (textStyle.hasKey(leadingKey)) {
      var currentLeading = textStyle.getUnitDoubleValue(leadingKey);
      if (currentLeading > 0) {
        newTextStyle.putUnitDouble(leadingKey, textStyle.getUnitDoubleType(leadingKey), currentLeading * plan.ratio);
      }
    }
  }

  var descriptor = new ActionDescriptor();
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextStyle);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  descriptor.putReference(charID.Null, reference);
  descriptor.putObject(charID.To, charID.TextStyle, newTextStyle);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

// Fallback: rewrite the layer through jamText. Every run keeps its own style
// and scales by the same ratio, and so does a box frame. Returns false when
// the layer has no text to rebuild.
function _resizeTextRebuild(oldTextParams, plan, delta) {
  var oldLayerText = oldTextParams && oldTextParams.layerText;
  var text = oldLayerText ? _normalizeTextKey(oldLayerText.textKey) : "";
  if (!text || !oldLayerText.textStyleRange || !oldLayerText.textStyleRange.length) return false;
  var firstSize = Number(oldLayerText.textStyleRange[0].textStyle && oldLayerText.textStyleRange[0].textStyle.size);
  var ratio = plan ? plan.ratio : (firstSize > 0 ? Math.max(0.1, firstSize + delta) / firstSize : 1);
  var newTextParams = {
    typeUnit: oldTextParams.typeUnit,
    layerText: {
      textKey: text,
      textGridding: oldLayerText.textGridding || "none",
      orientation: oldLayerText.orientation || "horizontal",
      antiAlias: oldLayerText.antiAlias || "antiAliasSmooth",
      textStyleRange: [],
    },
  };
  for (var i = 0; i < oldLayerText.textStyleRange.length; i++) {
    var range = _clone(oldLayerText.textStyleRange[i]);
    var style = range.textStyle || {};
    var size = Number(style.size);
    if (size > 0) style.size = Math.max(0.1, size * ratio);
    if (style.autoLeading || style.leading === undefined) {
      style.autoLeading = true;
      delete style.leading;
    } else {
      style.leading = Math.max(0.1, Number(style.leading) * ratio);
      style.autoLeading = false;
    }
    delete style.impliedFontSize;
    delete style.impliedLeading;
    delete style.impliedBaselineShift;
    range.textStyle = style;
    if (range.to > text.length) range.to = text.length;
    newTextParams.layerText.textStyleRange.push(range);
  }
  newTextParams.layerText.textStyleRange[newTextParams.layerText.textStyleRange.length - 1].to = text.length;
  if (oldLayerText.paragraphStyleRange && oldLayerText.paragraphStyleRange[0]) {
    var paragraphRange = _clone(oldLayerText.paragraphStyleRange[0]);
    var oldParStyle = paragraphRange.paragraphStyle || {};
    oldParStyle.textEveryLineComposer = oldParStyle.textEveryLineComposer || false;
    oldParStyle.burasagari = oldParStyle.burasagari || "burasagariNone";
    paragraphRange.paragraphStyle = oldParStyle;
    paragraphRange.to = text.length;
    newTextParams.layerText.paragraphStyleRange = [paragraphRange];
  }
  var frame = _scaleTextShape(plan ? plan.frame : (oldLayerText.textShape && oldLayerText.textShape[0]), ratio);
  if (frame) newTextParams.layerText.textShape = [frame];
  jamText.setLayerText(newTextParams);
  _applyMiddleEast(newTextParams.layerText.textStyleRange[0].textStyle);
  return true;
}

// A box frame keeps its proportion to the text: the frame from before the
// change times the size ratio Photoshop really applied. No padding is added,
// so a + then a - puts the frame back where it was, and a full line does not
// re-wrap since text and frame scale together. `writtenRatio`: the ratio the
// frame was already written with (null when it was not written).
function _fitFrameToTextSize(plan, sizeBefore, writtenRatio, typeUnit) {
  var ratio = _appliedSizeRatio(sizeBefore, _readTextStyleSize(), plan.ratio);
  if (writtenRatio !== null && Math.abs(ratio - writtenRatio) < 1e-9) return;
  var frame = _scaleTextShape(plan.frame, ratio);
  if (!frame) return;
  var params = { layerText: { textShape: [frame] } };
  if (typeUnit) params.typeUnit = typeUnit;
  jamText.setLayerText(params);
}

// Put the layer's centre back where it was before the resize
function _recentreOnBox(oldBox) {
  if (!oldBox) return;
  var newBox = null;
  try {
    newBox = _currentLayerBox();
  } catch (boxError) {}
  if (!newBox) return;
  var offsetX = oldBox.xMid - newBox.xMid;
  var offsetY = oldBox.yMid - newBox.yMid;
  if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
}

function _changeSize_alt() {
  var increasing = _hostState.changeActiveLayerTextSize.value > 0;
  _forEachSelectedLayer(function () {
    var a = new ActionReference();
    a.putProperty(charID.Property, charID.Text);
    a.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    var currentLayer = executeActionGet(a);
    if (currentLayer.hasKey(charID.Text)) {
      var settings = currentLayer.getObjectValue(charID.Text);
      var textStyleRange = settings.getList(charID.TextStyleRange);
      var sizes = [];
      var units = [];
      var proceed = true;
      for (var i = 0; i < textStyleRange.count; i++) {
        var style = textStyleRange.getObjectValue(i).getObjectValue(charID.TextStyle);
        sizes[i] = style.getDouble(charID.Size);
        units[i] = style.getUnitDoubleType(charID.Size);
        if (i > 0 && (sizes[i] !== sizes[i - 1] || units[i] !== units[i - 1])) {
          proceed = false;
          break;
        }
      }
      var amount = 0.2; // mm
      if (units[0] === charID.PixelUnit) amount = 1; // pixel
      else if (units[0] === 592473716) amount = 0.5; // point
      if (!increasing) amount *= -1;
      if (proceed) {
        var aa = new ActionDescriptor();
        var d = new ActionReference();
        d.putProperty(charID.Property, charID.TextStyle);
        d.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
        aa.putReference(charID.Null, d);
        var e = new ActionDescriptor();
        e.putUnitDouble(charID.Size, units[0], sizes[0] + amount);
        aa.putObject(charID.To, charID.TextStyle, e);
        executeAction(charID.Set, aa, DialogModes.NO);
      }
    }
  });
  _hostState.changeActiveLayerTextSize.result = "";
}

/* ======================================================== */
/* ==================== public methods ==================== */
/* ======================================================== */

function nativeAlert(data) {
  if (!data) return "";
  alert(data.text, data.title, data.isError);
}

function nativeConfirm(data) {
  if (!data) return "";
  var result = confirm(data.text, false, data.title);
  return result ? "1" : "";
}

function getUserFonts() {
  var fontsArr = [];
  for (var i = 0; i < app.fonts.length; i++) {
    var font = app.fonts[i];
    fontsArr.push({
      name: font.name,
      postScriptName: font.postScriptName,
      family: font.family,
      style: font.style,
    });
  }
  return jamJSON.stringify({
    fonts: fontsArr,
  });
}

function reloadUserFonts() {
  // app.fonts is built once at startup; refreshFonts() (CC 2015+) makes
  // Photoshop rescan the system so freshly installed fonts appear without a
  // restart. Only called after an explicit install action — the rescan
  // briefly blocks the host.
  try {
    app.refreshFonts();
  } catch (e) {
    // Older hosts without refreshFonts still return the current list.
  }
  return getUserFonts();
}

var frontmostCheckCache = { time: 0, front: true };

function isHostAppFrontmost() {
  // ScriptUI.environment.keyboardState reports the system-wide keyboard
  // state, so hotkeys would fire even while another app is focused. There is
  // no ExtendScript API for the foreground app, so shell out on macOS.
  if ($.os && $.os.indexOf("Windows") === 0) return true;
  var now = new Date().getTime();
  if (now - frontmostCheckCache.time < 300) return frontmostCheckCache.front;
  var front = true;
  try {
    front = app.system('lsappinfo info -only name `lsappinfo front` 2>/dev/null | grep -qi photoshop') === 0;
  } catch (e) {
    front = true;
  }
  frontmostCheckCache.time = now;
  frontmostCheckCache.front = front;
  return front;
}

function getHotkeyPressed() {
  var state = ScriptUI.environment.keyboardState;
  var string = "a";

  if (state.metaKey) {
    string += "WINa";
  }
  if (state.ctrlKey) {
    string += "CTRLa";
  }
  if (state.altKey) {
    string += "ALTa";
  }
  if (state.shiftKey) {
    string += "SHIFTa";
  }
  if (state.keyName) {
    string += state.keyName.toUpperCase() + "a";
  }
  if (string !== "a" && !isHostAppFrontmost()) {
    return "a";
  }
  return string;
}

function getActiveLayerText() {
  if (!documents.length) {
    return "";
  }
  // ActionManager only: touching activeDocument.activeLayer through the DOM
  // collapses a multi-layer selection down to a single layer
  if (!_layerIsTextLayer()) {
    return "";
  }
  var layerId = null;
  try {
    var layerIdProp = stringIDToTypeID("layerID");
    var idRef = new ActionReference();
    idRef.putProperty(charID.Property, layerIdProp);
    idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    layerId = executeActionGet(idRef).getInteger(layerIdProp);
  } catch (idError) {}
  // Rendered pixel bounds let the panel calibrate its text measurements
  // against real pixels (TextShapeR bubble-fit)
  var bounds = null;
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {}
  var stroke = null;
  try {
    stroke = _getLayerStroke();
  } catch (strokeError) {}
  return jamJSON.stringify({
    layerId: layerId,
    bounds: bounds,
    textType: _textLayerIsPointText() ? "point" : "paragraph",
    textProps: jamText.getLayerText(),
    stroke: stroke,
  });
}

function _getRenderedTextLines() {
  var state = _hostState.getRenderedTextLines;
  var originalId = null;
  try {
    originalId = _getActiveLayerId();
  } catch (idError) {}
  var duplicated = false;
  try {
    // Converting box text to point text makes Photoshop materialize its
    // automatic wraps as hard returns — the only scriptable way to read the
    // rendered line breaks. Done on a throwaway duplicate so the original
    // layer is never modified.
    _duplicateActiveLayer();
    duplicated = true;
    _changeToPointText();
    var textParams = jamText.getLayerText();
    if (textParams && textParams.layerText && typeof textParams.layerText.textKey === "string") {
      state.result = textParams.layerText.textKey;
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
}

// Text of the active layer with the line breaks it actually renders with:
// point text already holds every break in textKey, while box (paragraph)
// text needs the duplicate-and-convert pass above to expose its wraps
function getRenderedTextLines() {
  if (!documents.length || !_layerIsTextLayer()) {
    return jamJSON.stringify({ error: "layer" });
  }
  if (_textLayerIsPointText()) {
    var textParams = jamText.getLayerText();
    var text = textParams && textParams.layerText ? textParams.layerText.textKey : "";
    return jamJSON.stringify({ text: text || "" });
  }
  var state = _hostState.getRenderedTextLines;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Read Shape", "_getRenderedTextLines()");
  return jamJSON.stringify({ text: state.result });
}

function _collectTextLayerIds(container, ids, limit) {
  for (var index = 0; index < container.layers.length; index++) {
    if (ids.length >= limit) return;
    var layer = container.layers[index];
    if (layer.typename === "LayerSet") {
      _collectTextLayerIds(layer, ids, limit);
    } else if (layer.kind === LayerKind.TEXT && layer.visible) {
      ids.push(layer.id);
    }
  }
}

function _getAllRenderedTextLines() {
  var state = _hostState.getAllRenderedTextLines;
  var originalId = null;
  try {
    originalId = _getActiveLayerId();
  } catch (idError) {}
  // Bubble scans only run in the precise mode, and they destroy the current
  // selection: never sacrifice one the user drew — without a selection at
  // batch start, scans are free to run
  var canScanBubbles = false;
  if (state.scanBubbles) {
    try {
      canScanBubbles = !_getCurrentSelectionBounds();
    } catch (selectionError) {}
  }
  var ids = [];
  try {
    _collectTextLayerIds(app.activeDocument, ids, 80);
  } catch (collectError) {}
  var entries = [];
  for (var index = 0; index < ids.length; index++) {
    try {
      _selectLayerById(ids[index]);
      if (!_layerIsTextLayer()) continue;
      // Re-detect the bubble around this layer (same wand scan as the
      // bubble-aware mode) so each learned exemplar keeps its outline context
      var bubble = null;
      if (canScanBubbles) {
        try {
          var scan = _scanActiveLayerBubble(20, 17);
          if (scan && !scan.error && scan.bounds && scan.rows && scan.rows.length) {
            bubble = { rows: scan.rows, width: scan.bounds.width, height: scan.bounds.height };
          }
        } catch (bubbleScanError) {}
      }
      var text = "";
      if (_textLayerIsPointText()) {
        var textParams = jamText.getLayerText();
        text = textParams && textParams.layerText ? textParams.layerText.textKey : "";
      } else {
        // Same duplicate-and-convert trick as the single-layer read: box
        // text only exposes its automatic wraps once converted to point text
        var duplicated = false;
        try {
          _duplicateActiveLayer();
          duplicated = true;
          _changeToPointText();
          var dupParams = jamText.getLayerText();
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
      if (text) entries.push({ text: text, bubble: bubble });
    } catch (layerError) {}
  }
  if (originalId !== null) {
    try {
      _selectLayerById(originalId);
    } catch (selectError) {}
  }
  state.result = jamJSON.stringify({ entries: entries });
}

// Rendered text of every visible text layer in the document, automatic box
// wraps included: fuels the "learn from the whole page" batch feedback.
// data.scanBubbles re-detects each layer's bubble outline (slower, precise).
function getAllRenderedTextLines(data) {
  if (!documents.length) {
    return jamJSON.stringify({ error: "document" });
  }
  var state = _hostState.getAllRenderedTextLines;
  state.scanBubbles = !!(data && data.scanBubbles);
  state.result = jamJSON.stringify({ entries: [] });
  app.activeDocument.suspendHistory("TyperTools Read Shapes", "_getAllRenderedTextLines()");
  return state.result;
}

// Training reads run on a disposable document. Existing PSDs, their layer
// selections, pixel selections and history must remain untouched.
function _collectTrainingTextLayers(container, entries, parentPath, parentVisible) {
  for (var index = 0; index < container.layers.length; index++) {
    var layer = container.layers[index];
    var layerPath = parentPath ? parentPath + " / " + layer.name : layer.name;
    var visible = parentVisible && layer.visible;
    if (layer.typename === "LayerSet") {
      _collectTrainingTextLayers(layer, entries, layerPath, visible);
    } else if (layer.kind === LayerKind.TEXT) {
      entries.push({ layerId: layer.id, name: layer.name, layerPath: layerPath, visible: visible });
    }
  }
}

function _readTextShapeRTrainingLayers() {
  var state = _hostState.textShapeRTraining;
  var entries = [];
  _collectTrainingTextLayers(app.activeDocument, entries, "", true);
  for (var index = 0; index < entries.length; index++) {
    var entry = entries[index];
    entry.text = "";
    try {
      _selectLayerById(entry.layerId);
      if (_textLayerIsPointText()) {
        var params = jamText.getLayerText();
        entry.text = params && params.layerText ? params.layerText.textKey || "" : "";
      } else {
        _hostState.getRenderedTextLines.result = "";
        _getRenderedTextLines();
        entry.text = _hostState.getRenderedTextLines.result || "";
        if (!entry.text) entry.error = "readFailed";
      }
    } catch (readError) {
      entry.error = "readFailed";
    }
  }
  state.entries = entries;
}

// An empty path means the current page, including unsaved edits. A supplied
// path reuses the open document when present, otherwise opens it without saving.
function scanTextShapeRTraining(path) {
  var previousDoc = null;
  var source = null;
  var workDoc = null;
  var file = null;
  var saveDialogs = app.displayDialogs;
  try { previousDoc = app.activeDocument; } catch (noDocument) {}
  try {
    if (path) {
      if (!/\.psd$/i.test(path)) return jamJSON.stringify({ error: "badPath" });
      file = new File(path);
      if (!file.exists) return jamJSON.stringify({ error: "notFound" });
      for (var index = 0; index < app.documents.length; index++) {
        try {
          if (app.documents[index].fullName.fsName === file.fsName) {
            source = app.documents[index];
            break;
          }
        } catch (unsavedDocument) {}
      }
    } else {
      source = previousDoc;
      if (!source) return jamJSON.stringify({ error: "document" });
    }
    app.displayDialogs = DialogModes.NO;
    if (source) {
      app.activeDocument = source;
      workDoc = source.duplicate("TypeR Training Preview", false);
    } else {
      workDoc = app.open(file);
    }
    app.activeDocument = workDoc;
    _hostState.textShapeRTraining = { entries: [] };
    workDoc.suspendHistory("TypeR Read Training", "_readTextShapeRTrainingLayers()");
    return jamJSON.stringify({ entries: _hostState.textShapeRTraining.entries });
  } catch (scanError) {
    return jamJSON.stringify({ error: "scanFailed" });
  } finally {
    if (workDoc) {
      try { workDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) {}
    }
    if (previousDoc) {
      try { app.activeDocument = previousDoc; } catch (restoreError) {}
    }
    app.displayDialogs = saveDialogs;
    _hostState.textShapeRTraining = null;
  }
}

function setActiveLayerText(data) {
  var state = _hostState.setActiveLayerText;
  state.data = data;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Change", "_setActiveLayerText()");
  return state.result;
}

function _setSelectedTextLayers() {
  var state = _hostState.setSelectedTextLayers;
  var items = state.data && state.data.items ? state.data.items : [];
  var requestedRestoreIds = state.data && state.data.restoreLayerIds
    ? state.data.restoreLayerIds
    : [];
  var restoreIds = [];
  state.result = "";

  if (!documents.length) {
    state.result = "doc";
    return;
  }
  if (items.length < 2) {
    state.result = "layer";
    return;
  }

  var restoreSource = requestedRestoreIds.length ? requestedRestoreIds : items;
  for (var restoreIndex = 0; restoreIndex < restoreSource.length; restoreIndex++) {
    var restoreValue = requestedRestoreIds.length
      ? restoreSource[restoreIndex]
      : restoreSource[restoreIndex].layerId;
    var restoreId = parseInt(restoreValue, 10);
    if (!isNaN(restoreId)) restoreIds.push(restoreId);
  }

  // Validate every target before changing any layer. The history rollback in
  // setSelectedTextLayers remains the safety net for errors raised while the
  // text/style is actually being applied.
  for (var validateIndex = 0; validateIndex < items.length; validateIndex++) {
    var validateId = parseInt(items[validateIndex].layerId, 10);
    if (isNaN(validateId)) {
      state.result = "layer";
      break;
    }
    try {
      _selectLayerById(validateId);
      if (!_layerIsTextLayer() || app.activeDocument.activeLayer.allLocked) {
        state.result = "layer";
        break;
      }
    } catch (validateError) {
      state.result = "scriptError: " +
        (validateError && validateError.message ? validateError.message : validateError);
      break;
    }
  }

  if (state.result) {
    if (restoreIds.length) {
      try {
        _selectLayersById(restoreIds);
      } catch (validateRestoreError) {}
    }
    return;
  }

  for (var i = 0; i < items.length; i++) {
    var layerId = parseInt(items[i].layerId, 10);
    if (isNaN(layerId)) {
      state.result = "layer";
      break;
    }
    try {
      _selectLayerById(layerId);
      if (!_layerIsTextLayer()) {
        state.result = "layer";
        break;
      }
      _hostState.setActiveLayerText.data = items[i];
      _hostState.setActiveLayerText.result = "";
      _setActiveLayerText();
      if (_hostState.setActiveLayerText.result) {
        state.result = _hostState.setActiveLayerText.result;
        break;
      }
    } catch (applyError) {
      state.result = "scriptError: " + (applyError && applyError.message ? applyError.message : applyError);
      break;
    }
  }

  if (restoreIds.length) {
    try {
      _selectLayersById(restoreIds);
    } catch (restoreError) {}
  }
}

function setSelectedTextLayers(data) {
  var state = _hostState.setSelectedTextLayers;
  state.data = data;
  state.result = "";
  if (!documents.length) return "doc";
  var originalHistoryState = null;
  try {
    originalHistoryState = app.activeDocument.activeHistoryState;
  } catch (historyReadError) {}
  app.activeDocument.suspendHistory("TyperTools Multiple Paste", "_setSelectedTextLayers()");
  if (state.result && originalHistoryState) {
    try {
      app.activeDocument.activeHistoryState = originalHistoryState;
    } catch (historyRollbackError) {}
    var restoreIds = data && data.restoreLayerIds ? data.restoreLayerIds : [];
    if (restoreIds.length) {
      try {
        _selectLayersById(restoreIds);
      } catch (rollbackRestoreError) {}
    }
  }
  return state.result;
}

function createTextLayerInSelection(data, point) {
  var state = _hostState.createTextLayerInSelection;
  state.data = data;
  state.point = point;
  state.padding = data.padding || 0;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Paste", "_createTextLayerInSelection()");
  return state.result;
}

function alignTextLayerToSelection(data) {
  var state = _hostState.alignTextLayerToSelection;
  state.resize = !!data.resizeTextBox;
  state.padding = data.padding || 0;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Align", "_alignTextLayerToSelection()");
  return state.result;
}

// Answers "" or an error code the panel translates: "doc",
// "doubleBubbleLayers", "doubleBubbleEmpty", "doubleBubbleNotFound", or
// "scriptError: ..." for anything Photoshop refused. A failed split leaves
// the document as it was.
function alignTextLayersToDoubleBubble(data) {
  var state = _hostState.alignTextLayersToDoubleBubble;
  state.resize = !!(data && data.resizeTextBox);
  state.padding = (data && data.padding) || 0;
  state.result = "";
  state.entries = null;
  if (!documents.length) return "doc";
  var entries = null;
  try {
    entries = _targetLayerEntries();
  } catch (entriesError) {
    entries = null;
  }
  if (!_doubleBubbleEntriesValid(entries)) return "doubleBubbleLayers";
  state.entries = entries;
  var doc = app.activeDocument;
  var previousHistory = null;
  try {
    previousHistory = doc.activeHistoryState;
  } catch (historyError) {}
  try {
    doc.suspendHistory("TyperTools Align Double", "_alignTextLayersToDoubleBubble()");
  } catch (e) {
    state.result = "scriptError: " + (e && e.message ? e.message : e);
  }
  if (state.result && previousHistory) {
    try {
      doc.activeHistoryState = previousHistory;
    } catch (rollbackError) {}
  }
  state.entries = null;
  return state.result;
}

function changeActiveLayerTextSize(val) {
  var state = _hostState.changeActiveLayerTextSize;
  state.value = val;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Resize", "_changeActiveLayerTextSize()");
  return state.result;
}

function getCurrentSelection() {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  var selection = _checkSelection({ adjustAmount: 0 });
  if (selection.error) {
    return jamJSON.stringify({ error: selection.error });
  }
  return jamJSON.stringify(selection);
}

function _buildBoundsShapeRows(bounds, sampleCount) {
  var rows = [];
  for (var i = 0; i < sampleCount; i++) {
    var y = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
    rows.push({
      y: y,
      left: 0,
      right: 1,
      width: 1,
    });
  }
  return {
    bounds: bounds,
    rows: rows,
    fallback: true,
  };
}

function _normalizeShapeSampleCount(value, fallback) {
  var sampleCount = value ? parseInt(value, 10) : fallback;
  if (isNaN(sampleCount)) sampleCount = fallback;
  if (sampleCount < 5) sampleCount = 5;
  if (sampleCount > 31) sampleCount = 31;
  return sampleCount;
}

function _sampleCurrentSelectionShape(bounds, sampleCount) {
  var doc = app.activeDocument;
  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) {
    return _buildBoundsShapeRows(bounds, sampleCount);
  }

  var rows = [];
  var oldUnits = app.preferences.rulerUnits;
  var canIntersect = true;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
    for (var i = 0; i < sampleCount; i++) {
      var yRatio = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
      var yMid = bounds.top + bounds.height * yRatio;
      var sliceHeight = Math.max(1, Math.ceil(bounds.height / sampleCount));
      var top = Math.max(bounds.top, Math.round(yMid - sliceHeight / 2));
      var bottom = Math.min(bounds.bottom, Math.round(yMid + sliceHeight / 2));
      if (bottom <= top) bottom = top + 1;

      try {
        doc.selection.select([
          [bounds.left, top],
          [bounds.right, top],
          [bounds.right, bottom],
          [bounds.left, bottom],
        ], SelectionType.REPLACE, 0, false);
        doc.selection.load(tempChannel, SelectionType.INTERSECT);
      } catch (sliceError) {
        canIntersect = false;
        break;
      }

      var span = _getCurrentSelectionBounds();
      if (span && span.width > 0) {
        rows.push({
          y: yRatio,
          left: Math.max(0, Math.min(1, (span.left - bounds.left) / bounds.width)),
          right: Math.max(0, Math.min(1, (span.right - bounds.left) / bounds.width)),
          width: Math.max(0, Math.min(1, span.width / bounds.width)),
        });
      } else {
        rows.push({
          y: yRatio,
          left: 0.5,
          right: 0.5,
          width: 0,
        });
      }
    }
  } catch (error) {
    canIntersect = false;
  } finally {
    try {
      doc.selection.load(tempChannel);
    } catch (restoreError) {}
    try {
      tempChannel.remove();
    } catch (removeError) {}
    app.preferences.rulerUnits = oldUnits;
  }

  if (!canIntersect || !rows.length) {
    return _buildBoundsShapeRows(bounds, sampleCount);
  }

  return {
    bounds: bounds,
    rows: rows,
    fallback: false,
  };
}

function _findWorkPath(doc) {
  try {
    for (var i = 0; i < doc.pathItems.length; i++) {
      if (doc.pathItems[i].kind === PathKind.WORKPATH) return doc.pathItems[i];
    }
  } catch (findError) {}
  return null;
}

function _readPathPolygons(pathItem) {
  var polygons = [];
  var subPaths = pathItem.subPathItems;
  for (var s = 0; s < subPaths.length; s++) {
    var points = subPaths[s].pathPoints;
    var count = points.length;
    if (count < 3) continue;
    // On noisy outlines (wand caught screentone) the point count explodes:
    // skip curve flattening there, the anchors alone are dense enough
    var flattenSteps = count > 500 ? 1 : 6;
    var poly = [];
    for (var i = 0; i < count; i++) {
      var current = points[i];
      var next = points[(i + 1) % count];
      var a = current.anchor;
      var c1 = current.rightDirection;
      var c2 = next.leftDirection;
      var b = next.anchor;
      var straight = c1[0] === a[0] && c1[1] === a[1] && c2[0] === b[0] && c2[1] === b[1];
      var steps = straight ? 1 : flattenSteps;
      for (var t = 0; t < steps; t++) {
        var u = t / steps;
        var v = 1 - u;
        poly.push([
          v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0],
          v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1],
        ]);
      }
    }
    if (poly.length >= 3) polygons.push(poly);
  }
  return polygons;
}

function _polygonScanlineSpan(polygons, y) {
  var minX = null;
  var maxX = null;
  for (var p = 0; p < polygons.length; p++) {
    var poly = polygons[p];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i];
      var b = poly[(i + 1) % poly.length];
      // Half-open rule so scanlines crossing a vertex count it exactly once
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        var x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        if (minX === null || x < minX) minX = x;
        if (maxX === null || x > maxX) maxX = x;
      }
    }
  }
  return minX === null ? null : { left: minX, right: maxX };
}

function _buildPathShapeRows(polygons, sampleCount) {
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  for (var p = 0; p < polygons.length; p++) {
    for (var i = 0; i < polygons[p].length; i++) {
      var point = polygons[p][i];
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
  }
  var width = maxX - minX;
  var height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;
  var sliceHeight = height / sampleCount;
  var rows = [];
  var covered = 0;
  for (var r = 0; r < sampleCount; r++) {
    var yRatio = sampleCount <= 1 ? 0.5 : r / (sampleCount - 1);
    var yMid = minY + height * yRatio;
    var left = null;
    var right = null;
    // The legacy sampler measured the widest extent inside each band: probe
    // three scanlines per band to keep the same behavior
    var offsets = [-sliceHeight / 2, 0, sliceHeight / 2];
    for (var k = 0; k < offsets.length; k++) {
      var y = yMid + offsets[k];
      if (y <= minY) y = minY + height * 0.002;
      if (y >= maxY) y = maxY - height * 0.002;
      var span = _polygonScanlineSpan(polygons, y);
      if (span) {
        if (left === null || span.left < left) left = span.left;
        if (right === null || span.right > right) right = span.right;
      }
    }
    if (left !== null && right > left) {
      covered++;
      rows.push({
        y: yRatio,
        left: Math.max(0, Math.min(1, (left - minX) / width)),
        right: Math.max(0, Math.min(1, (right - minX) / width)),
        width: Math.max(0, Math.min(1, (right - left) / width)),
      });
    } else {
      rows.push({ y: yRatio, left: 0.5, right: 0.5, width: 0 });
    }
  }
  if (!covered) return null;
  return rows;
}

// DOM errors pop modal alerts ("The command X is not available") unless
// dialogs are turned off for the run: scans must never surface a dialog
function _withDialogsSuppressed(fn) {
  var oldDialogs = null;
  try {
    oldDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
  } catch (dialogError) {
    oldDialogs = null;
  }
  var result = null;
  try {
    result = fn();
  } finally {
    if (oldDialogs !== null) {
      try {
        app.displayDialogs = oldDialogs;
      } catch (restoreError) {}
    }
  }
  return result;
}

function _makeWorkPathFromSelection(tolerance) {
  // Canonical source reference is property 'fsel' of class 'csel'; some
  // hosts accept it on 'Chnl' instead, so try both before giving up
  var sourceClasses = [charID.SelectionClass, charID.Channel];
  var lastError = null;
  for (var i = 0; i < sourceClasses.length; i++) {
    try {
      var desc = new ActionDescriptor();
      var pathRef = new ActionReference();
      pathRef.putClass(charID.Path);
      desc.putReference(charID.Null, pathRef);
      var fromRef = new ActionReference();
      fromRef.putProperty(sourceClasses[i], charID.FrameSelect);
      desc.putReference(charID.From, fromRef);
      desc.putUnitDouble(charID.Tolerance, charID.PixelUnit, tolerance);
      executeAction(charID.Make, desc, DialogModes.NO);
      return;
    } catch (makeError) {
      lastError = makeError;
    }
  }
  throw lastError;
}

function _deleteWorkPath() {
  var desc = new ActionDescriptor();
  var pathRef = new ActionReference();
  pathRef.putProperty(charID.Path, charID.WorkPath);
  desc.putReference(charID.Null, pathRef);
  executeAction(charID.Delete, desc, DialogModes.NO);
}

// Fast selection shape scan: one make-work-path call replaces the legacy
// 21x (rect select + channel intersect + bounds read) loop that kept
// Photoshop's UI thread busy long enough to flash the wait cursor.
// Rows are normalized against the path's own bounding box, so whatever
// unit path anchors are reported in cancels out.
// The active selection is snapshotted to a temp channel first: the path
// conversion consumes it, and both the caller (restoreSelection) and the
// legacy fallback need it back. Everything risky runs through ActionManager
// with DialogModes.NO - a host that refuses the path conversion fails
// silently into the legacy sampler instead of popping alerts, and after 3
// failures the fast path backs off for a while.
//
// The back-off is timed, not permanent: the legacy sampler costs ~60 Photoshop
// operations per scan against ~4 here, so a session that tripped the counter on
// three transient failures (a locked layer, a busy document, a scan racing an
// undo) used to stay 15x slower until Photoshop restarted - the single biggest
// cause of "TypeR gets slower the longer it runs". Retrying every few minutes
// costs one cheap probe and restores the fast path as soon as the host is happy
// again.
function _sampleSelectionShapeViaPath(bounds, sampleCount, restoreSelection) {
  if ((_hostState.pathScanFails || 0) >= 3) {
    var now = new Date().getTime();
    if (now - (_hostState.pathScanBackoffAt || 0) < _PATH_SCAN_RETRY_MS) return null;
    // Cooldown elapsed: allow one probe. A failure re-arms the back-off.
    _hostState.pathScanFails = 2;
  }
  var doc = app.activeDocument;
  // Never clobber a work path the user is keeping around
  if (_findWorkPath(doc)) return null;
  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) return null;
  var polygons = null;
  var failure = "";
  try {
    _makeWorkPathFromSelection(2.0);
  } catch (makeError) {
    failure = "make:" + String(makeError.message || makeError);
  }
  if (!failure) {
    var workPath = _findWorkPath(doc);
    if (workPath) {
      try {
        polygons = _readPathPolygons(workPath);
      } catch (readError) {
        failure = "read:" + String(readError.message || readError);
      }
      try {
        _deleteWorkPath();
      } catch (deleteError) {
        try {
          workPath.remove();
        } catch (domRemoveError) {}
      }
    } else {
      failure = "noWorkPath";
    }
  }
  var rows = null;
  if (!failure && polygons && polygons.length) {
    rows = _buildPathShapeRows(polygons, sampleCount);
    if (!rows) failure = "emptyRows";
  } else if (!failure) {
    failure = "noPolygons";
  }
  // The conversion consumed the selection: bring it back whenever the caller
  // wants it or the legacy fallback is about to need it
  if (restoreSelection || !rows) {
    try {
      doc.selection.load(tempChannel);
    } catch (loadError) {}
  }
  try {
    tempChannel.remove();
  } catch (removeError) {}
  if (!rows) {
    _hostState.pathScanFails = (_hostState.pathScanFails || 0) + 1;
    if (_hostState.pathScanFails >= 3) {
      _hostState.pathScanBackoffAt = new Date().getTime();
    }
    _hostState.lastPathScanError = failure;
    return null;
  }
  _hostState.pathScanFails = 0;
  _hostState.lastPathScanError = "";
  return {
    scan: "path",
    bounds: bounds,
    rows: rows,
    fallback: false,
  };
}

function getCurrentSelectionShape(data) {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  var bounds = _getCurrentSelectionBounds();
  if (!bounds) {
    return jamJSON.stringify({ error: "noSelection" });
  }
  var sampleCount = _normalizeShapeSampleCount(data && data.samples, 17);
  var shape = _withTemporaryHistory("TypeR Shape Scan", function () {
    return _withDialogsSuppressed(function () {
      return (
        _sampleSelectionShapeViaPath(bounds, sampleCount, true) ||
        _sampleCurrentSelectionShape(bounds, sampleCount)
      );
    });
  });
  if (shape && shape.error) return jamJSON.stringify(shape);
  shape = shape || _buildBoundsShapeRows(bounds, sampleCount);
  // scan/scanError lead the object so they survive the debug log preview cap
  var out = { scan: shape.scan || "legacy" };
  if (out.scan === "legacy" && _hostState.lastPathScanError) {
    out.scanError = _hostState.lastPathScanError;
  }
  out.bounds = shape.bounds;
  out.rows = shape.rows;
  out.fallback = shape.fallback;
  return jamJSON.stringify(out);
}

// Core wand scan around the active text layer, shared by the interactive
// bubble-aware mode and the batch learning pass. Destroys any selection:
// callers must ensure none exists, or accept losing it.
function _scanActiveLayerBubble(tolerance, sampleCount) {
  return _withDialogsSuppressed(function () {
    var scanResult = null;
    try {
      var textBounds = _getCurrentTextLayerBounds();
      _createMagicWandSelection(tolerance);
      var bounds = _getCurrentSelectionBounds();
      if (!bounds || bounds.width * bounds.height < 200) {
        _deselect();
        return { error: "noBubble" };
      }
      // A wand escaping the bubble (open outline, plain page background) grabs
      // a huge area: reject implausible bubbles instead of shaping to the page
      if (textBounds && textBounds.width > 0 && textBounds.height > 0) {
        var areaRatio = (bounds.width * bounds.height) / (textBounds.width * textBounds.height);
        if (areaRatio > 60) {
          _deselect();
          return { error: "noBubble" };
        }
      }
      // Close the text holes and smooth the outline before sampling
      var smoothAmount = Math.max(4, Math.round(_getTextLayerSize() / 2));
      _modifySelectionBounds(smoothAmount);
      var expanded = _getCurrentSelectionBounds();
      var contractAmount = _clampAdjustAmount(expanded, -smoothAmount);
      if (contractAmount !== 0) _modifySelectionBounds(contractAmount);
      bounds = _getCurrentSelectionBounds() || bounds;
      // The wand selection is ours and gets deselected right below, so the
      // fast path only restores it when the legacy fallback needs to run
      scanResult =
        _sampleSelectionShapeViaPath(bounds, sampleCount, false) ||
        _sampleCurrentSelectionShape(bounds, sampleCount);
    } catch (bubbleError) {
      scanResult = null;
    }
    try {
      _deselect();
    } catch (deselectError) {}
    return scanResult;
  });
}

function getActiveLayerBubbleShape(data) {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  if (!_layerIsTextLayer()) {
    return jamJSON.stringify({ error: "layer" });
  }
  if (_getCurrentSelectionBounds()) {
    return jamJSON.stringify({ error: "hasSelection" });
  }
  // With several layers targeted the wand origin is ambiguous, and the user
  // is probably lining up a batch: leave the selection alone
  if (_getTargetLayerCount() > 1) {
    return jamJSON.stringify({ error: "multi" });
  }

  var tolerance = data && data.tolerance ? parseInt(data.tolerance, 10) : 20;
  if (isNaN(tolerance)) tolerance = 20;
  var sampleCount = _normalizeShapeSampleCount(data && data.samples, 21);

  var result = _withTemporaryHistory("TypeR Bubble Scan", function () {
    return _scanActiveLayerBubble(tolerance, sampleCount);
  });
  if (!result) {
    return jamJSON.stringify({ error: "shape" });
  }
  if (result.error) {
    return jamJSON.stringify({ error: result.error });
  }
  // scan/scanError lead the object so they survive the debug log preview cap
  var out = { scan: result.scan || "legacy" };
  if (out.scan === "legacy" && _hostState.lastPathScanError) {
    out.scanError = _hostState.lastPathScanError;
  }
  out.bounds = result.bounds;
  out.rows = result.rows;
  out.fallback = result.fallback;
  return jamJSON.stringify(out);
}

function getSelectedTextLayers() {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  var layers = [];
  var targetLayers = stringIDToTypeID("targetLayers");
  var layerIdProp = stringIDToTypeID("layerID");
  var indexes = [];
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (doc.hasKey(targetLayers)) {
    var list = doc.getList(targetLayers);
    var backgroundRef = new ActionReference();
    backgroundRef.putProperty(charID.Property, charID.Background);
    backgroundRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
    var offset = executeActionGet(backgroundRef).getBoolean(charID.Background) ? 0 : 1;
    for (var i = 0; i < list.count; i++) {
      indexes.push(list.getReference(i).getIndex() + offset);
    }
  } else {
    indexes.push(-1);
  }
  for (var j = 0; j < indexes.length; j++) {
    try {
      // Per-property gets: pulling the full layer descriptor is slow and
      // drags the whole text descriptor along for every selected layer
      var textRef = new ActionReference();
      textRef.putProperty(charID.Property, charID.Text);
      if (indexes[j] === -1) {
        textRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      } else {
        textRef.putIndex(charID.Layer, indexes[j]);
      }
      if (!executeActionGet(textRef).hasKey(charID.Text)) continue;

      var idRef = new ActionReference();
      idRef.putProperty(charID.Property, layerIdProp);
      if (indexes[j] === -1) {
        idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      } else {
        idRef.putIndex(charID.Layer, indexes[j]);
      }
      layers.push({
        id: executeActionGet(idRef).getInteger(layerIdProp),
      });
    } catch (layerError) {}
  }
  return jamJSON.stringify({ layers: layers });
}

function getActiveLayerTextIfChanged(data) {
  if (!documents.length || !_layerIsTextLayer()) {
    return jamJSON.stringify({ error: "layer", signature: "" });
  }
  var layerId = null;
  var historyIndex = null;
  try {
    layerId = _getActiveLayerId();
  } catch (layerError) {}
  try {
    historyIndex = _getActiveHistoryIndex();
  } catch (historyError) {}
  var signature = String(layerId) + ":" + String(historyIndex);
  if (layerId !== null && historyIndex !== null && data && data.signature === signature) {
    return jamJSON.stringify({ unchanged: true, signature: signature });
  }
  var snapshot = null;
  try {
    snapshot = jamJSON.parse(getActiveLayerText());
  } catch (snapshotError) {}
  if (!snapshot) return jamJSON.stringify({ error: "layer", signature: signature });
  snapshot.signature = signature;
  return jamJSON.stringify(snapshot);
}

// Geometry-only acknowledgement for Photoshop 'move' events. This intentionally
// avoids jamText.getLayerText(), stroke reads, selection reads and bubble scans:
// arrow nudges should never put Photoshop's main thread behind heavy TypeR work.
function getActiveTextLayerGeometry() {
  if (!documents.length) {
    return jamJSON.stringify({ error: "layer", signature: "" });
  }
  var layerId = null;
  var historyIndex = null;
  var bounds = null;
  try {
    layerId = _getActiveLayerId();
  } catch (layerError) {}
  try {
    historyIndex = _getActiveHistoryIndex();
  } catch (historyError) {}
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {}
  if (layerId === null || !bounds) {
    return jamJSON.stringify({ error: "layer", signature: "" });
  }
  return jamJSON.stringify({
    layerId: layerId,
    bounds: bounds,
    signature: String(layerId) + ":" + String(historyIndex),
  });
}

// Shared lightweight snapshot for the panel's selection-driven widgets. A
// single CEP bridge hop is much cheaper than queueing one call for the marquee
// and another for the selected text-layer IDs after every Photoshop event.
function getTypeRSelectionSnapshot() {
  var selection = null;
  var selectedLayers = { layers: [] };
  try {
    selection = jamJSON.parse(getCurrentSelection());
  } catch (selectionError) {}
  try {
    selectedLayers = jamJSON.parse(getSelectedTextLayers()) || selectedLayers;
  } catch (layersError) {}
  return jamJSON.stringify({
    selection: selection && !selection.error ? selection : null,
    layers: selectedLayers.layers || []
  });
}

function getTypeRPanelSnapshot(data) {
  var activeLayer = null;
  var selectionSnapshot = { selection: null, layers: [] };
  try {
    activeLayer = jamJSON.parse(getActiveLayerTextIfChanged(data || {}));
  } catch (activeLayerError) {}
  try {
    selectionSnapshot = jamJSON.parse(getTypeRSelectionSnapshot()) || selectionSnapshot;
  } catch (selectionSnapshotError) {}
  return jamJSON.stringify({
    activeLayer: activeLayer,
    selection: selectionSnapshot.selection,
    layers: selectionSnapshot.layers || []
  });
}

function _getTargetLayerCount() {
  var targetLayers = stringIDToTypeID("targetLayers");
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (!doc.hasKey(targetLayers)) return 1;
  return doc.getList(targetLayers).count;
}

function selectLayerById(id) {
  try {
    var layerId = parseInt(id, 10);
    if (isNaN(layerId)) return "error";
    var descriptor = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, layerId);
    descriptor.putReference(charID.Null, reference);
    descriptor.putBoolean(stringIDToTypeID("makeVisible"), false);
    executeAction(charID.Select, descriptor, DialogModes.NO);
    return "";
  } catch (selectError) {
    return "error";
  }
}

function startSelectionMonitoring() {
  var monitor = _hostState.selectionMonitor;
  if (monitor.callback) {
    app.removeNotifier("Slct", monitor.callback);
    monitor.callback = null;
  }
}

function stopSelectionMonitoring() {
  var monitor = _hostState.selectionMonitor;
  if (monitor.callback) {
    app.removeNotifier("Slct", monitor.callback);
    monitor.callback = null;
  }
  monitor.lastBoundsKey = null;
  monitor.lastBounds = null;
  monitor.multiWarnBounds = null;
}

function deselectDocumentSelection() {
  try {
    if (!documents.length) return "doc";
    try {
      _deselect();
    } catch (deselectError) {}
    var monitor = _hostState.selectionMonitor;
    monitor.lastBounds = null;
    monitor.lastBoundsKey = null;
    monitor.multiWarnBounds = null;
    return "";
  } catch (e) {
    return "error";
  }
}

function _getActiveHistoryIndex() {
  var reference = new ActionReference();
  reference.putEnumerated(stringIDToTypeID("historyState"), charID.Ordinal, charID.Target);
  var descriptor = executeActionGet(reference);
  return descriptor.getInteger(stringIDToTypeID("itemIndex")) - 1;
}

// Jumps back to just before the most recent "TyperTools Change" history
// state. A plain single-step undo lands on selection/wand noise (bubble
// detection creates several history states between two applies), so the
// undo must search the history by name instead.
function undoLastTyperChange() {
  try {
    if (!documents.length) return "doc";
    var doc = app.activeDocument;
    var states = doc.historyStates;
    if (!states.length) return "none";
    var activeIndex;
    try {
      activeIndex = _getActiveHistoryIndex();
    } catch (indexError) {
      activeIndex = states.length - 1;
    }
    if (activeIndex < 0) activeIndex = 0;
    if (activeIndex > states.length - 1) activeIndex = states.length - 1;
    for (var search = activeIndex; search > 0; search--) {
      if (states[search].name === "TyperTools Change") {
        doc.activeHistoryState = states[search - 1];
        return "";
      }
    }
    return "none";
  } catch (e) {
    return "error";
  }
}

function getTypeRDocumentKey() {
  return documents.length ? _hostState.documentSession + ":" + String(app.activeDocument.id) : "";
}

function getSelectionChanged() {
  var monitor = _hostState.selectionMonitor;
  var documentKey = getTypeRDocumentKey();
  if (monitor.documentKey !== documentKey) {
    monitor.documentKey = documentKey;
    monitor.lastBoundsKey = null;
    monitor.lastBounds = null;
    monitor.multiWarnBounds = null;
    return jamJSON.stringify({ documentChanged: true, documentKey: documentKey });
  }
  var result = jamJSON.parse(_getSelectionChanged());
  result.documentKey = documentKey;
  var selections = result.multiSelection || [];
  for (var i = 0; i < selections.length; i++) selections[i].documentKey = documentKey;
  return jamJSON.stringify(result);
}

function _getSelectionChanged() {
  try {
    var monitor = _hostState.selectionMonitor;
    var keyboardState = ScriptUI.environment && ScriptUI.environment.keyboardState;
    var shiftPressed = !!(keyboardState && keyboardState.shiftKey);

    var rawSelection = _getCurrentSelectionBounds();
    if (!rawSelection) {
      monitor.multiWarnBounds = null;
      return jamJSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    var selectionArray = Object.prototype.toString.call(rawSelection) === "[object Array]" ? rawSelection : [rawSelection];
    var groups = [];

    for (var i = 0; i < selectionArray.length; i++) {
      if (selectionArray[i].width < 2 && selectionArray[i].height < 2) continue;
      groups.push([selectionArray[i]]);
    }

    var changed = true;
    var margin = 30;
    while (changed) {
      changed = false;
      for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        for (var compareIndex = groupIndex + 1; compareIndex < groups.length; compareIndex++) {
          var overlap = false;
          for (var groupSelectionIndex = 0; groupSelectionIndex < groups[groupIndex].length; groupSelectionIndex++) {
            for (var compareSelectionIndex = 0; compareSelectionIndex < groups[compareIndex].length; compareSelectionIndex++) {
              var firstBounds = groups[groupIndex][groupSelectionIndex];
              var secondBounds = groups[compareIndex][compareSelectionIndex];
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

    var merged = [];
    for (var mergedIndex = 0; mergedIndex < groups.length; mergedIndex++) {
      var group = groups[mergedIndex];
      var minLeft = 99999;
      var minTop = 99999;
      var maxRight = -99999;
      var maxBottom = -99999;
      for (var boundIndex = 0; boundIndex < group.length; boundIndex++) {
        if (group[boundIndex].left < minLeft) minLeft = group[boundIndex].left;
        if (group[boundIndex].top < minTop) minTop = group[boundIndex].top;
        if (group[boundIndex].right > maxRight) maxRight = group[boundIndex].right;
        if (group[boundIndex].bottom > maxBottom) maxBottom = group[boundIndex].bottom;
      }

      var width = maxRight - minLeft;
      var height = maxBottom - minTop;
      if (width > 2 && height > 2) {
        merged.push({
          top: minTop,
          left: minLeft,
          right: maxRight,
          bottom: maxBottom,
          width: width,
          height: height,
          xMid: (minLeft + maxRight) / 2,
          yMid: (minTop + maxBottom) / 2,
        });
      }
    }

    if (merged.length === 0) {
      return jamJSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    var isSame = false;
    if (monitor.lastBounds && merged.length === 1) {
      var diffTop = Math.abs(merged[0].top - monitor.lastBounds.top);
      var diffLeft = Math.abs(merged[0].left - monitor.lastBounds.left);
      var diffRight = Math.abs(merged[0].right - monitor.lastBounds.right);
      var diffBottom = Math.abs(merged[0].bottom - monitor.lastBounds.bottom);
      if (diffTop <= 5 && diffLeft <= 5 && diffRight <= 5 && diffBottom <= 5) {
        isSame = true;
      }
    }

    if (isSame && !shiftPressed) {
      return jamJSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    // The union of a flagged Shift-add stays suppressed until the user makes
    // a fresh selection: capturing it once Shift is released would silently
    // create one bubble spanning several selections right after the panel
    // warned that this is not supported.
    if (monitor.multiWarnBounds && merged.length === 1 &&
      Math.abs(merged[0].top - monitor.multiWarnBounds.top) <= 5 &&
      Math.abs(merged[0].left - monitor.multiWarnBounds.left) <= 5 &&
      Math.abs(merged[0].right - monitor.multiWarnBounds.right) <= 5 &&
      Math.abs(merged[0].bottom - monitor.multiWarnBounds.bottom) <= 5) {
      return jamJSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    // Shift-adding a second outline never shrinks the selection: Photoshop
    // reports a single union rectangle that still contains the previously
    // seen bounds. Warn the panel instead of capturing that union as one
    // giant bubble, and remember it so it is not captured later either.
    if (shiftPressed && !isSame && monitor.lastBounds && merged.length === 1 &&
      merged[0].top <= monitor.lastBounds.top + 5 &&
      merged[0].left <= monitor.lastBounds.left + 5 &&
      merged[0].right >= monitor.lastBounds.right - 5 &&
      merged[0].bottom >= monitor.lastBounds.bottom - 5) {
      monitor.multiWarnBounds = merged[0];
      return jamJSON.stringify({ multipleSelections: true, shiftKey: shiftPressed });
    }
    monitor.multiWarnBounds = null;

    // Stored multi-bubble selections only retain bounds, so clean a newly
    // captured selection while its real outline is still available.
    var payloadBounds = merged;
    if (merged.length === 1) {
      var openedBounds = _withTemporaryHistory("TypeR Selection Capture", function () {
        return _getAdaptiveOpenedSelectionBounds(merged[0]);
      });
      payloadBounds = [openedBounds && !openedBounds.error ? openedBounds : merged[0]];
    }

    monitor.lastBounds = merged[0];
    monitor.lastBoundsKey = _selectionBoundsKey(merged[0]);

    var multiResults = [];
    for (var payloadIndex = 0; payloadIndex < payloadBounds.length; payloadIndex++) {
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

    return jamJSON.stringify({
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
    return jamJSON.stringify({ error: true, message: "getSelectionChanged inner error: " + e.message + " on line " + e.line, shiftKey: false });
  }
}

function _createTextLayersInStoredSelections() {
  var state = _hostState.createTextLayersInStoredSelections;
  if (!documents.length) {
    state.result = "doc";
    return;
  }
  var textSizeOverride = null;
  if (state.data.preserveActiveTextSize) {
    if (!_layerIsTextLayer()) {
      state.result = "sizeSource";
      return;
    }
    textSizeOverride = _getTextLayerSize();
  }
  
  var texts = state.data.texts || [];
  var styles = state.data.styles || [];
  
  if (texts.length === 0 || state.selections.length === 0) {
    state.result = "noSelection";
    return;
  }
  
  var maxCount = Math.min(texts.length, state.selections.length);
  var autoCenter = _autoCenterEnabled(state.data);
  var createdIds = [];
  
  for (var i = 0; i < maxCount; i++) {
    try {
      var text = texts[i] || texts[texts.length - 1] || "";
      var textRuns = state.data.richTextRuns
        ? (state.data.richTextRuns[i] || state.data.richTextRuns[state.data.richTextRuns.length - 1])
        : null;
      var baseStyle = styles[i] || styles[styles.length - 1] || null;
      var style = _ensureStyle(baseStyle);
      var selection = state.selections[i];

      if (!selection || typeof selection.width !== "number" || typeof selection.height !== "number") {
        state.result = "invalidSelection";
        return;
      }

      if (!text) continue;

      var dimensions = _calculateSelectionDimensions(selection, state.padding);
      if (!dimensions || isNaN(dimensions.width) || isNaN(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
        state.result = "invalidSelection";
        return;
      }

      // Create the text layer.
      var data = { text: text, style: style, direction: state.data.direction, richTextRuns: textRuns, textSizeOverride: textSizeOverride };
      _createAndSetLayerText(data, dimensions.width, dimensions.height);

      var bounds = _getCurrentTextLayerBounds();
      var pointModes = state.data.pointModes || [];
      var pointText = pointModes[i] === undefined ? state.point : !!pointModes[i];
      if (pointText) {
        _changeToPointText();
      } else {
        _resizeTextBoxToContent(dimensions.width, bounds);
      }
      bounds = _getCurrentTextLayerBounds();

      // Position the layer inside the stored selection.
      _positionLayerWithinSelection(selection, bounds);
      if (autoCenter) createdIds.push(_safeActiveLayerId());
    } catch (e) {
      state.result = "scriptError: " + (e && e.message ? e.message : e);
      return;
    }
  }

  if (autoCenter) {
    _autoCenterCreated(createdIds, {
      autoCenter: state.data.autoCenter,
      resizeTextBox: state.data.resizeTextBox,
      padding: state.padding,
    });
  }
  
  // Clear stored selections after use.
  state.selections = [];
  state.result = "";
}

function createTextLayersInStoredSelections(data, point) {
  var state = _hostState.createTextLayersInStoredSelections;
  state.data = data;
  state.point = point;
  state.padding = data.padding || 0;
  state.result = "";
  
  // Selections are passed directly from React.
  if (data && data.selections) {
    state.selections = data.selections;
  } else {
    state.selections = [];
  }
  
  if (!documents.length) return "doc";
  var documentKey = getTypeRDocumentKey();
  var count = state.selections.length;
  if (!count || !data.texts || data.texts.length !== count) return "noSelection";
  for (var index = 0; index < count; index++) {
    var selection = state.selections[index];
    if (!selection || !selection.documentKey || selection.documentKey !== documentKey) return "wrongDocument";
    if (!data.texts[index]) return "noText";
    var dimensions = _calculateSelectionDimensions(selection, state.padding);
    if (!dimensions || !isFinite(dimensions.width) || !isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) return "invalidSelection";
  }
  var doc = app.activeDocument;
  var previousHistory = doc.activeHistoryState;
  try {
    doc.suspendHistory("TyperTools Multiple Paste", "_createTextLayersInStoredSelections()");
  } catch (error) {
    state.result = "scriptError: " + error.message;
  }
  if (state.result) {
    try { doc.activeHistoryState = previousHistory; }
    catch (rollbackError) { return "rollbackFailed"; }
  }
  return state.result;
}

function openFile(path, autoClose) {
  try {
    var file = File(path);
    if (!file.exists) throw new Error("File not found");
    var previousId = _hostState.lastOpenedDocId;
    var newDoc = app.open(file);
    if (autoClose && previousId !== null && previousId !== newDoc.id) {
      for (var i = 0; i < app.documents.length; i++) {
        var doc = app.documents[i];
        if (doc.id === previousId) {
          try { doc.close(SaveOptions.SAVECHANGES); }
          catch (saveError) { app.activeDocument = doc; throw saveError; }
          break;
        }
      }
    }
    app.activeDocument = newDoc;
    _hostState.lastOpenedDocId = newDoc.id;
    return jamJSON.stringify({ ok: true, path: path, documentKey: getTypeRDocumentKey() });
  } catch (error) {
    return jamJSON.stringify({ ok: false, path: path, error: String(error.message || error) });
  }
}

function deleteFolder(folderPath) {
  try {
    var folder = new Folder(folderPath);
    if (folder.exists) {
      // Recursively delete contents
      var files = folder.getFiles();
      for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof Folder) {
          deleteFolder(files[i].fsName);
        } else {
          files[i].remove();
        }
      }
      folder.remove();
    }
    return 'OK';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

function openFolder(folderPath) {
  try {
    var os = $.os.toLowerCase();
    if (os.indexOf('win') !== -1) {
      // Windows: open Explorer
      app.system('explorer "' + folderPath.replace(/\//g, '\\') + '"');
    } else {
      // macOS: open Finder
      app.system('open "' + folderPath + '"');
    }
    return 'OK';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

/**
 * Collect font data from every text layer of a document (recursively).
 * Returns an array of {layerName, antiAlias, typeUnit, paragraphStyle, stroke, runs}.
 */
function _collectDocumentFontData(doc) {
  // Flat ActionManager iteration over layer indexes: no DOM tree walk and no
  // activeLayer switching (both are very slow on layer-heavy documents).
  // Groups (kind 7) and section bounders (kind 13) fail the kind === 3 check,
  // so recursion is unnecessary — the index space already covers nested layers.
  var results = [];
  var propId = charIDToTypeID("Prpr");
  var layerId = charIDToTypeID("Lyr ");
  var docId = charIDToTypeID("Dcmn");
  var ordinalId = charIDToTypeID("Ordn");
  var targetId = charIDToTypeID("Trgt");
  var nameId = charIDToTypeID("Nm  ");
  var layerKindId = stringIDToTypeID("layerKind");
  var layerCountId = stringIDToTypeID("numberOfLayers");
  var hasBackgroundId = stringIDToTypeID("hasBackgroundLayer");

  var getDocProperty = function (id) {
    var ref = new ActionReference();
    ref.putProperty(propId, id);
    ref.putEnumerated(docId, ordinalId, targetId);
    return executeActionGet(ref);
  };
  var getLayerProperty = function (id, index) {
    var ref = new ActionReference();
    ref.putProperty(propId, id);
    ref.putIndex(layerId, index);
    return executeActionGet(ref);
  };

  var layerCount = 0;
  try {
    layerCount = getDocProperty(layerCountId).getInteger(layerCountId);
  } catch (countError) {
    return results;
  }
  var hasBackground = false;
  try {
    hasBackground = getDocProperty(hasBackgroundId).getBoolean(hasBackgroundId);
  } catch (backgroundError) {}
  // Layer indexes are 0-based when a background layer exists, 1-based otherwise
  var firstIndex = hasBackground ? 0 : 1;
  var lastIndex = hasBackground ? layerCount - 1 : layerCount;

  var saveMeaningfulIds = jamEngine.meaningfulIds;
  var saveParseFriendly = jamEngine.parseFriendly;
  jamEngine.meaningfulIds = true;
  jamEngine.parseFriendly = true;
  try {
    for (var i = firstIndex; i <= lastIndex; i++) {
      try {
        if (getLayerProperty(layerKindId, i).getInteger(layerKindId) !== 3) continue;
        var resultObj = jamEngine.jsonGet([
          { "property": { "<property>": "textKey" } },
          { "layer": { "<index>": i } },
        ]);
        if (!("textKey" in resultObj)) continue;
        var textParams = jamText.fromLayerTextObject(resultObj["textKey"]);
        if (!textParams || !textParams.layerText) continue;
        var layerText = textParams.layerText;
        var ranges = layerText.textStyleRange || [];
        var runs = [];
        for (var r = 0; r < ranges.length; r++) {
          if (ranges[r] && ranges[r].textStyle) runs.push(ranges[r].textStyle);
        }
        if (!runs.length) continue;
        var paragraphStyle = null;
        if (layerText.paragraphStyleRange && layerText.paragraphStyleRange[0]) {
          paragraphStyle = layerText.paragraphStyleRange[0].paragraphStyle || null;
        }
        var stroke = null;
        try {
          stroke = _getLayerStroke(i);
        } catch (strokeError) {}
        var layerName = "";
        try {
          layerName = getLayerProperty(nameId, i).getString(nameId);
        } catch (nameError) {}
        results.push({
          layerName: layerName,
          antiAlias: layerText.antiAlias || "antiAliasSmooth",
          typeUnit: textParams.typeUnit || "pixelsUnit",
          paragraphStyle: paragraphStyle,
          stroke: stroke,
          runs: runs,
        });
      } catch (layerError) {}
    }
  } finally {
    jamEngine.meaningfulIds = saveMeaningfulIds;
    jamEngine.parseFriendly = saveParseFriendly;
  }
  return results;
}

/**
 * FontScanR: open a .psd file, extract font/style data from all its text
 * layers, then close it (unless it was already open in Photoshop).
 * Called once per file so the panel can show per-file progress.
 */
function scanPsdFonts(path) {
  if (!path) return jamJSON.stringify({ error: "badPath" });
  var file = new File(path);
  if (!file.exists) return jamJSON.stringify({ error: "notFound", file: path });
  var doc = null;
  var wasOpen = false;
  for (var i = 0; i < app.documents.length; i++) {
    try {
      // Unsaved documents throw on fullName access
      if (app.documents[i].fullName && app.documents[i].fullName.fsName === file.fsName) {
        doc = app.documents[i];
        wasOpen = true;
        break;
      }
    } catch (fullNameError) {}
  }
  var previousDoc = null;
  try {
    previousDoc = app.activeDocument;
  } catch (noDocError) {}
  // Suppress missing-font / text-update prompts: they block the scan and every
  // dialog Photoshop prepares slows the open down
  var saveDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;
  try {
    if (doc) {
      app.activeDocument = doc;
    } else {
      doc = app.open(file);
    }
    var layers = _collectDocumentFontData(doc);
    if (!wasOpen) {
      doc.close(SaveOptions.DONOTSAVECHANGES);
      if (previousDoc) {
        try {
          app.activeDocument = previousDoc;
        } catch (restoreError) {}
      }
    }
    return jamJSON.stringify({ file: file.fsName, layers: layers });
  } catch (scanError) {
    if (doc && !wasOpen) {
      try {
        doc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {}
    }
    return jamJSON.stringify({ error: "scanFailed", file: path, message: scanError && scanError.message ? scanError.message : String(scanError) });
  } finally {
    app.displayDialogs = saveDialogs;
  }
}

function makeExecutable(filePath) {
  try {
    var os = $.os.toLowerCase();
    if (os.indexOf('mac') !== -1) {
      app.system('chmod +x "' + filePath + '"');
    }
    return 'OK';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

function launchInstaller(filePath) {
  try {
    var file = new File(filePath);
    if (!file.exists) {
      return 'ERROR: file not found';
    }
    // execute() opens the file with its default handler: a console window for
    // .cmd on Windows, Terminal for an executable .command on macOS
    var launched = file.execute();
    if (launched) return 'OK';
    var os = $.os.toLowerCase();
    if (os.indexOf('mac') !== -1) {
      app.system('open "' + file.fsName + '"');
      return 'OK';
    }
    return 'ERROR: execute failed';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}
