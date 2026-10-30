// Script rows: every row takes its height from a hidden mirror of the text, so
// the highlights stay on their line whatever the panel width or the line count
const assert = require("assert");
const createLoader = require("./helpers/loadAppModule");
const loadContext = require("./helpers/loadContext");

const { measureRows, sameRowHeights } = createLoader()("app_src/components/textBlock/rowLayout.js");

// Wraps every 10 characters, and counts what the measure reads and writes
const createMirror = (clientWidth) => {
  const mirror = {
    clientWidth,
    children: [],
    reads: 0,
    writes: 0,
    ownerDocument: {
      createElement: () => {
        const node = { text: "" };
        Object.defineProperty(node, "textContent", { set(value) { node.text = value; mirror.writes += 1; } });
        Object.defineProperty(node, "offsetHeight", {
          get() {
            mirror.reads += 1;
            return Math.max(1, Math.ceil(node.text.length / (mirror.clientWidth / 10))) * 17;
          },
        });
        return node;
      },
    },
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
assert.strictEqual(mirror.writes, 4, "the same text is not written again");
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

// The textarea reads every "\r" as a line break while the rows split on "\n"
const { reducer, initial } = loadContext({});
const text = reducer(initial, { type: "setText", text: "un\r\ndeux\rtrois\nquatre" });
assert.strictEqual(text.text, "un\ndeux\ntrois\nquatre");
assert.deepStrictEqual(text.lines.map((line) => line.rawText), ["un", "deux", "trois", "quatre"]);
assert.strictEqual(reducer(initial, { type: "setText", text: undefined }).text, "");

console.log("Text row layout tests passed");
