import React from "react";
import ReactDOM from "react-dom";
import { FiChevronDown, FiSearch } from "react-icons/fi";

import { locale } from "../../utils";
import { filterFontOptions, getInstalledFontFaceRule } from "../../fontPreview";

import "./fontPicker.scss";

const ROW_HEIGHT = 30;
const OVERSCAN = 6;
const MAX_LIST_HEIGHT = 300;
const SEARCH_HEIGHT = 36;
const VIEWPORT_MARGIN = 8;

// One stylesheet shared by every picker. A face is only declared once a row
// showing it is rendered, so opening the family list of a typesetter's
// thousands of fonts loads just the visible ones.
let faceSheet = null;
const faceAliases = new Map();

const ensureFontFace = (font) => {
  if (!font || !font.postScriptName) return "";
  const cached = faceAliases.get(font.postScriptName);
  if (cached !== undefined) return cached;
  const alias = `TypeRPicker_${faceAliases.size}`;
  const rule = getInstalledFontFaceRule(font, alias);
  let result = "";
  try {
    if (!faceSheet) {
      const element = document.createElement("style");
      element.setAttribute("data-typer-font-picker", "");
      document.head.appendChild(element);
      faceSheet = element.sheet;
    }
    if (rule) {
      faceSheet.insertRule(rule, faceSheet.cssRules.length);
      result = alias;
    }
  } catch (e) {
    result = "";
  }
  faceAliases.set(font.postScriptName, result);
  return result;
};

