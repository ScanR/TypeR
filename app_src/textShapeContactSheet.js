import { createFontPreviewRegistry, getFontPreviewFamily } from "./fontPreview";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isLightPixel = (data, index, threshold) =>
  data[index] >= threshold && data[index + 1] >= threshold && data[index + 2] >= threshold;

const findLightRuns = (imageData, y, left, right, threshold) => {
  const runs = [];
  let start = null;
  for (let x = left; x <= right; x++) {
    const light = isLightPixel(imageData.data, (y * imageData.width + x) * 4, threshold);
    if (light && start === null) start = x;
    if ((!light || x === right) && start !== null) {
      const end = light && x === right ? x : x - 1;
      runs.push({ left: start, right: end, width: end - start + 1 });
      start = null;
    }
  }
  return runs;
};

const sampleBubbleShapeProfile = (imageData, bounds, samples = 21, threshold = 225) => {
  if (!imageData || !imageData.data || !bounds) return null;
  const left = clamp(Math.floor(bounds.left), 0, imageData.width - 1);
  const top = clamp(Math.floor(bounds.top), 0, imageData.height - 1);
  const right = clamp(Math.ceil(bounds.right) - 1, left, imageData.width - 1);
  const bottom = clamp(Math.ceil(bounds.bottom) - 1, top, imageData.height - 1);
  const width = Math.max(1, right - left + 1);
  const height = Math.max(1, bottom - top + 1);
  const centerX = (left + right) / 2;
  const count = clamp(Math.round(samples || 21), 7, 31);
  const rows = [];
  let valid = 0;

  for (let index = 0; index < count; index++) {
    const yRatio = count === 1 ? 0.5 : index / (count - 1);
    const centerY = clamp(Math.round(top + yRatio * (height - 1)), top, bottom);
    let best = null;
    for (let offset = -1; offset <= 1; offset++) {
      const y = clamp(centerY + offset, top, bottom);
      findLightRuns(imageData, y, left, right, threshold).forEach((run) => {
        const containsCenter = run.left <= centerX && run.right >= centerX;
        const distance = containsCenter ? 0 : Math.min(Math.abs(run.left - centerX), Math.abs(run.right - centerX));
        const score = run.width - distance * 1.5 + (containsCenter ? width : 0);
        if (!best || score > best.score) best = { ...run, score };
      });
    }
    if (best && best.width >= width * 0.08) {
      valid++;
      rows.push({
        y: yRatio,
        left: clamp((best.left - left) / width, 0, 1),
        right: clamp((best.right + 1 - left) / width, 0, 1),
        width: clamp(best.width / width, 0, 1),
      });
    } else {
      rows.push({ y: yRatio, left: 0.5, right: 0.5, width: 0 });
    }
  }
  return valid >= Math.ceil(count * 0.55) ? { rows } : null;
};

const getProfileWidthAt = (shapeProfile, y) => {
  const rows = (shapeProfile && shapeProfile.rows || []).filter((row) => row.width > 0);
  if (rows.length < 2) {
    const normalized = clamp(y * 2 - 1, -0.98, 0.98);
    return Math.max(0.18, Math.sqrt(1 - normalized * normalized));
  }
  if (y <= rows[0].y) return rows[0].width;
  if (y >= rows[rows.length - 1].y) return rows[rows.length - 1].width;
  for (let index = 1; index < rows.length; index++) {
    if (y <= rows[index].y) {
      const before = rows[index - 1];
      const after = rows[index];
      const ratio = (y - before.y) / Math.max(0.0001, after.y - before.y);
      return before.width + (after.width - before.width) * ratio;
    }
  }
  return 1;
};

const stripMarkdown = (value) => String(value || "")
  .replace(/\*\*([^*]+)\*\*/g, "$1")
  .replace(/__([^_]+)__/g, "$1")
  .replace(/\*([^*]+)\*/g, "$1")
  .replace(/_([^_]+)_/g, "$1");

