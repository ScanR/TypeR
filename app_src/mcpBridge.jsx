import React from "react";

import pkg from "../package.json";
import {
  buildRichTextPayload,
  csInterface,
  deselectDocument,
  getDefaultStroke,
  getDefaultStyle,
  getUserFonts,
  readStorage,
  refreshUserFonts,
  rgbToHex,
  trackHostAction,
  writeToStorage,
} from "./utils";
import { useContext } from "./context";
import { getScaledStyle, resolveStylePointText } from "./textLayerPayload";
import {
  bubbleToSelection,
  detectLearnedBubbles,
  getDetectionOptions,
  normalizeBubbleLearning,
  orderBubbles,
} from "./bubbleDetection";
import { getImagePageNumber } from "./pageImageMapping";
import { createFontContactSheet } from "./fontContactSheet";
import { createTextShapeContactSheet, sampleBubbleShapeProfile } from "./textShapeContactSheet";
import { parsePageMarker } from "./pageMarker";
import { scriptRevision, pageRange, nextPageLine, validateBounds, createOperationStore, polygonProfile } from "./mcpLogic";
import { createAdvancedCommands } from "./mcpAdvanced";
import contract from "../plugins/typer/mcp/contract.mjs";

// Local HTTP bridge for the TypeR MCP server (see docs/mcp/BRIDGE_API.md and
// mcp/). It listens on 127.0.0.1 only and requires the random token written
// to the discovery file, so only same-user local processes can drive it.
// Set storage key "mcpBridgeDisabled" to true to keep it off.
const BRIDGE_PORTS = [17845, 17846, 17847, 17848, 17849, 17850, 17851, 17852, 17853, 17854];
const DISCOVERY_FILENAME = "typer-mcp-bridge.json";
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT = 30000;
const LONG_TIMEOUT = 120000;
const LONG_COMMANDS = [
  "get_layers", "measure_text", "fit_text", "review_page", "get_region_image", "export_page", "sample_bubble", "learning",
  "detect_bubbles",
  "get_snapshot",
  "preview_fonts",
  "preview_text_shapes",
  "batch_paste",
  "edit_layer",
  "save_document"
];
const LEARNING_STORAGE_KEY = "bubbleDetectionLearning";
const SNAPSHOT_MAX_DIM = 1500;

const appVersion = pkg.version;

const getNodeRequire = () =>
  (window.cep_node && window.cep_node.require) ||
  (typeof window.require === "function" ? window.require : null);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class BridgeError extends Error {}
const fail = (message) => {
  throw new BridgeError(message);
};

// dispatch comes from useReducer and is asynchronous: after dispatching, the
// new state only reaches getState() on the next render. Poll until the
// predicate holds instead of guessing with a fixed delay.
const waitForState = (getState, predicate, timeout = 1500) => new Promise((resolve, reject) => {
  const startedAt = Date.now();
  const check = () => {
    const state = getState();
    if (predicate(state)) return resolve(state);
    if (Date.now() - startedAt >= timeout) return reject(new BridgeError("state_timeout"));
    setTimeout(check, 16);
  };
  check();
});

let expectedHostDocument = null;
let expectedHostKey = null;
const evalHost = (expression) => new Promise((resolve, reject) => {
  const guarded = `evalTypeRMcpHost(${JSON.stringify(expression)},${JSON.stringify(expectedHostDocument)},${JSON.stringify(expectedHostKey)})`;
  csInterface.evalScript(guarded, trackHostAction(result => {
    if (/^(wrongDocument|wrongDocumentSession|EvalScript error|scriptError:)/.test(String(result))) reject(new BridgeError(String(result)));
    else resolve(result);
  }));
});
const hostJSON = async expression => {
  const raw = await evalHost(expression);
  let result;
  try { result = JSON.parse(raw); } catch (error) { fail(`host_error: ${raw || "empty_response"}`); }
  if (!result || result.error) fail(result && result.error || "empty_host_result");
  return result;
};

const lineSummary = (line) => (line ? {
  rawIndex: line.rawIndex,
  displayIndex: line.ignore ? null : line.index,
  text: line.text,
  rawText: line.rawText,
  page: parsePageMarker(line.rawText),
  ignore: !!line.ignore,
  styleId: (line.usedStyle || line.style || {}).id || null,
  styleName: (line.usedStyle || line.style || {}).name || null,
} : null);

const styleSummary = (style, folders) => {
  const textStyle = ((((style.textProps || {}).layerText || {}).textStyleRange || [])[0] || {}).textStyle || {};
  const paragraphStyle = ((((style.textProps || {}).layerText || {}).paragraphStyleRange || [])[0] || {}).paragraphStyle || {};
  const color = textStyle.color || null;
  const folder = style.folder ? (folders || []).find((candidate) => candidate.id === style.folder) : null;
  return {
    id: style.id,
    name: style.name,
    folder: style.folder || null,
    folderName: folder ? folder.name : null,
    prefixes: (style.prefixes || []).filter(Boolean),
    textType: style.textType || null,
    fontPostScriptName: textStyle.fontPostScriptName || textStyle.fontName || null,
    fontFamily: textStyle.fontName || null,
    fontStyle: textStyle.fontStyleName || null,
    fontSize: typeof textStyle.size === "number" ? textStyle.size : null,
    alignment: paragraphStyle.alignment || "center",
    pointText: resolveStylePointText(style, false),
    textStyle,
    paragraphStyle,
    stroke: style.stroke || null,
    colorHex: color ? rgbToHex({ r: color.red, g: color.green, b: color.blue }) : null,
  };
};

const boundsSummary = (selection) => ({
  left: selection.left,
  top: selection.top,
  right: selection.right,
  bottom: selection.bottom,
  width: selection.width,
  height: selection.height,
});

