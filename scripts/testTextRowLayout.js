// Script rows: every row takes its height from a hidden mirror of the text, so
// the highlights stay on their line whatever the panel width or the line count
const assert = require("assert");
const createLoader = require("./helpers/loadAppModule");
const loadContext = require("./helpers/loadContext");

const { measureRows, rowStyleHeight, sameRowHeights } = createLoader()("app_src/components/textBlock/rowLayout.js");

// Wraps every 10 characters, and counts what the measure reads and writes
const createMirror = (clientWidth) => {
  const ownerDocument = {
    defaultView: {
      getComputedStyle: (node) => {
        mirror.reads += 1;
        const lines = node.text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (mirror.clientWidth / 10))), 0);
        return { height: mirror.truncate(lines * mirror.lineHeight) + mirror.extraHeight(node) + "px" };
      },
    },
    createElement: () => {
      const node = { text: "", ownerDocument };
      Object.defineProperty(node, "textContent", { set(value) { node.text = value; mirror.writes += 1; } });
      return node;
    },
  };
  const mirror = {
    clientWidth,
    lineHeight: 17,
    truncate: (height) => height,
    extraHeight: () => 0,
    children: [],
    reads: 0,
    writes: 0,
    ownerDocument,
    appendChild(node) { mirror.children.push(node); },
    removeChild() { mirror.children.pop(); },
    get lastChild() { return mirror.children[mirror.children.length - 1]; },
  };
  return mirror;
};

const mirror = createMirror(100);
const long = "x".repeat(15);
let layout = measureRows(mirror, ["a", "", long, "b"], null);
assert.deepStrictEqual(layout.heights, [17, 17, 34, 17], "an empty line keeps a full row and a wrapped one takes two");
assert.deepStrictEqual(layout.offsets, [0, 17, 34, 68, 85]);
assert.strictEqual(layout.total, 85);

// A wider panel unwraps lines that are not on screen: nothing else changed,
// and that is what used to leave the highlights a row below their text
mirror.clientWidth = 200;
let wider = measureRows(mirror, ["a", "", long, "b"], layout);
assert.deepStrictEqual(wider.heights, [17, 17, 17, 17], "a width change measures every line again");
assert.strictEqual(mirror.writes, 4 + 2, "the same text is not written again, only the probe of each measure");
assert.ok(!sameRowHeights(layout, wider));

// Same width: only the edited line is read
mirror.clientWidth = 100;
layout = measureRows(mirror, ["a", "", long, "b"], wider);
mirror.reads = 0;
mirror.writes = 0;
const edited = measureRows(mirror, ["a", long, long, "b"], layout);
assert.deepStrictEqual(edited.heights, [17, 34, 34, 17]);
assert.strictEqual(mirror.reads, 1);
assert.strictEqual(mirror.writes, 1);

// Lines added and removed
const added = measureRows(mirror, ["a", long, long, "b", long], edited);
assert.deepStrictEqual(added.heights, [17, 34, 34, 17, 34]);
const removed = measureRows(mirror, ["a"], added);
assert.deepStrictEqual(removed.heights, [17]);
assert.strictEqual(mirror.children.length, 1);
assert.strictEqual(measureRows(mirror, [], removed).total, 0);

assert.ok(sameRowHeights(edited, { heights: [17, 34, 34, 17] }));
assert.ok(!sameRowHeights(edited, { heights: [17, 34, 34] }));
assert.ok(!sameRowHeights(null, edited));

// Under a display scale the text rounds its lines to device pixels: the rows
// must take that height, not its rounding to whole pixels, or they drift
const scaled = createMirror(100);
scaled.lineHeight = 16.8;
const scaledLayout = measureRows(scaled, ["a", "", long], null);
assert.deepStrictEqual(scaledLayout.heights, [16.8, 16.8, 33.6]);
assert.strictEqual(scaledLayout.offsets[2], 33.6);
// Laid out at 125%, a row lands on its 21 device pixels and not 1/64 below
assert.strictEqual(Math.floor(rowStyleHeight(16.8) * 1.25 * 64) / 64, 21);
assert.strictEqual(Math.floor(rowStyleHeight(17) * 64) / 64, 17);

// Another screen changes the height of the lines and neither the text nor the
// width: every line is read again
const moved = createMirror(100);
moved.ownerDocument.defaultView.devicePixelRatio = 1;
const onFirstScreen = measureRows(moved, ["a", long], null);
moved.ownerDocument.defaultView.devicePixelRatio = 1.25;
moved.lineHeight = 16.8;
assert.deepStrictEqual(measureRows(moved, ["a", long], onFirstScreen).heights, [16.8, 33.6]);

// Each block truncates its height to 1/64px, the lines of the text don't
const truncating = createMirror(100);
truncating.lineHeight = 18.7;
truncating.truncate = (height) => Math.floor(height * 64) / 64;
const truncated = measureRows(truncating, ["a", long], null);
assert.ok(Math.abs(truncated.heights[0] - 18.7) < 1 / 512, "the height of a line comes from the tall block");
assert.ok(Math.abs(truncated.heights[1] - 37.4) < 1 / 256);

// A line really taller than its wrapping keeps its height
const tall = createMirror(100);
tall.extraHeight = (node) => (node.text === "emoji" ? 3 : 0);
assert.deepStrictEqual(measureRows(tall, ["a", "emoji"], null).heights, [17, 20]);

// The textarea reads every "\r" as a line break while the rows split on "\n"
const { reducer, initial } = loadContext({});
const text = reducer(initial, { type: "setText", text: "un\r\ndeux\rtrois\nquatre" });
assert.strictEqual(text.text, "un\ndeux\ntrois\nquatre");
assert.deepStrictEqual(text.lines.map((line) => line.rawText), ["un", "deux", "trois", "quatre"]);
assert.strictEqual(reducer(initial, { type: "setText", text: undefined }).text, "");

console.log("Text row layout tests passed");
