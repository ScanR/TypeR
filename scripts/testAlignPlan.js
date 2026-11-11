// Align in a double or triple bubble (app_src/oneClick/alignPlan.js): each
// selected text goes to a chamber of the outline the host read, instead of
// the centre of the whole connected bubble. No Photoshop involved.
const assert = require("assert");
const load = require("./helpers/loadAppModule")();

const { planAlignment, assignChambers } = load("app_src/oneClick/alignPlan.js");
const geometry = load("app_src/oneClick/geometry.js");

const px = (value) => ({ _unit: "pixelsUnit", _value: value });
const point = (xy) => ({ horizontal: px(xy[0]), vertical: px(xy[1]) });
const pathOf = (contours) => ({
  pathContents: {
    pathComponents: [{
      subpathListKey: contours.map((poly) => ({
        closedSubpath: true,
        points: poly.map((p) => ({ anchor: point(p), forward: point(p), backward: point(p) })),
      })),
    }],
  },
});

// Union outline of overlapping ellipses, ordered around `centre`
const unionOf = (ellipses, centre) => {
  const inside = (p, e) => ((p[0] - e[0]) / e[2]) ** 2 + ((p[1] - e[1]) / e[3]) ** 2 < 1 - 1e-6;
  const pts = [];
  ellipses.forEach((e) => {
    for (let i = 0; i < 200; i++) {
      const t = (i / 200) * Math.PI * 2;
      const p = [e[0] + e[2] * Math.cos(t), e[1] + e[3] * Math.sin(t)];
      if (!ellipses.some((o) => o !== e && inside(p, o))) pts.push(p);
    }
  });
  pts.sort((p, q) => Math.atan2(p[1] - centre[1], p[0] - centre[0]) - Math.atan2(q[1] - centre[1], q[0] - centre[0]));
  return pts;
};

const boundsOf = (poly) => {
  const b = geometry.box(poly);
  return { left: Math.floor(b.left), top: Math.floor(b.top), right: Math.ceil(b.right), bottom: Math.ceil(b.bottom) };
};
const boxAt = (x, y, w, h) => ({ left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 });
const page = { documentId: 3, width: 900, height: 1100, resolution: 72 };
const inRect = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

// The reported page: a double bubble, upper left and lower right
const left = [290, 290, 255, 170];
const right = [610, 475, 255, 170];
const outline = unionOf([left, right], [450, 382]);
const bubble = (textIds) => ({ selectionBounds: boundsOf(outline), rawPath: pathOf([outline]), textIds });

// Two texts already in their chambers (what the smart paste made) stay there
{
  const placements = planAlignment({
    ...page,
    texts: [{ id: 1, index: 5, box: boxAt(285, 275, 180, 70) }, { id: 2, index: 6, box: boxAt(620, 480, 280, 110) }],
    bubbles: [bubble([1, 2])],
  });
  assert.strictEqual(placements.length, 2);
  const first = placements.find((p) => p.id === 1).rect;
  const second = placements.find((p) => p.id === 2).rect;
  assert.ok(inRect(first, 290, 290) && !inRect(first, 610, 475), "the first text keeps the upper chamber");
  assert.ok(inRect(second, 610, 475) && !inRect(second, 290, 290), "the second text keeps the lower chamber");
  assert.ok(Math.abs(first.xMid - 290) < 60 && Math.abs(first.yMid - 290) < 60, "centred on the upper lobe, not on the neck");
  assert.ok(Math.abs(second.xMid - 610) < 60 && Math.abs(second.yMid - 475) < 60, "centred on the lower lobe");
}

// Both texts piled on the neck (the old Align result): the first pasted
// (lowest layer) goes to the first chamber in reading order
{
  const texts = [
    { id: 10, index: 2, box: boxAt(440, 395, 180, 70) },  // "A DOUBLE BUBBLE?", pasted first
    { id: 11, index: 3, box: boxAt(370, 395, 280, 110) }, // "THE NEXT LINE...", pasted second
  ];
  const placements = planAlignment({ ...page, texts, bubbles: [bubble([11, 10])] });
  assert.strictEqual(placements.length, 2);
  assert.ok(inRect(placements.find((p) => p.id === 10).rect, 290, 290), "first line in the upper chamber");
  assert.ok(inRect(placements.find((p) => p.id === 11).rect, 610, 475), "next line in the lower chamber");
}

