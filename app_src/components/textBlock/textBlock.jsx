import "./textBlock.scss";

import React from "react";
import PropTypes from "prop-types";
import { FiArrowRightCircle, FiTarget } from "react-icons/fi";

import config from "../../config";
import { locale, setActiveLayerText, resizeTextArea, scrollToLine, openFile, convertHtmlToMarkdown, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TextBlock = React.memo(function TextBlock() {
  const context = useContext();
  const direction = context.state.direction || "ltr";
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const [focused, setFocused] = React.useState(false);
  const lastOpenedPath = React.useRef(null);
  const textAreaRef = React.useRef(null);
  React.useEffect(resizeTextArea);
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
        if (segment.hidden && !segment.marker) style.visibility = "hidden";
        if (segment.marker) {
          style.opacity = 0.4;
          style.fontWeight = "normal";
          style.fontStyle = "normal";
          style.display = "inline-block";
          style.position = "relative";
          style.transform = "scale(0.65)";
          style.transformOrigin = "left center";
          if (segment.marker === "open") style.left = "0.2ch";
          if (segment.marker === "close") style.left = "-0.2ch";
        }
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
      if (!ignoreTagsPattern) {
        return <span>{renderMarkdownText(text)}</span>;
      }
      const regex = new RegExp(`(${ignoreTagsPattern})`, "g");
      const parts = text.split(regex);
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
    [ignoreTagsPattern, renderMarkdownText]
  );

  React.useEffect(() => {
    let pageIndex = 0;
    let currentPage = 0;
    for (const line of context.state.lines) {
      if (line.ignore) {
        const page = line.rawText.match(/Page ([0-9]+)/i);
        if (page && context.state.images[page[1] - 1]) {
          const img = context.state.images[page[1] - 1];
          currentPage = context.state.images.indexOf(img);
        }
      }
      if (line.rawIndex === context.state.currentLineIndex) {
        pageIndex = currentPage;
        break;
      }
    }
    const image = context.state.images[pageIndex];
    if (image && image.path !== lastOpenedPath.current) {
      openFile(image.path, context.state.autoClosePSD);
      lastOpenedPath.current = image.path;
      context.dispatch({ type: "setLastOpenedImagePath", path: image.path });
    }
  }, [context.state.currentLineIndex, context.state.autoClosePSD, context.state.images, context.state.lines]);

  let currentPage = 0;

  const classNameLine = (line) => {
    let style = "text-line";
    if (line.ignore) {
      style += " m-empty";
    }
    if (context.state.currentLineIndex === line.rawIndex) {
      style += " m-current";
    }
    if (line.rawText.match(/Page [0-9]+/i)) {
      style += " m-page";
    }
    return style;
  };

  const getTextLineNum = (line) => {
    if (line.ignore) {
      const page = line.rawText.match(/Page ([0-9]+)/i);
      if (page && context.state.images[page[1] - 1]) {
        const currentImage = context.state.images[page[1] - 1];
        currentPage = context.state.images.indexOf(currentImage);
        return currentImage.name;
      }
      return " ";
    }
    return line.index;
  };

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

  return (
    <React.Fragment>
      <div className="text-lines">
        {context.state.lines.map((line) => (
          <div key={line.rawIndex} className={classNameLine(line, context)}>
            <div className="text-line-num">{getTextLineNum(line)}</div>
            <div className="text-line-select" title={line.ignore ? "" : locale.selectLine}>
              {line.ignore ? " " : <FiTarget size={14} onClick={() => context.dispatch({ type: "setCurrentLineIndex", index: line.rawIndex })} />}
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
              {line.ignore ? " " : (
                <FiArrowRightCircle
                  size={14}
                  onClick={() => {
                    setActiveLayerText(line.text, null, direction);
                    context.dispatch({ type: "nextLine", add: true });
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="text-area-overlay" dir={direction}>
        {renderMarkdownOverlay(context.state.text || "")}
      </div>
      <textarea
        ref={textAreaRef}
        className="text-area"
        dir={direction}
        value={context.state.text}
        onChange={(e) => context.dispatch({ type: "setText", text: e.target.value })}
        onPaste={handlePaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {!context.state.lines.length && !focused && (
        <div className="text-message" dir={direction}>
          <div>{locale.pasteTextHint}</div>
        </div>
      )}
    </React.Fragment>
  );
});

export default TextBlock;
