// Spotlight of the What's new tour: a blue ring around the real control the
// current step asks for (a footer toggle, the Paste button, a script line, a
// settings tab…), so the user does the gesture in the panel instead of the
// guide doing it for them.
//
// The ring is a fixed element over the panel, moved every frame: it never
// changes the layout of the control and is not clipped by its parents. It
// keeps running while a window opened from the tour (settings, style editor)
// hides the guide, so it can lead the user inside that window too.

import { avoidRing } from "./whatsNewGuide";
import { whatsNewSession as session } from "./whatsNewSession";

// The first candidate found wins: { selector } or { find: () => element },
// { reveal } brings it into view when it is not rendered (virtualized lines)
let spot = null;
let listener = null;
let ring = null;
let frame = 0;
let shown = null;
let missingSince = 0;
let missing = false;
let revealedKey = null;
let scrolledTo = null;
let marked = [];

const isVisible = (element) => {
  if (!element || !element.getBoundingClientRect) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

// A window opened over the panel (not the floating guide) hides what is under it
const blockingModal = () => document.querySelector(".app-modal:not(.app-modal--walkthrough) .app-modal-inner");

const findTarget = () => {
  if (!spot) return null;
  const modal = blockingModal();
  for (let i = 0; i < spot.candidates.length; i++) {
    const candidate = spot.candidates[i];
    if (!candidate) continue;
    let element = null;
    try {
      element = candidate.find ? candidate.find() : document.querySelector(candidate.selector);
    } catch (error) {
      element = null;
    }
    if (!isVisible(element)) continue;
    if (modal && !modal.contains(element)) continue;
    return element;
  }
  return null;
};

const ensureRing = () => {
  if (ring && ring.parentNode) return ring;
  ring = document.createElement("div");
  ring.className = "whats-new-spot";
  ring.setAttribute("aria-hidden", "true");
  document.body.appendChild(ring);
  return ring;
};

// Secondary rings: a spot can also outline several controls inside the
// ringed area ({ marks: selector }), when any of them will do (the pencils
// of the style list)
const setMarks = (elements) => {
  marked.forEach((element) => {
    if (elements.indexOf(element) === -1) element.classList.remove("whats-new-mark");
  });
  elements.forEach((element) => element.classList.add("whats-new-mark"));
  marked = elements;
};

const findMarks = () => {
  if (!spot || !spot.marks || blockingModal()) return [];
  try {
    return Array.prototype.slice.call(document.querySelectorAll(spot.marks)).filter(isVisible);
  } catch (error) {
    return [];
  }
};

const hideRing = () => {
  if (ring) ring.style.display = "none";
  shown = null;
  setMarks([]);
};

// Layout pixels of the ring per pixel of getBoundingClientRect: they differ
// under the panel zoom (Settings > Appearance > scale) in recent Chromium
const rectScale = (element) => {
  const width = element.offsetWidth;
  return width ? element.getBoundingClientRect().width / width : 1;
};

// Over the panel, the ring darkens everything around the control, under the
// guide. In a window opened over the panel (settings, style editor), which
// already darkens the panel, it only rings the control, above that window.
const placeRing = (target) => {
  const element = ensureRing();
  const dim = !blockingModal();
  if (element.className !== "whats-new-spot" + (dim ? " m-dim" : "")) {
    element.className = "whats-new-spot" + (dim ? " m-dim" : "");
  }
  element.style.display = "block";
  const rect = target.getBoundingClientRect();
  const scale = rectScale(element) || 1;
  const pad = 3;
  element.style.left = (rect.left / scale - pad) + "px";
  element.style.top = (rect.top / scale - pad) + "px";
  element.style.width = (rect.width / scale + pad * 2) + "px";
  element.style.height = (rect.height / scale + pad * 2) + "px";
  return rect;
};

const tick = () => {
  frame = 0;
  if (!spot || !session.active) {
    hideRing();
    return;
  }
  // A visit step is done once the window or tab it shows is open
  if (spot.visit && spot.stepId && !session.done[spot.stepId] && isVisible(document.querySelector(spot.visit))) {
    session.done[spot.stepId] = true;
    if (listener && listener.onChange) listener.onChange();
  }
  const target = findTarget();
  if (target) {
    if (missing && listener && listener.onMissing) listener.onMissing(false);
    missing = false;
    missingSince = 0;
    const rect = placeRing(target);
    setMarks(findMarks());
    if (shown !== target) {
      shown = target;
      // Once per new target: scroll it into its list (script, settings)
      if (scrolledTo !== target && target.scrollIntoView) {
        scrolledTo = target;
        const container = target.closest(".text-lines, .tab-bar-list, .shortcut-list, .folders-list, .settings-tabs");
        if (container) target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
    // The guide never covers the ring: it moves out of the way
    avoidRing(rect, spot.key);
  } else {
    hideRing();
    if (spot.reveal && revealedKey !== spot.key) {
      revealedKey = spot.key;
      spot.reveal();
    }
    const now = Date.now();
    if (!missingSince) missingSince = now;
    // The control is hidden in this layout: the guide offers its fallback
    if (!missing && now - missingSince > 700) {
      missing = true;
      if (listener && listener.onMissing) listener.onMissing(true);
    }
  }
  frame = window.requestAnimationFrame(tick);
};

const start = () => {
  if (!frame) frame = window.requestAnimationFrame(tick);
};

// next: { key, candidates, marks, visit, stepId, reveal } or null
export const setTourSpot = (next) => {
  const key = next ? next.key : null;
  if ((spot ? spot.key : null) === key) {
    // Same target: keep the state, take the fresh closures
    if (next) spot = { ...next };
    return;
  }
  spot = next && (next.candidates.length || next.visit) ? { ...next } : null;
  missing = false;
  missingSince = 0;
  scrolledTo = null;
  if (listener && listener.onMissing) listener.onMissing(false);
  if (!spot) {
    hideRing();
    return;
  }
  start();
};

export const isTourSpotMissing = () => missing;

// The guide listens while it is mounted
export const setTourSpotListener = (next) => {
  listener = next;
};

export const clearTourSpot = () => {
  spot = null;
  hideRing();
};
