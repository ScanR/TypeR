// WebViews do not forward Photoshop tool keys. Release passive focus on exit,
// and release an editor only after a real host selection confirms the user
// returned to Photoshop. Moving the pointer while typing must not blur it.
export const isEditing = (element) => !!(element && (
  /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName || "") || element.isContentEditable
));

export const isHostSelection = (message) => {
  let data;
  try { data = JSON.parse(String(message.data).replace(/^ver\d+,/, "")); } catch (error) { return false; }
  const event = data.eventData;
  if (!event || event._isCommand) return false;
  const targets = Array.isArray(event._target) ? event._target : [];
  return targets.some((target) =>
    (data.eventID === 1936483188 && (target._ref === "layer" || target._ref === "document" || target._ref === "tool")) ||
    (data.eventID === 1936028772 && target._ref === "channel" &&
      (target._property === "selection" || target._value === "selection" || target._value === "fsel"))
  );
};

export function installFocusRelease({ document, window, request, on, notify, delay = 120 }) {
  let outside = false;
  let timer = null;
  let composing = false;
  let armed = false;
  let draggingOutside = false;
  const ownsFocus = () => typeof document.hasFocus !== "function" || document.hasFocus();
  const cancel = () => { if (timer !== null) window.clearTimeout(timer); timer = null; };
  const arm = () => { if (ownsFocus()) armed = true; };
  // The host hears whether an editor has the focus here: after a change made
  // by a shortcut while typing, it leaves the caret alone (main.js restoreFocus)
  let editing = null;
  const reportEditing = () => {
    if (typeof notify !== "function") return;
    const now = ownsFocus() && isEditing(document.activeElement);
    if (now === editing) return;
    editing = now;
    notify("focusState", { editing: now });
  };
  const release = () => {
    if (!armed || composing || draggingOutside || document.hidden) return;
    // A selection already focused Photoshop: no modal call is needed.
    if (!ownsFocus()) { armed = false; return; }
    armed = false;
    const active = document.activeElement;
    if (active && typeof active.blur === "function") active.blur();
    request("restoreFocus").catch(() => {});
  };
  document.addEventListener("focusin", () => { arm(); reportEditing(); }, true);
  // The element losing the focus is still the active one during focusout
  document.addEventListener("focusout", () => { window.setTimeout(reportEditing, 0); }, true);
  document.addEventListener("mousedown", arm, true);
  window.addEventListener("focus", () => { arm(); reportEditing(); });
  document.documentElement.addEventListener("mouseleave", (event) => {
    outside = true;
    draggingOutside = !!event.buttons;
    cancel();
    // A drag can end outside the panel; keep its source alive until return.
    if (!armed || draggingOutside || isEditing(document.activeElement) || composing || !ownsFocus()) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (outside && !isEditing(document.activeElement)) release();
    }, delay);
  });
  document.documentElement.addEventListener("mouseenter", () => { outside = false; draggingOutside = false; cancel(); });
  document.addEventListener("compositionstart", () => { composing = true; cancel(); }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  window.addEventListener("blur", () => {
    cancel();
    armed = false;
    // Preserve the editor/caret across Cmd-Tab. Native focus has already left
    // the WebView; neither a DOM blur nor bringing Photoshop forward helps.
    reportEditing();
  });
  on("psEvent", (message) => {
    if (!armed || !outside || !isHostSelection(message)) return;
    cancel();
    release();
  });
}