const requireBounds = bounds => validateBounds(bounds);

// Same flow as the bubbleDetect modal scan: host snapshot PNG, decoded to
// ImageData through an off-screen canvas (the bridge runs in the panel DOM).
const decodeSnapshot = (maxDim) => new Promise((resolve, reject) => {
  hostJSON(`typeRMcpExport(${JSON.stringify({ maxDim: maxDim || SNAPSHOT_MAX_DIM })})`).then((result) => {
    if (!result || result.error || !result.path) {
      return reject(new BridgeError(result && result.error === "doc" ? "no_document" : "snapshot_failed"));
    }
    const read = window.cep.fs.readFile(result.path, window.cep.encoding.Base64);
    if (!read || read.err || !read.data) return reject(new BridgeError("snapshot_read_failed"));
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const canvasContext = canvas.getContext("2d");
        canvasContext.drawImage(image, 0, 0);
        resolve({
          pixels: canvasContext.getImageData(0, 0, canvas.width, canvas.height),
          path: result.path,
          imageWidth: canvas.width,
          imageHeight: canvas.height,
          docWidth: result.docWidth || canvas.width,
          docHeight: result.docHeight || canvas.height,
        });
      } catch (error) {
        reject(new BridgeError("snapshot_decode_failed"));
      }
    };
    image.onerror = () => reject(new BridgeError("snapshot_decode_failed"));
    image.src = "data:image/png;base64," + read.data;
    if (result.temporary) { try { getNodeRequire()("fs").unlinkSync(result.path); } catch (cleanupError) {} }
  }).catch(reject);
});

const resolveStyle = (state, styleId, line) => {
  if (styleId) {
    const style = (state.styles || []).find((candidate) => candidate.id === styleId);
    if (!style) fail(`bad_params: unknown styleId ${styleId}`);
    return style;
  }
  return (line && (line.usedStyle || line.style)) || state.currentStyle || null;
};

