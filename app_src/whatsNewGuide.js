// Position of the floating What's new guide. The user drags it by its header,
// and it moves out of the way on its own when it covers the control the
// spotlight rings (whatsNewSpotlight.js). The position lives in the session,
// so the guide comes back at the same place after a window the tour opens.

import { whatsNewSession as session } from "./whatsNewSession";

// Space kept between the guide and the panel edges, and around the ring
const MARGIN = 8;
const GAP = 10;

let dragging = false;

const guideElement = () => document.querySelector(".app-modal-inner--whats-new");

// Layout pixels per pixel of getBoundingClientRect: they differ under the
// panel zoom (Settings > Appearance > scale) in recent Chromium
const rectScale = (element) => {
  const width = element.offsetWidth;
  return width ? element.getBoundingClientRect().width / width : 1;
};

const clamp = (value, room) => Math.max(MARGIN, Math.min(value, room - MARGIN));

export const isGuideDragging = () => dragging;

// Inline position for modal.jsx, none while the guide keeps its default side
export const getGuideStyle = () => {
  const position = session.guidePos;
  if (!position) return undefined;
  const style = { left: position.left + "px", right: "auto", top: "auto", bottom: "auto" };
  style[position.anchor] = position.offset + "px";
  return style;
};

const applyGuideStyle = (guide) => {
  const style = getGuideStyle();
  if (!style) return;
  Object.keys(style).forEach((key) => {
    guide.style[key] = style[key];
  });
};

// left, top: layout pixels in the panel. The guide sticks to the closest
// edge, so it stays there when its content grows or shrinks.
const placeGuide = (guide, left, top) => {
  const area = guide.offsetParent;
  if (!area) return;
  const height = guide.offsetHeight;
  const x = clamp(left, area.clientWidth - guide.offsetWidth);
  const y = clamp(top, area.clientHeight - height);
  session.guidePos = y + height / 2 > area.clientHeight / 2
    ? { left: x, anchor: "bottom", offset: area.clientHeight - y - height }
    : { left: x, anchor: "top", offset: y };
  applyGuideStyle(guide);
};

// After a render or a panel resize: the guide takes its saved place (a
// resumed run) and never leaves the panel
export const keepGuideInside = () => {
  const guide = guideElement();
  if (!guide || !session.guidePos || dragging) return;
  applyGuideStyle(guide);
  placeGuide(guide, guide.offsetLeft, guide.offsetTop);
};

// ring: client rect of the ringed control. The guide goes to the panel edge
// nearest to it that leaves the ring visible, else right above or below the
// ring, unless the user dragged it there for this target (lockKey).
export const avoidRing = (ring, lockKey) => {
  const guide = guideElement();
  if (!guide || dragging || (session.guideLockKey && session.guideLockKey === lockKey)) return;
  const area = guide.offsetParent;
  if (!area) return;
  const box = guide.getBoundingClientRect();
  if (!(ring.left < box.right && box.left < ring.right && ring.top < box.bottom && box.top < ring.bottom)) return;
  const scale = rectScale(guide) || 1;
  const areaTop = area.getBoundingClientRect().top;
  const ringTop = (ring.top - areaTop) / scale;
  const ringBottom = (ring.bottom - areaTop) / scale;
  const room = area.clientHeight;
  const height = guide.offsetHeight;
  const current = guide.offsetTop;
  const fits = (top) => top >= MARGIN - 0.5 && top + height <= room - MARGIN + 0.5 &&
    (top + height <= ringTop || top >= ringBottom);
  const nearest = (tops) => tops.filter(fits).sort((a, b) => Math.abs(a - current) - Math.abs(b - current))[0];
  let top = nearest([MARGIN, room - height - MARGIN]);
  if (top === undefined) top = nearest([ringBottom + GAP, ringTop - GAP - height]);
  // Too tall for either side: the side with more room shows most of it
  if (top === undefined) top = ringTop > room - ringBottom ? MARGIN : room - height - MARGIN;
  if (Math.abs(top - current) < 1) return;
  placeGuide(guide, guide.offsetLeft, top);
};

// mousedown on the guide header. A short move is still a click; a drag puts
// the guide where the user drops it, even over the ring, until the next target.
export const startGuideDrag = (event, lockKey) => {
  if (event.button !== 0) return;
  const target = event.target;
  if (target && target.closest && target.closest("button:not(.whats-new-mini-title), input, a")) return;
  const guide = guideElement();
  if (!guide) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const left = guide.offsetLeft;
  const top = guide.offsetTop;
  const scale = rectScale(guide) || 1;
  let moved = false;

  const onMove = (move) => {
    const dx = (move.clientX - startX) / scale;
    const dy = (move.clientY - startY) / scale;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!moved) {
      moved = true;
      dragging = true;
      document.body.classList.add("whats-new-dragging");
    }
    move.preventDefault();
    placeGuide(guide, left + dx, top + dy);
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    if (!moved) return;
    dragging = false;
    document.body.classList.remove("whats-new-dragging");
    session.guideLockKey = lockKey || null;
    // The click ending the drag must not unfold the folded guide
    const swallow = (click) => {
      click.stopPropagation();
      click.preventDefault();
    };
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
};
