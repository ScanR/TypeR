// Smart paste orchestration, shared by both hosts. It runs in the UXP host
// and in the CEP panel; the host adapter only talks to Photoshop:
//   adapter.capture(trigger) -> input (see bubblePlan.js) + { activeTextSize }
//   adapter.measure(requests) -> replies (see measureSpec.js)
//   adapter.resolveRunStyle(textStyle, run) -> textStyle (optional)
//   adapter.useAtlas -> boolean
// The result is a list of paste sessions the host commits in one history
// state (see commitSmartPaste in each host).
//
// request = {
//   trigger: { source: "wand" | "rectangle" | "lasso" | "manual", x, y },
//   lines: [{ text, richTextRuns, style, styleLocked }],   // N, N+1, N+2
//   roleStyles: { shout: style | null, narration: style | null },
//   settings: { autoClean, distribute, minScale, hyphenation ("fr"|"en"|"off"),
//               direction, padding, keepSize, pointText, forceSplit },
//   forceSplit: split the bubble at its likeliest neck even when it does not
//   look double (the user clicked it again after a one-line paste)
// }

import { buildPlan, subpathsFromDescriptor } from "./bubblePlan";
import { isPageLeak } from "./openBubble";
import { chambersFor } from "./connected";
import { planText, NoPlacementError } from "./layout";
import { breakPointsFor } from "./hyphenation";
import { clearGeometryCaches } from "./geometry";

const clone = (value) => JSON.parse(JSON.stringify(value));

export class SmartPasteError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = "SmartPasteError";
    this.code = code;
    // The bubble's text colour, when it was read: the classic paste keeps it
    if (details && details.textColor) this.textColor = details.textColor;
  }
}

// Size presets by page width (TypeR's autoSizeByPageWidth), as the hosts do
export const resolveStyleSizeForPage = (style, pageWidth) => {
  if (!style || style.autoSizeByPageWidth !== true || !(pageWidth > 0)) return style;
  const presets = style.sizePresets;
  if (!presets || presets.length < 2) return style;
  let defaultIndex = parseInt(style.sizePresetDefaultIndex, 10);
  if (isNaN(defaultIndex) || defaultIndex < 0 || defaultIndex >= presets.length) defaultIndex = 0;
  let selectedSize = parseFloat(presets[defaultIndex]);
  let selectedThreshold = -1;
  const minWidths = style.sizePresetMinWidths || [];
  for (let i = 0; i < presets.length; i++) {
    if (i === defaultIndex) continue;
    const threshold = parseFloat(minWidths[i]);
    const presetSize = parseFloat(presets[i]);
    if (!isNaN(threshold) && threshold > 0 && !isNaN(presetSize) && presetSize > 0 && pageWidth >= threshold && threshold > selectedThreshold) {
      selectedThreshold = threshold;
      selectedSize = presetSize;
    }
  }
  if (isNaN(selectedSize) || selectedSize <= 0) return style;
  const ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges[0] || !ranges[0].textStyle) return style;
  ranges[0].textStyle.size = selectedSize;
  if (ranges[0].textStyle.impliedFontSize != null) ranges[0].textStyle.impliedFontSize = selectedSize;
  return style;
};