const getFonts = () => new Promise((resolve) => {
  const cached = getUserFonts();
  if (cached.length) {
    resolve(cached);
    return;
  }
  refreshUserFonts(resolve);
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const applyStyleOverrides = async (baseStyle, params) => {
  const style = clone(baseStyle || { textProps: getDefaultStyle(), stroke: getDefaultStroke() });
  if (!style.textProps) style.textProps = getDefaultStyle();
  if (!style.stroke) style.stroke = getDefaultStroke();
  const textStyle = style.textProps.layerText.textStyleRange[0].textStyle;
  const paragraphStyle = style.textProps.layerText.paragraphStyleRange[0].paragraphStyle;
  if (params.fontPostScriptName || params.fontFamily) {
    const fonts = await getFonts();
    const font = fonts.find((candidate) => candidate.postScriptName === params.fontPostScriptName)
      || fonts.find((candidate) => candidate.family === params.fontFamily && (!params.fontStyle || candidate.style === params.fontStyle));
    if (!font) fail("bad_params: requested font is not installed in Photoshop");
    textStyle.fontPostScriptName = font.postScriptName;
    textStyle.fontStyleName = font.style;
    textStyle.fontName = font.name;
  }
  if (typeof params.fontSize === "number" && params.fontSize > 0) {
    textStyle.size = params.fontSize;
    if (textStyle.impliedFontSize != null) textStyle.impliedFontSize = params.fontSize;
  }
  if (params.alignment) paragraphStyle.alignment = params.alignment;
  if (params.color && [params.color.r, params.color.g, params.color.b].every((value) => typeof value === "number")) {
    textStyle.color = { red: params.color.r, green: params.color.g, blue: params.color.b };
  }
  if (typeof params.pointText === "boolean") style.textType = params.pointText ? "point" : "paragraph";
  if (params.textType) style.textType = params.textType;
  if (params.prefixes) style.prefixes = params.prefixes;
  if (params.folderId !== undefined) style.folder = params.folderId || null;
  for (const key of ["leading", "autoLeading", "tracking", "horizontalScale", "verticalScale", "baselineShift"]) {
    if (params[key] !== undefined) textStyle[key] = params[key];
  }
  if (params.leading != null && params.autoLeading !== true) textStyle.autoLeading = false;
  if (params.autoLeading === true) delete textStyle.leading;
  if (params.fontSize != null) style.sizePresets = [];
  if (params.stroke) style.stroke = { ...style.stroke, ...params.stroke };
  if (params.direction) paragraphStyle.directionType = params.direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
  return style;
};

const generateShapeVariants = async (state, text, options) => {
  const engine = await import(/* webpackChunkName: "text-shaper-engine" */ "./textShapeR");
  engine.setDehyphenationEnabled(state.dehyphenateTextShapeR === true);
  engine.setTextShapeRTuning(state.textShapeRTuning || null);
  if (typeof options.manualLineCount === "number") {
    const manual = engine.generateManualTextShapeRVariant(text, {
      lineCount: options.manualLineCount,
      width: options.width,
      height: options.height,
      shapeProfile: options.shapeProfile || null,
    });
    return manual ? [manual] : [];
  }
  return engine.generateTextShapeRVariants(text, {
    limit: clamp(options.limit || 8, 1, 20),
    allowHyphenation: options.allowHyphenation !== false,
    profile: options.profile || "balanced",
    width: options.width,
    height: options.height,
    shapeProfile: options.shapeProfile || null,
  });
};

// Mirrors utils.createTextLayersInStoredSelections without its nativeAlert
// error path: a headless caller must get the host error string back, never a
// modal Photoshop dialog.
const hostBatchPaste = async (state, texts, styles, selections, pointText, padding) => {
  const parsedTexts = texts.map((line) => buildRichTextPayload(line));
  const data = JSON.stringify({
    texts: parsedTexts.map((entry) => entry.text),
    richTextRuns: parsedTexts.map((entry) => entry.richTextRuns),
    styles,
    pointModes: styles.map((style) => resolveStylePointText(style, pointText)),
    selections,
    padding: padding || 0,
    direction: state.direction,
    mcp: true,
  });
  return hostJSON("createTextLayersInStoredSelections(" + data + ", " + !!pointText + ")");
};

const buildPasteEntries = async (state, entries, options) => {
  const texts = [];
  const styles = [];
  const selections = [];
  const commitEntries = [];
  let fallbackCursor = state.currentLineIndex;
  const capturedAt = Date.now();
  const range = options.allowCrossPage ? { start: 0, end: state.lines.length } : pageRange(state.lines || [], state.currentLineIndex);
  const documentInfo = await commands.document_info();

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const selection = validateBounds(entry.bounds, documentInfo);
    const outline = entry.polygon ? polygonProfile(entry.polygon, selection) : entry.shapeProfile || null;
    let line = null;
    if (typeof entry.lineIndex === "number") {
      if (entry.lineIndex < range.start || entry.lineIndex >= range.end) fail("page_boundary: line belongs to another page");
      line = (state.lines || [])[entry.lineIndex];
      if (!line || line.ignore) fail(`bad_params: entry ${index} lineIndex ${entry.lineIndex} is not a usable line`);
      fallbackCursor = Math.max(fallbackCursor, entry.lineIndex + 1);
    } else if (entry.text == null) {
      const usable = nextPageLine(state.lines || [], fallbackCursor, range);
      if (usable === null) fail(`bad_params: entry ${index} has no text and no script line is left`);
      line = state.lines[usable];
      fallbackCursor = usable + 1;
    }
    let text = entry.text != null ? String(entry.text) : line.text;
    if (!text) fail(`bad_params: entry ${index} resolves to empty text`);
    let style = resolveStyle(state, entry.styleId, line)
      || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    style = await applyStyleOverrides(getScaledStyle(style, state.textScale), entry.typography || {});
    const autoShape = entry.autoShape != null ? !!entry.autoShape : options.autoShape !== false;
    if (autoShape && (entry.forceShape || text.indexOf("\n") === -1)) {
      const variants = await generateShapeVariants(state, text, {
        limit: 1,
        allowHyphenation: entry.allowHyphenation != null ? entry.allowHyphenation : options.allowHyphenation,
        profile: entry.profile || options.profile,
        width: selection.width,
        height: selection.height,
        shapeProfile: outline,
      });
      if (variants[0]) text = variants[0].text;
    }
    texts.push(text);
    styles.push(style);
    selections.push({
      ...selection,
      capturedAt,
      documentKey: documentInfo.documentKey,
      bubbleId: entry.bubbleId || null,
      shapeProfile: outline,
      styleId: style.id || null,
      lineIndex: line ? line.rawIndex : undefined,
    });
    if (line) commitEntries.push({ lineIndex: line.rawIndex, styleId: style.id || null });
  }

  return { texts, styles, selections, commitEntries };
};

const commands = {
  status: async ({ getState }) => {
    const state = getState();
    return {
      version: appVersion,
      linesTotal: (state.lines || []).length,
      currentLineIndex: state.currentLineIndex,
      stylesTotal: (state.styles || []).length,
      multiBubbleMode: !!state.multiBubbleMode,
      storedSelections: (state.storedSelections || []).length,
      direction: state.direction || "ltr",
      imagesTotal: (state.images || []).length,
    };
  },

  get_state: async ({ getState }, params) => {
    const state = getState();
    const result = {
      scriptRevision: scriptRevision(state.text),
      pageRange: pageRange(state.lines || [], state.currentLineIndex),
      currentTabId: state.currentTabId,
      lines: (state.lines || []).map(lineSummary),
      currentLineIndex: state.currentLineIndex,
      currentLine: lineSummary(state.currentLine),
      currentStyleId: state.currentStyleId || null,
      direction: state.direction || "ltr",
      multiBubbleMode: !!state.multiBubbleMode,
      storedSelections: (state.storedSelections || []).length,
      images: (state.images || []).map((image) => ({
        name: image.name,
        path: image.path,
        page: getImagePageNumber(image),
      })),
      lastOpenedImagePath: state.lastOpenedImagePath || null,
      settings: {
        pastePointText: !!state.pastePointText,
        internalPadding: state.internalPadding || 0,
        textScale: state.textScale || null,
      },
    };
    if (params.includeText) result.text = state.text || "";
    return result;
  },

  set_text: async ({ getState, dispatch }, params) => {
    if (typeof params.text !== "string") fail("bad_params: text must be a string");
    if (params.expectedScriptRevision && params.expectedScriptRevision !== scriptRevision(getState().text)) fail("script_changed");
    dispatch({ type: "setText", text: params.text });
    const state = await waitForState(getState, (next) => next.text === params.text);
    return { linesTotal: (state.lines || []).length };
  },

  set_current_line: async ({ getState, dispatch }, params) => {
    const state = getState();
    const line = (state.lines || [])[params.rawIndex];
    if (!line) fail(`bad_params: no line at rawIndex ${params.rawIndex}`);
    dispatch({ type: "setCurrentLineIndex", index: params.rawIndex });
    const next = await waitForState(getState, (candidate) => candidate.currentLineIndex === params.rawIndex);
    return { currentLineIndex: next.currentLineIndex };
  },

  next_line: async (ctx) => {
    const state = ctx.getState();
    const next = nextPageLine(state.lines, state.currentLineIndex + 1, pageRange(state.lines, state.currentLineIndex));
    if (next === null) return { boundary: true, currentLineIndex: state.currentLineIndex };
    return commands.set_current_line(ctx, { rawIndex: next });
  },

  prev_line: async (ctx) => {
    const state = ctx.getState();
    const range = pageRange(state.lines, state.currentLineIndex);
    for (let index = state.currentLineIndex - 1; index >= range.start; index--) {
      if (!state.lines[index].ignore && !parsePageMarker(state.lines[index].rawText)) return commands.set_current_line(ctx, { rawIndex: index });
    }
    return { boundary: true, currentLineIndex: state.currentLineIndex };
  },

  get_styles: async ({ getState }) => {
    const state = getState();
    return {
      styles: (state.styles || []).map((style) => styleSummary(style, state.folders)),
      currentStyleId: state.currentStyleId || null,
      folders: state.folders || [],
    };
  },

  select_style: async ({ getState, dispatch }, params) => {
    const state = getState();
    if (!(state.styles || []).some((style) => style.id === params.styleId)) {
      fail(`bad_params: unknown styleId ${params.styleId}`);
    }
    dispatch({ type: "setCurrentStyleId", id: params.styleId });
    const next = await waitForState(getState, (candidate) => candidate.currentStyleId === params.styleId);
    // The style-prefix → line mapping is recomputed ~75 ms after the style
    // change (deferred in context.jsx); ride that window out so an immediate
    // get_state/batch_paste reads fresh lines[].styleId.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { currentStyleId: next.currentStyleId };
  },

  search_fonts: async (ctx, params) => {
    const query = String(params.query || "").toLocaleLowerCase();
    const limit = clamp(params.limit || 30, 1, 100);
    const fonts = await getFonts();
    return {
      fonts: fonts
        .filter((font) => !query || `${font.family} ${font.style} ${font.name} ${font.postScriptName}`.toLocaleLowerCase().indexOf(query) !== -1)
        .slice(0, limit),
    };
  },

  preview_fonts: async (ctx, params) => {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) fail("node_unavailable");
    const fonts = await getFonts();
    return createFontContactSheet(fonts, params || {}, nodeRequire);
  },

  save_style: async ({ getState, dispatch }, params) => {
    const state = getState();
    const styles = state.styles || [];
    if (params.folderId && !(state.folders || []).some(folder => folder.id === params.folderId)) fail("unknown_folder");
    const existing = params.styleId
      ? resolveStyle(state, params.styleId, null)
      : (state.currentStyle || styles[0] || { textProps: getDefaultStyle(), stroke: getDefaultStroke() });
    const style = await applyStyleOverrides(existing, params);
    const id = params.styleId || `mcp-${Date.now().toString(36)}`;
    style.id = id;
    style.name = params.name || style.name || "MCP Style";
    dispatch({ type: "saveStyle", id, data: style });
    if (params.select !== false) dispatch({ type: "setCurrentStyleId", id });
    const next = await waitForState(getState, (candidate) => (candidate.styles || []).some((item) => item.id === id && item.name === style.name && item.textProps === style.textProps));
    return { style: styleSummary((next.styles || []).find((item) => item.id === id) || style, next.folders) };
  },

  document_info: async () => {
    return hostJSON("getTypeRMcpDocumentInfo()");
  },

  detect_bubbles: async ({ getState }, params) => {
    const state = getState();
    const snapshot = await decodeSnapshot(params.maxDim);
    const sensitivity = clamp(params.sensitivity || 5, 1, 10);
    const learning = normalizeBubbleLearning(readStorage(LEARNING_STORAGE_KEY));
    const bubbles = detectLearnedBubbles(snapshot.pixels, getDetectionOptions(sensitivity), learning)
      .map((bubble, index) => ({ ...bubble, id: index }));
    const rtl = params.rtl != null ? !!params.rtl : state.direction === "rtl";
    const ordered = orderBubbles(bubbles, rtl);
    const scaleX = snapshot.docWidth / snapshot.imageWidth;
    const scaleY = snapshot.docHeight / snapshot.imageHeight;
    const assignments = {};
    const range = pageRange(state.lines || [], state.currentLineIndex);
    let cursor = state.currentLineIndex;
    ordered.forEach(bubble => { const line = nextPageLine(state.lines || [], cursor, range); assignments[bubble.id] = line; if (line !== null) cursor = line + 1; });
    const documentInfo = await commands.document_info();
    return {
      documentId: documentInfo.id,
      documentKey: documentInfo.documentKey,
      pageRange: range,
      docWidth: snapshot.docWidth,
      docHeight: snapshot.docHeight,
      snapshotPath: snapshot.path,
      bubbles: ordered.map((bubble, order) => ({
        id: bubble.id,
        order,
        docBounds: boundsSummary(bubbleToSelection(bubble, scaleX, scaleY)),
        confidence: typeof bubble.confidence === "number" ? bubble.confidence : null,
        area: bubble.area,
        fillRatio: bubble.fillRatio,
        suggestedLine: typeof assignments[bubble.id] === "number"
          ? lineSummary((state.lines || [])[assignments[bubble.id]])
          : null,
      })),
    };
  },

  batch_paste: async (ctx, params) => {
    const { getState, dispatch } = ctx;
    const state = getState();
    if (!Array.isArray(params.entries) || !params.entries.length) {
      fail("bad_params: entries must be a non-empty array");
    }
    const { texts, styles, selections, commitEntries } = await buildPasteEntries(state, params.entries, params);
    const pointText = params.pointText != null ? !!params.pointText : !!state.pastePointText;
    const padding = params.padding != null ? params.padding : (state.internalPadding || 0);
    if (params.dryRun) {
      return {
        dryRun: true,
        placements: selections.map((selection, index) => ({
          bounds: boundsSummary(selection),
          text: texts[index],
          lineIndex: selection.lineIndex,
          styleId: selection.styleId,
        })),
      };
    }
    const created = await hostBatchPaste(state, texts, styles, selections, pointText, padding);
    // If the caller already received busy_timeout, don't mutate the panel line
    // state behind its back: the paste happened in Photoshop, but the cursor
    // stays where the client believes it is.
    if (ctx.isCancelled && ctx.isCancelled()) fail("busy_timeout");
    deselectDocument();

    let nextLineIndex = state.currentLineIndex;
    if (params.advanceLines !== false && commitEntries.length) {
      const lastLineIndex = Math.max(...commitEntries.map((entry) => entry.lineIndex));
      const usable = nextPageLine(state.lines || [], lastLineIndex + 1, pageRange(state.lines || [], state.currentLineIndex));
      nextLineIndex = usable === null ? lastLineIndex : usable;
      dispatch({ type: "commitLineBatch", entries: commitEntries, nextLineIndex });
      await waitForState(getState, (next) => next.currentLineIndex === nextLineIndex, 500);
    }
    await commands.record_placements(ctx, { created, selections, texts, state });
    return {
      documentId: created.documentId,
      pasted: texts.length,
      nextLineIndex,
      placements: selections.map((selection, index) => ({
        layerId: created.layers[index].layerId,
        renderedBounds: created.layers[index].bounds,
        bounds: boundsSummary(selection),
        text: texts[index],
        lineIndex: selection.lineIndex,
        styleId: selection.styleId,
      })),
    };
  },

  paste_text: async (ctx, params) => {
    const { getState } = ctx;
    if (typeof params.text !== "string" || !params.text) fail("bad_params: text is required");
    if (params.bounds) {
      const result = await commands.batch_paste(ctx, {
        entries: [{ bounds: params.bounds, text: params.text, styleId: params.styleId || null, typography: params.typography, autoShape: params.autoShape === true }],
        pointText: params.pointText,
        padding: params.padding,
        advanceLines: false,
      });
      return result;
    }
    const state = getState();
    const style = resolveStyle(state, params.styleId, null)
      || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    const scaledStyle = await applyStyleOverrides(getScaledStyle(style, state.textScale), params.typography || {});
    const pointText = params.pointText != null ? !!params.pointText : !!state.pastePointText;
    const parsed = buildRichTextPayload(params.text);
    const data = JSON.stringify({
      text: parsed.text,
      style: scaledStyle,
      padding: params.padding != null ? params.padding : (state.internalPadding || 0),
      direction: state.direction,
      richTextRuns: parsed.richTextRuns,
    });
    const error = await evalHost(
      "createTextLayerInSelection(" + data + ", " + resolveStylePointText(scaledStyle, pointText) + ")"
    );
    if (error) fail(String(error));
    return { pasted: 1, layer: (await commands.document_info()).activeLayer };
  },

  apply_to_active: async ({ getState }, params) => {
    const state = getState();
    const hasText = typeof params.text === "string" && params.text;
    const style = params.styleId ? resolveStyle(state, params.styleId, null) : null;
    if (!hasText && !style) fail("bad_params: text or styleId is required");
    let text = hasText ? params.text : "";
    if (!hasText && style) {
      let snapshot = null;
      try { snapshot = JSON.parse(await evalHost(`getTypeRPanelSnapshot(${JSON.stringify({})})`) || "{}"); } catch (error) {}
      text = snapshot && snapshot.activeLayer && snapshot.activeLayer.textProps
        ? snapshot.activeLayer.textProps.layerText.textKey || ""
        : "";
      if (!text) fail("no_text_layer");
    }
    const parsed = buildRichTextPayload(text);
    const payload = style
      ? { text: parsed.text, style: getScaledStyle(style, state.textScale), direction: state.direction, richTextRuns: parsed.richTextRuns }
      : { text: parsed.text, style: null, contentOnly: true, richTextRuns: parsed.richTextRuns };
    const error = await evalHost("setActiveLayerText(" + JSON.stringify(payload) + ")");
    if (error) fail(String(error));
    return { ok: true };
  },

  align_active: async (ctx, params) => {
    const state = ctx.getState();
    if (params.layerId != null) await commands.select_layer(ctx, { layerId: params.layerId });
    if (params.bounds) {
      const bounds = validateBounds(params.bounds, await commands.document_info());
      const selectionError = await evalHost("selectTypeRMcpBounds(" + JSON.stringify(bounds) + ")");
      if (selectionError) fail(String(selectionError));
    }
    const data = JSON.stringify({
      resizeTextBox: params.resizeTextBox != null ? !!params.resizeTextBox : !!state.resizeTextBoxOnCenter,
      padding: params.padding != null ? params.padding : (state.internalPadding || 0),
    });
    const error = await evalHost("alignTextLayerToSelection(" + data + ")");
    if (error) fail(String(error));
    return { ok: true };
  },

  change_text_size: async (ctx, params) => {
    if (typeof params.delta !== "number" || !params.delta) fail("bad_params: delta must be a non-zero number");
    if (params.layerId != null) await commands.select_layer(ctx, { layerId: params.layerId });
    const error = await evalHost("changeActiveLayerTextSize(" + params.delta + ")");
    if (error) fail(String(error));
    return { ok: true, layerId: params.layerId != null ? Math.round(params.layerId) : null, delta: params.delta };
  },

  nudge_layer: async (ctx, params) => {
    if (typeof params.layerId !== "number") fail("bad_params: layerId must be a number");
    const deltaX = typeof params.deltaX === "number" ? params.deltaX : 0;
    const deltaY = typeof params.deltaY === "number" ? params.deltaY : 0;
    if (!deltaX && !deltaY) fail("bad_params: deltaX or deltaY must be non-zero");
    await commands.select_layer(ctx, { layerId: params.layerId });
    const data = JSON.stringify({ deltaX, deltaY });
    const error = await evalHost("nudgeActiveTextLayer(" + data + ")");
    if (error) fail(String(error));
    return { ok: true, layerId: Math.round(params.layerId), deltaX, deltaY };
  },

  get_layers: async (ctx, params) => hostJSON(`typeRMcpLayers(${JSON.stringify({ ...params, textOnly: true })})`),

  shape_text: async ({ getState }, params) => {
    if (typeof params.text !== "string" || !params.text) fail("bad_params: text is required");
    const state = getState();
    const width = typeof params.width === "number" ? params.width : undefined;
    const height = typeof params.height === "number" ? params.height : undefined;
    const variants = await generateShapeVariants(state, params.text, {
      limit: clamp(params.limit || 8, 1, 20),
      allowHyphenation: params.allowHyphenation,
      manualLineCount: params.manualLineCount,
      profile: params.profile,
      width,
      height,
      shapeProfile: params.shapeProfile || null,
    });
    return {
      variants: variants.map((variant) => ({
        lines: variant.lines,
        lineCount: variant.lines.length,
        score: variant.score != null ? variant.score : null,
      })),
    };
  },

  preview_text_shapes: async ({ getState }, params) => {
    const state = getState();
    const line = typeof params.lineIndex === "number" ? (state.lines || [])[params.lineIndex] : null;
    if (typeof params.lineIndex === "number" && (!line || line.ignore)) {
      fail(`bad_params: lineIndex ${params.lineIndex} is not a usable line`);
    }
    const text = typeof params.text === "string" && params.text ? params.text : (line && line.text);
    if (!text) fail("bad_params: text or a usable lineIndex is required");
    const targetBounds = params.bounds ? requireBounds(params.bounds) : null;
    const width = targetBounds ? targetBounds.width : params.width;
    const height = targetBounds ? targetBounds.height : params.height;
    if (!(width > 0) || !(height > 0)) fail("bad_params: bounds or positive width/height are required");

    let snapshot = null;
    let shapeProfile = params.shapeProfile || null;
    if (targetBounds) {
      snapshot = await decodeSnapshot(params.maxDim || 1800);
      if (!shapeProfile) {
        const scaleX = snapshot.imageWidth / snapshot.docWidth;
        const scaleY = snapshot.imageHeight / snapshot.docHeight;
        shapeProfile = sampleBubbleShapeProfile(snapshot.pixels, {
          left: targetBounds.left * scaleX,
          top: targetBounds.top * scaleY,
          right: targetBounds.right * scaleX,
          bottom: targetBounds.bottom * scaleY,
        }, params.shapeSamples || 21);
      }
    }

    const variants = await generateShapeVariants(state, text, {
      limit: clamp(params.limit || 6, 2, 12),
      allowHyphenation: params.allowHyphenation,
      profile: params.profile,
      width,
      height,
      shapeProfile,
    });
    const style = resolveStyle(state, params.styleId, line)
      || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    const scaledStyle = getScaledStyle(style, state.textScale);
    const textStyle = ((((scaledStyle.textProps || {}).layerText || {}).textStyleRange || [])[0] || {}).textStyle || {};
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) fail("node_unavailable");
    return createTextShapeContactSheet({
      variants,
      fonts: await getFonts(),
      textStyle,
      params: { ...params, text, width, height },
      nodeRequire,
      snapshot,
      bounds: targetBounds,
      shapeProfile,
    });
  },

  select_layer: async (ctx, params) => {
    if (typeof params.layerId !== "number") fail("bad_params: layerId must be a number");
    const error = await evalHost(`selectLayerById(${Math.round(params.layerId)})`);
    if (error) fail("layer_not_found");
    return { selectedLayerId: Math.round(params.layerId) };
  },

  edit_layer: async (ctx, params) => {
    await commands.select_layer(ctx, params);
    let text = params.text;
    let bubbleShape = null;
    if ((params.autoShape && typeof text === "string" && text) || (params.align && !params.bounds)) {
      const shapeRaw = await evalHost(`getActiveLayerBubbleShape(${JSON.stringify({ samples: 21, tolerance: 20 })})`);
      try { bubbleShape = JSON.parse(shapeRaw || "{}"); } catch (error) {}
    }
    if (params.autoShape && typeof text === "string" && text) {
      const variants = await generateShapeVariants(ctx.getState(), text, {
        limit: 1,
        allowHyphenation: params.allowHyphenation,
        profile: params.profile,
        width: bubbleShape && bubbleShape.bounds ? bubbleShape.bounds.width : undefined,
        height: bubbleShape && bubbleShape.bounds ? bubbleShape.bounds.height : undefined,
        shapeProfile: bubbleShape && bubbleShape.rows ? bubbleShape : null,
      });
      if (variants[0]) text = variants[0].text;
    }
    const applied = params.typography || params.textRuns
      ? await commands.apply_typography(ctx, { ...params, text })
      : await commands.apply_to_active(ctx, { text, styleId: params.styleId });
    if (params.align) {
      await commands.align_active(ctx, {
        ...params,
        bounds: params.bounds || (bubbleShape && bubbleShape.bounds) || null,
      });
    }
    return { ...applied, layerId: Math.round(params.layerId), text: text || null };
  },

  save_document: async (ctx, params) => {
    if (params.path && (!getNodeRequire()("path").isAbsolute(params.path) || !/\.psd$/i.test(params.path))) fail("bad_params: absolute .psd path required");
    const previous = await commands.document_info();
    const data = JSON.stringify({ path: params.path || null, asCopy: !!params.asCopy });
    const result = await hostJSON(`saveTypeRMcpDocument(${data})`);
    const current = await commands.document_info();
    const previousIdentity = previous.path || previous.documentKey;
    const currentIdentity = current.path || current.documentKey;
    if (previousIdentity !== currentIdentity) {
      const links = (ctx.getState().mcpProgress || []).map(link => link.document === previousIdentity && link.documentId === current.id ? { ...link, document: currentIdentity } : link);
      ctx.dispatch({ type: "setMcpProgress", links });
      await waitForState(ctx.getState, state => state.mcpProgress === links);
    }
    return result;
  },

  deselect: async () => new Promise((resolve) => {
    deselectDocument(() => resolve({ ok: true }));
  }),


};

