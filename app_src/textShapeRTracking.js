const roundedDimension = (value) => Math.round(Number(value) || 0);

// Bubble detection is deliberately stable across translations. Moving a text
// layer does not change the bubble silhouette, and users can explicitly
// refresh after moving text to another bubble. Resizing still invalidates the
// cache because it changes TextShapeR's pixel calibration.
const getBubbleCacheKey = (layerId, bounds, fallbackKey) => {
  if (layerId == null) return `bubble:${fallbackKey}`;
  if (!bounds) return `bubble:${layerId}`;
  return `bubble:${layerId}:${roundedDimension(bounds.width)},${roundedDimension(bounds.height)}`;
};

const haveSameLayerSize = (first, second) =>
  !!first &&
  !!second &&
  roundedDimension(first.width) === roundedDimension(second.width) &&
  roundedDimension(first.height) === roundedDimension(second.height);

// A selection that does not touch the text layer belongs to another bubble
// (the next one to paste into, with the last text still active): it is no
// shape for this text. Unknown bounds never refuse a read.
const selectionTouchesLayer = (selection, bounds) => {
  if (!selection || !bounds) return true;
  const sides = ["left", "top", "right", "bottom"];
  for (let i = 0; i < sides.length; i++) {
    if (!Number.isFinite(Number(selection[sides[i]])) || !Number.isFinite(Number(bounds[sides[i]]))) return true;
  }
  return Number(selection.left) < Number(bounds.right) && Number(selection.right) > Number(bounds.left) &&
    Number(selection.top) < Number(bounds.bottom) && Number(selection.bottom) > Number(bounds.top);
};

export { getBubbleCacheKey, haveSameLayerSize, selectionTouchesLayer };