// A line made only of punctuation, as the hosts do
export const isPunctuationOnlyText = (text) => typeof text === "string" && /^[!?.,;:'"()\[\]~\-\u00A1\u00AB\u00BB\u00BF\u060C\u061B\u061F\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u203C\u203D\u2047\u2048\u2049\u3001\u3002\u301C\uFF01\uFF1F\uFF5E]+$/.test(text.replace(/[\s\u00A0\u202F]+/g, ""));

export const scaleStyleForPunctuationOnlyText = (style, text) => {
  if (!style) return style;
  const scale = parseFloat(style.punctuationOnlyScale);
  if (!(scale > 1) || !isPunctuationOnlyText(text)) return style;
  const scaled = clone(style);
  const ranges = scaled.textProps && scaled.textProps.layerText && scaled.textProps.layerText.textStyleRange;
  if (!ranges) return scaled;
  ranges.forEach((range) => {
    const textStyle = range && range.textStyle;
    if (!textStyle) return;
    ["size", "impliedFontSize", "leading", "impliedLeading"].forEach((field) => {
      if (typeof textStyle[field] === "number") textStyle[field] *= scale;
    });
  });
  return scaled;
};

const overrideSize = (style, size) => {
  const ranges = style.textProps.layerText.textStyleRange;
  for (let i = 0; i < ranges.length; i++) {
    if (!ranges[i] || !ranges[i].textStyle) continue;
    ranges[i].textStyle.size = size;
    if (ranges[i].textStyle.impliedFontSize != null) ranges[i].textStyle.impliedFontSize = size;
  }
};

// The style of a line in a bubble of this kind: a script prefix wins, then
// the style marked for the kind in the current folder, then the line's style
export const styleForKind = (line, kind, roleStyles) => {
  if (!line.styleLocked && roleStyles && (kind === "shout" || kind === "narration") && roleStyles[kind]) {
    return { style: roleStyles[kind], role: kind };
  }
  return { style: line.style, role: null };
};

const validStyle = (style) => !!(style && style.textProps && style.textProps.layerText &&
  style.textProps.layerText.textStyleRange && style.textProps.layerText.textStyleRange[0] &&
  style.textProps.layerText.paragraphStyleRange && style.textProps.layerText.paragraphStyleRange[0]);

// What the commit needs of a plan (plain data, also crosses evalScript)
const sessionPlan = (plan) => ({
  documentId: plan.documentId,
  source: plan.source,
  kind: plan.kind,
  click: plan.click,
  connected: plan.connected,
  neck: plan.neck,
  necks: plan.necks || (plan.neck ? [plan.neck] : null),
  cleanPolygon: plan.cleanPolygon,
  cleanupPolygon: plan.cleanupPolygon,
  cleanupInset: plan.cleanupInset,
  autoClean: plan.autoClean,
  cleanupSkipped: plan.cleanupSkipped,
  fillRGB: plan.fillRGB,
  selection: plan.selection,
});

export const prepareSmartPaste = async (request, adapter) => {
  const settings = request.settings || {};
  const lines = (request.lines || []).filter((line) => line && typeof line.text === "string" && line.text.trim());
  if (!lines.length) throw new SmartPasteError("noText");
  clearGeometryCaches();
  const input = await adapter.capture(request.trigger || { source: "manual" });
  if (!input) throw new SmartPasteError("noSelection");
  input.direction = settings.direction;
  const page = { width: input.width, height: input.height, resolution: input.resolution };
  let plan;
  let subpaths = null;
  if (input.openPlan) {
    // An open bubble the UXP host already isolated (openBubble.js)
    plan = input.openPlan;
  } else {
    // A leaking wand selection needs the open-bubble recovery (UXP only)
    if (input.source !== "rectangle" && isPageLeak(input.selectionBounds, input.width, input.height)) {
      throw new SmartPasteError("openBubble", "The selection leaks into the page");
    }
    subpaths = input.source === "rectangle" ? null : subpathsFromDescriptor(input.rawPath, input.resolution);
    try {
      plan = buildPlan(input, { autoClean: !!settings.autoClean, forceSplit: !!settings.forceSplit, subpaths });
    } catch (error) {
      throw new SmartPasteError("shape", error && error.message);
    }
  }
  const wanted = settings.distribute === false ? 1 : Math.min(3, lines.length);
  const chambers = wanted > 1 && plan.source === "wand" && plan.connected && subpaths ? chambersFor(input, plan, subpaths, wanted, { autoClean: !!settings.autoClean, forceSplit: !!settings.forceSplit }) : [plan];
  const breakPoints = breakPointsFor(settings.hyphenation || "off");
  const sessions = [];
  for (let i = 0; i < chambers.length; i++) {
    const chamber = chambers[i];
    const line = lines[i];
    const picked = styleForKind(line, chamber.kind, request.roleStyles);
    if (!validStyle(picked.style)) throw new SmartPasteError("style", "The style has no text settings");
    const pageStyle = resolveStyleSizeForPage(clone(picked.style), page.width);
    const keepsActiveSize = settings.keepSize && input.activeTextSize > 0;
    const style = keepsActiveSize ? pageStyle : scaleStyleForPunctuationOnlyText(pageStyle, line.text);
    if (keepsActiveSize) overrideSize(style, input.activeTextSize);
    // Enlarged punctuation may shrink back as far as the style's own size can
    const enlargedBy = style === pageStyle ? 1 : parseFloat(style.punctuationOnlyScale);
    const payload = {
      text: line.text,
      richTextRuns: line.richTextRuns || null,
      style,
      direction: settings.direction,
      padding: settings.padding || 0,
    };
    let text;
    try {
      text = await planText(chamber, payload, {
        page,
        measure: adapter.measure,
        useAtlas: !!adapter.useAtlas,
        resolveRunStyle: adapter.resolveRunStyle,
        breakPoints,
        sizePolicy: { minScale: (settings.minScale > 0 ? settings.minScale : 0.85) / enlargedBy, fixed: !!settings.keepSize },
      });
    } catch (error) {
      // A later chamber that does not fit: paste the chambers before it
      if (i > 0 && error instanceof NoPlacementError) break;
      if (error instanceof NoPlacementError) throw new SmartPasteError("noPlacement", error.message, { textColor: chamber.textColor });
      throw error;
    }
    sessions.push({
      plan: sessionPlan(chamber),
      text: {
        params: text.params,
        renderedText: text.renderedText,
        stroke: text.stroke,
        pad: text.pad,
        size: text.size,
        tier: text.tier,
        hyphenated: text.hyphenated,
        axis: text.candidate.axis,
        top: text.candidate.top,
        bottom: text.candidate.bottom,
        // The last line is a lone pause ("…"): its ink may be re-centred
        terminalPause: text.candidate.lines.length > 1 && (text.candidate.lines[text.candidate.lines.length - 1].edge.flags & 1) === 1,
      },
      styleId: picked.style.id || null,
      role: picked.role,
      layerName: line.text.replace(/[\r\n]+/g, " ").substring(0, 100),
    });
  }
  return {
    documentId: input.documentId,
    source: input.source,
    selectionBounds: input.selectionBounds,
    pointText: !!settings.pointText,
    sessions,
    consumed: sessions.length,
    cleanupSkipped: plan.cleanupSkipped || null,
  };
};