Object.assign(commands, createAdvancedCommands({ commands, hostJSON, evalHost, applyStyleOverrides, resolveStyle, generateShapeVariants, waitForState, decodeSnapshot, sampleBubbleShapeProfile, getNodeRequire }));

const transactional = new Set(["batch_paste", "paste_text", "apply_to_active", "align_active", "nudge_layer", "change_text_size", "edit_layer", "transform_layer", "manage_layers"]);
const publicSpecs = new Map(contract.specs.map(spec => [spec[1], spec]));
const isReadOnlyCommand = (command, params) => contract.readOnly.includes(command) || params.dryRun === true || (["manage_layers", "manage_tabs"].includes(command) && params.action === "list") || command === "capture_style" && !params.save || command === "learning" && params.action === "get";
const panelSnapshot = state => ({ tabId: state.currentTabId, text: state.text, currentLineIndex: state.currentLineIndex, usedLineStyles: state.usedLineStyles || {}, mcpProgress: state.mcpProgress || [] });
const restorePanel = async (ctx, snapshot) => {
  if (ctx.getState().currentTabId !== snapshot.tabId || ctx.getState().text !== snapshot.text) fail("panel_changed: Photoshop recovered but script state needs review");
  ctx.dispatch({ type: "restoreMcpPanel", ...snapshot });
  await waitForState(ctx.getState, next => next.currentLineIndex === snapshot.currentLineIndex && next.mcpProgress === snapshot.mcpProgress);
};
commands.get_operation = async (ctx, params) => {
  const record = ctx.operations.get(params.operationId);
  if (!record) fail("unknown_operation");
  const { fingerprint, beforePanel, ...publicRecord } = record;
  return publicRecord;
};
commands.undo = async (ctx, params) => {
  const info = await commands.document_info();
  const record = params.operationId ? ctx.operations.get(params.operationId) : ctx.operations.list().filter(item => item.undoable && item.documentKey === info.documentKey && item.status === "completed").sort((a, b) => b.finishedAt - a.finishedAt)[0];
  if (!record || !record.undoable || record.status !== "completed") fail("no_undoable_mcp_operation");
  const state = ctx.getState();
  if (state.currentTabId !== record.beforePanel.tabId || state.text !== record.beforePanel.text) fail("panel_changed: restore the original tab and script before undo");
  await hostJSON(`typeRMcpCheckpoint(${JSON.stringify({ action: "undo", id: record.operationId })})`);
  await restorePanel(ctx, record.beforePanel);
  ctx.operations.finish(record.operationId, { status: "undone", undoable: false });
  return { undoneOperationId: record.operationId };
};