// One text: the chamber holding it, or the nearest one
{
  const lower = planAlignment({ ...page, texts: [{ id: 4, index: 1, box: boxAt(700, 520, 200, 80) }], bubbles: [bubble([4])] });
  assert.strictEqual(lower.length, 1);
  assert.ok(inRect(lower[0].rect, 610, 475) && !inRect(lower[0].rect, 290, 290));
  const upper = planAlignment({ ...page, texts: [{ id: 5, index: 1, box: boxAt(250, 240, 200, 80) }], bubbles: [bubble([5])] });
  assert.ok(inRect(upper[0].rect, 290, 290) && !inRect(upper[0].rect, 610, 475));
  // On the neck: still one of the two chambers, never the whole outline
  const neck = planAlignment({ ...page, texts: [{ id: 6, index: 1, box: boxAt(450, 385, 200, 80) }], bubbles: [bubble([6])] });
  assert.strictEqual(neck.length, 1);
  assert.ok(inRect(neck[0].rect, 290, 290) !== inRect(neck[0].rect, 610, 475));
}

// A single bubble: every text on the bubble's centre (bodyCentre), the point
// the smart paste centres a text on
{
  const oval = unionOf([[450, 400, 250, 160]], [450, 400]);
  const single = planAlignment({
    ...page,
    texts: [{ id: 7, index: 1, box: boxAt(450, 400, 200, 80) }, { id: 8, index: 2, box: boxAt(450, 470, 200, 60) }],
    bubbles: [{ selectionBounds: boundsOf(oval), rawPath: pathOf([oval]), textIds: [7, 8] }],
  });
  assert.deepStrictEqual(single.map((p) => p.id), [7, 8]);
  single.forEach((p) => {
    assert.ok(Math.abs(p.rect.xMid - 450) < 0.5 && Math.abs(p.rect.yMid - 400) < 0.5, "the oval's centre: " + p.rect.xMid + ", " + p.rect.yMid);
    assert.ok(p.rect.left >= 199 && p.rect.right <= 701 && p.rect.top >= 239 && p.rect.bottom <= 561, "the oval's box");
  });
  // A text beside the bubble's middle still finds the bubble
  const off = planAlignment({
    ...page, texts: [{ id: 7, index: 1, box: boxAt(560, 330, 120, 60) }],
    bubbles: [{ selectionBounds: boundsOf(oval), rawPath: pathOf([oval]), textIds: [7] }],
  });
  assert.ok(off.length === 1 && Math.abs(off[0].rect.xMid - 450) < 0.5 && Math.abs(off[0].rect.yMid - 400) < 0.5);
  // A rectangle marquee keeps the classic Align (no placement)
  const rect = [[100, 100], [500, 100], [500, 300], [100, 300]];
  assert.deepStrictEqual(planAlignment({
    ...page, texts: [{ id: 9, index: 1, box: boxAt(300, 200, 100, 40) }],
    bubbles: [{ selectionBounds: boundsOf(rect), rawPath: pathOf([rect]), textIds: [9] }],
  }), []);
}

