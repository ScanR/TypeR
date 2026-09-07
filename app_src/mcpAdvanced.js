import { buildRichTextPayload, getDefaultStyle, getDefaultStroke } from "./utils";
import { getScaledStyle, resolveStylePointText } from "./textLayerPayload";
import { scriptRevision, pageRange, nextPageLine, validateBounds, reviewPage, normalizeDialogue, dialogueMatches } from "./mcpLogic";
import { parsePageMarker } from "./pageMarker";
import { createPageImageLookup, getImageForPage } from "./pageImageMapping";

export const createAdvancedCommands = ({ commands, hostJSON, evalHost, applyStyleOverrides, resolveStyle, generateShapeVariants, waitForState, decodeSnapshot, sampleBubbleShapeProfile, getNodeRequire }) => {
  const fail = message => { throw new Error(message); };
  const allLayers = async (ctx, includeStyles = false) => {
    const layers = [];
    let offset = 0;
    do {
      const result = await commands.get_layers(ctx, { offset, limit: 200, includeHidden: true, includeStyles });
      layers.push(...result.layers);
      offset = result.nextOffset;
    } while (offset !== null);
    return layers;
  };
  const documentIdentity = info => info.path || info.documentKey;
  const currentLinks = (state, info) => (state.mcpProgress || []).filter(link => link.tabId === state.currentTabId && link.document === documentIdentity(info));
  const persistLinks = async (ctx, links) => {
    ctx.dispatch({ type: "setMcpProgress", links });
    await waitForState(ctx.getState, state => state.mcpProgress === links);
  };
  const baseComposition = async (ctx, params) => {
    const state = ctx.getState();
    const info = await commands.document_info();
    const bounds = validateBounds(params.bounds, info);
    const line = params.lineIndex == null ? null : state.lines[params.lineIndex];
    if (params.lineIndex != null && (!line || line.ignore)) fail("bad_params: usable lineIndex required");
    const text = params.text != null ? params.text : line && line.text;
    if (!text) fail("bad_params: text or lineIndex required");
    let style = resolveStyle(state, params.styleId, line) || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    style = await applyStyleOverrides(getScaledStyle(style, state.textScale), params.typography || {});
    const padding = params.padding == null ? state.internalPadding || 0 : params.padding;
    if (bounds.width - padding * 2 < 2 || bounds.height - padding * 2 < 2) fail("bad_params: padding exceeds bubble dimensions");
    return { state, info, bounds, text, style, padding, pointText: params.pointText == null ? resolveStylePointText(style, state.pastePointText) : params.pointText };
  };
  const measure = async (base, candidates) => {
    const payloads = [];
    for (const candidate of candidates) {
      const parsed = buildRichTextPayload(candidate.text);
      const style = await applyStyleOverrides(base.style, candidate.typography || {});
      payloads.push({ text: parsed.text, richTextRuns: parsed.richTextRuns, style, bounds: base.bounds, padding: base.padding, pointText: base.pointText, direction: candidate.typography && candidate.typography.direction || base.state.direction });
    }
    const result = await hostJSON(`typeRMcpMeasure(${JSON.stringify({ candidates: payloads })})`);
    return result.measurements.map((measurement, index) => ({ ...measurement, text: candidates[index].text, typography: candidates[index].typography || {}, targetBounds: base.bounds, padding: base.padding, pointText: base.pointText }));
  };
  const assertAbsolutePath = (path, extensions) => {
    const nodePath = getNodeRequire()("path");
    if (typeof path !== "string" || !nodePath.isAbsolute(path) || !extensions.test(path)) fail("bad_params: absolute path with supported extension required");
  };

  return {
    get_snapshot: async (ctx, params) => hostJSON(`typeRMcpExport(${JSON.stringify({ maxDim: params.maxDim || 1500 })})`),

    get_region_image: async (ctx, params) => {
      const info = await commands.document_info();
      let bounds = params.bounds;
      if (!bounds && params.layerId != null) {
        const layer = (await allLayers(ctx)).find(item => item.layerId === params.layerId);
        if (!layer || !layer.bounds) fail("layer_not_found");
        bounds = layer.bounds;
      }
      bounds = validateBounds(bounds, info);
      const margin = params.margin || 0;
      bounds = validateBounds({ left: Math.max(0, bounds.left - margin), top: Math.max(0, bounds.top - margin), right: Math.min(info.width, bounds.right + margin), bottom: Math.min(info.height, bounds.bottom + margin) }, info);
      return hostJSON(`typeRMcpExport(${JSON.stringify({ bounds, maxDim: params.maxDim || 1600 })})`);
    },

    measure_text: async (ctx, params) => {
      const base = await baseComposition(ctx, params);
      return (await measure(base, [{ text: base.text, typography: params.typography }]))[0];
    },

    fit_text: async (ctx, params) => {
      const base = await baseComposition(ctx, params);
      const textStyle = base.style.textProps.layerText.textStyleRange[0].textStyle;
      const preferredSize = textStyle.size || 36;
      const min = params.minFontSize == null ? preferredSize * 0.85 : params.minFontSize;
      const max = params.maxFontSize == null ? preferredSize : params.maxFontSize;
      if (min > max) fail("bad_params: minFontSize exceeds maxFontSize");
      const variants = await generateShapeVariants(base.state, base.text, { ...params, width: base.bounds.width, height: base.bounds.height, limit: params.variants || 3 });
      const texts = [base.text];
      variants.forEach(variant => { if (!texts.includes(variant.text)) texts.push(variant.text); });
      const count = params.candidates || 12;
      const layouts = texts.slice(0, Math.min(params.variants || 3, count));
      const levels = Math.max(1, Math.floor(count / layouts.length));
      const candidates = [];
      for (let level = 0; level < levels; level++) {
        const size = levels === 1 ? max : max - (max - min) * level / (levels - 1);
        layouts.forEach(text => candidates.push({ text, typography: { ...params.typography, fontSize: Math.round(size * 100) / 100 } }));
      }
      const measurements = await measure(base, candidates);
      measurements.sort((a, b) => Number(b.fits) - Number(a.fits) || b.fontSize - a.fontSize || a.overflowX + a.overflowY - b.overflowX - b.overflowY);
      return { candidates: measurements, best: measurements.find(item => item.fits) || null, reason: measurements.some(item => item.fits) ? null : "no_measured_candidate_fits_constraints", measurementEngine: "photoshop", requiresVisualReview: true };
    },

    capture_style: async (ctx, params) => {
      const reference = await hostJSON(`typeRMcpCaptureStyle(${params.layerId})`);
      if (!params.save) return reference;
      const id = `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      if (!params.name) fail("bad_params: name required when saving a reference style");
      if (params.folderId && !ctx.getState().folders.some(folder => folder.id === params.folderId)) fail("unknown_folder");
      const style = { id, name: params.name, textProps: reference.textProps, stroke: reference.stroke || getDefaultStroke(), textType: reference.textType, prefixes: params.prefixes || [], folder: params.folderId || null };
      ctx.dispatch({ type: "saveStyle", id, data: style });
      await waitForState(ctx.getState, state => state.styles.some(item => item.id === id));
      return { styleId: id, referenceLayerId: params.layerId };
    },

    apply_typography: async (ctx, params) => {
      const reference = await hostJSON(`typeRMcpCaptureStyle(${params.layerId})`);
      const state = ctx.getState();
      const source = params.styleId ? getScaledStyle(resolveStyle(state, params.styleId), state.textScale) : { textProps: reference.textProps, stroke: reference.stroke || getDefaultStroke(), textType: reference.textType };
      const style = await applyStyleOverrides(source, params.typography || {});
      const parsed = buildRichTextPayload(params.text == null ? reference.text : params.text);
      const error = await evalHost(`setActiveLayerText(${JSON.stringify({ text: parsed.text, richTextRuns: parsed.richTextRuns, style, direction: params.typography && params.typography.direction || state.direction })})`);
      if (error) fail(error);
      if (params.textRuns || params.typography) await hostJSON(`typeRMcpTypography(${JSON.stringify({ layerId: params.layerId, typography: params.typography || {}, textRuns: params.textRuns || [] })})`);
      return { ok: true, layerId: params.layerId };
    },

    transform_layer: async (ctx, params) => hostJSON(`typeRMcpTransform(${JSON.stringify(params)})`),

    manage_layers: async (ctx, params) => params.action === "list"
      ? hostJSON(`typeRMcpLayers(${JSON.stringify({ ...params, includeHidden: true })})`)
      : hostJSON(`typeRMcpManageLayers(${JSON.stringify(params)})`),

    set_page_mapping: async (ctx, params) => {
      const pages = new Set();
      const fs = getNodeRequire()("fs");
      const images = params.images.map(image => {
        assertAbsolutePath(image.path, /\.(psd|psb|png|jpe?g|tiff?)$/i);
        if (!fs.existsSync(image.path)) fail(`file_not_found: ${image.path}`);
        if (pages.has(image.page)) fail("duplicate_page_mapping");
        pages.add(image.page);
        return { ...image, name: image.path.split(/[\\/]/).pop(), baseName: `Page ${image.page}` };
      });
      ctx.dispatch({ type: "setImages", images });
      await waitForState(ctx.getState, state => state.images === images);
      return { images };
    },

    manage_tabs: async (ctx, params) => {
      const before = ctx.getState();
      if (["switch", "rename"].includes(params.action) && !before.tabs.some(tab => tab.id === params.tabId)) fail("tab_not_found");
      if (params.action === "create") {
        ctx.dispatch({ type: "addTab", name: params.name, data: { text: params.text || "" } });
        await waitForState(ctx.getState, state => state.currentTabId !== before.currentTabId);
      } else if (params.action === "switch") {
        ctx.dispatch({ type: "switchTab", id: params.tabId });
        await waitForState(ctx.getState, state => state.currentTabId === params.tabId);
      } else if (params.action === "rename") {
        if (!params.name) fail("name_required");
        ctx.dispatch({ type: "renameTab", id: params.tabId, name: params.name });
        await waitForState(ctx.getState, state => state.tabs.find(tab => tab.id === params.tabId).name === params.name);
      }
      const state = ctx.getState();
      return { currentTabId: state.currentTabId, tabs: state.tabs.map(tab => ({ id: tab.id, name: tab.name, images: tab.images.length })) };
    },

    edit_script_lines: async (ctx, params) => {
      const state = ctx.getState();
      if (scriptRevision(state.text) !== params.expectedScriptRevision) fail("script_changed");
      if (params.lines.some(line => /[\r\n]/.test(line))) fail("bad_params: each replacement must be one raw line");
      const raw = state.text.split(/\r\n|\r|\n/);
      if (params.start > raw.length || params.start + params.deleteCount > raw.length) fail("bad_params: line range outside script");
      raw.splice(params.start, params.deleteCount, ...params.lines);
      await commands.set_text(ctx, { text: raw.join("\n"), expectedScriptRevision: params.expectedScriptRevision });
      return { scriptRevision: scriptRevision(ctx.getState().text), linesTotal: ctx.getState().lines.length };
    },

    get_progress: async ctx => ({ currentTabId: ctx.getState().currentTabId, links: (ctx.getState().mcpProgress || []).filter(link => link.tabId === ctx.getState().currentTabId), scriptRevision: scriptRevision(ctx.getState().text) }),

    record_placements: async (ctx, { state, created, selections, texts }) => {
      const info = await commands.document_info();
      const links = (ctx.getState().mcpProgress || []).slice();
      selections.forEach((selection, index) => {
        if (selection.lineIndex == null) return;
        links.push({ tabId: state.currentTabId, document: documentIdentity(info), documentId: info.id, layerId: created.layers[index].layerId, lineIndex: selection.lineIndex, sourceText: state.lines[selection.lineIndex].text, appliedText: buildRichTextPayload(texts[index]).text, scriptRevision: scriptRevision(state.text), bounds: selection, bubbleId: selection.bubbleId, styleId: selection.styleId, status: "placed" });
      });
      await persistLinks(ctx, links);
    },

    set_progress: async (ctx, params) => {
      const state = ctx.getState(), info = await commands.document_info();
      const line = state.lines[params.lineIndex];
      if (!line || line.ignore) fail("invalid_line");
      const layer = (await allLayers(ctx)).find(item => item.layerId === params.layerId);
      if (!layer) fail("layer_not_found");
      if (params.status === "validated" && !dialogueMatches(layer.text, buildRichTextPayload(line.text).text)) fail("text_mismatch: repair the text before validation");
      const links = (state.mcpProgress || []).slice();
      const existing = links.findIndex(link => link.tabId === state.currentTabId && link.document === documentIdentity(info) && link.layerId === params.layerId);
      const link = { ...(existing < 0 ? {} : links[existing]), tabId: state.currentTabId, document: documentIdentity(info), documentId: info.id, layerId: params.layerId, lineIndex: params.lineIndex, scriptRevision: scriptRevision(state.text), sourceText: line.text, appliedText: layer.text, status: params.status };
      if (params.bounds) link.bounds = validateBounds(params.bounds, info);
      if (params.bubbleId) link.bubbleId = params.bubbleId;
      if (existing < 0) links.push(link); else links[existing] = link;
      await persistLinks(ctx, links);
      return { link };
    },

    review_page: async (ctx, params) => {
      const state = ctx.getState(), info = await commands.document_info();
      return { documentId: info.id, ...reviewPage({ lines: state.lines, range: pageRange(state.lines, state.currentLineIndex), layers: await allLayers(ctx), links: currentLinks(state, info), revision: scriptRevision(state.text), padding: params.padding || 0 }) };
    },

    export_page: async (ctx, params) => {
      assertAbsolutePath(params.path, params.format === "jpeg" ? /\.jpe?g$/i : /\.png$/i);
      return hostJSON(`typeRMcpExport(${JSON.stringify(params)})`);
    },

    sample_bubble: async (ctx, params) => {
      const info = await commands.document_info();
      if (params.bounds) {
        const bounds = validateBounds(params.bounds, info);
        const snapshot = await decodeSnapshot(2400);
        const sx = snapshot.imageWidth / snapshot.docWidth, sy = snapshot.imageHeight / snapshot.docHeight;
        const shape = sampleBubbleShapeProfile(snapshot.pixels, { left: bounds.left * sx, top: bounds.top * sy, right: bounds.right * sx, bottom: bounds.bottom * sy }, params.samples || 21);
        return { documentId: info.id, documentKey: info.documentKey, bounds, shapeProfile: shape };
      }
      if (params.layerId == null) fail("bad_params: bounds or layerId required");
      const original = info.activeLayer;
      try {
        await commands.select_layer(ctx, params);
        const shape = await hostJSON(`getActiveLayerBubbleShape(${JSON.stringify({ samples: params.samples || 21, tolerance: 20 })})`);
        return { documentId: info.id, documentKey: info.documentKey, ...shape };
      } finally { if (original) await commands.select_layer(ctx, { layerId: original.id }); }
    },

    learning: async (ctx, params) => {
      const state = ctx.getState();
      if (params.action === "get") return { tuning: state.textShapeRTuning || null };
      if (!Number.isInteger(params.documentId)) fail("documentId_required_for_learning");
      if (!params.layerIds || !params.layerIds.length) fail("layerIds_required");
      const info = await commands.document_info();
      const links = currentLinks(state, info);
      const rendered = { entries: await allLayers(ctx) };
      const engine = await import(/* webpackChunkName: "text-shaper-engine" */ "./textShapeR");
      let tuning = state.textShapeRTuning;
      let learned = 0;
      for (const id of params.layerIds) {
        const link = links.find(item => item.layerId === id && item.status === "validated" && item.scriptRevision === scriptRevision(state.text));
        if (!link) fail("unvalidated_layer: only explicitly validated associations can train");
        const layer = (rendered.entries || []).find(item => item.layerId === id);
        if (!layer || normalizeDialogue(layer.text) !== normalizeDialogue(link.appliedText)) fail("validated_layer_changed");
        const feedback = engine.recordTextShapeRFeedback(layer.text, { width: link.bounds && link.bounds.width, height: link.bounds && link.bounds.height }, tuning);
        if (feedback) { tuning = feedback.tuning; learned++; }
      }
      ctx.dispatch({ type: "setTextShapeRTuning", value: tuning, learned: true });
      await waitForState(ctx.getState, next => next.textShapeRTuning === tuning);
      return { learned, tuning };
    },

    open_image: async (ctx, params) => {
      const state = ctx.getState();
      const image = params.page == null ? null : getImageForPage(state.images, params.page, createPageImageLookup(state.images));
      const path = params.path || image && image.path;
      assertAbsolutePath(path, /\.(psd|psb|png|jpe?g|tiff?)$/i);
      const result = await hostJSON(`openFile(${JSON.stringify(path)},false)`);
      if (!result.ok) fail(result.error || "open_failed");
      ctx.dispatch({ type: "clearSelections", preserveLine: true });
      ctx.dispatch({ type: "setLastOpenedImagePath", path });
      await waitForState(ctx.getState, next => next.lastOpenedImagePath === path);
      return { opened: path, document: await commands.document_info() };
    },

    next_page: async ctx => navigatePage(ctx, 1),
    previous_page: async ctx => navigatePage(ctx, -1),
  };

  async function navigatePage(ctx, direction) {
    const state = ctx.getState();
    const current = pageRange(state.lines, state.currentLineIndex);
    let start = direction > 0 ? current.end : current.start - 1;
    if (start < 0 || start >= state.lines.length) return { boundary: true, currentLineIndex: state.currentLineIndex };
    const range = pageRange(state.lines, start);
    const lineIndex = nextPageLine(state.lines, range.start, range);
    if (lineIndex === null || !range.page) fail("page_has_no_usable_dialogue");
    const opened = await commands.open_image(ctx, { page: range.page });
    ctx.dispatch({ type: "setCurrentLineIndex", index: lineIndex });
    await waitForState(ctx.getState, next => next.currentLineIndex === lineIndex);
    return { ...opened, currentLineIndex: lineIndex, page: range.page };
  }
};
