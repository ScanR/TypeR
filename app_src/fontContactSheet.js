import { createFontPreviewRegistry, getFontPreviewFamily } from "./fontPreview";

const DEFAULT_SAMPLE = "Une voix, un ton, une émotion — Aa Éé 0123 ?!";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const fontSearchText = (font) =>
  `${font.family || ""} ${font.style || ""} ${font.name || ""} ${font.postScriptName || ""}`.toLocaleLowerCase();

const selectFontPreviewCandidates = (fonts, params = {}) => {
  const list = fonts || [];
  const requested = Array.isArray(params.fontPostScriptNames)
    ? params.fontPostScriptNames.filter(Boolean)
    : [];
  const query = String(params.query || "").trim().toLocaleLowerCase();
  const limit = clamp(Math.round(params.limit || 12), 1, 24);
  const seen = new Set();
  const selected = [];

  const add = (font) => {
    const key = font && (font.postScriptName || `${font.family}|${font.style}|${font.name}`);
    if (!font || !key || seen.has(key)) return;
    seen.add(key);
    selected.push(font);
  };

  if (requested.length) {
    requested.forEach((postScriptName) => {
      add(list.find((font) => font.postScriptName === postScriptName));
    });
  } else {
    list.forEach((font) => {
      if (!query || fontSearchText(font).indexOf(query) !== -1) add(font);
    });
  }
  return selected.slice(0, limit);
};

const wrapCanvasText = (ctx, text, maxWidth, maxLines = 2) => {
  const paragraphs = String(text || "").split(/\r?\n/);
  const lines = [];
  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length && lines.length < maxLines; paragraphIndex++) {
    const words = paragraphs[paragraphIndex].trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
      const next = line ? `${line} ${words[wordIndex]}` : words[wordIndex];
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = words[wordIndex];
        if (lines.length >= maxLines) break;
      } else {
        line = next;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
  }
  if (!lines.length) lines.push(" ");
  return lines;
};

const createFontContactSheet = async (fonts, params, nodeRequire) => {
  const candidates = selectFontPreviewCandidates(fonts, params);
  if (!candidates.length) throw new Error("bad_params: no installed font matches the preview request");

  const sample = String(params.text || DEFAULT_SAMPLE).slice(0, 500);
  const columns = clamp(Math.round(params.columns || 2), 1, 3);
  const fontSize = clamp(Math.round(params.fontSize || 42), 18, 96);
  const canvasWidth = clamp(Math.round(params.width || 1400), 700, 2400);
  const outerPadding = 28;
  const gap = 18;
  const cardWidth = (canvasWidth - outerPadding * 2 - gap * (columns - 1)) / columns;
  const sampleLineHeight = Math.round(fontSize * 1.18);
  const cardHeight = 88 + sampleLineHeight * 2 + 26;
  const rows = Math.ceil(candidates.length / columns);
  const canvasHeight = outerPadding * 2 + rows * cardHeight + Math.max(0, rows - 1) * gap;
  const dark = params.theme === "dark";

  const textStyles = candidates.map((font) => ({
    fontPostScriptName: font.postScriptName,
    fontName: font.name || font.family,
    fontStyleName: font.style,
  }));
  const registry = createFontPreviewRegistry(candidates, textStyles, Date.now(), "mcp");
  const styleElement = document.createElement("style");
  styleElement.setAttribute("data-typer-mcp-font-preview", "true");
  styleElement.textContent = registry.css;
  document.head.appendChild(styleElement);

  try {
    if (document.fonts && document.fonts.load) {
      await Promise.all(textStyles.map((textStyle) =>
        document.fonts.load(`${fontSize}px ${getFontPreviewFamily(textStyle, registry)}`, sample).catch(() => [])
      ));
    }

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = dark ? "#17191d" : "#eef0f3";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "alphabetic";

    candidates.forEach((font, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = outerPadding + column * (cardWidth + gap);
      const top = outerPadding + row * (cardHeight + gap);
      const textStyle = textStyles[index];
      const family = getFontPreviewFamily(textStyle, registry);

      ctx.fillStyle = dark ? "#24272d" : "#ffffff";
      ctx.strokeStyle = dark ? "#414650" : "#cbd0d8";
      ctx.lineWidth = 1;
      ctx.fillRect(left, top, cardWidth, cardHeight);
      ctx.strokeRect(left + 0.5, top + 0.5, cardWidth - 1, cardHeight - 1);

      ctx.fillStyle = dark ? "#f3f5f7" : "#20242a";
      ctx.font = "600 20px Tahoma, sans-serif";
      ctx.fillText(`${index + 1}. ${font.family || font.name || font.postScriptName}`, left + 22, top + 31, cardWidth - 44);
      ctx.fillStyle = dark ? "#aeb5c0" : "#68707b";
      ctx.font = "14px Tahoma, sans-serif";
      ctx.fillText(`${font.style || "Regular"} · ${font.postScriptName || font.name || ""}`, left + 22, top + 56, cardWidth - 44);

      ctx.fillStyle = dark ? "#ffffff" : "#111318";
      ctx.font = `${fontSize}px ${family}`;
      const lines = wrapCanvasText(ctx, params.uppercase ? sample.toLocaleUpperCase() : sample, cardWidth - 44, 2);
      lines.forEach((line, lineIndex) => {
        ctx.fillText(line, left + 22, top + 96 + lineIndex * sampleLineHeight, cardWidth - 44);
      });
    });

    const nodePath = nodeRequire("path");
    const os = nodeRequire("os");
    const fs = nodeRequire("fs");
    const { Buffer } = nodeRequire("buffer");
    const outputPath = nodePath.join(os.tmpdir(), `typer-font-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const base64 = canvas.toDataURL("image/png").split(",")[1];
    fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
    return {
      path: outputPath,
      temporary: true,
      measurementEngine: "canvas_estimate",
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      sample,
      fonts: candidates.map((font, index) => ({
        index: index + 1,
        family: font.family || null,
        style: font.style || null,
        name: font.name || null,
        postScriptName: font.postScriptName || null,
      })),
    };
  } finally {
    if (styleElement.parentNode) styleElement.parentNode.removeChild(styleElement);
  }
};

export { createFontContactSheet, selectFontPreviewCandidates, wrapCanvasText };