const getPreviewStyle = (font) => {
  const alias = ensureFontFace(font);
  return alias ? { fontFamily: `"${alias}", "Tahoma", sans-serif` } : undefined;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Font family / font style dropdown whose rows are drawn in their own font,
// with an optional search field. options: [{ value, label, font, meta }].
const FontPicker = React.memo(function FontPicker(props) {
  const { options, value, onChange, searchable, className, minPopoverWidth, title } = props;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [layout, setLayout] = React.useState(null);
  const triggerRef = React.useRef();
  const listRef = React.useRef();
  const inputRef = React.useRef();
  const initialScrollRef = React.useRef(0);

  const selected = options.find((option) => option.value === value);
  const filtered = React.useMemo(
    () => (searchable ? filterFontOptions(options, query) : options),
    [options, query, searchable]
  );

  const close = (restoreFocus) => {
    setOpen(false);
    if (restoreFocus && triggerRef.current) triggerRef.current.focus();
  };

  const openPicker = (initialQuery) => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, minPopoverWidth || 0), viewportWidth - VIEWPORT_MARGIN * 2);
    const left = clamp(rect.left, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
    const chrome = (searchable ? SEARCH_HEIGHT : 0) + 2;
    const wanted = Math.min(MAX_LIST_HEIGHT, Math.max(options.length, 1) * ROW_HEIGHT);
    const below = viewportHeight - rect.bottom - VIEWPORT_MARGIN - 4 - chrome;
    const above = rect.top - VIEWPORT_MARGIN - 4 - chrome;
    const placeBelow = below >= Math.min(wanted, ROW_HEIGHT * 6) || below >= above;
    const listHeight = Math.max(ROW_HEIGHT * 3, Math.min(wanted, placeBelow ? below : above));
    setLayout({
      left,
      width,
      listHeight,
      top: placeBelow ? rect.bottom + 4 : undefined,
      bottom: placeBelow ? undefined : viewportHeight - rect.top + 4,
    });

    const startQuery = initialQuery || "";
    const startOptions = searchable && startQuery ? filterFontOptions(options, startQuery) : options;
    const selectedIndex = startQuery ? 0 : Math.max(0, startOptions.findIndex((option) => option.value === value));
    const startScroll = clamp(
      selectedIndex * ROW_HEIGHT - listHeight / 2 + ROW_HEIGHT / 2,
      0,
      Math.max(0, startOptions.length * ROW_HEIGHT - listHeight)
    );
    initialScrollRef.current = startScroll;
    setQuery(startQuery);
    setHighlight(selectedIndex);
    setScrollTop(startScroll);
    setOpen(true);
  };

  React.useLayoutEffect(() => {
    if (!open) return;
    if (listRef.current) listRef.current.scrollTop = initialScrollRef.current;
    const focusTarget = searchable ? inputRef.current : listRef.current;
    if (focusTarget) focusTarget.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const handleResize = () => setOpen(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  const scrollToIndex = (index) => {
    const list = listRef.current;
    if (!list || !layout) return;
    const top = index * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + layout.listHeight) list.scrollTop = top + ROW_HEIGHT - layout.listHeight;
  };

  const changeQuery = (nextQuery) => {
    setQuery(nextQuery);
    setHighlight(0);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const choose = (option) => {
    close(true);
    if (option && option.value !== value) onChange(option.value);
  };

  const moveHighlight = (delta) => {
    if (!filtered.length) return;
    const next = clamp(highlight + delta, 0, filtered.length - 1);
    setHighlight(next);
    scrollToIndex(next);
  };

  const handlePopoverKeyDown = (e) => {
    const page = layout ? Math.max(1, Math.floor(layout.listHeight / ROW_HEIGHT) - 1) : 8;
    if (e.key === "ArrowDown") moveHighlight(1);
    else if (e.key === "ArrowUp") moveHighlight(-1);
    else if (e.key === "PageDown") moveHighlight(page);
    else if (e.key === "PageUp") moveHighlight(-page);
    else if (e.key === "Enter") choose(filtered[highlight]);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
    // Escape must not also close the style editor (document-level handler)
    e.stopPropagation();
  };

  const handleTriggerKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openPicker();
    } else if (searchable && e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Typing on the closed picker starts a search, like a native select
      e.preventDefault();
      openPicker(e.key);
    }
  };

  const renderRows = () => {
    if (!layout) return null;
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(filtered.length, Math.ceil((scrollTop + layout.listHeight) / ROW_HEIGHT) + OVERSCAN);
    const rows = [];
    for (let index = first; index < last; index++) {
      const option = filtered[index];
      const isSelected = option.value === value;
      rows.push(
        <div
          key={option.value}
          role="option"
          aria-selected={isSelected}
          className={
            "font-picker-option" +
            (index === highlight ? " m-highlight" : "") +
            (isSelected ? " m-selected" : "")
          }
          style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
          title={option.label}
          onMouseMove={() => index !== highlight && setHighlight(index)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => choose(option)}
        >
          <span className="font-picker-option-label" style={getPreviewStyle(option.font)}>
            {option.label}
          </span>
          {option.meta && <span className="font-picker-option-meta">{option.meta}</span>}
        </div>
      );
    }
    return rows;
  };

  const popover = open && layout && ReactDOM.createPortal(
    <React.Fragment>
      <div className="font-picker-overlay" onMouseDown={() => close(false)} />
      <div
        className="font-picker-popover"
        style={{ left: layout.left, width: layout.width, top: layout.top, bottom: layout.bottom }}
        onKeyDown={handlePopoverKeyDown}
      >
        {searchable && (
          <div className="font-picker-search">
            <FiSearch size={13} />
            <input
              ref={inputRef}
              type="text"
              className="topcoat-text-input"
              value={query}
              placeholder={locale.editStyleFontSearch || "Search fonts"}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => changeQuery(e.target.value)}
            />
          </div>
        )}
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="font-picker-list"
          style={{ height: Math.min(layout.listHeight, Math.max(filtered.length, 1) * ROW_HEIGHT) }}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          {filtered.length ? (
            <div className="font-picker-list-inner" style={{ height: filtered.length * ROW_HEIGHT }}>
              {renderRows()}
            </div>
          ) : (
            <div className="font-picker-empty">{locale.editStyleFontNoResults || "No font found"}</div>
          )}
        </div>
      </div>
    </React.Fragment>,
    document.body
  );

  return (
    <React.Fragment>
      <button
        ref={triggerRef}
        type="button"
        title={title || (selected ? selected.label : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={"topcoat-textarea font-picker-trigger" + (open ? " m-open" : "") + (className ? " " + className : "")}
        onClick={() => (open ? close(false) : openPicker())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="font-picker-trigger-label" style={selected ? getPreviewStyle(selected.font) : undefined}>
          {selected ? selected.label : value}
        </span>
        <FiChevronDown size={13} className="font-picker-trigger-icon" />
      </button>
      {popover}
    </React.Fragment>
  );
});

export default FontPicker;
