import deepClone from "./deepClone";
import { applyCapturedTextSize } from "./styleSizePresets";

const getScaledStyle = (style, textScale) => {
  if (!style || !textScale) return style;
  const scaledStyle = deepClone(style);
  const textStyle = scaledStyle.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const ratio = textScale / 100;
  if (typeof textStyle.size === "number") {
    textStyle.size *= ratio;
  }
  if (Array.isArray(scaledStyle.sizePresets)) {
    scaledStyle.sizePresets = scaledStyle.sizePresets.map((size) => (
      typeof size === "number" ? size * ratio : size
    ));
  }
  if (typeof textStyle.leading === "number" && textStyle.leading) {
    textStyle.leading *= ratio;
  }
  return scaledStyle;
};

const resolveStylePointText = (style, fallbackPointText = false) => {
  if (style?.textType === "point") return true;
  if (style?.textType === "paragraph") return false;
  return !!fallbackPointText;
};

const getNextUsableLineIndex = (lines, startIndex) => {
  for (let index = Math.max(0, startIndex); index < lines.length; index++) {
    if (lines[index] && !lines[index].ignore) return index;
  }
  return null;
};

const buildSelectedLayerPayload = ({
  layerIds = [],
  lines = [],
  currentLineIndex = 0,
  currentStyle = null,
  textScale = null,
}) => {
  const items = [];
  const lineEntries = [];
  let lineIndex = Math.max(0, currentLineIndex);
  let activeStyle = currentStyle;

  for (let layerIndex = 0; layerIndex < layerIds.length; layerIndex++) {
    const usableLineIndex = getNextUsableLineIndex(lines, lineIndex);
    if (usableLineIndex === null) break;

    const targetLine = lines[usableLineIndex];
    const targetStyle = targetLine.usedStyle || targetLine.style || activeStyle;
    if (targetStyle) activeStyle = targetStyle;
    items.push({
      layerId: layerIds[layerIndex],
      text: targetLine.text,
      style: getScaledStyle(targetStyle, textScale),
    });
    lineEntries.push({
      lineIndex: usableLineIndex,
      styleId: targetStyle?.id || null,
    });
    lineIndex = usableLineIndex + 1;
  }

  const nextLineIndex = getNextUsableLineIndex(lines, lineIndex);
  const lastEntry = lineEntries[lineEntries.length - 1];
  return {
    items,
    lineEntries,
    nextLineIndex: nextLineIndex === null
      ? (lastEntry ? lastEntry.lineIndex : currentLineIndex)
      : nextLineIndex,
  };
};

const buildStoredSelectionPayload = ({
  storedSelections = [],
  lines = [],
  currentLineIndex = 0,
  styles = [],
  currentStyle = null,
  textScale = null,
}) => {
  const texts = [];
  const layerStyles = [];
  let nextFallbackIndex = currentLineIndex;

  const resolveStyleForLine = (targetLine, selection) => {
    if (selection?.styleId) {
      const storedStyle = styles.find((style) => style.id === selection.styleId);
      if (storedStyle) return applyCapturedTextSize(storedStyle, selection.textSize);
    }
    if (targetLine?.usedStyle) return targetLine.usedStyle;
    if (targetLine?.style) return targetLine.style;
    return currentStyle;
  };

  const resolveLineForSelection = (selection) => {
    if (typeof selection.lineIndex === "number" && selection.lineIndex >= 0) {
      const storedLine = lines[selection.lineIndex];
      if (storedLine && !storedLine.ignore) {
        nextFallbackIndex = Math.max(nextFallbackIndex, selection.lineIndex + 1);
        return storedLine;
      }
    }

    while (nextFallbackIndex < lines.length) {
      const candidate = lines[nextFallbackIndex];
      nextFallbackIndex++;
      if (candidate && !candidate.ignore) {
        return candidate;
      }
    }
    return null;
  };

  for (let i = 0; i < storedSelections.length; i++) {
    const selection = storedSelections[i];
    const targetLine = resolveLineForSelection(selection);
    if (!targetLine) break;
    texts.push(targetLine.text);
    layerStyles.push(getScaledStyle(resolveStyleForLine(targetLine, selection), textScale));
  }

  return { texts, styles: layerStyles };
};

export {
  getScaledStyle,
  resolveStylePointText,
  buildSelectedLayerPayload,
  buildStoredSelectionPayload,
};