// Triple bubble: three texts, three chambers, left to right
{
  const centres = [[300, 400], [540, 400], [780, 400]];
  const r = 150;
  const pts = [];
  const inside = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < r * r - 1e-6;
  for (const c of centres) {
    for (let i = 0; i < 160; i++) {
      const t = (i / 160) * Math.PI * 2;
      const p = [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
      if (!centres.some((o) => o !== c && inside(p, o))) pts.push(p);
    }
  }
  const tripleOutline = pts.filter((p) => p[1] <= 400).sort((a, b) => a[0] - b[0])
    .concat(pts.filter((p) => p[1] > 400).sort((a, b) => b[0] - a[0]));
  const texts = [
    { id: 21, index: 1, box: boxAt(310, 410, 120, 50) },
    { id: 22, index: 2, box: boxAt(530, 390, 120, 50) },
    { id: 23, index: 3, box: boxAt(770, 400, 120, 50) },
  ];
  const placements = planAlignment({
    ...page, width: 1100, texts,
    bubbles: [{ selectionBounds: boundsOf(tripleOutline), rawPath: pathOf([tripleOutline]), textIds: [21, 22, 23] }],
  });
  assert.strictEqual(placements.length, 3);
  centres.forEach((c, i) => assert.ok(inRect(placements.find((p) => p.id === texts[i].id).rect, c[0], c[1]), "chamber " + i));
  // One text in the middle chamber of a triple bubble
  const middle = planAlignment({
    ...page, width: 1100, texts: [texts[1]],
    bubbles: [{ selectionBounds: boundsOf(tripleOutline), rawPath: pathOf([tripleOutline]), textIds: [22] }],
  });
  assert.strictEqual(middle.length, 1);
  assert.ok(inRect(middle[0].rect, 540, 400) && !inRect(middle[0].rect, 300, 400) && !inRect(middle[0].rect, 780, 400));
}

// Reading order of side by side chambers: right first in a manga (the default),
// left first in a comic or a manhwa
{
  const square = (x0, y0) => [[x0, y0], [x0 + 10, y0], [x0 + 10, y0 + 10], [x0, y0 + 10]];
  const chambers = [
    { cleanPolygon: square(0, 0), selection: { xMid: 5, yMid: 5 } },
    { cleanPolygon: square(100, 0), selection: { xMid: 105, yMid: 5 } },
  ];
  const texts = [{ box: boxAt(50, 5, 4, 4) }, { box: boxAt(52, 5, 4, 4) }];
  const bounds = { left: 0, top: 0, right: 110, bottom: 10 };
  assert.deepStrictEqual(assignChambers(texts, chambers, bounds), [1, 0]);
  assert.deepStrictEqual(assignChambers(texts, chambers, bounds, "rtl"), [1, 0]);
  assert.deepStrictEqual(assignChambers(texts, chambers, bounds, "ltr"), [0, 1]);
}

// An outline the host's own wand found (probed) only takes the texts inside
// it: a probe beside a narrow bubble can land in the region next to it. The
// user's own selection takes any text (Align moves a text into it).
{
  const oval = unionOf([[450, 400, 250, 160]], [450, 400]);
  const outside = { id: 11, index: 1, box: boxAt(900, 400, 120, 60) };
  const inside = { id: 12, index: 2, box: boxAt(430, 380, 120, 60) };
  const bubble = (probed) => ({ selectionBounds: boundsOf(oval), rawPath: pathOf([oval]), textIds: [11, 12], probed });
  assert.deepStrictEqual(planAlignment({ ...page, texts: [outside, inside], bubbles: [bubble(true)] }).map((p) => p.id), [12]);
  assert.deepStrictEqual(planAlignment({ ...page, texts: [outside, inside], bubbles: [bubble(false)] }).map((p) => p.id), [11, 12]);
}

// A text the smart paste just centred stays on that centre (pasteTargets.js)
{
  const { rememberPasteTargets, keepPastedTexts, forgetPasteTargets } = load("app_src/oneClick/pasteTargets.js");
  const rect = { left: 300, top: 250, right: 600, bottom: 550, width: 300, height: 300, xMid: 452, yMid: 398 };
  const capture = (box, documentId = 7) => ({ documentId, texts: [{ id: 21, index: 1, box }] });
  rememberPasteTargets(7, [21, 22], [{ x: 450, y: 400 }, null]);
  // Still where the paste put it (whole-pixel bounds: half a pixel off)
  const still = boxAt(450.5, 399.5, 120, 60);
  assert.deepStrictEqual(keepPastedTexts(capture(still), [{ id: 21, rect }], false), [{ id: 21, rect: { ...rect, xMid: 450, yMid: 400 } }], "Align's other reading of the bubble is left out");
  assert.strictEqual(rect.xMid, 452, "the plan itself is not changed");
  // No placement (Align found no bubble): the text's own box on that centre
  const own = keepPastedTexts(capture(still), [], false);
  assert.deepStrictEqual(own, [{ id: 21, rect: { left: 390, top: 370, right: 510, bottom: 430, width: 120, height: 60, xMid: 450, yMid: 400 } }]);
  // ...unless Align resizes the text box to the bubble: the classic Align
  assert.deepStrictEqual(keepPastedTexts(capture(still), [], true), []);
  // A placement in another region (Align's wand took the wrong one): kept
  // on the paste's centre, or left to the classic Align with a resize
  const far = { ...rect, left: 900, right: 1200, xMid: 1050 };
  assert.deepStrictEqual(keepPastedTexts(capture(still), [{ id: 21, rect: far }], false)[0].rect.xMid, 450);
  assert.deepStrictEqual(keepPastedTexts(capture(still), [{ id: 21, rect: far }], true), []);
  // A selection of the user's: Align moves the text into it, pasted or not,
  // and a marquee (no placement) keeps the classic Align
  const picked = { documentId: 7, texts: [{ id: 21, index: 1, box: still }], bubbles: [{ textIds: [21], probed: false }] };
  assert.deepStrictEqual(keepPastedTexts(picked, [{ id: 21, rect: far }], false), [{ id: 21, rect: far }]);
  assert.deepStrictEqual(keepPastedTexts(picked, [], false), []);
  // ...but the same bubble selected again keeps the paste's own centre
  assert.deepStrictEqual(keepPastedTexts(picked, [{ id: 21, rect }], false)[0].rect.xMid, 450);
  // An outline the host probed itself is no selection of the user's
  const probedCapture = { documentId: 7, texts: [{ id: 21, index: 1, box: still }], bubbles: [{ textIds: [21], probed: true }] };
  assert.deepStrictEqual(keepPastedTexts(probedCapture, [{ id: 21, rect: far }], false)[0].rect.xMid, 450);
  // Moved since the paste, another document, another layer: aligned as usual
  assert.deepStrictEqual(keepPastedTexts(capture(boxAt(455, 400, 120, 60)), [{ id: 21, rect }], false), [{ id: 21, rect }]);
  assert.deepStrictEqual(keepPastedTexts(capture(still, 8), [{ id: 21, rect }], false), [{ id: 21, rect }]);
  assert.deepStrictEqual(keepPastedTexts({ documentId: 7, texts: [{ id: 22, index: 1, box: still }] }, [], false), []);
  // Garbage in, and nothing remembered
  assert.deepStrictEqual(keepPastedTexts(null, null, false), []);
  rememberPasteTargets(undefined, [1], [{ x: 1, y: 1 }]);
  rememberPasteTargets(7, null, null);
  forgetPasteTargets();
  assert.deepStrictEqual(keepPastedTexts(capture(still), [{ id: 21, rect }], false), [{ id: 21, rect }]);
  // The oldest centres go first
  for (let i = 0; i < 450; i++) rememberPasteTargets(7, [1000 + i], [{ x: 450, y: 400 }]);
  assert.deepStrictEqual(keepPastedTexts({ documentId: 7, texts: [{ id: 1000, box: still }] }, [], false), []);
  assert.strictEqual(keepPastedTexts({ documentId: 7, texts: [{ id: 1449, box: still }] }, [], false).length, 1);
  forgetPasteTargets();
}

// Garbage in: nothing placed, nothing thrown
assert.deepStrictEqual(planAlignment(null), []);
assert.deepStrictEqual(planAlignment({ ...page, texts: [{ id: 1, box: null }], bubbles: [{ rawPath: null, textIds: [1] }] }), []);
assert.deepStrictEqual(planAlignment({ ...page, texts: [{ id: 1, box: boxAt(5, 5, 2, 2) }], bubbles: [{ selectionBounds: { left: 0, top: 0, right: 9, bottom: 9 }, rawPath: { pathContents: {} }, textIds: [1] }] }), []);

console.log("Align plan tests passed");
