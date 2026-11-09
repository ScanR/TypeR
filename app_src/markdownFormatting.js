const getMarkerCount = (text, start, end, markerChar) => {
  let before = 0;
  let after = 0;
  while (before < 3 && start - before - 1 >= 0 && text[start - before - 1] === markerChar) before += 1;
  while (after < 3 && end + after < text.length && text[end + after] === markerChar) after += 1;
  return Math.min(before, after);
};

const getSelectedMarkerCount = (text, start, end, markerChar) => {
  let opening = 0;
  let closing = 0;
  while (opening < 3 && start + opening < end && text[start + opening] === markerChar) opening += 1;
  while (closing < 3 && end - closing - 1 >= start && text[end - closing - 1] === markerChar) closing += 1;
  const count = Math.min(opening, closing);
  return end - start > count * 2 ? count : 0;
};

const markerCountToStyle = (count) => ({
  bold: count >= 2,
  italic: count === 1 || count >= 3,
});

const styleToMarker = (style, markerChar = "*") => {
  const count = style.bold && style.italic ? 3 : style.bold ? 2 : style.italic ? 1 : 0;
  return markerChar.repeat(count);
};

const formatMarkdownSelection = (text, start, end, format) => {
  const value = typeof text === "string" ? text : "";
  const safeStart = Math.max(0, Math.min(Number(start) || 0, value.length));
  const safeEnd = Math.max(safeStart, Math.min(Number(end) || 0, value.length));
  if (safeStart === safeEnd || (format !== "bold" && format !== "italic")) {
    return { text: value, selectionStart: safeStart, selectionEnd: safeEnd };
  }

  let markerChar = "*";
  let markerCount = getMarkerCount(value, safeStart, safeEnd, markerChar);
  let markersInsideSelection = false;
  if (!markerCount) {
    const underscoreCount = getMarkerCount(value, safeStart, safeEnd, "_");
    if (underscoreCount) {
      markerChar = "_";
      markerCount = underscoreCount;
    }
  }
  if (!markerCount) {
    markerCount = getSelectedMarkerCount(value, safeStart, safeEnd, markerChar);
    markersInsideSelection = markerCount > 0;
    if (!markerCount) {
      const underscoreCount = getSelectedMarkerCount(value, safeStart, safeEnd, "_");
      if (underscoreCount) {
        markerChar = "_";
        markerCount = underscoreCount;
        markersInsideSelection = true;
      }
    }
  }

  const currentStyle = markerCountToStyle(markerCount);
  const nextStyle = { ...currentStyle, [format]: !currentStyle[format] };
  const nextMarker = styleToMarker(nextStyle, markerChar);
  const selectedText = markersInsideSelection
    ? value.slice(safeStart + markerCount, safeEnd - markerCount)
    : value.slice(safeStart, safeEnd);

  if (markerCount) {
    const outerStart = markersInsideSelection ? safeStart : safeStart - markerCount;
    const outerEnd = markersInsideSelection ? safeEnd : safeEnd + markerCount;
    return {
      text: value.slice(0, outerStart) + nextMarker + selectedText + nextMarker + value.slice(outerEnd),
      selectionStart: outerStart + nextMarker.length,
      selectionEnd: outerStart + nextMarker.length + selectedText.length,
    };
  }

  return {
    text: value.slice(0, safeStart) + nextMarker + selectedText + nextMarker + value.slice(safeEnd),
    selectionStart: safeStart + nextMarker.length,
    selectionEnd: safeEnd + nextMarker.length,
  };
};

const BLOCK_TAGS = /^(p|div|li|ul|ol|tr|table|h[1-6]|blockquote|section|article|header|footer|pre)$/i;
const SKIPPED_TAGS = /^(script|style|head|title|meta|link|template)$/i;

const markdownStyleMarker = (bold, italic) => (bold && italic ? "***" : bold ? "**" : italic ? "*" : "");

// Wraps every line of a run in its markers, keeping the spaces around the
// words outside them: "**Hello **world" is not read as bold, "**Hello** world" is
const applyMarkdownStyle = (text, bold, italic) => {
  const marker = markdownStyleMarker(bold, italic);
  if (!marker) return text;
  return text.split("\n").map((part) => {
    const match = /^(\s*)(.*?)(\s*)$/.exec(part);
    const core = match ? match[2] : part;
    if (!core) return part;
    return match[1] + marker + core + marker + match[3];
  }).join("\n");
};

// The Markdown of a pasted HTML document (the DOM body of the clipboard's
// text/html), with the bold and italic runs marked. Only the paragraphs, list
// items and <br> of the document break lines: the line breaks of the HTML
// source itself (Word wraps its clipboard HTML every 70 characters or so) and
// the indentation between its tags are whitespace, as a browser renders them,
// so a paragraph pasted from Word stays one script line and no blank line
// appears between two paragraphs. The text is not escaped: a "*" or "_" of
// the document is kept as typed, so that a style prefix such as "* *:" still
// starts its line, exactly as a plain-text paste leaves it.
const htmlNodeToMarkdown = (root) => {
  const runs = [];
  const lastText = () => (runs.length ? runs[runs.length - 1].text : "");
  const pushRun = (text, style) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic) {
      last.text += text;
    } else {
      runs.push({ text, bold: style.bold, italic: style.italic });
    }
  };

  const walk = (node, style, preformatted) => {
    if (!node) return;
    if (node.nodeType === 3) {
      const raw = String(node.nodeValue || "").replace(/\u00a0/g, " ");
      if (preformatted) {
        pushRun(raw, style);
        return;
      }
      const value = raw.replace(/\s+/g, " ");
      // Whitespace between two blocks is layout, not text
      if (value === " " && (!runs.length || /\n$/.test(lastText()))) return;
      pushRun(value, style);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = String(node.tagName || "").toLowerCase();
    if (SKIPPED_TAGS.test(tag)) return;
    if (tag === "br") {
      pushRun("\n", style);
      return;
    }

    const nextStyle = { bold: style.bold, italic: style.italic };
    if (tag === "b" || tag === "strong") nextStyle.bold = true;
    if (tag === "i" || tag === "em") nextStyle.italic = true;

    const inlineStyle = (typeof node.getAttribute === "function" && node.getAttribute("style")) || "";
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(inlineStyle)) nextStyle.bold = true;
    if (/font-weight\s*:\s*(normal|[1-5]00)/i.test(inlineStyle)) nextStyle.bold = false;
    if (/font-style\s*:\s*italic/i.test(inlineStyle)) nextStyle.italic = true;
    if (/font-style\s*:\s*normal/i.test(inlineStyle)) nextStyle.italic = false;

    const isBlock = BLOCK_TAGS.test(tag);
    if (isBlock && runs.length && !/\n$/.test(lastText())) {
      pushRun("\n", style);
    }
    const children = node.childNodes ? Array.from(node.childNodes) : [];
    for (const child of children) {
      walk(child, nextStyle, preformatted || tag === "pre");
    }
    if (isBlock) {
      pushRun("\n", style);
    }
  };

  walk(root, { bold: false, italic: false }, false);

  return runs
    .map((run) => applyMarkdownStyle(run.text, run.bold, run.italic))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
};

export { formatMarkdownSelection, applyMarkdownStyle, htmlNodeToMarkdown };
