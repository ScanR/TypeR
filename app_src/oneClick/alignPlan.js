// Align. The classic Align centres a text on the wand selection around it,
// opened in Photoshop to cut the tail off. Here the outline the host read
// (alignCapture) goes through the smart paste's own geometry, so that both put
// a text on the same point: a single bubble gets its body's centre
// (bodyCentre, geometry.js), and a double or triple bubble is cut with the
// neck finder, each text going to a chamber (the wand selects every chamber
// of a connected bubble: each text landed on the neck). Pure: nothing here
// reads Photoshop.
//
// capture = {
//   documentId, width, height, resolution,
//   texts: [{ id, index, box: { left, top, right, bottom } }],  // index: stack position
//   bubbles: [{ selectionBounds, rawPath, textIds, probed }],    // one per outline; probed: found by the host's wand
// }
// planAlignment(capture, readingOrder) -> [{ id, rect }], rect being the
// body of the bubble or of the chamber (left, top, right, bottom, width,
// height) and the point the text is centred on (xMid, yMid). A text left out
// keeps the classic Align: its selection is a rectangle, or no bubble can be
// read in the outline.

import { buildBubblePlan, isAxisRectangle, subpathsFromDescriptor } from "./bubblePlan";
import { deriveDoubleSibling, deriveTriplePlans } from "./connected";
import { clearGeometryCaches, contains } from "./geometry";

const centreOf = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

const validBox = (b) => !!(b && [b.left, b.top, b.right, b.bottom].every((v) => typeof v === "number" && isFinite(v)) &&
  b.right > b.left && b.bottom > b.top);

// Where to click the outline: the text centres, then around them (a centre on
// the neck is ambiguous), then no click (the first chamber in reading order)
const seedsFor = (texts) => {
  const seeds = texts.map((text) => centreOf(text.box));
  texts.forEach((text) => {
    const b = text.box;
    const c = centreOf(b);
    const w = (b.right - b.left) / 4;
    const h = (b.bottom - b.top) / 4;
    seeds.push({ x: c.x - w, y: c.y }, { x: c.x + w, y: c.y }, { x: c.x, y: c.y - h }, { x: c.x, y: c.y + h });
  });
  seeds.push(null);
  return seeds;
};

// The plans of the outline: its two or three chambers, the bubble itself when
// it is single, or null when no bubble can be read
const plansOf = (input, subpaths, texts) => {
  const seeds = seedsFor(texts);
  for (let i = 0; i < seeds.length; i++) {
    let plan;
    try {
      plan = buildBubblePlan({ ...input, click: seeds[i] }, { subpaths, click: seeds[i] || undefined });
    } catch (uncertain) {
      continue;
    }
    if (!plan.connected) return [plan];
    const triple = deriveTriplePlans(input, plan, subpaths);
    if (triple) return triple;
    const sibling = deriveDoubleSibling(input, plan, subpaths);
    if (sibling) return [plan, sibling];
  }
  return null;
};

const distance2 = (point, chamber) => (point.x - chamber.selection.xMid) ** 2 + (point.y - chamber.selection.yMid) ** 2;

const nearestChamber = (point, chambers) => {
  let best = 0;
  for (let i = 1; i < chambers.length; i++) if (distance2(point, chambers[i]) < distance2(point, chambers[best])) best = i;
  return best;
};

// Order of the chambers as the smart paste distributes the script lines: top
// first, then right first in a manga and left first in a comic or a manhwa
const chambersInReadingOrder = (chambers, selectionBounds, readingOrder) => {
  const tolerance = Math.min(selectionBounds.bottom - selectionBounds.top, selectionBounds.right - selectionBounds.left) * 0.15;
  const order = chambers.map((chamber, index) => ({ index, x: chamber.selection.xMid, y: chamber.selection.yMid }));
  order.sort((p, q) => {
    if (Math.abs(p.y - q.y) > tolerance) return p.y - q.y;
    return readingOrder === "ltr" ? p.x - q.x : q.x - p.x;
  });
  return order.map((entry) => entry.index);
};

// Texts piled on each other (an earlier Align put them all on the neck) do
// not tell which chamber they belong to
const OVERLAP_RATIO = 0.1;
const piled = (texts) => {
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i].box;
      const b = texts[j].box;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const smaller = Math.min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top));
      if (w > 0 && h > 0 && w * h > smaller * OVERLAP_RATIO) return true;
    }
  }
  return false;
};

// Chamber index per text (texts in stack order, the first pasted first). A
// text already inside its own chamber stays there; one text goes to the
// chamber holding it or the nearest; texts sharing a chamber or piled on
// each other follow the reading order, the first pasted in the first chamber.
export const assignChambers = (texts, chambers, selectionBounds, readingOrder) => {
  const centres = texts.map((text) => centreOf(text.box));
  const inside = centres.map((point) => chambers.findIndex((chamber) => contains(chamber.cleanPolygon, point)));
  if (inside.every((index) => index >= 0) && new Set(inside).size === inside.length && !piled(texts)) return inside;
  if (texts.length === 1) return [nearestChamber(centres[0], chambers)];
  if (texts.length <= chambers.length) return chambersInReadingOrder(chambers, selectionBounds, readingOrder).slice(0, texts.length);
  return centres.map((point, i) => (inside[i] >= 0 ? inside[i] : nearestChamber(point, chambers)));
};

const rectOf = (selection) => ({
  left: selection.left,
  top: selection.top,
  right: selection.right,
  bottom: selection.bottom,
  width: selection.right - selection.left,
  height: selection.bottom - selection.top,
  xMid: selection.xMid,
  yMid: selection.yMid,
});

export const planAlignment = (capture, readingOrder) => {
  const placements = [];
  if (!capture || !Array.isArray(capture.texts) || !Array.isArray(capture.bubbles)) return placements;
  clearGeometryCaches();
  const byId = {};
  capture.texts.forEach((text) => {
    if (text && validBox(text.box)) byId[text.id] = text;
  });
  const placed = {};
  capture.bubbles.forEach((bubble) => {
    if (!bubble || !bubble.rawPath || !validBox(bubble.selectionBounds) || isAxisRectangle(bubble.rawPath)) return;
    const texts = (bubble.textIds || []).map((id) => byId[id]).filter((text) => text && !placed[text.id]);
    if (!texts.length) return;
    texts.sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
    const input = {
      documentId: capture.documentId,
      width: capture.width,
      height: capture.height,
      resolution: capture.resolution || 72,
      source: "wand",
      selectionBounds: { ...bubble.selectionBounds },
      rawPath: bubble.rawPath,
      fill: null,
      readingOrder,
    };
    let chambers;
    try {
      chambers = plansOf(input, subpathsFromDescriptor(bubble.rawPath, input.resolution), texts);
    } catch (unreadable) {
      chambers = null;
    }
    if (!chambers) return;
    if (chambers.length < 2) {
      // A single bubble: every text on its centre. The user's selection takes
      // any text (Align moves a text into the selected bubble); an outline the
      // host's own wand found (probed) only the texts inside it: its probes
      // around a text can land in the region next to a narrow bubble
      texts.forEach((text) => {
        if (bubble.probed && !contains(chambers[0].cleanPolygon, centreOf(text.box))) return;
        placed[text.id] = true;
        placements.push({ id: text.id, rect: rectOf(chambers[0].selection) });
      });
      return;
    }
    const assigned = assignChambers(texts, chambers, input.selectionBounds, readingOrder);
    texts.forEach((text, i) => {
      placed[text.id] = true;
      placements.push({ id: text.id, rect: rectOf(chambers[assigned[i]].selection) });
    });
  });
  return placements;
};
