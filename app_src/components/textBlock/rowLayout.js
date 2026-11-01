// The glyphs live in the textarea/overlay, the highlights in separate rows, so
// every row must be exactly as tall as its line of text. Rows are virtualized
// and can't report the height of a line they don't render: this measures each
// line in one hidden mirror that wraps like the text layer instead.
const ROW_HEIGHT = 17;

// Under a display scale, older Chromiums round each line of text to whole device
// pixels (125%: 16.8px, not 17px), and offsetHeight rounds that back to 17: the
// rows then outgrow the text, by two lines after some 80 rows. The computed height
// keeps the fraction.
const computedHeight = (node) => parseFloat(node.ownerDocument.defaultView.getComputedStyle(node).height) || ROW_HEIGHT;

// A block truncates its own height to 1/64px, which a text of many lines doesn't
// do line by line: under a UI scale, WebKit's rows would fall short of the text by
// half a line after some 800 rows. A tall block gives the height of a line itself.
const PITCH_LINES = 64;
const measurePitch = (mirror) => {
  const probe = mirror.ownerDocument.createElement("div");
  probe.textContent = "\n".repeat(PITCH_LINES - 1) + "x";
  mirror.appendChild(probe);
  const pitch = computedHeight(probe) / PITCH_LINES;
  mirror.removeChild(probe);
  return pitch;
};

// A line taller than its wrapping explains keeps the height it really has
const rowHeight = (node, pitch) => {
  const height = computedHeight(node);
  const wrapped = Math.max(1, Math.round(height / pitch)) * pitch;
  return Math.abs(height - wrapped) < 0.1 ? wrapped : height;
};

// The computed height has a few digits only and layout truncates to 1/64px: this
// keeps a row from falling just under its line. It stays out of the offsets, as
// the spacers aren't truncated line by line.
export const rowStyleHeight = (height) => height + 0.005;

export const measureRows = (mirror, rawTexts, previous) => {
  const width = mirror.clientWidth;
  const scale = mirror.ownerDocument.defaultView.devicePixelRatio;
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

  // Same width and display scale: only the rewritten lines can have changed height
  const sameBox = !!previous && previous.width === width && previous.scale === scale;
  const pitch = sameBox ? previous.pitch : measurePitch(mirror);
  const heights = sameBox ? previous.heights.slice(0, count) : new Array(count);
  if (sameBox) {
    changed.forEach((i) => { heights[i] = rowHeight(nodes[i], pitch); });
  } else {
    for (let i = 0; i < count; i++) heights[i] = rowHeight(nodes[i], pitch);
  }

  const offsets = new Array(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + heights[i];
  return { rawTexts, width, scale, pitch, heights, offsets, total: offsets[count] };
};

export const sameRowHeights = (a, b) => {
  if (!a || !b || a.heights.length !== b.heights.length) return false;
  return a.heights.every((height, i) => height === b.heights[i]);
};
