import { parsePageMarker } from "../../pageMarker";
import "./textBlock.scss";

import React from "react";
import PropTypes from "prop-types";
import { FiArrowRightCircle, FiBold, FiItalic, FiTarget } from "react-icons/fi";

import config from "../../config";
import { nativeAlert, locale, setActiveLayerText, resizeTextArea, scrollToLine, openFile, convertHtmlToMarkdown, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { notePerfRender } from "../../perfDebug";
import { formatMarkdownSelection } from "../../markdownFormatting";
import { createPageImageLookup, getImageForPage } from "../../pageImageMapping";

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const textSelectionMirrorProperties = [
  "boxSizing", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
  "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textAlign", "textTransform",
  "direction", "tabSize", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "whiteSpace", "wordBreak", "overflowWrap",
];

const getTextAreaSelectionRects = (textArea) => {
  if (!textArea || typeof document === "undefined" || typeof window === "undefined") return [];
  const start = textArea.selectionStart;
  const end = textArea.selectionEnd;
  if (start === end) return [];

  const computed = window.getComputedStyle(textArea);
  const mirrorParent = textArea.offsetParent || textArea.parentElement;
  if (!mirrorParent) return [];
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "hidden";
  mirror.style.left = `${textArea.offsetLeft}px`;
  mirror.style.top = `${textArea.offsetTop}px`;
  mirror.style.width = `${textArea.offsetWidth}px`;
  mirror.style.minHeight = `${textArea.offsetHeight}px`;
  textSelectionMirrorProperties.forEach((property) => {
    mirror.style[property] = computed[property];
  });

  mirror.appendChild(document.createTextNode(textArea.value.slice(0, start)));
  const selected = document.createElement("span");
  selected.textContent = textArea.value.slice(start, end);
  mirror.appendChild(selected);
  mirror.appendChild(document.createTextNode(textArea.value.slice(end) || "\u200b"));
  mirrorParent.appendChild(mirror);

  let rects = [];
  try {
    const range = document.createRange();
    range.selectNodeContents(selected);
    rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (!rects.length) {
      const rect = selected.getBoundingClientRect();
      if (rect.height > 0) rects = [rect];
    }
  } finally {
    mirror.remove();
  }
  return rects;
};

// Extracted memoized line component to avoid re-rendering every line on each render
const LineItem = React.memo(function LineItem({ line, direction, isCurrent, dispatch, renderHighlightedText, lineNum }) {
  const className = "text-line" +
    (line.ignore ? " m-empty" : "") +
    (isCurrent ? " m-current" : "") +
    (parsePageMarker(line.rawText) ? " m-page" : "");

  const handleSelect = React.useCallback(() => {
    dispatch({ type: "setCurrentLineIndex", index: line.rawIndex });
  }, [dispatch, line.rawIndex]);

  const handleInsert = React.useCallback(() => {
    setActiveLayerText(line.text, null, direction, (ok) => {
      if (ok) {
        dispatch({ type: "nextLine", add: true });
      }
    });
  }, [dispatch, line.text, direction]);

  return (
    <div className={className} data-line-index={line.rawIndex}>
      <div className="text-line-num" title={String(lineNum || "")}>{lineNum}</div>
      <div className="text-line-select" title={line.ignore ? "" : locale.selectLine}>
        {line.ignore ? " " : <FiTarget size={14} onClick={handleSelect} />}
      </div>
      <div className="text-line-text" dir={direction}>
        {line.ignorePrefix ? (
          <React.Fragment>
            <span className="text-line-ignore-prefix">{line.ignorePrefix}</span>
            {renderHighlightedText(line.rawText.slice(line.ignorePrefix.length))}
          </React.Fragment>
        ) : line.stylePrefix ? (
          <React.Fragment>
            <span className="text-line-style-prefix" style={{ background: line.style?.prefixColor || config.defaultPrefixColor }}>
              {line.stylePrefix}
            </span>
            {renderHighlightedText(line.rawText.slice(line.stylePrefix.length))}
          </React.Fragment>
        ) : (
          renderHighlightedText(line.rawText)
        )}
      </div>
      <div className="text-line-insert" title={line.ignore ? "" : locale.insertText}>
        {line.ignore ? " " : <FiArrowRightCircle size={14} onClick={handleInsert} />}
      </div>
    </div>
  );
});
LineItem.propTypes = {
  line: PropTypes.object.isRequired,
  direction: PropTypes.string.isRequired,
  isCurrent: PropTypes.bool.isRequired,
  dispatch: PropTypes.func.isRequired,
  renderHighlightedText: PropTypes.func.isRequired,
  lineNum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};

const TextBlock = React.memo(function TextBlock() {
  notePerfRender("TextBlock");
  const context = useContext((state) => ({
    direction: state.direction,
    interpretMarkdown: state.interpretMarkdown,
    text: state.text,
    currentLineIndex: state.currentLineIndex,
    ignoreTags: state.ignoreTags,
    lines: state.lines,
    images: state.images,
    autoClosePSD: state.autoClosePSD,
  }));
  const direction = context.state.direction || "ltr";
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const [focused, setFocused] = React.useState(false);
  const [selection, setSelection] = React.useState({ start: 0, end: 0 });
  const [formatToolbarPosition, setFormatToolbarPosition] = React.useState(null);
  const lastOpenedPath = React.useRef(null);
  const textAreaRef = React.useRef(null);
  const formatToolbarRef = React.useRef(null);
  const linesRef = React.useRef(null);
  const [rowLayout, setRowLayout] = React.useState(null);
  const [viewport, setViewport] = React.useState({ top: 0, height: 600 });
  const scrollFrameRef = React.useRef(null);
  const pageImageLookup = React.useMemo(
    () => createPageImageLookup(context.state.images),
    [context.state.images]
  );

  // Fix: only resize when text changes, not on every render
  React.useEffect(resizeTextArea, [context.state.text]);

  // The textarea must always match the rendered lines' height: if it goes
  // stale (panel re-shown, UI zoom, markdown/ignore-tags toggles, rewrap),
  // the .text-lines layer keeps the clicks and the textarea becomes
  // uneditable. Observe the lines block so every height change re-syncs.
  React.useEffect(() => {
    if (typeof ResizeObserver === "undefined" || !linesRef.current) return undefined;
    const observer = new ResizeObserver(() => resizeTextArea(true));
    observer.observe(linesRef.current);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    scrollToLine(context.state.currentLineIndex, 1000);
  }, [context.state.currentLineIndex]);

  const ignoreTags = React.useMemo(
    () => (context.state.ignoreTags || []).filter((tag) => tag),
    [context.state.ignoreTags]
  );
  const ignoreTagsPattern = React.useMemo(() => {
    if (!ignoreTags.length) return null;
    const pattern = ignoreTags.map((tag) => escapeRegExp(tag)).join("|");
    return pattern || null;
  }, [ignoreTags]);

  // Memoize the RegExp so it's not recreated on every renderHighlightedText call
  const ignoreTagsRegex = React.useMemo(() => {
    if (!ignoreTagsPattern) return null;
    return new RegExp(`(${ignoreTagsPattern})`, "g");
  }, [ignoreTagsPattern]);

  const renderMarkdownText = React.useCallback(
    (text, keyPrefix = "md") => {
      if (!markdownEnabled) return text;
      const parsed = parseMarkdownRuns(text);
      if (!parsed.hasFormatting) {
        return parsed.text;
      }
      return parsed.runs.map((run, index) => {
        const runStyle = {};
        if (run.bold) runStyle.fontWeight = "bold";
        if (run.italic) runStyle.fontStyle = "italic";
        return (
          <span key={`${keyPrefix}-${index}`} style={runStyle}>
            {run.text}
          </span>
        );
      });
    },
    [markdownEnabled]
  );

  const renderMarkdownOverlay = React.useCallback(
    (text) => {
      if (!markdownEnabled) return text;
      const parsed = parseMarkdownRuns(text || "");
      const segments = parsed.overlaySegments || [];
      if (!segments.length) return text;
      return segments.map((segment, index) => {
        const style = {};
        if (segment.bold) style.fontWeight = "bold";
        if (segment.italic) style.fontStyle = "italic";
        if (segment.hidden) style.visibility = "hidden";
        return (
          <span key={`overlay-${index}`} style={style}>
            {segment.text || " "}
          </span>
        );
      });
    },
    [markdownEnabled]
  );

  const renderHighlightedText = React.useCallback(
    (text) => {
      if (text === undefined || text === null || text === "") {
        return <span>{" "}</span>;
      }
      if (!ignoreTagsRegex) {
        return <span>{renderMarkdownText(text)}</span>;
      }
      const parts = text.split(ignoreTagsRegex);
      const nodes = parts.map((part, index) => {
        if (!part) return null;
        if (index % 2 === 1) {
          return (
            <span key={`ignore-${index}`} className="text-line-ignore-tag">
              {part}
            </span>
          );
        }
        return (
          <React.Fragment key={`text-${index}`}>
            {renderMarkdownText(part, `md-${index}`)}
          </React.Fragment>
        );
      });
      const hasContent = nodes.some((node) => node !== null);
      if (!hasContent) {
        return <span>{" "}</span>;
      }
      return nodes;
    },
    [ignoreTagsRegex, renderMarkdownText]
  );

  // Keep the page-opening effect in sync with explicit MCP navigation.
  React.useEffect(() => {
    if (context.state.lastOpenedImagePath) lastOpenedPath.current = context.state.lastOpenedImagePath;
  }, [context.state.lastOpenedImagePath]);

  React.useEffect(() => {
    let active = true;
    let image = context.state.images[0] || null;
    for (const line of context.state.lines) {
      if (line.ignore) {
        const page = parsePageMarker(line.rawText);
        const pageImage = page
          ? getImageForPage(context.state.images, page, pageImageLookup)
          : null;
        if (pageImage) image = pageImage;
      }
      if (line.rawIndex === context.state.currentLineIndex) {
        break;
      }
    }
    if (image && image.path !== lastOpenedPath.current) {
      openFile(image.path, context.state.autoClosePSD, (result) => {
        if (!active || result.superseded) return;
        if (!result.ok) {
          nativeAlert(locale.errorOpenPage.replace("{path}", image.path), locale.errorTitle, true);
          return;
        }
        lastOpenedPath.current = image.path;
        context.dispatch({ type: "clearSelections", preserveLine: true });
        context.dispatch({ type: "setLastOpenedImagePath", path: image.path });
      });
    }
    return () => { active = false; };
  }, [context.state.currentLineIndex, context.state.autoClosePSD, context.state.images, context.state.lines, pageImageLookup]);

  // Precompute line numbers (handles the cumulative page counter)
  const linesWithNums = React.useMemo(() => {
    return context.state.lines.map((line) => {
      let lineNum;
      if (line.ignore) {
        const page = parsePageMarker(line.rawText);
        const currentImage = page
          ? getImageForPage(context.state.images, page, pageImageLookup)
          : null;
        if (currentImage) {
          lineNum = currentImage.name;
        } else {
          lineNum = " ";
        }
      } else {
        lineNum = line.index;
      }
      return { line, lineNum };
    });
  }, [context.state.lines, context.state.images, pageImageLookup]);

  // Measure the real wrapped height of each row once, then keep only the rows
  // near the viewport mounted. The textarea remains the source of the total
  // scroll height, while spacers preserve the highlight layer's geometry.
  React.useLayoutEffect(() => {
    const container = linesRef.current;
    if (!container || linesWithNums.length < 200) {
      if (rowLayout) setRowLayout(null);
      return;
    }
    const width = container.clientWidth;
    const nodes = container.querySelectorAll("[data-line-index]");
    const needsFullLayout = !rowLayout || rowLayout.heights.length !== linesWithNums.length || Math.abs(rowLayout.width - width) > 1;
    const heights = needsFullLayout ? new Array(linesWithNums.length).fill(17) : rowLayout.heights.concat([]);
    let changed = needsFullLayout;
    for (let i = 0; i < nodes.length; i++) {
      const index = parseInt(nodes[i].getAttribute("data-line-index"), 10);
      const height = nodes[i].offsetHeight || 17;
      if (heights[index] !== height) {
        heights[index] = height;
        changed = true;
      }
    }
    if (changed) {
      const offsets = new Array(heights.length + 1);
      offsets[0] = 0;
      for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i];
      setRowLayout({ heights, offsets, total: offsets[offsets.length - 1], width });
    }
  }, [context.state.lines, linesWithNums.length, rowLayout]);

  React.useEffect(() => {
    const scrollContainer = linesRef.current?.parentElement;
    if (!scrollContainer || linesWithNums.length < 200) return undefined;
    const updateViewport = () => {
      scrollFrameRef.current = null;
      setViewport((current) => {
        const next = { top: scrollContainer.scrollTop, height: scrollContainer.clientHeight };
        return current.top === next.top && current.height === next.height ? current : next;
      });
    };
    const onScroll = () => {
      if (!scrollFrameRef.current) scrollFrameRef.current = requestAnimationFrame(updateViewport);
    };
    updateViewport();
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateViewport);
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateViewport);
      if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [linesWithNums.length]);

  const virtualWindow = React.useMemo(() => {
    if (!rowLayout || linesWithNums.length < 200 || rowLayout.heights.length !== linesWithNums.length) {
      return { start: 0, end: linesWithNums.length, top: 0, bottom: 0 };
    }
    const overscan = 450;
    const minY = Math.max(0, viewport.top - overscan);
    const maxY = viewport.top + viewport.height + overscan;
    let low = 0;
    let high = linesWithNums.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rowLayout.offsets[middle + 1] < minY) low = middle + 1;
      else high = middle;
    }
    const start = low;
    low = start;
    high = linesWithNums.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rowLayout.offsets[middle] <= maxY) low = middle + 1;
      else high = middle;
    }
    const end = Math.max(start + 1, low);
    return {
      start,
      end,
      top: rowLayout.offsets[start],
      bottom: Math.max(0, rowLayout.total - rowLayout.offsets[end]),
    };
  }, [linesWithNums.length, rowLayout, viewport]);
  React.useLayoutEffect(() => {
    if (linesRef.current) linesRef.current.__typerRowLayout = rowLayout;
  }, [rowLayout]);

  const handlePaste = React.useCallback(
    (event) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      if (!markdownEnabled) return;
      const html = clipboard.getData("text/html");
      if (!html) return;
      const markdown = convertHtmlToMarkdown(html);
      if (!markdown) return;
      const plainText = clipboard.getData("text/plain") || "";
      if (markdown === plainText) return;

      event.preventDefault();
      const currentText = context.state.text || "";
      const textArea = textAreaRef.current;
      const start = textArea ? textArea.selectionStart : currentText.length;
      const end = textArea ? textArea.selectionEnd : currentText.length;
      const nextText = currentText.slice(0, start) + markdown + currentText.slice(end);
      context.dispatch({ type: "setText", text: nextText });
      requestAnimationFrame(() => {
        if (!textArea) return;
        const cursor = start + markdown.length;
        textArea.selectionStart = cursor;
        textArea.selectionEnd = cursor;
      });
    },
    [context.state.text, context.dispatch, markdownEnabled]
  );

  const handleTextChange = React.useCallback(
    (e) => context.dispatch({ type: "setText", text: e.target.value }),
    [context.dispatch]
  );

  const updateSelection = React.useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    setSelection({ start: textArea.selectionStart, end: textArea.selectionEnd });
  }, []);

  const applySelectionFormat = React.useCallback(
    (format) => {
      const textArea = textAreaRef.current;
      if (!markdownEnabled || !textArea || textArea.selectionStart === textArea.selectionEnd) return;
      const result = formatMarkdownSelection(
        context.state.text || "",
        textArea.selectionStart,
        textArea.selectionEnd,
        format
      );
      context.dispatch({ type: "setText", text: result.text });
      setSelection({ start: result.selectionStart, end: result.selectionEnd });
      requestAnimationFrame(() => {
        if (!textAreaRef.current) return;
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(result.selectionStart, result.selectionEnd);
      });
    },
    [context.dispatch, context.state.text, markdownEnabled]
  );

  const handleFormatMouseDown = React.useCallback((event) => event.preventDefault(), []);
  const handleTextKeyDown = React.useCallback(
    (event) => {
      if (!markdownEnabled || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = String(event.key || "").toLowerCase();
      if (key !== "b" && key !== "i") return;
      if (!textAreaRef.current || textAreaRef.current.selectionStart === textAreaRef.current.selectionEnd) return;
      event.preventDefault();
      applySelectionFormat(key === "b" ? "bold" : "italic");
    },
    [applySelectionFormat, markdownEnabled]
  );

  // Parsing the whole script for the overlay is costly; only redo it when the
  // text itself changes, not on every unrelated context update
  const overlayContent = React.useMemo(
    () => renderMarkdownOverlay(context.state.text || ""),
    [renderMarkdownOverlay, context.state.text]
  );
  const handleFocus = React.useCallback(() => setFocused(true), []);
  const handleBlur = React.useCallback(() => {
    setFocused(false);
    setSelection({ start: 0, end: 0 });
  }, []);
  const hasSelection = markdownEnabled && focused && selection.end > selection.start;

  const updateFormatToolbarPosition = React.useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea || textArea.selectionStart === textArea.selectionEnd) {
      setFormatToolbarPosition(null);
      return;
    }
    const blockRect = textArea.parentElement.getBoundingClientRect();
    const selectionRect = getTextAreaSelectionRects(textArea).find((rect) => (
      rect.bottom >= blockRect.top && rect.top <= blockRect.bottom
    ));
    if (!selectionRect) {
      setFormatToolbarPosition(null);
      return;
    }

    const toolbarWidth = formatToolbarRef.current?.offsetWidth || 58;
    const toolbarHeight = formatToolbarRef.current?.offsetHeight || 28;
    const selectionCenter = selectionRect.left + selectionRect.width / 2;
    const left = Math.max(
      toolbarWidth / 2 + 4,
      Math.min(window.innerWidth - toolbarWidth / 2 - 4, selectionCenter)
    );
    const aboveTop = selectionRect.top - 6;
    const below = aboveTop - toolbarHeight < 4;
    setFormatToolbarPosition({
      left,
      top: below ? selectionRect.bottom + 6 : aboveTop,
      below,
    });
  }, []);

  React.useLayoutEffect(() => {
    if (!hasSelection) {
      setFormatToolbarPosition(null);
      return undefined;
    }
    const textArea = textAreaRef.current;
    const scrollContainer = textArea?.parentElement;
    let frame = null;
    const update = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateFormatToolbarPosition);
    };
    updateFormatToolbarPosition();
    update();
    scrollContainer?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scrollContainer?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [context.state.text, hasSelection, selection.end, selection.start, updateFormatToolbarPosition]);

  return (
    <React.Fragment>
      <div className="text-lines" ref={linesRef}>
        {virtualWindow.top > 0 && <div className="text-lines-spacer" style={{ height: virtualWindow.top }} />}
        {linesWithNums.slice(virtualWindow.start, virtualWindow.end).map(({ line, lineNum }) => (
          <LineItem
            key={line.rawIndex}
            line={line}
            direction={direction}
            isCurrent={context.state.currentLineIndex === line.rawIndex}
            dispatch={context.dispatch}
            renderHighlightedText={renderHighlightedText}
            lineNum={lineNum}
          />
        ))}
        {virtualWindow.bottom > 0 && <div className="text-lines-spacer" style={{ height: virtualWindow.bottom }} />}
      </div>
      <div className={"text-area-overlay" + (focused ? " m-hidden" : "")} dir={direction}>
        {overlayContent}
      </div>
      <textarea
        ref={textAreaRef}
        className={"text-area" + (focused ? " m-focused" : "")}
        dir={direction}
        value={context.state.text}
        onChange={handleTextChange}
        onPaste={handlePaste}
        onSelect={updateSelection}
        onKeyUp={updateSelection}
        onMouseUp={updateSelection}
        onKeyDown={handleTextKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {hasSelection && formatToolbarPosition && (
        <div
          ref={formatToolbarRef}
          className={"text-format-toolbar" + (formatToolbarPosition.below ? " m-below" : "")}
          role="toolbar"
          style={{ left: formatToolbarPosition.left, top: formatToolbarPosition.top }}
        >
          <button
            type="button"
            onMouseDown={handleFormatMouseDown}
            onClick={() => applySelectionFormat("bold")}
            title={`${locale.textFormatBold || "Bold"} (Ctrl+B)`}
            aria-label={locale.textFormatBold || "Bold"}
          >
            <FiBold size={13} />
          </button>
          <button
            type="button"
            onMouseDown={handleFormatMouseDown}
            onClick={() => applySelectionFormat("italic")}
            title={`${locale.textFormatItalic || "Italic"} (Ctrl+I)`}
            aria-label={locale.textFormatItalic || "Italic"}
          >
            <FiItalic size={13} />
          </button>
        </div>
      )}
      {!context.state.lines.length && !focused && (
        <div className="text-message" dir={direction}>
          <div>{locale.pasteTextHint}</div>
        </div>
      )}
    </React.Fragment>
  );
});

export default TextBlock;
