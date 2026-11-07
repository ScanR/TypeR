// HTML elements that UXP's panel DOM draws as native widgets, adapted when
// TypeR runs there (uxp-src/host/inPanel.js).
// - A <button> is a native button in UXP: it shows its text only, never its
//   icons (an <svg> child is laid out at 0x0), and it is drawn above the
//   page. The application's buttons become <div role="button">, with the
//   class "typer-button" that the stylesheet rules about "button" are
//   rewritten to (webpack.uxp.config.js) and that gets a button's defaults
//   (style.scss).
// - A text field, a list or a textarea paints any background that is not
//   opaque in black: translucent ones are composed over what is under them,
//   as a browser shows them, and set opaque.
// - Icons take --typer-icon for want of currentColor: an inline text colour
//   sets it too.
import React from "react";

const ACTIVATING_KEYS = { Enter: true, " ": true, Spacebar: true };

const InPanelButton = React.forwardRef(function InPanelButton(props, ref) {
  const { type, disabled, onClick, onKeyDown, className, tabIndex, children, form, name, value, autoFocus, ...rest } = props;
  const activate = (event) => {
    if (disabled) return;
    if (onClick) onClick(event);
    // A submit button sends its form, as the native element would
    if (type === "submit" && !event.defaultPrevented) {
      let node = event.currentTarget;
      while (node && node.tagName !== "FORM") node = node.parentNode;
      if (node) node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  };
  return React.createElement("div", Object.assign({}, rest, {
    ref,
    role: "button",
    tabIndex: disabled ? -1 : tabIndex === undefined ? 0 : tabIndex,
    "aria-disabled": disabled ? "true" : undefined,
    disabled: disabled ? true : undefined,
    className: "typer-button" + (className ? " " + className : "") + (disabled ? " m-disabled" : ""),
    onClick: activate,
    onKeyDown: (event) => {
      if (onKeyDown) onKeyDown(event);
      if (!event.defaultPrevented && ACTIVATING_KEYS[event.key]) {
        event.preventDefault();
        activate(event);
      }
    },
  }), children);
});

/* ------------------------- field backgrounds ------------------------- */

const FIELDS = { input: true, textarea: true, select: true };
// Inputs that are no text field: UXP draws its own widget for them
const NOT_TEXT_FIELD = /^(checkbox|radio|range|file|color|hidden|button|submit|reset|image)$/i;
const NAMED = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1] };

// "#rgb", "#rrggbb(aa)", "rgb(a)(…)", "hsl(a)(…deg, …%, …%, a)": [r, g, b, a] or null
export function parseColor(text) {
  const value = String(text || "").trim().toLowerCase();
  if (NAMED[value]) return NAMED[value].slice();
  let match = /^#([0-9a-f]{3,8})$/.exec(value);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((digit) => digit + digit).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const channel = (index) => parseInt(hex.slice(index, index + 2), 16);
    return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) / 255 : 1];
  }
  match = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
  if (!match) return null;
  const parts = match[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const number = (part) => parseFloat(part);
  const alphaOf = (part) => (part === undefined ? 1 : /%$/.test(part) ? number(part) / 100 : number(part));
  if (match[1][0] === "r") {
    const channel = (part) => (/%$/.test(part) ? number(part) * 2.55 : number(part));
    return [channel(parts[0]), channel(parts[1]), channel(parts[2]), alphaOf(parts[3])];
  }
  const hue = (((number(parts[0]) / (/turn$/.test(parts[0]) ? 1 / 360 : /rad$/.test(parts[0]) ? Math.PI / 180 : 1)) % 360) + 360) % 360;
  const saturation = number(parts[1]) / 100;
  const lightness = number(parts[2]) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255, alphaOf(parts[3])];
}

// The colours from the top layer down to the first opaque one, composed
export function composeLayers(layers, base) {
  let result = base.slice(0, 3);
  for (let index = layers.length - 1; index >= 0; index--) {
    const [r, g, b, a] = layers[index];
    result = [r * a + result[0] * (1 - a), g * a + result[1] * (1 - a), b * a + result[2] * (1 - a)];
  }
  return "rgb(" + result.map((channel) => Math.round(channel)).join(", ") + ")";
}

// Photoshop's panel colour, when nothing under the field is opaque
const DEFAULT_BASE = [83, 83, 83, 1];

function settleFieldBackground(node) {
  if (!node || !node.isConnected || (node.tagName === "INPUT" && NOT_TEXT_FIELD.test(node.type || ""))) return;
  // The colour set last time comes off first: the field's own rules may have
  // changed since (focus, theme)
  if (node.__typerBackground !== undefined && node.style.backgroundColor === node.__typerBackground) node.style.removeProperty("background-color");
  node.__typerBackground = undefined;
  const own = parseColor(getComputedStyle(node).backgroundColor);
  if (!own || own[3] >= 1) return;
  const layers = own[3] > 0 ? [own] : [];
  let base = DEFAULT_BASE;
  for (let parent = node.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
    const color = parseColor(getComputedStyle(parent).backgroundColor);
    if (!color || color[3] <= 0) continue;
    if (color[3] >= 1) { base = color; break; }
    layers.push(color);
  }
  // Important: some fields are made transparent with !important (search boxes)
  node.style.setProperty("background-color", composeLayers(layers, base), "important");
  node.__typerBackground = node.style.backgroundColor;
}

