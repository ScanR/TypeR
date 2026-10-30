// The glyphs live in the textarea/overlay, the highlights in separate rows, so
// every row must be exactly as tall as its line of text. Rows are virtualized
// and can't report the height of a line they don't render: this measures each
// line in one hidden mirror that wraps like the text layer instead.
const ROW_HEIGHT = 17;

export const measureRows = (mirror, rawTexts, previous) => {
  const width = mirror.clientWidth;
  const count = rawTexts.length;
  while (mirror.children.length > count) mirror.removeChild(mirror.lastChild);
  while (mirror.children.length < count) mirror.appendChild(mirror.ownerDocument.createElement("div"));

  const nodes = mirror.children;
  const changed = [];
  for (let i = 0; i < count; i++) {
    if (previous && previous.rawTexts[i] === rawTexts[i]) continue;
    nodes[i].textContent = rawTexts[i];
    changed.push(i);
  }

  // Same width: only the rewritten lines can have wrapped differently
  const sameWidth = !!previous && previous.width === width;
  const heights = sameWidth ? previous.heights.slice(0, count) : new Array(count);
  if (sameWidth) {
    changed.forEach((i) => { heights[i] = nodes[i].offsetHeight || ROW_HEIGHT; });
  } else {
    for (let i = 0; i < count; i++) heights[i] = nodes[i].offsetHeight || ROW_HEIGHT;
  }

  const offsets = new Array(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + heights[i];
  return { rawTexts, width, heights, offsets, total: offsets[count] };
};

export const sameRowHeights = (a, b) => {
  if (!a || !b || a.heights.length !== b.heights.length) return false;
  return a.heights.every((height, i) => height === b.heights[i]);
};
