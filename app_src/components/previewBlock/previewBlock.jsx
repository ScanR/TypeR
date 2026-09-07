import "./previewBlock.scss";

import React from "react";
import { FiArrowRightCircle, FiChevronLeft, FiChevronRight, FiChevronsRight, FiLock, FiCrosshair, FiPlay, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown, FiAlertTriangle, FiInfo, FiRotateCcw, FiStar, FiX } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";
import { FaMagic } from "react-icons/fa";

import { csInterface, locale, nativeConfirm, setActiveLayerText, setLayerTextFast, getSelectionBoundsHash, addPhotoshopEventListener, hasReceivedPhotoshopEvents, isPhotoshopSelectEvent, isPhotoshopMoveEvent, isHostActionPending, isPanelIdle, isPanelInteracting, notePanelActivity, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, deselectDocument, undoLastTextChange, getActiveLayerRenderedText, getAllLayersRenderedTexts, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, getUserFonts, refreshUserFonts, scrollToLine, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { getScaledStyle } from "../../textLayerPayload";
import { getBubbleCacheKey, haveSameLayerSize } from "../../textShapeRTracking";
import { isShortcutActiveForEvent, pasteInSelection, withShortcutHint } from "../../shortcutCommands";
import { createFontPreviewRegistry, getFontPreviewFamily } from "../../fontPreview";
import { notePerfRender } from "../../perfDebug";
import TextShapeRFitPreview from "../textShapeRFitPreview";

let textShapeREnginePromise = null;
let panelSnapshotPending = false;
let panelSnapshotTimer = null;
let panelSnapshotSignature = "";
let panelSnapshotCallbacks = [];
const schedulePanelSnapshot = () => {
  if (panelSnapshotPending || panelSnapshotTimer) return;
  panelSnapshotTimer = setTimeout(() => {
    panelSnapshotTimer = null;
    panelSnapshotPending = true;
    const requestedSignature = panelSnapshotSignature;
    const requestedCallbacks = panelSnapshotCallbacks;
    panelSnapshotSignature = "";
    panelSnapshotCallbacks = [];
    csInterface.evalScript(`getTypeRPanelSnapshot(${JSON.stringify({ signature: requestedSignature })})`, (result) => {
      panelSnapshotPending = false;
      let snapshot = { activeLayer: null, selection: null, layers: [] };
      try {
        snapshot = JSON.parse(result || "{}") || snapshot;
      } catch (error) {}
      requestedCallbacks.forEach((snapshotCallback) => snapshotCallback(snapshot));
      // Requests arriving while ExtendScript was busy belong to the next
      // Photoshop state; do not satisfy them with the now-stale response.
      if (panelSnapshotCallbacks.length) schedulePanelSnapshot();
    });
  }, 0);
};
const requestPanelSnapshot = (signature, callback) => {
  panelSnapshotCallbacks.push(callback);
  if (signature) panelSnapshotSignature = signature;
  schedulePanelSnapshot();
};
const loadTextShapeREngine = () => {
  if (!textShapeREnginePromise) {
    textShapeREnginePromise = import(/* webpackChunkName: "text-shaper-engine" */ "../../textShapeR");
  }
  return textShapeREnginePromise;
};

const normalizeLayerText = (text) => String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

const getNextUsableLineIndex = (lines, lineIndex) => {
  const currentLine = lines[lineIndex];
  if (currentLine?.last) return { index: lineIndex, advanced: false };
  for (let i = lineIndex + 1; i < lines.length; i++) {
    if (!lines[i].ignore) return { index: lines[i].rawIndex, advanced: true };
  }
  return { index: lineIndex, advanced: false };
};

const getLayerSourceKey = (source) => JSON.stringify({
  layerId: source.layerId || null,
  text: source.text,
  textStyleRange: source.style?.textProps?.layerText?.textStyleRange || null,
  paragraphStyleRange: source.style?.textProps?.layerText?.paragraphStyleRange || null,
  stroke: source.style?.stroke || null,
});

// Detected bubbles are memoized per layer so revisiting a layer never pays for
// a second wand scan. Bounded: a long session on a busy chapter must not grow
// this map forever, and the oldest entries are the least likely to come back.
const BUBBLE_CACHE_LIMIT = 120;

const rememberBubbleShape = (cache, key, shape) => {
  if (cache.size >= BUBBLE_CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, shape);
};

const getActiveTextLayerSource = (signature, callback) => {
  requestPanelSnapshot(signature, ({ activeLayer: data }) => {
    try {
      if (data.unchanged) {
        callback({ unchanged: true, signature: data.signature });
        return;
      }
      if (!data?.textProps?.layerText) {
        callback(null);
        return;
      }
      const source = {
        text: normalizeLayerText(data.textProps.layerText.textKey),
        layerId: typeof data.layerId === "number" ? data.layerId : null,
        bounds: data.bounds || null,
        style: {
          textProps: data.textProps,
          stroke: data.stroke || null,
        },
      };
      callback({ ...source, key: getLayerSourceKey(source), signature: data.signature || "" });
    } catch (error) {
      callback(null);
    }
  });
};

// Shared fallbacks: a fresh `{}` per render would invalidate every memo that
// depends on the text style, and rebuilding the font-preview registry on each
// render is what made the whole panel repaint on unrelated dispatches
const emptyTextStyle = {};

const PreviewBlock = React.memo(function PreviewBlock() {
  notePerfRender("PreviewBlock");
  const context = useContext((state) => ({
    uiLayout: state.uiLayout,
    currentStyle: state.currentStyle,
    currentLine: state.currentLine,
    interpretMarkdown: state.interpretMarkdown,
    textShapeRTuning: state.textShapeRTuning,
    textShapeRBubbleAware: state.textShapeRBubbleAware,
    inlineTextShapeR: state.inlineTextShapeR,
    currentLineIndex: state.currentLineIndex,
    multiBubbleMode: state.multiBubbleMode,
    storedSelections: state.storedSelections,
    modalType: state.modalType,
    lines: state.lines,
    styles: state.styles,
    textScale: state.textScale,
    pastePointText: state.pastePointText,
    internalPadding: state.internalPadding,
    direction: state.direction,
    resizeTextBoxOnCenter: state.resizeTextBoxOnCenter,
    textSizeIncrement: state.textSizeIncrement,
    showTips: state.showTips,
    textShapeRPerformanceTipVisible: state.textShapeRPerformanceTipVisible,
    textShapeRUsageCount: state.textShapeRUsageCount,
    textShapeRLearnUsed: state.textShapeRLearnUsed,
    textShapeRLearnTipShown: state.textShapeRLearnTipShown,
    textShapeRLearnTipVisible: state.textShapeRLearnTipVisible,
    shortcut: state.shortcut,
    keepSizeHeld: state.keepSizeHeld,
  }));
  const uiVisible = context.state.uiLayout?.visible || {};
  const showPreviewMainControls =
    uiVisible.previewCreateButton !== false ||
    uiVisible.previewAlignButton !== false ||
    uiVisible.previewSizeControls !== false;
  const batchTrackingEnabled = context.state.inlineTextShapeR && uiVisible.previewWidget !== false;
  const [textShapeREngine, setTextShapeREngine] = React.useState(null);
  React.useEffect(() => {
    if (!context.state.inlineTextShapeR || uiVisible.previewWidget === false || textShapeREngine) return undefined;
    let active = true;
    loadTextShapeREngine().then((engine) => {
      if (!active) return;
      engine.setDehyphenationEnabled(context.getState().dehyphenateTextShapeR === true);
      engine.setTextShapeRTuning(context.getState().textShapeRTuning);
      setTextShapeREngine(engine);
    });
    return () => {
      active = false;
    };
  }, [context.state.inlineTextShapeR, uiVisible.previewWidget, textShapeREngine, context.getState]);
  React.useEffect(() => {
    context.dispatch({ type: "showTextShapeRPerformanceTip" });
  }, [context.dispatch]);
  React.useEffect(() => {
    context.dispatch({ type: "showTextShapeRLearnTip" });
  }, [
    context.dispatch,
    context.state.inlineTextShapeR,
    context.state.showTips,
    context.state.textShapeRUsageCount,
    context.state.textShapeRLearnUsed,
    context.state.textShapeRLearnTipShown,
    context.state.textShapeRTuning,
    uiVisible.preview,
    uiVisible.previewWidget,
  ]);
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText?.textStyleRange?.[0]?.textStyle || emptyTextStyle;
  const styleObject = React.useMemo(() => getStyleObject(textStyle), [textStyle]);
  const [inlineLayerSource, setInlineLayerSource] = React.useState({
    text: "",
    style: null,
    key: "",
    layerId: null,
    loading: false,
    error: "",
  });
  const inlineSourceKey = React.useRef("");
  const inlineSourceSignature = React.useRef("");
  const inlineLayerIdRef = React.useRef(null);
  const inlineSourcePending = React.useRef(false);
  const inlineGeometryPending = React.useRef(false);
  const inlineGeometryQueued = React.useRef(false);
  const inlineContentEventVersion = React.useRef(0);
  const inlineEventDebounce = React.useRef(null);
  const inlineMoveDebounce = React.useRef(null);
  const inlineLastRefreshAt = React.useRef(0);
  const inlineShapePending = React.useRef(false);
  const inlineShapeKey = React.useRef("");
  const inlineLayerBoundsRef = React.useRef(null);
  const bubbleShapeCache = React.useRef(new Map());
  const inlineShapeSettle = React.useRef({ hash: "", timer: null });
  const [inlineSelectionShape, setInlineSelectionShape] = React.useState(null);
  const batchOrderRef = React.useRef([]);
  const batchPending = React.useRef(false);
  const batchQueued = React.useRef(false);
  const batchEventDebounce = React.useRef(null);
  const batchRunRef = React.useRef(null);
  const batchSelectionRef = React.useRef([]);
  const [batchSelection, setBatchSelection] = React.useState([]);
  const [batchRun, setBatchRun] = React.useState(null);
  batchRunRef.current = batchRun;
  batchSelectionRef.current = batchSelection;
  const inlineTextStyle = inlineLayerSource.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle || emptyTextStyle;
  const inlineStyleObject = React.useMemo(() => getStyleObject(inlineTextStyle), [inlineTextStyle]);
  const [installedFonts, setInstalledFonts] = React.useState(getUserFonts);
  React.useEffect(() => {
    const cachedFonts = getUserFonts();
    if (cachedFonts.length) {
      setInstalledFonts(cachedFonts);
      return;
    }
    refreshUserFonts(setInstalledFonts);
  }, []);
  const registryRef = React.useRef(null);
  const fontPreviewRegistry = React.useMemo(() => {
    const next = createFontPreviewRegistry(installedFonts, [textStyle, inlineTextStyle], 0, "preview");
    // Keeping the previous object when the CSS is identical avoids re-injecting
    // the <style> block, which forces a full style recalculation of the panel
    if (registryRef.current && registryRef.current.css === next.css) return registryRef.current;
    registryRef.current = next;
    return next;
  }, [installedFonts, textStyle, inlineTextStyle]);
  const previewStyleObject = React.useMemo(() => ({
    ...styleObject,
    fontFamily: getFontPreviewFamily(textStyle, fontPreviewRegistry),
  }), [styleObject, textStyle, fontPreviewRegistry]);
  const inlinePreviewStyleObject = React.useMemo(() => ({
    ...inlineStyleObject,
    fontFamily: getFontPreviewFamily(inlineTextStyle, fontPreviewRegistry),
  }), [inlineStyleObject, inlineTextStyle, fontPreviewRegistry]);
  const markdownEnabled = context.state.interpretMarkdown !== false;
  // Calibrate measure units against the layer's real rendered pixels: the
  // current text and its bounds give px-per-unit and px-per-line, which lets
  // the generator check candidates against the bubble in absolute pixels
  const inlineCalibration = React.useMemo(() => {
    const bounds = inlineLayerSource.bounds;
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
    const lines = String(inlineLayerSource.text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    if (!textShapeREngine) return null;
    const maxUnits = Math.max(...lines.map((line) => textShapeREngine.visibleWidth(line)));
    if (!(maxUnits > 0)) return null;
    // Bounds measure glyph extent, not leading: an n-line block spans
    // (n - 1) * leading + glyphHeight where glyphHeight is ~0.62 of the
    // leading for all-caps text (the manga default) and ~0.8 with
    // descenders. Underestimating the leading here let too-tall blocks pass
    // the fit check and pushed their edge lines out of the bubble curve.
    const glyphRatio = /[gjpqyç()]/.test(lines.join("")) ? 0.8 : 0.62;
    return {
      unitPx: bounds.width / maxUnits,
      linePx: bounds.height / (lines.length - 1 + glyphRatio),
    };
  }, [inlineLayerSource.text, inlineLayerSource.bounds, textShapeREngine]);
  const inlineTextShapeRVariants = React.useMemo(
    () => textShapeREngine ? textShapeREngine.generateTextShapeRVariants(inlineLayerSource.text, {
      limit: 12,
      allowHyphenation: true,
      profile: "balanced",
      shapeProfile: inlineSelectionShape?.profile || null,
      width: inlineSelectionShape?.width,
      height: inlineSelectionShape?.height,
      calibration: inlineCalibration,
    }) : [],
    // textShapeRTuning is not read here but changes the generator's scoring:
    // its module-level state is updated before the dispatch triggers this
    [inlineLayerSource.text, inlineSelectionShape, inlineCalibration, context.state.textShapeRTuning, textShapeREngine]
  );
  const [inlineVariantPage, setInlineVariantPage] = React.useState(0);
  const inlinePageSize = 3;
  const inlinePageCount = Math.max(1, Math.ceil(inlineTextShapeRVariants.length / inlinePageSize));
  const visibleInlineVariants = inlineTextShapeRVariants.slice(
    inlineVariantPage * inlinePageSize,
    inlineVariantPage * inlinePageSize + inlinePageSize
  );
  const [applyingTextShapeRId, setApplyingTextShapeRId] = React.useState(null);
  const renderMarkdownText = React.useCallback((text) => {
    if (!markdownEnabled) return text;
    const parsed = parseMarkdownRuns(text || "");
    if (!parsed.hasFormatting) {
      return parsed.text;
    }
    return parsed.runs.map((run, index) => {
      const runStyle = {};
      if (run.bold) runStyle.fontWeight = "bold";
      if (run.italic) runStyle.fontStyle = "italic";
      return (
        <span key={`md-${index}`} style={runStyle}>
          {run.text}
        </span>
      );
    });
  }, [markdownEnabled]);

  const selectionCheckInterval = React.useRef(null);
  const selectionEventDebounce = React.useRef(null);
  const selectionCheckCallbackRef = React.useRef(null);
  const selectionCheckPending = React.useRef(false);
  const selectionPollLastAt = React.useRef(0);
  const [shiftSelectionWarning, setShiftSelectionWarning] = React.useState(false);
  const shiftTipTimeout = React.useRef(null);
  const [textShapeRUndoDepth, setTextShapeRUndoDepth] = React.useState(0);
  const [showClearAllTip, setShowClearAllTip] = React.useState(false);
  const clearAllTipTimeout = React.useRef(null);
  const [clearAllTipShown, setClearAllTipShown] = React.useState(false);

  const refreshInlineLayerSource = React.useCallback((showLoading = false) => {
    if (inlineSourcePending.current) return;
    inlineSourcePending.current = true;
    inlineLastRefreshAt.current = Date.now();
    setInlineLayerSource((current) => (
      showLoading || (!current.text && !current.error) ? { ...current, loading: true, error: "" } : current
    ));
    if (showLoading) inlineSourceSignature.current = "";
    getActiveTextLayerSource(inlineSourceSignature.current, (source) => {
      inlineSourcePending.current = false;
      if (source?.unchanged) {
        inlineSourceSignature.current = source.signature || inlineSourceSignature.current;
        setInlineLayerSource((current) => (current.loading || current.error ? { ...current, loading: false, error: "" } : current));
        return;
      }
      if (!source?.text) {
        inlineSourceKey.current = "";
        inlineSourceSignature.current = "";
        inlineLayerIdRef.current = null;
        inlineLayerBoundsRef.current = null;
        setInlineLayerSource((current) => {
          const error = locale.textShapeRLayerNoText || "Select a Photoshop text layer first.";
          if (!current.text && current.error === error && !current.loading) return current;
          return { text: "", style: null, key: "", layerId: null, loading: false, error };
        });
        return;
      }
      inlineLayerIdRef.current = source.layerId;
      inlineSourceSignature.current = source.signature || "";
      inlineLayerBoundsRef.current = source.bounds || null;
      if (source.key === inlineSourceKey.current) {
        setInlineLayerSource((current) => {
          const sizeChanged = source.bounds && !haveSameLayerSize(current.bounds, source.bounds);
          if (!sizeChanged && !current.loading && !current.error) return current;
          return {
            ...current,
            bounds: sizeChanged ? source.bounds : current.bounds,
            loading: false,
            error: "",
          };
        });
        return;
      }
      inlineSourceKey.current = source.key;
      setInlineLayerSource({
        text: source.text,
        style: source.style,
        key: source.key,
        layerId: source.layerId,
        bounds: source.bounds,
        loading: false,
        error: "",
      });
    });
  }, []);

  const bubbleAware = context.state.textShapeRBubbleAware === true;

  const clearInlineShapeSettle = React.useCallback(() => {
    if (inlineShapeSettle.current.timer) {
      clearTimeout(inlineShapeSettle.current.timer);
      inlineShapeSettle.current.timer = null;
    }
    inlineShapeSettle.current.hash = "";
  }, []);

  const refreshInlineSelectionShape = React.useCallback((force = false) => {
    if (inlineShapePending.current) return;
    if (force) {
      // Explicit refresh: the user is telling us the detection is stale, so
      // the memoized bubble for this layer must not short-circuit the rescan
      inlineShapeKey.current = "";
      bubbleShapeCache.current.delete(
        getBubbleCacheKey(inlineLayerIdRef.current, inlineLayerBoundsRef.current, inlineSourceKey.current)
      );
    }
    inlineShapePending.current = true;
    requestPanelSnapshot(inlineSourceSignature.current, ({ selection }) => {
      if (selection && selection.width && selection.height) {
        // Without an active text layer there is nothing to shape: skip the
        // outline sampling entirely so drawing selections on non-text layers
        // never churns the document with the 21-op sampling pass.
        if (!inlineSourceKey.current) {
          inlineShapePending.current = false;
          inlineShapeKey.current = "";
          clearInlineShapeSettle();
          setInlineSelectionShape((current) => (current ? null : current));
          return;
        }
        // A manual selection always wins over the automatic bubble detection
        const boundsHash = `selection:${getSelectionBoundsHash(selection)}`;
        if (boundsHash === inlineShapeKey.current) {
          inlineShapePending.current = false;
          return;
        }
        // The outline sampling runs 21 selection ops on Photoshop's main
        // thread: firing it on every bounds change would freeze the canvas
        // mid-drag. Wait until two consecutive reads agree (the user let go
        // of the mouse) before paying for it.
        if (!force && boundsHash !== inlineShapeSettle.current.hash) {
          inlineShapeSettle.current.hash = boundsHash;
          if (inlineShapeSettle.current.timer) clearTimeout(inlineShapeSettle.current.timer);
          inlineShapeSettle.current.timer = setTimeout(() => {
            inlineShapeSettle.current.timer = null;
            refreshInlineSelectionShape();
          }, 350);
          inlineShapePending.current = false;
          return;
        }
        clearInlineShapeSettle();
        csInterface.evalScript(`getCurrentSelectionShape(${JSON.stringify({ samples: 21 })})`, (result) => {
          inlineShapePending.current = false;
          try {
            const data = JSON.parse(result || "{}");
            if (!data || data.error || !data.bounds) return;
            inlineShapeKey.current = boundsHash;
            setInlineSelectionShape({
              profile: data,
              width: data.bounds.width,
              height: data.bounds.height,
              source: "selection",
            });
          } catch (error) {}
        });
        return;
      }

      // No manual selection anymore: forget any pending settle re-check
      clearInlineShapeSettle();

      // While several layers are selected (batch being lined up) the wand
      // would fire on an ambiguous target and churn the document: hold off
      const multiSelecting = batchSelectionRef.current.length > 1 && !batchRunRef.current;
      if (!bubbleAware || !inlineSourceKey.current || multiSelecting) {
        inlineShapePending.current = false;
        inlineShapeKey.current = "";
        setInlineSelectionShape((current) => (current ? null : current));
        return;
      }

      // Bubble-aware mode: magic-wand the bubble around the active text layer
      // (same detection as align-without-selection). Cached per layer ID, not
      // per layer content: the bubble doesn't move when the text changes, so
      // applying a shape must not pay for a new wand scan.
      const bubbleKey = getBubbleCacheKey(inlineLayerIdRef.current, inlineLayerBoundsRef.current, inlineSourceKey.current);
      if (bubbleKey === inlineShapeKey.current) {
        inlineShapePending.current = false;
        return;
      }
      // Layers already scanned in this session are served from memory. Each
      // wand scan is one Photoshop history state, and on a full-resolution page
      // every state holds a snapshot: without this, walking back and forth
      // through the layers of a page churned the scratch file until the whole
      // session crawled. The key follows size, not position: translating text
      // never changes the silhouette and an explicit refresh handles the rare
      // case where the text is moved to another bubble.
      const memoized = bubbleShapeCache.current.get(bubbleKey);
      if (memoized !== undefined) {
        inlineShapePending.current = false;
        inlineShapeKey.current = bubbleKey;
        setInlineSelectionShape(memoized);
        return;
      }
      csInterface.evalScript(`getActiveLayerBubbleShape(${JSON.stringify({ samples: 21, tolerance: 20 })})`, (result) => {
        inlineShapePending.current = false;
        try {
          const data = JSON.parse(result || "{}");
          // A transient "a selection is active" answer says nothing about the
          // bubble: never memoize it, or the layer stays shapeless afterwards
          if (data && (data.error === "hasSelection" || data.error === "historyBusy")) return;
          // Cache failures too: retrying the wand on every poll would spam
          // the document with temporary selections
          inlineShapeKey.current = bubbleKey;
          const shape = !data || data.error || !data.bounds
            ? null
            : {
              profile: data,
              width: data.bounds.width,
              height: data.bounds.height,
              source: "bubble",
            };
          rememberBubbleShape(bubbleShapeCache.current, bubbleKey, shape);
          setInlineSelectionShape((current) => (shape || current ? shape : current));
        } catch (error) {}
      });
    });
  }, [bubbleAware, clearInlineShapeSettle]);

  // A Photoshop 'move' action changes history but not the text or style. Read
  // only the active layer's ID/bounds/history signature, then acknowledge that
  // signature so the fallback poll does not rediscover the move as a content
  // change. Repeated arrow nudges collapse into one lightweight host call.
  const refreshInlineLayerGeometry = React.useCallback(() => {
    // A text/style refresh always has priority: its full snapshot also carries
    // the latest geometry, so acknowledging history separately would be both
    // redundant and vulnerable to racing the content read.
    if (inlineEventDebounce.current || inlineSourcePending.current) return;
    if (inlineGeometryPending.current) {
      inlineGeometryQueued.current = true;
      return;
    }
    const contentEventVersion = inlineContentEventVersion.current;
    inlineGeometryPending.current = true;
    csInterface.evalScript("getActiveTextLayerGeometry()", (result) => {
      inlineGeometryPending.current = false;
      if (contentEventVersion !== inlineContentEventVersion.current || inlineSourcePending.current) {
        inlineGeometryQueued.current = false;
        return;
      }
      let geometry = null;
      try {
        geometry = JSON.parse(result || "{}");
      } catch (error) {}

      const currentLayerId = inlineLayerIdRef.current;
      const sameLayer = geometry && geometry.layerId === currentLayerId;
      if (!sameLayer || !geometry.bounds) {
        inlineSourceSignature.current = "";
        refreshInlineLayerSource();
        refreshInlineSelectionShape();
      } else if (haveSameLayerSize(inlineLayerBoundsRef.current, geometry.bounds)) {
        inlineSourceSignature.current = geometry.signature || inlineSourceSignature.current;
        inlineLayerBoundsRef.current = geometry.bounds;
      } else {
        // Defensive path for transforms reported as moves: size changes affect
        // TextShapeR calibration and must keep the existing full refresh.
        inlineSourceSignature.current = "";
        inlineLayerBoundsRef.current = geometry.bounds;
        setInlineLayerSource((current) => (
          current.layerId === geometry.layerId ? { ...current, bounds: geometry.bounds } : current
        ));
        refreshInlineLayerSource();
        refreshInlineSelectionShape(true);
      }

      if (inlineGeometryQueued.current) {
        inlineGeometryQueued.current = false;
        refreshInlineLayerGeometry();
      }
    });
  }, [refreshInlineLayerSource, refreshInlineSelectionShape]);

  // Batch mode: the user multi-selects text layers, then chains shapes one
  // layer at a time. Photoshop only reports stacking order, so the click
  // order is reconstructed by diffing the selection on every select event.
  const refreshBatchSelection = React.useCallback(() => {
    // While a batch runs the panel drives the layer selection itself
    if (batchRunRef.current) return;
    if (batchPending.current) {
      // A click landed while a diff was in flight: queue one trailing run so
      // the final selection state is never missed
      batchQueued.current = true;
      return;
    }
    batchPending.current = true;
    requestPanelSnapshot(inlineSourceSignature.current, ({ layers }) => {
      batchPending.current = false;
      const ids = (layers || []).map((layer) => layer.id).filter((id) => typeof id === "number");
      if (ids) {
        const kept = batchOrderRef.current.filter((id) => ids.indexOf(id) !== -1);
        const added = ids.filter((id) => kept.indexOf(id) === -1);
        const nextOrder = kept.concat(added);
        batchOrderRef.current = nextOrder;
        setBatchSelection((current) => (
          current.length === nextOrder.length && current.every((id, index) => id === nextOrder[index])
            ? current
            : nextOrder
        ));
      }
      if (batchQueued.current) {
        batchQueued.current = false;
        refreshBatchSelection();
      }
    });
  }, []);

  const goToBatchLayer = React.useCallback((layerId) => {
    // Blank the source first so stale variants of the previous layer are
    // never clickable while the next one loads
    inlineSourceKey.current = "";
    inlineLayerIdRef.current = null;
    setInlineLayerSource({ text: "", style: null, key: "", layerId: null, loading: true, error: "" });
    csInterface.evalScript(`selectLayerById(${JSON.stringify(layerId)})`, () => {
      refreshInlineLayerSource(true);
      refreshInlineSelectionShape(true);
    });
  }, [refreshInlineLayerSource, refreshInlineSelectionShape]);

  const startTextShapeRBatch = React.useCallback(() => {
    const queue = batchOrderRef.current;
    if (queue.length < 2) return;
    setBatchRun({ queue: [...queue], index: 0 });
    goToBatchLayer(queue[0]);
  }, [goToBatchLayer]);

  const stopTextShapeRBatch = React.useCallback(() => {
    setBatchRun(null);
    refreshBatchSelection();
  }, [refreshBatchSelection]);

  const advanceTextShapeRBatch = React.useCallback(() => {
    const current = batchRunRef.current;
    if (!current) return;
    const nextIndex = current.index + 1;
    if (nextIndex >= current.queue.length) {
      setBatchRun(null);
      return;
    }
    setBatchRun({ ...current, index: nextIndex });
    goToBatchLayer(current.queue[nextIndex]);
  }, [goToBatchLayer]);

  React.useEffect(() => {
    if (!batchTrackingEnabled) {
      batchOrderRef.current = [];
      setBatchSelection((current) => (current.length ? [] : current));
      return undefined;
    }
    refreshBatchSelection();
    const unsubscribePhotoshopEvents = addPhotoshopEventListener((event) => {
      if (!isPhotoshopSelectEvent(event)) return;
      if (batchEventDebounce.current) clearTimeout(batchEventDebounce.current);
      batchEventDebounce.current = setTimeout(() => {
        batchEventDebounce.current = null;
        refreshBatchSelection();
      }, 120);
    });
    const fallbackTimer = setInterval(() => {
      // Skip while the user is clicking inside the panel: this round-trip runs
      // on the same Photoshop thread that has to deliver the click
      if (isPanelInteracting()) return;
      if (!document.hidden && !isHostActionPending() && !hasReceivedPhotoshopEvents()) {
        refreshBatchSelection();
      }
    }, 2500);
    return () => {
      unsubscribePhotoshopEvents();
      clearInterval(fallbackTimer);
      if (batchEventDebounce.current) {
        clearTimeout(batchEventDebounce.current);
        batchEventDebounce.current = null;
      }
    };
  }, [batchTrackingEnabled, refreshBatchSelection]);

  React.useEffect(() => {
    if (!context.state.inlineTextShapeR) return undefined;
    refreshInlineLayerSource();
    refreshInlineSelectionShape();

    // Primary signal: Photoshop notifies the panel when a layer is selected
    // or edited. Debounced because 'setd' events arrive in bursts.
    const unsubscribePhotoshopEvents = addPhotoshopEventListener((event) => {
      if (isPhotoshopMoveEvent(event)) {
        inlineLastRefreshAt.current = Date.now();
        if (inlineEventDebounce.current || inlineSourcePending.current) return;
        if (inlineMoveDebounce.current) clearTimeout(inlineMoveDebounce.current);
        inlineMoveDebounce.current = setTimeout(() => {
          inlineMoveDebounce.current = null;
          refreshInlineLayerGeometry();
        }, 120);
        return;
      }
      inlineContentEventVersion.current += 1;
      inlineGeometryQueued.current = false;
      if (inlineMoveDebounce.current) {
        clearTimeout(inlineMoveDebounce.current);
        inlineMoveDebounce.current = null;
      }
      if (inlineEventDebounce.current) clearTimeout(inlineEventDebounce.current);
      inlineEventDebounce.current = setTimeout(() => {
        inlineEventDebounce.current = null;
        refreshInlineLayerSource();
        refreshInlineSelectionShape();
      }, 120);
    });

    // No focus-triggered refresh: the panel regains focus on every click
    // coming from the Photoshop canvas, and running the layer/bubble/batch
    // refresh at that exact moment competed with the click being processed
    // (laggy style selection). Photoshop select events and the fallback
    // poll below keep the inline data fresh.

    // Fallback polling for hosts where the event bridge stays silent; slows
    // down to a keep-alive once real Photoshop events are flowing.
    const pollTimer = setInterval(() => {
      // Never queue refresh work behind a running paste/align action, nor in
      // the middle of a click the panel is still waiting to be handled
      if (document.hidden || isHostActionPending() || isPanelInteracting()) return;
      // Panel idle for minutes (Photoshop probably in the background): drop
      // to a slow keep-alive so the host is not polled for hours. Any event
      // or interaction refreshes immediately through the other paths.
      const idleDelay = isPanelIdle() ? 30000 : hasReceivedPhotoshopEvents() ? 6000 : 1200;
      if (Date.now() - inlineLastRefreshAt.current >= idleDelay) {
        refreshInlineLayerSource();
        refreshInlineSelectionShape();
      }
    }, 1200);

    return () => {
      unsubscribePhotoshopEvents();
      clearInterval(pollTimer);
      if (inlineEventDebounce.current) {
        clearTimeout(inlineEventDebounce.current);
        inlineEventDebounce.current = null;
      }
      if (inlineMoveDebounce.current) {
        clearTimeout(inlineMoveDebounce.current);
        inlineMoveDebounce.current = null;
      }
      clearInlineShapeSettle();
      inlineSourcePending.current = false;
      inlineGeometryPending.current = false;
      inlineGeometryQueued.current = false;
      inlineContentEventVersion.current += 1;
      inlineShapePending.current = false;
    };
  }, [context.state.inlineTextShapeR, refreshInlineLayerSource, refreshInlineLayerGeometry, refreshInlineSelectionShape, clearInlineShapeSettle]);

  React.useEffect(() => {
    setInlineVariantPage(0);
  }, [inlineLayerSource.key]);

  // Re-detect the bubble when the active layer changes or the mode toggles
  React.useEffect(() => {
    if (!context.state.inlineTextShapeR) return;
    refreshInlineSelectionShape();
  }, [context.state.inlineTextShapeR, inlineLayerSource.key, bubbleAware, refreshInlineSelectionShape]);

  const toggleBubbleAware = React.useCallback(() => {
    context.dispatch({ type: "setTextShapeRBubbleAware", value: !bubbleAware });
  }, [context, bubbleAware]);
  const bubbleAwareTitle = bubbleAware
    ? (locale.textShapeRBubbleToggleOn || "Bubble detection is on: suggestions fit the detected bubble. Click to turn it off.")
    : (locale.textShapeRBubbleToggleOff || "Bubble detection is off: only manual selections are used. Click to turn it on.");

  React.useEffect(() => {
    setInlineVariantPage((current) => Math.min(current, inlinePageCount - 1));
  }, [inlinePageCount]);

  const showShiftTip = React.useCallback(() => {
    setShiftSelectionWarning(true);
    if (shiftTipTimeout.current) {
      clearTimeout(shiftTipTimeout.current);
    }
    shiftTipTimeout.current = setTimeout(() => setShiftSelectionWarning(false), 3500);
  }, []);

  const showClearAllTipFunc = React.useCallback(() => {
    if (clearAllTipShown) return;
    setShowClearAllTip(true);
    setClearAllTipShown(true);
    if (clearAllTipTimeout.current) {
      clearTimeout(clearAllTipTimeout.current);
    }
    clearAllTipTimeout.current = setTimeout(() => setShowClearAllTip(false), 5000);
  }, [clearAllTipShown]);

  const closeClearAllTip = () => {
    setShowClearAllTip(false);
    if (clearAllTipTimeout.current) {
      clearTimeout(clearAllTipTimeout.current);
    }
  };

  const addSelectionAndAdvance = (selection) => {
    if (!selection) return;
    const currentLineIndex = context.state.currentLineIndex;
    const nextLine = context.state.multiBubbleMode
      ? getNextUsableLineIndex(context.state.lines || [], currentLineIndex)
      : { index: currentLineIndex, advanced: false };
    context.dispatch({
      type: "addSelectionBatch",
      entries: [{ selection, lineIndex: currentLineIndex }],
      nextLineIndex: nextLine.advanced ? nextLine.index : undefined,
    });
  };

  // Resets the stored selections AND the active Photoshop selection: leaving
  // the marquee alive would make the poll re-add it right away and advance
  // the current line behind the user's back
  const resetStoredSelections = React.useCallback((preserveLine = false) => {
    context.dispatch({ type: "clearSelections", preserveLine });
    deselectDocument();
  }, [context.dispatch]);

  const clearButtonTimeout = React.useRef(null);

  const removeLastStoredSelection = () => {
    const storedSelections = context.state.storedSelections || [];
    if (storedSelections.length === 0) return;
    context.dispatch({ type: "removeSelection", index: storedSelections.length - 1 });
    // The removed selection is usually the live marquee: drop it in Photoshop
    // too so the poll does not re-add it and advance the line
    deselectDocument();
  };

  const handleClearMouseDown = () => {
    clearButtonTimeout.current = setTimeout(() => {
      clearButtonTimeout.current = null;
      resetStoredSelections();
    }, 1000);
  };

  const handleClearMouseUp = () => {
    if (clearButtonTimeout.current) {
      clearTimeout(clearButtonTimeout.current);
      clearButtonTimeout.current = null;
      removeLastStoredSelection();
    }
  };

  const handleClearMouseLeave = () => {
    if (clearButtonTimeout.current) {
      clearTimeout(clearButtonTimeout.current);
      clearButtonTimeout.current = null;
    }
  };

  const checkForSelectionChange = React.useCallback(() => {
    if (!context.state.multiBubbleMode || context.state.modalType || document.hidden || selectionCheckPending.current || isHostActionPending()) return;
    // A click just happened inside the panel: let Photoshop's main thread
    // deliver it before spending a round-trip on selection polling
    if (isPanelInteracting()) return;
    // Idle backoff: 5 polls per second only while the user is actually
    // working; a first selection after a long pause restores the fast rate
    if (isPanelIdle() && Date.now() - selectionPollLastAt.current < 1000) return;
    selectionPollLastAt.current = Date.now();
    selectionCheckPending.current = true;

    getSelectionChanged((selection) => {
      selectionCheckPending.current = false;
      if (selection) {
        if (selection.documentChanged) {
          context.dispatch({ type: "clearSelections", preserveLine: true });
          setTimeout(() => { if (selectionCheckCallbackRef.current) selectionCheckCallbackRef.current(); }, 0);
          return;
        }
        notePanelActivity();
        // The host detected a Shift-add growing the previous selection:
        // multi-bubble needs one selection at a time, so warn instead of
        // storing a selection spanning several outlines
        if (selection.multipleSelections) {
          showShiftTip();
          return;
        }
        if (selection.multiSelection && selection.multiSelection.length > 0) {
          const storedHashSet = new Set((context.state.storedSelections || []).map((storedSelection) => getSelectionBoundsHash(storedSelection)));
          let nextLineIndex = context.state.currentLineIndex;
          const entries = [];

          for (const multiSelection of selection.multiSelection) {
            const { shiftKey, ...cleanSelection } = multiSelection;
            const selectionHash = getSelectionBoundsHash(cleanSelection);
            if (storedHashSet.has(selectionHash)) {
              continue;
            }

            storedHashSet.add(selectionHash);
            entries.push({ selection: cleanSelection, lineIndex: nextLineIndex });
            const nextLine = getNextUsableLineIndex(context.state.lines || [], nextLineIndex);
            nextLineIndex = nextLine.index;
            if (!nextLine.advanced) {
              break;
            }
          }

          if (entries.length > 0) {
            context.dispatch({
              type: "addSelectionBatch",
              entries,
              nextLineIndex: nextLineIndex !== context.state.currentLineIndex ? nextLineIndex : undefined,
            });
          }
          return;
        }

        if (selection.shiftKey) {
          showShiftTip();
          return;
        }
        const { shiftKey, ...cleanSelection } = selection;
        const newHash = getSelectionBoundsHash(cleanSelection);
        const storedHashSet = new Set((context.state.storedSelections || []).map((storedSelection) => getSelectionBoundsHash(storedSelection)));

        if (!storedHashSet.has(newHash)) {
          addSelectionAndAdvance(cleanSelection);
        }
      }
    });
  }, [context.state.multiBubbleMode, context.state.modalType, context.state.storedSelections, context.state.currentLineIndex, context.state.lines, showShiftTip]);
  selectionCheckCallbackRef.current = checkForSelectionChange;

  React.useEffect(() => {
    let unsubscribePhotoshopEvents = () => {};
    if (context.state.multiBubbleMode && !context.state.modalType) {
      startSelectionMonitoring();
      // Selection marquee changes emit Photoshop `setd` notifications. React
      // to those bursts and keep only a slow safety poll for old hosts whose
      // event bridge is unreliable, instead of hitting ExtendScript 5x/s.
      unsubscribePhotoshopEvents = addPhotoshopEventListener((event) => {
        if (isPhotoshopMoveEvent(event)) return;
        if (selectionEventDebounce.current) clearTimeout(selectionEventDebounce.current);
        selectionEventDebounce.current = setTimeout(() => {
          selectionEventDebounce.current = null;
          if (selectionCheckCallbackRef.current) selectionCheckCallbackRef.current();
        }, 100);
      });
      selectionCheckInterval.current = setInterval(() => {
        if (selectionCheckCallbackRef.current) selectionCheckCallbackRef.current();
      }, 1500);
    } else {
      stopSelectionMonitoring();
      selectionCheckPending.current = false;
      if (selectionCheckInterval.current) {
        clearInterval(selectionCheckInterval.current);
        selectionCheckInterval.current = null;
      }
    }

    return () => {
      unsubscribePhotoshopEvents();
      stopSelectionMonitoring();
      selectionCheckPending.current = false;
      if (selectionEventDebounce.current) {
        clearTimeout(selectionEventDebounce.current);
        selectionEventDebounce.current = null;
      }
      if (selectionCheckInterval.current) {
        clearInterval(selectionCheckInterval.current);
      }
      if (shiftTipTimeout.current) {
        clearTimeout(shiftTipTimeout.current);
      }
      if (clearAllTipTimeout.current) {
        clearTimeout(clearAllTipTimeout.current);
      }
      if (clearButtonTimeout.current) {
        clearTimeout(clearButtonTimeout.current);
      }
    };
  }, [context.state.multiBubbleMode, context.state.modalType]);
  React.useEffect(() => {
    if (!context.state.multiBubbleMode && shiftSelectionWarning) {
      setShiftSelectionWarning(false);
    }
  }, [context.state.multiBubbleMode, shiftSelectionWarning]);

  React.useEffect(() => {
    const storedSelections = context.state.storedSelections || [];
    if (context.state.multiBubbleMode && storedSelections.length > 10 && !clearAllTipShown) {
      showClearAllTipFunc();
    }
    if (!context.state.multiBubbleMode || storedSelections.length === 0) {
      setClearAllTipShown(false);
      setShowClearAllTip(false);
    }
  }, [context.state.multiBubbleMode, context.state.storedSelections, clearAllTipShown, showClearAllTipFunc]);

  const createLayer = React.useCallback((event) => {
    pasteInSelection(context, batchOrderRef.current, {
      preserveActiveTextSize: isShortcutActiveForEvent(event, context.state.shortcut.keepTextSize),
    });
  }, [context]);

  const insertStyledText = (event) => {
    const storedSelections = context.state.storedSelections || [];
    
    if (context.state.multiBubbleMode && storedSelections.length > 0) {
      createLayer(event);
    } else {
      const lineStyle = getScaledStyle(context.state.currentStyle, context.state.textScale);
      setActiveLayerText(line.text, lineStyle, context.state.direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      }, {
        preserveActiveTextSize: isShortcutActiveForEvent(event, context.state.shortcut.keepTextSize),
      });
    }
  };

  const currentLineClick = React.useCallback(() => {
    if (line.rawIndex === void 0) return;
    scrollToLine(line.rawIndex);
  }, [line.rawIndex]);

  const handleAlignLayer = React.useCallback(() => {
    alignTextLayerToSelection(context.state.resizeTextBoxOnCenter, context.state.internalPadding || 0, () => {
      if (context.state.multiBubbleMode && (context.state.storedSelections || []).length > 0) {
        resetStoredSelections(true);
      }
    });
  }, [context.state, resetStoredSelections]);

  const handleDecrease = React.useCallback(() => {
    changeActiveLayerTextSize(-(context.state.textSizeIncrement || 1));
  }, [context.state.textSizeIncrement]);

  const handleIncrease = React.useCallback(() => {
    changeActiveLayerTextSize(context.state.textSizeIncrement || 1);
  }, [context.state.textSizeIncrement]);

  const handlePrevLine = React.useCallback(() => {
    context.dispatch({ type: "prevLine" });
  }, [context.dispatch]);

  const handleNextLine = React.useCallback(() => {
    context.dispatch({ type: "nextLine" });
  }, [context.dispatch]);

  const handleScaleChange = React.useCallback((e) => {
    context.dispatch({ type: "setTextScale", scale: e.target.value });
  }, [context.dispatch]);

  const focusScale = React.useCallback(() => {
    if (!context.state.textScale) context.dispatch({ type: "setTextScale", scale: 100 });
  }, [context.state.textScale, context.dispatch]);

  const blurScale = React.useCallback(() => {
    if (context.state.textScale === 100) context.dispatch({ type: "setTextScale", scale: null });
  }, [context.state.textScale, context.dispatch]);

  const moveInlineTextShapeRPage = React.useCallback((direction) => {
    setInlineVariantPage((current) => {
      if (inlinePageCount <= 1) return 0;
      return (current + direction + inlinePageCount) % inlinePageCount;
    });
  }, [inlinePageCount]);

  const applyTextShapeRVariant = React.useCallback((variant, advance = false) => {
    if (!variant || applyingTextShapeRId) return;
    // In batch mode, only apply once the loaded layer really is the queued
    // one — a fast click during the layer switch must not hit the wrong layer
    if (batchRunRef.current) {
      const expectedLayerId = batchRunRef.current.queue[batchRunRef.current.index];
      if (inlineLayerSource.loading || !inlineLayerSource.layerId || inlineLayerSource.layerId !== expectedLayerId) return;
    }
    setApplyingTextShapeRId(variant.id);
    // Fast path: the style snapshot the widget already read lets the host
    // skip its own layer re-read and every style/stroke re-apply — only the
    // line breaking changes
    setLayerTextFast(variant.text, inlineLayerSource.style, context.state.direction, (ok) => {
      setApplyingTextShapeRId(null);
      if (!ok) return;
      context.dispatch({ type: "recordTextShapeRUse" });
      // In batch mode a picked shape moves on to the next queued layer
      if (batchRunRef.current) {
        advanceTextShapeRBatch();
        return;
      }
      setTextShapeRUndoDepth((depth) => depth + 1);
      // The layer text now IS the applied variant: update the source locally
      // instead of paying a read roundtrip; the debounced Photoshop event
      // refresh will confirm silently (same key, no re-render)
      setInlineLayerSource((current) => {
        const next = { ...current, text: variant.text, loading: false, error: "" };
        next.key = getLayerSourceKey(next);
        inlineSourceKey.current = next.key;
        return next;
      });
      if (advance) context.dispatch({ type: "nextLine", add: true });
    });
  }, [applyingTextShapeRId, context, inlineLayerSource.style, inlineLayerSource.loading, inlineLayerSource.layerId, advanceTextShapeRBatch]);

  // Hover refresh is a fallback for missed Photoshop events: rate-limit it so
  // sweeping the cursor over the widget doesn't queue ExtendScript roundtrips
  const handleTextShapeRMouseEnter = React.useCallback(() => {
    if (Date.now() - inlineLastRefreshAt.current < 800 || isHostActionPending()) return;
    refreshInlineLayerSource();
    refreshInlineSelectionShape();
  }, [refreshInlineLayerSource, refreshInlineSelectionShape]);

  // Jumps Photoshop history back to just before the last applied shape —
  // the panel equivalent of Ctrl+Z after trying a shape
  const undoTextShapeRApply = React.useCallback(() => {
    if (applyingTextShapeRId || batchRunRef.current) return;
    undoLastTextChange((ok) => {
      if (!ok) return;
      setTextShapeRUndoDepth((depth) => Math.max(0, depth - 1));
      inlineSourceKey.current = "";
      refreshInlineLayerSource(true);
    });
  }, [applyingTextShapeRId, refreshInlineLayerSource]);

  // "This shape is the best": learn from the line breaks the user typeset by
  // hand on the selected layer, so future suggestions drift toward that
  // style. Shift-click resets everything learned so far.
  const [shapeFeedbackFlash, setShapeFeedbackFlash] = React.useState("");
  const [textShapeRLearning, setTextShapeRLearning] = React.useState(false);
  const shapeFeedbackTimer = React.useRef(null);
  React.useEffect(() => () => {
    if (shapeFeedbackTimer.current) clearTimeout(shapeFeedbackTimer.current);
  }, []);
  const flashShapeFeedback = React.useCallback((message) => {
    setShapeFeedbackFlash(message);
    if (shapeFeedbackTimer.current) clearTimeout(shapeFeedbackTimer.current);
    shapeFeedbackTimer.current = setTimeout(() => setShapeFeedbackFlash(""), 3000);
  }, []);
  const markLayerShapeAsBest = React.useCallback((event) => {
    if (event?.shiftKey) {
      nativeConfirm(
        locale.confirmResetTextShapeR || "Reset all learned text shape preferences?",
        locale.confirmTitle || "Confirmation",
        (confirmed) => {
          if (!confirmed) return;
          if (textShapeREngine) textShapeREngine.setTextShapeRTuning(null);
          context.dispatch({ type: "setTextShapeRTuning", value: null });
          flashShapeFeedback(locale.textShapeRMarkBestReset || "Learned shape preferences reset");
        }
      );
      return;
    }
    if (event?.altKey || event?.ctrlKey) {
      // Batch-learn from every visible text layer of the document, feeding
      // each layer's lesson into the next so the whole page counts. Alt-click
      // also re-detects the bubble around each layer (same wand scan as
      // bubble-aware) so exemplars keep their outline context; Ctrl-click
      // skips the scans and stays fast.
      setTextShapeRLearning(true);
      getAllLayersRenderedTexts(!!event.altKey, (entries) => {
        try {
          if (!entries.length) {
            flashShapeFeedback(locale.textShapeRLearnAllEmpty || "No text layers found to learn from");
            return;
          }
          let tuningState = context.state.textShapeRTuning;
          let learned = 0;
          entries.forEach((entry) => {
            const result = textShapeREngine && textShapeREngine.recordTextShapeRFeedback(entry.text, {
              limit: 12,
              allowHyphenation: true,
              profile: "balanced",
              shapeProfile: entry.bubble ? { rows: entry.bubble.rows } : null,
              width: entry.bubble?.width,
              height: entry.bubble?.height,
            }, tuningState);
            if (!result) return;
            tuningState = result.tuning;
            // Each sample generates against the tuning the previous one taught
            textShapeREngine.setTextShapeRTuning(tuningState);
            learned += 1;
          });
          if (!learned) {
            flashShapeFeedback(locale.textShapeRLearnAllEmpty || "No text layers found to learn from");
            return;
          }
          context.dispatch({ type: "setTextShapeRTuning", value: tuningState, learned: true });
          flashShapeFeedback((locale.textShapeRLearnAllSaved || "Learned from {count} layers — suggestions will follow this style")
            .replace("{count}", learned));
        } finally {
          setTextShapeRLearning(false);
        }
      });
      return;
    }
    if (!textShapeREngine || !inlineLayerSource.text || inlineLayerSource.loading) return;
    // textKey only holds manual returns: box (paragraph) layers also wrap
    // automatically, so the visual shape must be read off the host, which
    // materializes those wraps on a throwaway point-text copy of the layer
    getActiveLayerRenderedText((renderedText) => {
      const result = textShapeREngine.recordTextShapeRFeedback(renderedText || inlineLayerSource.text, {
        limit: 12,
        allowHyphenation: true,
        profile: "balanced",
        shapeProfile: inlineSelectionShape?.profile || null,
        width: inlineSelectionShape?.width,
        height: inlineSelectionShape?.height,
        calibration: inlineCalibration,
      }, context.state.textShapeRTuning);
      if (!result) return;
      // Apply to the generator before dispatching so the re-render (whose memo
      // depends on the stored tuning) already sees the new knobs
      textShapeREngine.setTextShapeRTuning(result.tuning);
      context.dispatch({ type: "setTextShapeRTuning", value: result.tuning, learned: true });
      flashShapeFeedback((locale.textShapeRMarkBestSaved || "Preference saved ({count} lines) — suggestions will follow this style")
        .replace("{count}", result.chosenLineCount));
    });
  }, [inlineLayerSource.text, inlineLayerSource.loading, inlineSelectionShape, inlineCalibration, context, flashShapeFeedback, textShapeREngine]);

  const handleIncrementChange = React.useCallback((e) => {
    context.dispatch({ type: "setTextSizeIncrement", increment: e.target.value });
  }, [context.dispatch]);

  const handleIncrementBlur = React.useCallback(() => {
    if (!context.state.textSizeIncrement || context.state.textSizeIncrement < 1) {
      context.dispatch({ type: "setTextSizeIncrement", increment: 1 });
    }
  }, [context.state.textSizeIncrement, context.dispatch]);

  const showTextShapeRLearnTip = context.state.textShapeRLearnTipVisible &&
    !context.state.textShapeRLearnUsed &&
    !!inlineLayerSource.text &&
    !inlineLayerSource.loading &&
    !batchRun;

  return (
    <React.Fragment>
      <style type="text/css">{fontPreviewRegistry.css}</style>
      <div className="preview-top">
        {context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0 && (
          <div className="preview-top_selection-controls">
            <div className="preview-top_selection-info">
              <span className="preview-top_selection-count">{context.state.storedSelections.length} {context.state.storedSelections.length > 1 ? (locale.selectionsCount || 'selections') : (locale.selectionCount || 'selection')}</span>
              <button
                className="topcoat-icon-button--large"
                title={locale.clearSelections || "Remove the last selection (hold 1s to clear all)"}
                onMouseDown={handleClearMouseDown}
                onMouseUp={handleClearMouseUp}
                onMouseLeave={handleClearMouseLeave}
              >
                <FiMinusCircle size={16} />
              </button>
            </div>
          </div>
        )}
        {context.state.multiBubbleMode && context.state.showTips !== false && shiftSelectionWarning && (
          <div className="preview-top_selection-warning">
            <FiAlertTriangle size={14} />
            <span>{locale.multiBubbleShiftTip || "Multi-bubble works with one selection at a time. Release Shift and create selections one by one."}</span>
          </div>
        )}
        {context.state.multiBubbleMode && context.state.showTips !== false && showClearAllTip && (
          <div className="preview-top_selection-tip">
            <FiMinusCircle size={14} />
            <span>{locale.multiBubbleClearAllTip || "Tip: Hold the - button for 1 second to clear all selections at once"}</span>
            <button
              className="preview-top_selection-tip-close"
              onClick={closeClearAllTip}
              title={locale.close || "Close"}
            >
              <FiX size={14} />
            </button>
          </div>
        )}
        {context.state.inlineTextShapeR && context.state.showTips !== false && context.state.textShapeRPerformanceTipVisible && (
          <div className="preview-top_textshaper-performance-tip">
            <FiAlertTriangle size={14} />
            <span>
              {locale.textShapeRPerformanceTip || "TextShapeR can impact Photoshop performance, especially on lower-end computers."}
            </span>
            <button
              className="preview-top_selection-tip-close"
              onClick={() => context.dispatch({ type: "hideTextShapeRPerformanceTip" })}
              title={locale.close || "Close"}
            >
              <FiX size={14} />
            </button>
          </div>
        )}
        {showPreviewMainControls && <div className="preview-top_main-controls">
          {uiVisible.previewCreateButton !== false && (
            <button className={"preview-top_big-btn preview-top_big-btn--small topcoat-button--large--cta" + (context.state.keepSizeHeld ? " m-keep-size" : "")} title={`${withShortcutHint(
              context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0
                ? (locale.multiBubbleCreateLayersDescr || "Paste {count} text layer(s)").replace("{count}", context.state.storedSelections.length)
                : locale.createLayerDescr,
              context.state.shortcut.add
            )}\n${withShortcutHint(locale.shortcut_keepTextSizeDescr || "Hold to keep the selected text layer size", context.state.shortcut.keepTextSize)}`} onClick={createLayer}>
              <AiOutlineBorderInner size={18} /> {locale.createLayer}
              {context.state.keepSizeHeld && (
                <span className="keep-size-badge" title={locale.shortcut_keepTextSize}>
                  <FiLock size={9} />
                </span>
              )}
            </button>
          )}
          {uiVisible.previewAlignButton !== false && (
            <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large" title={withShortcutHint(locale.alignLayerDescr, context.state.shortcut.center)} onClick={handleAlignLayer}>
              <MdCenterFocusWeak size={18} /> {locale.alignLayer}
            </button>
          )}
          {context.state.multiBubbleMode && (
            <button
              className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large"
              title={withShortcutHint(locale.bubbleDetectButtonDescr || "Detect the speech bubbles of the open document", context.state.shortcut.detectBubbles)}
              onClick={() => context.dispatch({ type: "setModal", modal: "bubbleDetect" })}
            >
              <FiCrosshair size={18} /> {locale.bubbleDetectButton || "Detect"}
            </button>
          )}
          <button
            className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large"
            title={locale.bubbleTrainerButtonDescr}
            onClick={() => context.dispatch({ type: "setModal", modal: "bubbleDetectTrainer" })}
          >
            <FaMagic size={16} /> {locale.bubbleTrainerButton}
          </button>
          {uiVisible.previewSizeControls !== false && (
            <div className="preview-top_change-size-cont">
              <button className="topcoat-icon-button--large" title={locale.layerTextSizeMinus} onClick={handleDecrease}>
                <FiMinusCircle size={18} />
              </button>
              <div className="preview-top_size-input">
                <input min={1} max={99} type="number" value={context.state.textSizeIncrement || ""} onChange={handleIncrementChange} onBlur={handleIncrementBlur} className="topcoat-text-input" />
                <span>px</span>
              </div>
              <button className="topcoat-icon-button--large" title={locale.layerTextSizePlus} onClick={handleIncrease}>
                <FiPlusCircle size={18} />
              </button>
            </div>
          )}
        </div>}
      </div>
      {(uiVisible.previewNav !== false || uiVisible.previewWidget !== false) && (
      <div className="preview-bottom">
        {uiVisible.previewNav !== false && (
        <div className="preview-nav">
          <button className="topcoat-icon-button--large" title={locale.prevLine} onClick={handlePrevLine}>
            <FiArrowUp size={18} />
          </button>
          <button className="topcoat-icon-button--large" title={locale.nextLine} onClick={handleNextLine}>
            <FiArrowDown size={18} />
          </button>
        </div>
        )}
        {uiVisible.previewWidget === false ? null : context.state.inlineTextShapeR && textShapeRLearning ? (
          <div className="preview-textshaper-learning hostBgdDark" role="status" aria-live="polite">
            <span className="preview-textshaper-learning-label">
              {locale.textShapeRLearning || "Learning text shape..."}
            </span>
            <span className="preview-textshaper-learning-track" aria-hidden="true">
              <span className="preview-textshaper-learning-bar" />
            </span>
          </div>
        ) : context.state.inlineTextShapeR ? (
          <div className={"preview-textshaper hostBgdDark" + (showTextShapeRLearnTip ? " has-learn-tip" : "")} onMouseEnter={handleTextShapeRMouseEnter}>
            <div className="preview-textshaper-head">
              <div className="preview-textshaper-title">
                <span>{locale.textShapeRTitle || "TextShapeR"}</span>
              </div>
              <div className="preview-textshaper-pager">
                {batchRun ? (
                  <span className="preview-textshaper-batch-run">
                    <span
                      className="preview-textshaper-batch-progress"
                      title={(locale.textShapeRBatchProgress || "Batch: shaping layer {current} of {total}")
                        .replace("{current}", batchRun.index + 1)
                        .replace("{total}", batchRun.queue.length)}
                    >
                      {batchRun.index + 1}/{batchRun.queue.length}
                    </span>
                    <button
                      type="button"
                      onClick={advanceTextShapeRBatch}
                      title={locale.textShapeRBatchSkip || "Skip this layer and go to the next one"}
                    >
                      <FiChevronsRight size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={stopTextShapeRBatch}
                      title={locale.textShapeRBatchStop || "Stop the batch"}
                    >
                      <FiX size={12} />
                    </button>
                  </span>
                ) : batchSelection.length >= 2 ? (
                  <button
                    type="button"
                    className="preview-textshaper-batch-start"
                    onClick={startTextShapeRBatch}
                    title={(locale.textShapeRBatchStart || "Chain shapes over the {count} selected text layers, in the order you picked them")
                      .replace("{count}", batchSelection.length)}
                  >
                    <FiPlay size={10} />
                    <span>{batchSelection.length}</span>
                  </button>
                ) : null}
                {inlineSelectionShape ? (
                  <span
                    className={"preview-textshaper-shape-dot" + (inlineSelectionShape.source === "bubble" ? " is-bubble" : "")}
                    title={inlineSelectionShape.source === "bubble"
                      ? (locale.textShapeRBubbleActive || "Shapes follow the detected bubble outline")
                      : (locale.textShapeRShapeActive || "Shapes follow the current selection outline")}
                  />
                ) : null}
                <button
                  type="button"
                  className={"preview-textshaper-bubble-toggle" + (bubbleAware ? " is-active" : "")}
                  onClick={toggleBubbleAware}
                  title={bubbleAwareTitle}
                >
                  <FaMagic size={10} />
                </button>
                <span className="preview-textshaper-learn-anchor">
                  {showTextShapeRLearnTip ? (
                    <span className="preview-textshaper-learn-tip" role="status">
                      <FiInfo size={12} />
                      <span className="preview-textshaper-learn-tip-text">
                        {locale.textShapeRLearnTip || "Improve TextShapeR with your own typesets: click the star to teach it your style. Ctrl-click the star to automatically learn from the visible text layers on the current page."}
                        <span className="preview-textshaper-learn-info">
                          {locale.textShapeRLearnInfo || "TextShapeR does not use generative AI."}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="preview-textshaper-learn-tip-close"
                        onClick={() => context.dispatch({ type: "hideTextShapeRLearnTip" })}
                        title={locale.close || "Close"}
                        aria-label={locale.close || "Close"}
                      >
                        <FiX size={11} />
                      </button>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={"preview-textshaper-markbest" + (context.state.textShapeRTuning?.samples ? " is-active" : "")}
                    onClick={markLayerShapeAsBest}
                    disabled={!inlineLayerSource.text || inlineLayerSource.loading || !!batchRun}
                    title={locale.textShapeRMarkBest || "Learn text shape. Alt-click: all layers + bubble outlines. Ctrl-click: all layers (fast). Shift-click: reset."}
                  >
                    <FiStar size={11} />
                  </button>
                </span>
                <button
                  type="button"
                  onClick={undoTextShapeRApply}
                  disabled={!textShapeRUndoDepth || !!applyingTextShapeRId || !!batchRun}
                  title={locale.textShapeRUndo || "Undo the last applied shape (steps Photoshop history back)"}
                >
                  <FiRotateCcw size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => moveInlineTextShapeRPage(-1)}
                  disabled={inlinePageCount <= 1}
                  title={locale.textShapeRPreviousSuggestions || "Show previous TextShapeR suggestions"}
                >
                  <FiChevronLeft size={12} />
                </button>
                <span>{inlineLayerSource.loading ? (locale.textShapeRLayerLoading || "Reading selected layer...") : `${inlineVariantPage + 1}/${inlinePageCount}`}</span>
                <button
                  type="button"
                  onClick={() => moveInlineTextShapeRPage(1)}
                  disabled={inlinePageCount <= 1}
                  title={locale.textShapeRNextSuggestions || "Show next TextShapeR suggestions"}
                >
                  <FiChevronRight size={12} />
                </button>
              </div>
            </div>
            {shapeFeedbackFlash ? (
              <div className="preview-textshaper-feedback">{shapeFeedbackFlash}</div>
            ) : null}
            <div className="preview-textshaper-list">
              {visibleInlineVariants.length ? visibleInlineVariants.map((variant, index) => (
                <button
                  key={variant.id}
                  type="button"
                  className={"preview-textshaper-choice" + (applyingTextShapeRId === variant.id ? " is-applying" : "")}
                  onClick={(event) => applyTextShapeRVariant(variant, event.shiftKey)}
                  title={locale.textShapeRInlineApplyHint || "Apply this text shape to the selected Photoshop text layer. Shift-click also moves to the next line."}
                >
                  <span className="preview-textshaper-rank">{inlineVariantPage * inlinePageSize + index + 1}</span>
                  <TextShapeRFitPreview
                    outerClassName="preview-textshaper-text"
                    innerClassName="preview-textshaper-fit"
                    contentKey={`${variant.text}|${markdownEnabled}|${inlinePreviewStyleObject.fontFamily}`}
                    style={inlinePreviewStyleObject}
                  >
                    {variant.lines.map((variantLine, lineIndex) => (
                      <span key={`${variant.id}-${lineIndex}`} className="preview-textshaper-line">
                        {renderMarkdownText(variantLine)}
                      </span>
                    ))}
                  </TextShapeRFitPreview>
                </button>
              )) : (
                <div className="preview-textshaper-empty">{inlineLayerSource.error || locale.textShapeREmpty || "No text available for TextShapeR."}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="preview-current hostBgdDark" title={locale.scrollToLine} onClick={currentLineClick}>
            <div className="preview-line-info">
              <div className="preview-line-info-text">
                {locale.previewLine}: <b>{line.index || "—"}</b>, {locale.previewStyle}: <b className="preview-line-style-name">{style.name || "—"}</b>, {locale.previewTextScale}:
                <div className="preview-line-scale">
                  <input min={1} max={999} type="number" placeholder="100" value={context.state.textScale || ""} onChange={handleScaleChange} onFocus={focusScale} onBlur={blurScale} className="topcoat-text-input" />
                  <span>%</span>
                </div>
              </div>
              <div className="preview-line-info-actions">
                <FiArrowRightCircle size={16} className={context.state.keepSizeHeld ? "m-keep-size" : ""} onClick={insertStyledText} title={`${withShortcutHint(locale.insertStyledText, context.state.shortcut.apply)}\n${withShortcutHint(locale.shortcut_keepTextSizeDescr || "Hold to keep the selected text layer size", context.state.shortcut.keepTextSize)}`} />
              </div>
            </div>
            <div className="preview-line-text" style={previewStyleObject}>
              <span style={{ fontFamily: previewStyleObject.fontFamily }}>
                {renderMarkdownText(line.text || "")}
              </span>
            </div>
          </div>
        )}
      </div>
      )}
    </React.Fragment>
  );
});

export default PreviewBlock;