const fields = new Set();
let sweepTimer = null;
// What the theme is: Photoshop's (body classes, theme colours) and the editor's
const themeKey = () => {
  const host = document.getElementById("hostStyle");
  return document.body.className + "|" + (document.body.getAttribute("data-editor-theme") || "") + "|" + (host ? host.textContent : "");
};
// The fields' rules change with focus and with the theme: they are settled
// again on focus changes, and when the theme changed (looked at once a
// second; nothing is touched while it stays the same)
function watchFields() {
  if (sweepTimer) return;
  let theme = themeKey();
  sweepTimer = setInterval(() => {
    fields.forEach((node) => { if (!node.isConnected) fields.delete(node); });
    const now = themeKey();
    if (now === theme) return;
    theme = now;
    fields.forEach(settleFieldBackground);
  }, 1000);
  const settleTarget = (event) => { if (fields.has(event.target)) setTimeout(() => settleFieldBackground(event.target), 0); };
  document.addEventListener("focusin", settleTarget, true);
  document.addEventListener("focusout", settleTarget, true);
}

const setRef = (ref, node) => {
  if (typeof ref === "function") ref(node);
  else if (ref && typeof ref === "object") ref.current = node;
};

function fieldProps(props) {
  const ref = props && props.ref;
  return Object.assign({}, props, {
    ref: (node) => {
      setRef(ref, node);
      // Once per field: a render (each key typed) leaves its background alone
      if (!node || fields.has(node)) return;
      fields.add(node);
      watchFields();
      setTimeout(() => settleFieldBackground(node), 0);
    },
  });
}

/* ----------------------- leaving and entering ----------------------- */

// UXP sends mouseout and mouseover without relatedTarget. React then takes
// every mouseout for the pointer leaving the window and calls onMouseLeave on
// all the element's ancestors (the dividers' drag stopped at once: the panel
// body ends it on mouseleave), and every mouseover for the pointer coming in.
// UXP's pointerout and pointerover, sent just before them for the same move,
// do carry it: the mouse event takes the pointer event's, in place, before
// React reads it. Nothing is dispatched again: a synthetic event's dispatch
// is asynchronous in UXP and sometimes throws inside it ("reading 'detail'").
function installHoverEvents() {
  [["pointerout", "mouseout"], ["pointerover", "mouseover"]].forEach(([pointerType, mouseType]) => {
    let last = null;
    document.addEventListener(pointerType, (event) => {
      last = { target: event.target, related: event.relatedTarget || null };
    }, true);
    document.addEventListener(mouseType, (event) => {
      const pointer = last;
      last = null;
      if (event.relatedTarget || !pointer || pointer.target !== event.target || !pointer.related) return;
      try { Object.defineProperty(event, "relatedTarget", { configurable: true, value: pointer.related }); } catch (error) {}
    }, true);
  });
}

/* ------------------------------ clicks ------------------------------ */

// UXP sends click to the element the button was released over, wherever it
// was pressed: a divider dragged and released over a folder's title folded
// the folder. A browser sends it to the nearest element that holds both;
// the click is retargeted so, in place, before React reads its target.
function installClickTarget() {
  let pressed = null;
  window.addEventListener("mousedown", (event) => { pressed = event.target; }, true);
  window.addEventListener("click", (event) => {
    const down = pressed;
    pressed = null;
    const up = event.target;
    if (!down || !up || down === up || typeof up.contains !== "function" || up.contains(down)) return;
    let common = up.parentNode;
    while (common && !(typeof common.contains === "function" && common.contains(down))) common = common.parentNode;
    if (!common) return;
    try { Object.defineProperty(event, "target", { configurable: true, value: common }); } catch (error) {}
  }, true);
}

/* ------------------------------ resize ------------------------------ */

// UXP fires window's resize at every layout change of the page, the panel's
// size unchanged. The application lays its blocks out again on resize, with
// their saved sizes: during a divider's drag, the blocks jumped back to the
// saved size at each hover. Those resize events are dropped while a mouse
// button is held. The others go through: UXP lays a page out after the
// script that changed it (a new element measures 0×0), and they are what
// makes the application measure again what it measured too early (the
// footer's labels, for one).
function installResizeFilter() {
  const size = () => document.documentElement.clientWidth + "x" + document.documentElement.clientHeight;
  let last = size();
  let pressed = false;
  window.addEventListener("mousedown", () => { pressed = true; }, true);
  window.addEventListener("mouseup", () => { pressed = false; }, true);
  // A button released outside the panel sends no mouseup here
  window.addEventListener("mousemove", (event) => { if (pressed && event.buttons === 0) pressed = false; }, true);
  window.addEventListener("resize", (event) => {
    if (!event.isTrusted) return;
    const now = size();
    if (pressed && now === last) event.stopImmediatePropagation();
    last = now;
  }, true);
}

/* --------------------------- installation --------------------------- */

const NOT_ICON_COLOR = /currentcolor|^\s*(inherit|initial|unset|revert)\s*$/i;

function iconColorProps(props) {
  const color = props.style.color;
  if (typeof color !== "string" || NOT_ICON_COLOR.test(color) || props.style["--typer-icon"] !== undefined) return props;
  return Object.assign({}, props, { style: Object.assign({}, props.style, { "--typer-icon": color }) });
}

// Every createElement of the application, compiled with React's classic
// JSX runtime, goes through React.createElement
export function installInPanelElements() {
  installHoverEvents();
  installResizeFilter();
  installClickTarget();
  const createElement = React.createElement;
  React.createElement = function inPanelCreateElement(type, props, ...children) {
    if (type === "button") type = InPanelButton;
    else if (typeof type === "string" && FIELDS[type]) props = fieldProps(props);
    if (props && props.style && typeof type === "string") props = iconColorProps(props);
    return createElement.call(this, type, props, ...children);
  };
}