const runCommand = async (ctx, command, params = {}) => {
  const spec = publicSpecs.get(command);
  if (!spec || !commands[command]) fail("unknown_command");
  contract.validate(spec[3], params);
  if (command === "get_operation") return commands.get_operation(ctx, params);
  const readOnly = isReadOnlyCommand(command, params);
  let before = null, info = null, checkpoint = false;
  if (!readOnly && ctx.preparedRequestId !== params.requestId) {
    const entry = ctx.operations.begin(params.requestId, command, params);
    if (!entry.fresh) {
      if (entry.record.status === "completed") return entry.record.result;
      fail(`${entry.record.status}: ${entry.record.error || "query typer_get_operation; do not replay with another requestId"}`);
    }
  }
  expectedHostDocument = params.documentId == null ? null : params.documentId;
  expectedHostKey = params.expectedDocumentKey || null;
  window.__typerMcpNavigating = true;
  try {
    if (spec[3].properties.documentId || transactional.has(command) && !readOnly) {
      info = await commands.document_info();
      expectedHostDocument = info.id;
      expectedHostKey = info.documentKey;
    }
    if (transactional.has(command) && !readOnly) {
      before = panelSnapshot(ctx.getState());
      await hostJSON(`typeRMcpCheckpoint(${JSON.stringify({ action: "begin", id: params.requestId })})`);
      checkpoint = true;
    }
    const result = await commands[command](ctx, params);
    if (checkpoint) await hostJSON(`typeRMcpCheckpoint(${JSON.stringify({ action: "commit", id: params.requestId })})`);
    const response = readOnly ? result : { ...result, operationId: params.requestId };
    if (!readOnly) ctx.operations.finish(params.requestId, { status: "completed", result: response, beforePanel: before, documentKey: info && info.documentKey, undoable: checkpoint });
    return response;
  } catch (error) {
    let message = error.message || String(error);
    if (checkpoint) {
      try {
        await hostJSON(`typeRMcpCheckpoint(${JSON.stringify({ action: "rollback", id: params.requestId })})`);
        await restorePanel(ctx, before);
      } catch (rollbackError) { message += `; recovery_failed: ${rollbackError.message}`; }
    }
    if (!readOnly) ctx.operations.finish(params.requestId, { status: "failed", error: message, undoable: false });
    throw new BridgeError(message);
  } finally {
    expectedHostDocument = null;
    expectedHostKey = null;
    window.__typerMcpNavigating = false;
  }
};

