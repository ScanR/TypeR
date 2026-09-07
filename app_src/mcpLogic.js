import { parsePageMarker } from "./pageMarker";

export const scriptRevision = (text) => {
  let hash = 2166136261;
  const value = String(text || "");
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${value.length}:${(hash >>> 0).toString(16)}`;
};

export const pageRange = (lines, cursor = 0) => {
  let start = 0;
  let end = lines.length;
  let page = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = parsePageMarker(lines[i].rawText);
    if (!marker) continue;
    if (i <= cursor) { start = i; page = marker; }
    else { end = i; break; }
  }
  return { start, end, page };
};

export const nextPageLine = (lines, cursor, range = pageRange(lines, cursor)) => {
  for (let i = Math.max(range.start, cursor); i < range.end; i++) {
    if (lines[i] && !lines[i].ignore && !parsePageMarker(lines[i].rawText)) return i;
  }
  return null;
};

export const validateBounds = (bounds, document = null) => {
  if (!bounds || !["left", "top", "right", "bottom"].every(key => Number.isFinite(bounds[key]))) throw new Error("bad_params: finite bounds required");
  const left = Math.round(bounds.left), top = Math.round(bounds.top), right = Math.round(bounds.right), bottom = Math.round(bounds.bottom);
  if (left < 0 || top < 0 || right - left < 2 || bottom - top < 2) throw new Error("bad_params: invalid bounds");
  if (document && (right > document.width || bottom > document.height)) throw new Error("bad_params: bounds outside document");
  return { left, top, right, bottom, width: right - left, height: bottom - top, xMid: (left + right) / 2, yMid: (top + bottom) / 2 };
};

export const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export const polygonProfile = (points, bounds, samples = 21) => {
  if (!points || points.length < 3) throw new Error("bad_params: polygon needs three vertices");
  points.forEach(point => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) throw new Error("bad_params: polygon outside bounds");
  });
  const rows = [];
  for (let i = 0; i < samples; i++) {
    const y = (i + 0.5) / samples;
    const scanY = bounds.top + y * bounds.height;
    const intersections = [];
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) intersections.push(a.x + (scanY - a.y) * (b.x - a.x) / (b.y - a.y));
    });
    intersections.sort((a, b) => a - b);
    if (intersections.length > 2) throw new Error("bad_params: split a concave polygon with disconnected horizontal spans");
    const left = intersections.length ? (intersections[0] - bounds.left) / bounds.width : 0.5;
    const right = intersections.length ? (intersections[intersections.length - 1] - bounds.left) / bounds.width : 0.5;
    rows.push({ y, left, right, width: right - left });
  }
  if (!rows.some(row => row.width > 0)) throw new Error("bad_params: empty polygon");
  return { rows };
};

// Keep every request result for the session. Never silently forget a write key.
export const createOperationStore = (previous = {}, persist = () => {}) => {
  const records = Object.assign(Object.create(null), previous);
  Object.keys(records).forEach(key => {
    if (records[key].status === "pending") records[key] = { ...records[key], status: "interrupted", error: "panel_reloaded: inspect the document before any new write" };
  });
  return {
    get: id => records[id] || null,
    list: () => Object.keys(records).map(id => records[id]),
    begin(id, command, params) {
      const fingerprint = canonical({ command, params });
      const known = records[id];
      if (known) {
        if (known.fingerprint !== fingerprint) throw new Error("request_id_conflict: reuse requires identical arguments");
        return { fresh: false, record: known };
      }
      if (Object.keys(records).length >= 2000) throw new Error("operation_log_full: export/review this session before starting more writes");
      records[id] = { operationId: id, command, fingerprint, status: "pending", startedAt: Date.now() };
      persist(records);
      return { fresh: true, record: records[id] };
    },
    finish(id, patch) {
      records[id] = { ...records[id], ...patch, finishedAt: Date.now() };
      const undoable = Object.keys(records).filter(key => records[key].undoable).sort((a, b) => records[b].finishedAt - records[a].finishedAt);
      undoable.slice(16).forEach(key => { delete records[key].beforePanel; records[key].undoable = false; });
      persist(records);
      return records[id];
    },
  };
};

export const normalizeDialogue = text => String(text || "").replace(/\*\*|\*/g, "").replace(/\s+/g, " ").trim();
export const dialogueMatches = (rendered, source) => normalizeDialogue(rendered) === normalizeDialogue(source) || normalizeDialogue(String(rendered || "").replace(/-\s*(?:\r\n|\r|\n)\s*/g, "")) === normalizeDialogue(source);

export const reviewPage = ({ lines, range, layers, links, revision, padding = 0 }) => {
  const issues = [];
  const byId = new Map(layers.map(layer => [layer.layerId, layer]));
  const seen = new Set();
  const mappedLayers = [];
  for (const link of links) {
    if (link.lineIndex < range.start || link.lineIndex >= range.end) continue;
    const layer = byId.get(link.layerId);
    const issue = (kind, extra = {}) => issues.push({ kind, layerId: link.layerId, lineIndex: link.lineIndex, ...extra });
    if (link.scriptRevision !== revision) { issue("stale_script_link"); continue; }
    if (!layer) { issue("missing_layer"); continue; }
    if (seen.has(link.lineIndex)) issue("duplicate_line");
    seen.add(link.lineIndex);
    if (normalizeDialogue(layer.text) !== normalizeDialogue(link.appliedText || lines[link.lineIndex].text)) issue("text_changed", { expected: link.appliedText || lines[link.lineIndex].text, actual: layer.text });
    if (link.sourceText !== lines[link.lineIndex].text) issue("script_changed");
    if (layer.visible === false) issue("hidden_layer");
    if (layer.fontMissing) issue("missing_font", { font: layer.fontPostScriptName });
    if (link.bounds && layer.bounds) {
      const b = link.bounds, t = layer.bounds;
      const margins = { left: t.left - b.left, top: t.top - b.top, right: b.right - t.right, bottom: b.bottom - t.bottom };
      if (Object.values(margins).some(margin => margin < padding - 0.5)) issue("margin_overflow", { bounds: b, margins });
    }
    if (layer.bounds) mappedLayers.push(layer);
  }
  for (let i = range.start; i < range.end; i++) if (!lines[i].ignore && !parsePageMarker(lines[i].rawText) && !seen.has(i)) issues.push({ kind: "missing_dialogue", lineIndex: i, text: lines[i].text });
  for (let a = 0; a < mappedLayers.length; a++) for (let b = a + 1; b < mappedLayers.length; b++) {
    const one = mappedLayers[a], two = mappedLayers[b];
    if (one.layerId === two.layerId) continue;
    const x = Math.min(one.bounds.right, two.bounds.right) - Math.max(one.bounds.left, two.bounds.left);
    const y = Math.min(one.bounds.bottom, two.bounds.bottom) - Math.max(one.bounds.top, two.bounds.top);
    if (x > 0 && y > 0) issues.push({ kind: "layer_collision", layerIds: [one.layerId, two.layerId], overlapArea: x * y });
  }
  const sizesByStyle = new Map();
  links.forEach(link => {
    const layer = byId.get(link.layerId);
    if (link.lineIndex < range.start || link.lineIndex >= range.end || !link.styleId || !layer || !layer.fontSize) return;
    if (!sizesByStyle.has(link.styleId)) sizesByStyle.set(link.styleId, []);
    sizesByStyle.get(link.styleId).push(layer);
  });
  sizesByStyle.forEach((group, styleId) => {
    if (group.length < 3) return;
    const sizes = group.map(layer => layer.fontSize).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    group.forEach(layer => {
      if (layer.fontSize < median * 0.75 || layer.fontSize > median * 1.25) issues.push({ kind: "size_outlier", layerId: layer.layerId, styleId, fontSize: layer.fontSize, medianFontSize: median });
    });
  });
  return { page: range.page, reviewedLines: seen.size, issues, requiresVisualReview: true };
};
