// Paste on click: which Photoshop "set selection" events are a user's
// selection worth pasting into. Inspired by MD TYPER's selection-event.js.
// A Magic Wand click carries its options (tolerance, contiguous, antiAlias,
// merged); a restored or loaded selection does not and never triggers.

const number = (value) => {
  if (typeof value === "number") return value;
  return value && typeof value._value === "number" ? value._value : NaN;
};

const WAND_OPTIONS = ["tolerance", "contiguous", "antiAlias", "merged"];

// descriptor: the actionJSON of a "set" event. Returns null or
// { source: "wand", x, y } | { source: "rectangle", left, top, right, bottom }
// | { source: "lasso" }
export const classifySelectionEvent = (descriptor, toolId) => {
  if (!descriptor || typeof descriptor !== "object") return null;
  const target = descriptor._target || descriptor.null || descriptor.target;
  if (!/selection|fsel/i.test(JSON.stringify(target || ""))) return null;
  const to = descriptor.to || descriptor.T || descriptor["T   "];
  if (!to || typeof to !== "object") return null;
  const kind = to._obj || to._class || "";
  if (kind === "paint" || kind === "Pnt " || kind === "point") {
    const options = WAND_OPTIONS.filter((field) => Object.prototype.hasOwnProperty.call(descriptor, field));
    if (options.length < 2) return null;
    const x = number(to.horizontal);
    const y = number(to.vertical);
    if (!isFinite(x) || !isFinite(y)) return null;
    return { source: "wand", x, y };
  }
  if (kind === "rectangle" || kind === "Rctn") {
    if (toolId && toolId !== "marqueeRectTool") return null;
    const bounds = { left: number(to.left), top: number(to.top), right: number(to.right), bottom: number(to.bottom) };
    if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(isFinite)) return { source: "rectangle" };
    if (bounds.right - bounds.left < 4 || bounds.bottom - bounds.top < 4) return null;
    return { source: "rectangle", ...bounds };
  }
  if (kind === "polygon" || kind === "Plgn" || kind === "lasso" || kind === "ellipse" || kind === "Elps") {
    return { source: "lasso" };
  }
  return null;
};

// Tools whose selections can trigger a paste when the event carries no
// descriptor (some CEP hosts): the current tool decides
export const triggerSourceForTool = (toolId) => {
  if (toolId === "magicWandTool") return "wand";
  if (toolId === "marqueeRectTool") return "rectangle";
  if (toolId === "lassoTool" || toolId === "polySelTool" || toolId === "magneticLassoTool" || toolId === "marqueeEllipTool") return "lasso";
  return null;
};

// CEP Photoshop event payloads: "ver1,{json}" (or bare JSON)
export const parseCepEventData = (data) => {
  if (!data || typeof data !== "string") return null;
  const start = data.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(data.slice(start));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (malformed) {
    return null;
  }
};
