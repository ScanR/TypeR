# Smart paste and paste on click

Smart paste fits a translation to the bubble's real outline instead of the selection's rectangle. Paste on click
pastes as soon as the user selects a bubble. The bubble geometry, the layout solver and the measurement recipe
come from MD TYPER 1.3.22, a TypeR fork, reused with its author's permission and reorganized for TypeR.

## What the user gets

- **Smart paste** (on by default; Settings > Behavior). Paste, the Paste shortcut and multi-bubble batches:
  - read the selection's outline (work path, 2 px tolerance) and keep the bubble's body, without its tail;
  - keep the style size when the text fits, otherwise shrink it as little as possible (the largest size that fits,
    to half a percent), down to the minimum size (85% by default), then allow one hyphen in a long word (French or
    English, or off);
  - set a line made only of punctuation at the style's punctuation scale (×2 or ×3, off by default); a small bubble
    shrinks it, down to the minimum size of the style's own size;
  - break the lines to follow the bubble's silhouette and centre the ink optically, all lines inside the outline;
  - write white text without a stroke in a black bubble;
  - use the style marked *Shout* or *Narration* (style editor, "Bubble type") of the current folder for a spiky
    bubble or a rectangle; a script prefix always wins;
  - split a double or triple bubble and paste the next lines in its other chambers ("Distribute lines");
  - optionally paint the bubble under the text (Auto clean): one `TypeR Clean` layer per document, under the
    texts, only on solid white or black;
  - apply conditional refont rules: text between two markers takes another style's font.
  - When the smart paste cannot place the text, the classic paste runs and a short notice says why.
- **Paste on click** (off by default; footer toggle, shortcut without a default key). A Magic Wand click, a
  rectangle or a lasso pastes the current line at once. Restored or loaded selections, and the selections
  TypeR makes itself, never paste.
- **Undo sync**. Undoing a TypeR paste in Photoshop puts the script line back; a redo moves it forward again.

## Architecture

```
app_src/oneClick/            shared engine (pure, ES5 after babel)
  geometry.js                outlines, containment, bubble body, neck finder, shape classifier, cleanup validator
  bubblePlan.js              plan of a wand / rectangle / lasso selection (from the work path and the fill)
  connected.js               double and triple chambers
  alignPlan.js               Align: each selected text to its chamber (outlines read by alignCapture)
  textGraph.js               candidate lines of a translation, composition of the chosen lines
  solver.js                  beam search of lines inside the polygon (MD TYPER's frozen solver)
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
- **CEP** runs the engine in the panel (modern or ES5 build) and calls three ExtendScript steps:
  `smartPasteCapture` (work path through ActionManager, channel histograms of the selection),
  `smartPasteMeasure` (one staging text layer, bounds per line) and `smartPasteCommit`.
- Both hosts also answer `getHistorySnapshot` (history state ids) and `replaySelectionTrigger` (multi-bubble).

## Deliberate differences between CEP and UXP

These follow from what ExtendScript can do; the behaviour stays the same otherwise.

- CEP reads no pixels: the fill comes from the channel histograms of the selection. The cleanup checks that need
  pixels (fading edges) and open bubbles run in UXP only; in CEP an open bubble falls back to the classic paste.
- CEP measures line by line; UXP also reads up to 24 plain lines at once from a vector atlas.
- UXP reports history moves live; CEP checks the history before a paste, after Photoshop events and when the
  panel gets the focus.

## Testing

- `scripts/testSmartPasteEngine.js` runs the engine on synthetic bubbles (oval, small, tiny, shout, rectangle,
  double, triple, RTL, black) with a simulated measurement.
- `scripts/testSmartPasteClient.js` covers the panel client, multi-bubble replay and the paste-on-click gate.
- `scripts/testSmartPasteSettings.js` covers the settings state.
- Checked in Photoshop 2026 on the test pages: oval, cloud, shout and double bubbles, a black bubble, Auto clean,
  through the UXP host and through the CEP host.
