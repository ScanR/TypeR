import { parsePageMarker } from "./pageMarker";

const getFirstUsableLineIndexOnCurrentPage = (lines, currentLineIndex) => {
  if (!Array.isArray(lines) || !lines.length) return currentLineIndex;

  const currentPosition = lines.findIndex((line) => line.rawIndex === currentLineIndex);
  if (currentPosition < 0) return currentLineIndex;

  let pageStartPosition = 0;
  for (let index = currentPosition; index >= 0; index -= 1) {
    if (parsePageMarker(lines[index].rawText || "")) {
      pageStartPosition = index + 1;
      break;
    }
  }

  for (let index = pageStartPosition; index <= currentPosition; index += 1) {
    if (!lines[index].ignore) return lines[index].rawIndex;
  }

  return currentLineIndex;
};

export const getStoredSelectionLineIndex = (selection, fallbackLineIndex, lines = []) => {
  if (!selection || typeof selection.lineIndex !== "number") return fallbackLineIndex;
  if (!Array.isArray(lines) || !lines.length) return selection.lineIndex;

  const firstCurrentPageLineIndex = getFirstUsableLineIndexOnCurrentPage(lines, fallbackLineIndex);
  return selection.lineIndex < firstCurrentPageLineIndex
    ? firstCurrentPageLineIndex
    : selection.lineIndex;
};