const createBridge = (nodeRequire, ctx) => {
  ctx.operations = createOperationStore(readStorage("mcpOperations") || {}, records => {
    // Host checkpoints cannot survive a reload. Persist recovery results, not
    // a full duplicate of the chapter script/progress for every undo record.
    const durable = Object.create(null);
    Object.keys(records).forEach(id => { const { beforePanel, ...record } = records[id]; durable[id] = { ...record, undoable: false }; });
    if (!writeToStorage({ mcpOperations: durable }, false)) fail("operation_log_write_failed");
  });
  const http = nodeRequire("http");
  const fs = nodeRequire("fs");
  const os = nodeRequire("os");
  const path = nodeRequire("path");
  const crypto = nodeRequire("crypto");
  const { Buffer } = nodeRequire("buffer");

  const token = crypto.randomBytes(32).toString("hex");
  const discoveryPath = path.join(os.tmpdir(), DISCOVERY_FILENAME);
  let server = null;
  let stopped = false;
  // Commands run strictly one at a time: concurrent evalScript chains against
  // the single ExtendScript engine would interleave selections and pastes.
  let queue = Promise.resolve();

  const respond = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };

  const handler = (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return respond(res, 200, { ok: true, service: "typer-mcp-bridge", version: appVersion });
    }
    if (req.method !== "POST" || req.url !== "/rpc") {
      return respond(res, 404, { ok: false, error: "not_found" });
    }
    if (req.headers["x-typer-token"] !== token) {
      return respond(res, 403, { ok: false, error: "forbidden" });
    }
    // Accumulate raw Buffers and decode once on "end": per-chunk toString()
    // corrupts multi-byte UTF-8 sequences split across TCP packets.
    const chunks = [];
    let received = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        // Answer before dropping the socket so the client sees 413 instead of
        // a bare connection reset; keep draining until the response flushes.
        respond(res, 413, { ok: false, error: "payload_too_large" });
        res.once("finish", () => req.destroy());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      let parsed = null;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch (error) {
        return respond(res, 400, { ok: false, error: "bad_json" });
      }
      let commandCtx = ctx;
      try {
        if (!parsed || typeof parsed !== "object") fail("bad_request");
        const spec = publicSpecs.get(parsed.command);
        if (!spec) fail("unknown_command");
        contract.validate(spec[3], parsed.params || {});
        if (!isReadOnlyCommand(parsed.command, parsed.params || {})) {
          const entry = ctx.operations.begin(parsed.params.requestId, parsed.command, parsed.params);
          if (!entry.fresh) {
            if (entry.record.status === "completed") return respond(res, 200, { ok: true, result: entry.record.result });
            return respond(res, 200, { ok: false, error: `${entry.record.status}: query typer_get_operation with the original requestId` });
          }
          commandCtx = { ...ctx, preparedRequestId: parsed.params.requestId };
        }
      } catch (error) { return respond(res, 200, { ok: false, error: error.message || String(error) }); }
      const execute = async () => {
        let replied = false;
        const timeout = LONG_COMMANDS.includes(parsed.command) ? LONG_TIMEOUT : DEFAULT_TIMEOUT;
        const timer = setTimeout(() => {
          replied = true;
          respond(res, 200, { ok: false, error: `busy_timeout: query typer_get_operation with ${parsed.params && parsed.params.requestId || "the original request ID"}` });
        }, timeout);
        try {
          const result = await runCommand(commandCtx, parsed.command, parsed.params || {});
          if (!replied) respond(res, 200, { ok: true, result });
        } catch (error) {
          if (!replied) respond(res, 200, { ok: false, error: error.message || String(error) });
        } finally { clearTimeout(timer); }
      };
      if (parsed.command === "get_operation") execute();
      else queue = queue.then(execute, execute);
    });
    req.on("error", () => {});
  };

  const writeDiscovery = (port) => {
    try {
      fs.writeFileSync(discoveryPath, JSON.stringify({
        port,
        token,
        pid: (window.cep_node && window.cep_node.process && window.cep_node.process.pid) || null,
        version: appVersion,
        startedAt: Date.now(),
      }), { mode: 0o600 });
      fs.chmodSync(discoveryPath, 0o600);
    } catch (error) {
      console.error("TypeR MCP bridge: discovery write failed", error);
    }
  };

  const listen = (portIndex) => {
    if (stopped || portIndex >= BRIDGE_PORTS.length) {
      if (portIndex >= BRIDGE_PORTS.length) console.error("TypeR MCP bridge: all ports busy");
      return;
    }
    server = http.createServer(handler);
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        server = null;
        listen(portIndex + 1);
      } else {
        console.error("TypeR MCP bridge:", error);
      }
    });
    server.listen(BRIDGE_PORTS[portIndex], "127.0.0.1", () => {
      if (stopped) return;
      writeDiscovery(BRIDGE_PORTS[portIndex]);
      console.log(`TypeR MCP bridge listening on 127.0.0.1:${BRIDGE_PORTS[portIndex]}`);
    });
  };

  listen(0);

  return {
    stop: () => {
      stopped = true;
      if (server) {
        try { server.close(); } catch (error) { /* panel is unloading */ }
        server = null;
      }
      try {
        const current = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
        if (current && current.token === token) fs.unlinkSync(discoveryPath);
      } catch (error) { /* already gone or unreadable: nothing to clean */ }
    },
  };
};

const McpBridge = React.memo(function McpBridge() {
  const context = useContext(() => ({}));

  React.useEffect(() => {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      console.warn("TypeR MCP bridge: Node is unavailable, bridge disabled");
      return undefined;
    }
    if (readStorage("mcpBridgeDisabled")) return undefined;
    const bridge = createBridge(nodeRequire, {
      getState: context.getState,
      dispatch: context.dispatch,
    });
    window.addEventListener("beforeunload", bridge.stop);
    return () => {
      window.removeEventListener("beforeunload", bridge.stop);
      bridge.stop();
    };
  }, []);

  return <React.Fragment />;
});

export default McpBridge;