const createTextShapeContactSheet = async ({
  variants,
  fonts,
  textStyle,
  params,
  nodeRequire,
  snapshot,
  bounds,
  shapeProfile,
}) => {
  if (!variants || !variants.length) throw new Error("shape_failed: TextShapeR returned no variants");
  const columns = clamp(Math.round(params.columns || 2), 1, 3);
  const canvasWidth = clamp(Math.round(params.sheetWidth || 1400), 800, 2400);
  const outer = 26;
  const gap = 18;
  const headerHeight = 58;
  const cardWidth = (canvasWidth - outer * 2 - gap * (columns - 1)) / columns;
  const visualHeight = clamp(Math.round(cardWidth * 0.72), 280, 500);
  const cardHeight = headerHeight + visualHeight;
  const rows = Math.ceil(variants.length / columns);
  const canvasHeight = outer * 2 + rows * cardHeight + Math.max(0, rows - 1) * gap;
  const dark = params.theme === "dark";

  const registry = createFontPreviewRegistry(fonts, [textStyle], Date.now(), "mcp_shape");
  const family = getFontPreviewFamily(textStyle, registry);
  const styleElement = document.createElement("style");
  styleElement.setAttribute("data-typer-mcp-shape-preview", "true");
  styleElement.textContent = registry.css;
  document.head.appendChild(styleElement);

  try {
    const actualFontSize = clamp(Number(params.fontSize || textStyle.size || textStyle.impliedFontSize || 36), 6, 300);
    if (document.fonts && document.fonts.load) {
      await document.fonts.load(`${actualFontSize}px ${family}`, stripMarkdown(params.text || "")).catch(() => []);
    }
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = dark ? "#15171b" : "#e9edf2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = "alphabetic";

    let pageCanvas = null;
    let sourceRect = null;
    if (snapshot && bounds) {
      pageCanvas = document.createElement("canvas");
      pageCanvas.width = snapshot.imageWidth;
      pageCanvas.height = snapshot.imageHeight;
      pageCanvas.getContext("2d").putImageData(snapshot.pixels, 0, 0);
      const scaleX = snapshot.imageWidth / snapshot.docWidth;
      const scaleY = snapshot.imageHeight / snapshot.docHeight;
      const marginX = bounds.width * 0.12;
      const marginY = bounds.height * 0.12;
      sourceRect = {
        left: clamp((bounds.left - marginX) * scaleX, 0, snapshot.imageWidth - 1),
        top: clamp((bounds.top - marginY) * scaleY, 0, snapshot.imageHeight - 1),
        right: clamp((bounds.right + marginX) * scaleX, 1, snapshot.imageWidth),
        bottom: clamp((bounds.bottom + marginY) * scaleY, 1, snapshot.imageHeight),
        bubbleLeft: bounds.left * scaleX,
        bubbleTop: bounds.top * scaleY,
        bubbleRight: bounds.right * scaleX,
        bubbleBottom: bounds.bottom * scaleY,
      };
    }

    const metadata = [];
    variants.forEach((variant, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const left = outer + column * (cardWidth + gap);
      const top = outer + row * (cardHeight + gap);
      const visualTop = top + headerHeight;
      const innerPadding = 18;
      const innerLeft = left + innerPadding;
      const innerTop = visualTop + innerPadding;
      const innerWidth = cardWidth - innerPadding * 2;
      const innerHeight = visualHeight - innerPadding * 2;

      ctx.fillStyle = dark ? "#24272d" : "#ffffff";
      ctx.strokeStyle = dark ? "#444a54" : "#c7cdd6";
      ctx.fillRect(left, top, cardWidth, cardHeight);
      ctx.strokeRect(left + 0.5, top + 0.5, cardWidth - 1, cardHeight - 1);
      ctx.fillStyle = dark ? "#f4f6f8" : "#1e2228";
      ctx.font = "600 19px Tahoma, sans-serif";
      ctx.fillText(`Variante ${index + 1} · ${variant.lines.length} lignes`, left + 18, top + 26);
      ctx.fillStyle = dark ? "#aeb5c0" : "#68717c";
      ctx.font = "14px Tahoma, sans-serif";
      ctx.fillText(`score ${variant.score == null ? "—" : Number(variant.score).toFixed(2)}`, left + 18, top + 48);

      let bubbleDisplay = null;
      let documentScale = 1;
      if (pageCanvas && sourceRect) {
        const sourceWidth = Math.max(1, sourceRect.right - sourceRect.left);
        const sourceHeight = Math.max(1, sourceRect.bottom - sourceRect.top);
        const scale = Math.min(innerWidth / sourceWidth, innerHeight / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        const drawLeft = innerLeft + (innerWidth - drawWidth) / 2;
        const drawTop = innerTop + (innerHeight - drawHeight) / 2;
        ctx.drawImage(pageCanvas, sourceRect.left, sourceRect.top, sourceWidth, sourceHeight, drawLeft, drawTop, drawWidth, drawHeight);
        bubbleDisplay = {
          left: drawLeft + (sourceRect.bubbleLeft - sourceRect.left) * scale,
          top: drawTop + (sourceRect.bubbleTop - sourceRect.top) * scale,
          width: (sourceRect.bubbleRight - sourceRect.bubbleLeft) * scale,
          height: (sourceRect.bubbleBottom - sourceRect.bubbleTop) * scale,
        };
        documentScale = scale * (snapshot.imageWidth / snapshot.docWidth);
      } else {
        const aspect = clamp(Number(params.height || 280) / Math.max(1, Number(params.width || 320)), 0.3, 3);
        let bubbleWidth = innerWidth * 0.82;
        let bubbleHeight = bubbleWidth * aspect;
        if (bubbleHeight > innerHeight * 0.9) {
          bubbleHeight = innerHeight * 0.9;
          bubbleWidth = bubbleHeight / aspect;
        }
        bubbleDisplay = {
          left: innerLeft + (innerWidth - bubbleWidth) / 2,
          top: innerTop + (innerHeight - bubbleHeight) / 2,
          width: bubbleWidth,
          height: bubbleHeight,
        };
        documentScale = bubbleWidth / Math.max(1, Number(params.width || 320));
        ctx.fillStyle = dark ? "#f7f7f4" : "#fffefb";
        ctx.strokeStyle = dark ? "#c7ccd2" : "#333840";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          bubbleDisplay.left + bubbleDisplay.width / 2,
          bubbleDisplay.top + bubbleDisplay.height / 2,
          bubbleDisplay.width / 2,
          bubbleDisplay.height / 2,
          0, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();
      }

      const renderedFontSize = clamp(actualFontSize * documentScale, 10, 86);
      const lineHeight = renderedFontSize * Number(params.lineHeight || 1.14);
      const lines = variant.lines.map(stripMarkdown);
      const centerX = bubbleDisplay.left + bubbleDisplay.width / 2;
      const centerY = bubbleDisplay.top + bubbleDisplay.height / 2;
      const firstBaseline = centerY - ((lines.length - 1) * lineHeight) / 2 + renderedFontSize * 0.34;
      ctx.font = `${renderedFontSize}px ${family}`;
      ctx.textAlign = "center";
      let maxOverflowRatio = 0;
      const measurements = lines.map((line, lineIndex) => {
        const baseline = firstBaseline + lineIndex * lineHeight;
        const normalizedY = clamp((baseline - renderedFontSize * 0.35 - bubbleDisplay.top) / bubbleDisplay.height, 0, 1);
        const available = bubbleDisplay.width * getProfileWidthAt(shapeProfile, normalizedY) * 0.9;
        const measured = ctx.measureText(line).width;
        const overflowRatio = measured / Math.max(1, available);
        maxOverflowRatio = Math.max(maxOverflowRatio, overflowRatio);
        return { line, baseline, available, measured, overflowRatio };
      });
      measurements.forEach((measurement) => {
        ctx.fillStyle = measurement.overflowRatio > 1 ? "#d62f2f" : "#111318";
        ctx.fillText(measurement.line, centerX, measurement.baseline);
      });
      ctx.textAlign = "left";
      metadata.push({
        index: index + 1,
        text: variant.text,
        lines: variant.lines,
        lineCount: variant.lines.length,
        score: variant.score == null ? null : variant.score,
        fits: maxOverflowRatio <= 1 && lines.length * lineHeight <= bubbleDisplay.height * 0.9,
        approximate: true,
        maxOverflowRatio: Math.round(maxOverflowRatio * 1000) / 1000,
        renderedFontSize: Math.round(renderedFontSize * 10) / 10,
      });
    });

    const nodePath = nodeRequire("path");
    const os = nodeRequire("os");
    const fs = nodeRequire("fs");
    const { Buffer } = nodeRequire("buffer");
    const outputPath = nodePath.join(os.tmpdir(), `typer-text-shape-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    const base64 = canvas.toDataURL("image/png").split(",")[1];
    fs.writeFileSync(outputPath, Buffer.from(base64, "base64"));
    return {
      path: outputPath,
      temporary: true,
      measurementEngine: "canvas_estimate",
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      fontPostScriptName: textStyle.fontPostScriptName || textStyle.fontName || null,
      fontSize: actualFontSize,
      contextualPageCrop: !!pageCanvas,
      shapeProfile: shapeProfile || null,
      variants: metadata,
    };
  } finally {
    if (styleElement.parentNode) styleElement.parentNode.removeChild(styleElement);
  }
};

export { createTextShapeContactSheet, getProfileWidthAt, sampleBubbleShapeProfile, stripMarkdown };
