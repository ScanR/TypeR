// Where the smart paste centred each text it made, kept for Align. A text that
// is still there is left there: the paste read the bubble on the user's own
// Magic Wand click, and Align reads it again with its own wand (another
// tolerance, another point), an outline a pixel or two apart and now and then
// another region. Without this, Align right after a paste moved one text in
// six by a few pixels, and a few of them out of their bubble. A text moved
// since, or resized off its centre, is aligned as any other. Pure, in memory:
// a panel reload forgets it.

const LIMIT = 400;
// The settle puts Photoshop's ink box within half a pixel of the target, and
// its bounds are whole pixels
const STILL_THERE = 1;

const targets = new Map();
const keyOf = (documentId, layerId) => documentId + ":" + layerId;

export const rememberPasteTargets = (documentId, layerIds, points) => {
  if (documentId === undefined || documentId === null || !Array.isArray(layerIds) || !Array.isArray(points)) return;
  layerIds.forEach((layerId, i) => {
    const point = points[i];
    if (layerId === undefined || layerId === null || !point || !isFinite(point.x) || !isFinite(point.y)) return;
    const key = keyOf(documentId, layerId);
    targets.delete(key);
    targets.set(key, { x: Number(point.x), y: Number(point.y) });
  });
  while (targets.size > LIMIT) targets.delete(targets.keys().next().value);
};

export const forgetPasteTargets = () => targets.clear();

// The placements of an Align, the texts still on their paste's centre kept on
// it. With a selection of the user's (an outline the host did not probe
// itself), Align moves the text into that selection: the paste's centre only
// holds when it lies in the placement, the same bubble. Without one, a text
// with no placement, or with a placement elsewhere (Align's wand took another
// region), gets its own box set on that centre, unless Align also resizes the
// text box to the bubble: the bubble is then needed.
export const keepPastedTexts = (capture, placements, resize) => {
  const out = Array.isArray(placements) ? placements.slice() : [];
  if (!capture || !Array.isArray(capture.texts) || !targets.size) return out;
  const selected = {};
  (capture.bubbles || []).forEach((bubble) => {
    if (bubble && !bubble.probed) (bubble.textIds || []).forEach((id) => { selected[id] = true; });
  });
  capture.texts.forEach((text) => {
    const box = text && text.box;
    const point = text && targets.get(keyOf(capture.documentId, text.id));
    if (!point || !box || !isFinite(box.left) || !isFinite(box.right) || !isFinite(box.top) || !isFinite(box.bottom)) return;
    const x = (box.left + box.right) / 2;
    const y = (box.top + box.bottom) / 2;
    if (Math.abs(x - point.x) > STILL_THERE || Math.abs(y - point.y) > STILL_THERE) return;
    const index = out.findIndex((placement) => placement && placement.id === text.id);
    const rect = index >= 0 ? out[index].rect : null;
    const inside = !!rect && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    if (inside) out[index] = { id: text.id, rect: { ...rect, xMid: point.x, yMid: point.y } };
    else if (selected[text.id]) return;
    else if (resize) {
      if (index >= 0) out.splice(index, 1);
    } else if (index >= 0) out[index] = { id: text.id, rect: ownRect(box, point) };
    else out.push({ id: text.id, rect: ownRect(box, point) });
  });
  return out;
};

const ownRect = (box, point) => {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  return {
    left: point.x - width / 2,
    top: point.y - height / 2,
    right: point.x + width / 2,
    bottom: point.y + height / 2,
    width,
    height,
    xMid: point.x,
    yMid: point.y,
  };
};
