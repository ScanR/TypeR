# Smart paste and paste on click

Smart paste fits a translation to the bubble's real outline instead of the selection's rectangle. Paste on click
pastes as soon as the user selects a bubble. The bubble geometry, the layout solver and the measurement recipe
come from MD TYPER 1.3.22, a TypeR fork, reused with its author's permission and reorganized for TypeR.

## What the user gets

- **Smart paste** (on by default; Settings > Behavior). Paste, the Paste shortcut and multi-bubble batches:
  - read the selection's outline (work path, 2 px tolerance) and keep the bubble's body, without its tail;
  - keep the style size when the text fits, otherwise shrink it as little as possible (the largest size that fits,
    to half a percent, then rounded down to half a point or pixel, a tenth of a millimetre, where it still fits),
    down to the minimum size (75% by default), then allow one hyphen in a long word (French or English, by default
    the script's language, or off);
  - keep the padding (Settings, "Internal padding") between the outline and the text's ink, the style's stroke
    included;
  - set a line made only of punctuation at the style's punctuation scale (×2 or ×3, off by default); a small bubble
    shrinks it, down to the minimum size of the style's own size;
  - break the lines to follow the bubble's silhouette and centre the text where Align puts it, every line inside
    the outline there: pressing Align right after a paste does not move the text (see *Centring*);
  - write white text without a stroke in a black bubble;
  - use the style marked *Shout* or *Narration* (style editor, "Bubble type") of the current folder for a spiky
    bubble or, on a Magic Wand selection only, a rectangular box (a rectangle marquee or a lasso keeps the line's
    style); a script prefix always wins;
  - split a double or triple bubble and paste the next lines in its other chambers ("Distribute lines"). A chamber's
    line is always pasted, on the same ladder as a single bubble (below). The neck is no bubble line: the padding
    does not apply along it;
  - optionally paint the bubble under the text (Auto clean): one `TypeR Clean` layer per document, under the
    texts, only on solid white or black;
  - apply conditional refont rules: text between two markers takes another style's font.
  - When the text does not fit at the minimum size, even with a hyphen, the margin gives way one step at a time, each
    step with the whole size range and the hyphenation again (`marginSteps`, layout.js): two thirds of the padding,
    one third, the base margin (3.5% of the bubble's smaller side, 2 px at least), half of it, none. Then the text
    overflows the bubble as little as possible: a text is always placed. A larger padding never sets the text closer
    to the outline than a smaller one. The classic paste only takes over, without
    a notice, when no bubble can be read at all (see *When the classic paste still runs*).
- **Paste on click** (off by default; footer toggle, shortcut without a default key). A Magic Wand click, a
  rectangle or a lasso pastes the current line at once. Restored or loaded selections, and the selections
  TypeR makes itself, never paste. The Magic Wand must read the page and not the active layer, so TypeR turns its
  "Sample All Layers" option on and selects a click made without it again (`ensureWandSampleAll`).
  A second Magic Wand click in a bubble that just got one line (the next line waiting) splits it: the paste is
  undone (`restoreHistoryState`) and both lines are pasted with `forceSplit`, which cuts the bubble at the chord
  that removes the most of its outline's dents (`forcedCut`), even when the neck finder saw a single bubble. When a
  seam from a concave corner straight to a straight side explains about as many dents, that seam is used instead:
  under a panel frame the dent chord may run to a corner of the frame, across a lobe.
  For the double bubbles an outline alone cannot tell from a single one: offset boxes, a bubble under a frame with a
  tail by its seam or a tilted frame.
  Detection favours single bubbles: a wrong split costs more than a miss, which this gesture fixes. To change a threshold in `findCut`, rerun the outline benches and have a typesetter label every cut it adds or removes.
  The first line stays in the chamber clicked first.
  A paste around the click of a leaking selection is never such a candidate (`open` in the paste's result): every
  click on the page has that same selection, so the next one is another text.
  Undoing a one-line paste on click while the next line waits shows the tip about that second click, once
  (`singlePasteUndone`, tip `splitDoubleBubble`): it is what a user does when a double bubble got one line.
- **Double bubbles under a panel frame**. A frame that clips a double bubble leaves one notch only, where the two
  lobes meet; the other end of their seam is on the frame. It is the commonest double bubble of a manga page (two
  bubbles side by side or stacked against the border of the panel), and the routes that need two notches miss it.
  The last route of the neck finder (`frameNeck`) cuts from that corner to the nearest point of the straight side
  it faces, when the corner is as sharp as two arcs meeting (not a blade or a strand of hair over the bubble, not
  the base of a tail) and deep enough in the bubble's hull (a hand or a head over a single bubble dents it less),
  the side is a real frame (straight, close to an axis, ending on a corner) and both chambers are convex and no
  boxes. A notch shallower than 7% of the bubble's size, a tail right at the seam or a tilted frame take the
  second click. Measured against the rule before it, with no cut lost or moved anywhere:
  - 696 lettered pages of 35 series, real Magic Wand outlines read in Photoshop (1,362 bubbles): 23 bubbles more
    are split, all double, the seam between their two texts; of the 347 bubbles whose lettering makes two blocks,
    297 are split at the first click instead of 276; no single bubble gets a new cut;
  - the same pages with TypeR Studio's own outlines: the same 23 doubles and one more, and 21 regions of the
    drawing, which are no bubbles;
  - the neck bench (60 lettered pages, real outlines): 4 of its 5 doubles under a frame, no single bubble split;
  - 1,000 scanned pages of 48 other chapters (emulated outlines, softer than Photoshop's): 7 bubbles split.
- **A small bubble on a large one**. A small bubble stuck on the side of a large one is cut off it at the first
  click when no other route found a neck: the outline is a bubble's (no hair or hand in it), the neck is pinched
  on both sides and short for the lobe it closes, and the lobe is round. It is the last resort of the neck finder
  and moves no cut the other routes make. With it, 299 of the 347 two-text bubbles of the lettered pages are split
  at the first click (276 before the frame route).
- **Open bubbles and text outside a bubble**. A Magic Wand click whose selection leaks into the page (a bubble
  open on its panel, a bubble drawn with strokes that do not meet, text set on the bare page) is pasted around
  the click:
  - the new TypeR first tries to isolate the chamber with the page's pixels (`recoverOpenBubble`, MD TYPER's
    recovery: gaps up to twice the contraction radius, a compact chamber);
  - otherwise, and always in the Legacy panel, the host reads the outline of the selection inside a disc around
    the click (18% of the page's width; one work path, rolled back) and `localRegion` finds the region of the
    click on a grid: the selection is opened (eroded, then grown back from the part around the click) at growing
    radii, and the first radius that closes the region inside the disc wins, a bubble; when none does, the widest
    opening is kept, the free area around the click. Letters and specks the region encloses are covered, as in a
    closed bubble; a longer piece of ink (a drawing, another bubble) and what lies behind it are left out. The
    region is laid out like a regular bubble, never cleaned;
  - a click nothing can be read around gets the disc itself.
  A manual Paste uses the Magic Wand click that made the selection (`lastClick`, forgotten when the selection
  changes without a click), provided it still lies in the selection. The classic paste set such a line in the
  middle of the page-wide selection, on one line, often far from the click.
- **When the classic paste still runs**. A selection that leaks into the page with no click known (a manual
  Paste whose click TypeR did not see: the Legacy panel on hosts that send no event data), a lasso that covers
  the page, a style without text settings, and Photoshop errors. A document or a selection that is missing, and
  a timeout, stop the paste instead.
- **Undo sync**. Undoing a TypeR paste in Photoshop puts the script line back; a redo moves it forward again.

## Centring

The paste and Align put a text on the same point, so that Align right after a paste leaves it in place. Both
move the layer so that the centre of its bounds, the box of its ink, lands on the bubble's centre, and both get
that centre from the same function, `bodyCentre` (geometry.js), on the outline of the bubble.

- **The centre.** The body first: the outline opened (contracted, then grown back) by 14% of its short side, which
  cuts the tail off, as Align did with Photoshop's Contract and Expand. A single bubble is centred on the body's
  centroid, its centre of mass. A chamber of a double or triple bubble is centred halfway between the body's
  centroid and the centre of its box: the cut at the neck takes a chamber's end away and pulls its centroid from
  the neck, where typesetters set the text nearer the neck, as if the lobe went on under the other one. Align used
  the centre of the opened selection's box for a single bubble: it follows every bump of the outline and the whole
  stub of a thick tail the opening cannot cut (a tail whose base is a third of the bubble's short side moved it by
  9 to 18 px on a 220 px bubble, the centroid by 2).
- **What it was chosen on**, against where typesetters set their texts (the centre of the text's ink box):
  - typeset PSDs of two runs of chapters (417 pages; `psd-truth` in the neck bench reads the text layers and
    floods the bubble around each on the page without its lettering): 1,514 single bubbles and 842 chambers. The
    texts of these files all sit 2 to 3 px right and down of every centre tried, the same whatever the bubble or
    the text, so each centre is judged without its own constant offset per chapter. Median distance left, first
    run / second run: single bubbles 2.8 / 6.4 px for the opened box centre, 2.6 / 3.2 px for `bodyCentre`
    (nearer by more than a pixel for 239 and 473 texts, farther for 110 and 45); chambers 3.1 / 4.8 px for the
    centroid of the eroded body Align and the paste used, 2.9 / 4.5 px for `bodyCentre`;
  - 696 lettered pages of 35 series (real Magic Wand outlines, the lettering's ink as the truth): 931 single
    bubbles, 660 chambers. On the nine chapters lettered within 3 px of any centre (372 bubbles), 2.6 px for the
    opened box centre, 2.1 px for the body's centroid (nearer for 112, farther for 59); chambers 5.9 px for the
    centroid of the eroded body, 4.0 px halfway to the box (nearer for 118, farther for 23). The typesetters set
    a chamber's text 4 px nearer the neck than its centroid, in 86% of the chambers.
  - Tried and left out: the centre of the largest inscribed circle, centroids weighted by the distance to the
    outline, the middle between the sides over the rows the text spans (a little better on the lettered pages,
    worse on the PSDs), the box of the widest chords.
- **Align** (`alignPlan.js`). The host reads the outline of the bubble around each selected text (`alignCapture`:
  the user's selection, or its own wand probes) and the panel answers a placement per text: the bubble's body
  and its centre, or the chamber's. The host then only moves the layers; it no longer opens the selection in
  Photoshop (a stored channel, Contract, Expand, a reload) for a text the panel placed. An outline the host's own
  wand found (`probed`) only takes the texts that lie inside it: a probe beside a narrow bubble can land in the
  region next to it. A rectangle marquee, and a text no bubble can be read around, keep the classic Align.
- **A pasted text stays where the paste put it** (`pasteTargets.js`). The paste read the bubble on the user's own
  Magic Wand click; Align reads it again with its own wand, another tolerance at another point: an outline a
  pixel or two apart, now and then another region or another split. The panel remembers where each pasted layer
  was centred, and an Align of a layer still within a pixel of that point keeps it there. A text moved since is
  aligned as any other, and a selection of the user's still wins: Align moves the text into the selected bubble.
  In memory only: a panel reload forgets it.
- The solver (`_jointSearch`) tries one axis and one block centre, the target, where MD TYPER tried them 5% and
  10% off it too and kept a layout off the centre when the centred one did not fit. Once a set of lines is
  complete, the centre of its ink box goes on the target: the lines move down or up, the axis moves by the
  asymmetry of their ink (side bearings, a "?" or a "…" at the end of a line), and every line must fit there
  (`_jointCentreInk`); otherwise the search goes on. The fine pass only seeds the beam a tenth to three tenths of
  the text size above and below. The native verification centres the measured ink box again and checks every
  line there (`verifyPackedChoice`, layout.js). The ladders of sizes, margins and overflow keep the same centre.
- The commit moves Photoshop's ink box onto the target (`text.target`) when it is more than half a pixel off
  (`_smartSettleInk` in host.js, `placeText` in the UXP host): one move in the commit's own call, reading the ink
  box the commit already read. A point text is first set to point once more, as Align does after its move: the
  first time, Photoshop moves its ink 2 or 3 px sideways (7 to 14 ms); afterwards Align's own conversion no
  longer moves it.
- Cost of the centred layout: a layout that only fits off the centre is no longer kept. On 400 real outlines
  (simulated measurement, asymmetric ink), 11% of the texts are set smaller than with MD TYPER's off-centre
  layouts, by 2.3% of the style size at the median, 9% at p90 and 15% at most (the minimum size); 3% are set
  larger. The engine time is halved (fewer axes and block centres); `bodyCentre` adds under a millisecond a
  bubble.
- Measured with censuses (`psd-truth` in the neck bench: a Magic Wand click, the paste, Align on each pasted text
  as the panel does, then the text moved by hand and Align again), on pages cleaned of their lettering:

  | | Align right after a paste moves the text | a text moved by hand, then Align: back within 1 px of the paste's place |
  | --- | --- | --- |
  | TypeR Studio, 221 bubbles, 349 texts | 0 px, every text | 99% single, 95% double, 80% triple |
  | Photoshop, Legacy host, 32 bubbles, 48 texts | 0 px, every text | 100% single, 93% double (2 px at most), 3 of 3 triple |

  Before any of this, Align moved one pasted text in two (72 bubbles in Photoshop: 4 px at the median and 37 px
  at p95 in a single bubble). What Align still puts elsewhere, when it reads the bubble itself, is its own reading:
  another outline a pixel apart, another split of a triple, a probe in the next region. In the Legacy host the
  move of an Align takes 12 ms instead of 137 (the selection is no longer contracted and expanded in Photoshop);
  reading the outline (`alignCapture`, 90 ms) is unchanged. Paste times are unchanged: the same measurement round
  trips (`benchSmartPasteCep.js`: 23 round trips, 28 requests lean, 36 exhaustive).

## Architecture

```
app_src/oneClick/            shared engine (pure, ES5 after babel)
  geometry.js                outlines, containment, bubble body, neck finder, shape classifier, cleanup validator
  bubblePlan.js              plan of a wand / rectangle / lasso selection (from the work path and the fill)
  openBubble.js              leaking clicks: open chamber from the pixels (UXP), region around the click (both hosts)
  connected.js               double and triple chambers
  alignPlan.js               Align: each selected text to its chamber (outlines read by alignCapture)
  textGraph.js               candidate lines of a translation, composition of the chosen lines
  solver.js                  beam search of lines inside the polygon (MD TYPER's frozen solver), ink box centred
  measureSpec.js             64 px measuring parameters, metrics from bounds or vector atlases, metric cache
  layout.js                  measure -> solve -> verify natively, size policy, hyphenation retry
  hyphenation.js, hyphen/    French (TextShapeR syllables) and English (hyphen library, ISC) break points
  refont.js                  conditional refont rules on parsed rich text
  selectionEvent.js          which Photoshop "set selection" events trigger a paste
  pasteHistory.js            undo sync bookkeeping
  smartPaste.js              orchestration over a host adapter (capture, measure)
app_src/smartPasteClient.js  panel: request from the state, CEP adapter, fallback, history records, multi-bubble
app_src/pasteOnClick.jsx     panel: Photoshop events -> paste on click and undo sync
uxp-src/host/smartPaste.js   UXP host: the engine runs here (Imaging pixels, work path, atlas measuring, commit)
app_src/host.js              CEP host, "smart paste" section (ES3): capture, measure, commit, history, replay
```

- **UXP** runs the whole engine in the plugin host (`smartPaste(request)`): pixels and paths never cross the
  WebView. Reads run in rolled-back history suspensions; the paste is one history state.
  Each text measurement groups its create/update and bounds read into one `batchPlay` call; an atlas
  groups creation, conversion and path reading. The final atlas is removed by history rollback.
  Atlas row leading is normalized for pixel styles at non-72 dpi so the engine can keep measuring in batches.
- **CEP** runs the engine in the panel (modern or ES5 build) and calls three ExtendScript steps:
  `smartPasteCapture` (work path through ActionManager, channel histograms of the selection),
  `smartPasteMeasure` (invisible staging layers, individual bounds or atlas metrics) and `smartPasteCommit`.
- Both hosts also answer `getHistorySnapshot` (history state ids) and `replaySelectionTrigger` (multi-bubble).

## Deliberate differences between CEP and UXP

These follow from what ExtendScript can do; the behaviour stays the same otherwise.

- CEP reads no pixels: the fill comes from the channel histograms of the selection. The cleanup checks that need
  pixels (fading edges) and the pixel recovery of an open chamber run in UXP only; in CEP a leaking click always
  takes the region around the click. `smartPasteCapture` answers `leak` at once for such a click, without reading
  the page-wide outline, and the panel calls it again with the disc (`local`): one more round trip.
- Both hosts can read up to 24 compatible lines at once from a vector atlas, with individual measurements as
  fallback. CEP reduces the outlines to metrics before returning them across its bridge. In CEP the atlas outline
  is read point by point through the Action Manager, so an atlas is not always cheaper than single lines
  (one text update and one bounds read each): the host times every request and the panel uses the kind that
  measured a line faster, once it has seen both (`preferAtlas`, `measurementCosts()` in smartPasteClient.js).
- CEP measures lean (`leanMeasure`, layout.js): when no estimated line set fits a size, the engine does not measure
  every candidate line (dozens to hundreds, each a round trip or an atlas) before giving up on that size. It
  searches once more with the estimated lines narrowed by 3% (the estimates run that wide: the widest space, no
  kerning across words) and the native verification measures the chosen lines. Before the size ladder, a text that
  cannot fit at the smallest size by the estimates is refused at once. UXP keeps the exhaustive measurement.
- UXP reports history moves live; CEP checks the history before a paste, after Photoshop events and when the
  panel gets the focus. That reading costs one get per history state, so the host answers "unchanged" when the
  current state and the count are those of the panel's last reading, and a paste moves that reading forward
  without a new one (`getHistorySnapshot({ known })`, `noteHistoryAfterPaste`).
- CEP reads a work path denser than 512 points (a spiky or noisy outline) without its Bézier handles, a third of
  the Action Manager calls; the unit of a point is read once, on its anchor.
- The panel's inline TextShapeR reads the outline of a selection made while a text layer is active
  (`getCurrentSelectionShape`, a point-by-point path read). A selection that does not touch that layer is the next
  bubble, not the text's: it is not read, so the paste does not wait behind it. Photoshop events sent for the
  measurements of a smart paste refresh the panel once, after the paste.

## Testing

- `scripts/testSmartPasteEngine.js` runs the engine on synthetic bubbles (oval, small, tiny, shout, rectangle,
  double, triple, RTL, black) with a simulated measurement.
- `scripts/testSmartPasteCentre.js` checks the centring contract: the ink box on Align's centre (oval, tail,
  asymmetric lines, double, triple, overflow), Align's plan of the pasted texts on the same targets, and the
  opening of a single bubble.
- `scripts/testSmartPasteClient.js` covers the panel client, multi-bubble replay and the paste-on-click gate.
- `scripts/testSmartPasteSettings.js` covers the settings state.
- `scripts/testHostPrecedence.js` refuses an `a || (b && c)` in the ExtendScript host. ExtendScript reads `&&` and
  `||` left to right with the same precedence, and the build prints the host without the parentheses the standard
  does not need: such a test must be written as separate statements. The Legacy capture of a leaking click failed
  that way (`clicked` was false for every Magic Wand trigger) until it was. The expressions that were already
  there are listed in the test and left as they are.
- `scripts/benchSmartPasteCep.js` counts, on synthetic bubbles, what a paste costs the Legacy panel: measurement
  round trips, atlas and single-line requests, solver searches and engine time (`--uxp` for the UXP host's
  exhaustive measurement, `--json` to keep the numbers).
- Checked in Photoshop 2026 on the test pages: oval, cloud, shout and double bubbles, a black bubble, Auto clean,
  through the UXP host and through the CEP host.
- Censuses in Photoshop 2026 on the lettered bench (696 pages of 35 series, real Magic Wand clicks, the real
  fonts, text committed): the 1,373 bubbles through the UXP host, all pasted by the smart paste (1,039 single,
  320 double, 14 triple; 236 ms a paste at the median), 357 of them through the CEP host; 126 leaking clicks
  (open bubbles and texts outside a bubble, cleaned of their lettering) through the UXP host, all pasted, and a
  third of them through the CEP host, the text in the same place for 40 of 43 (the three others are chambers the
  UXP host isolates with the pixels).
