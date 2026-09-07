# Long-session scan history regression

## Confirmed defect

`getCurrentSelectionShape`, `getActiveLayerBubbleShape` and the multi-bubble selection capture perform temporary Photoshop operations. `suspendHistory` grouped each scan into one state but did not remove it. Repeated analysis therefore retained scan states, consumed undo capacity and introduced unnecessary history/scratch work.

This defect was reproduced in Photoshop 2026 on macOS using the current source, isolated inside a script with a disposable 1000 × 1000 RGB document. The user's document was not edited.

| Check | Before | After |
| --- | --- | --- |
| Initial history count | 3 | 3 |
| Repeated path scans | 12 | 100 |
| Final history count | 15 | 3 |
| Extra alpha channels | 0 | 0 |

After the fix, all 100 scans returned path profiles without errors. The original selection, history names and active history index were preserved. Multi-bubble capture also kept the history count unchanged. An analysis attempted after Undo was deferred, and Redo restored the original selection successfully.

## Change

The three analysis paths now use `_withTemporaryHistory`. It suspends operations, restores the preceding document state and deletes only the newly created scan state. It never retries a failed scan without history suspension. The temporary callback is released in `finally`.

A scan after Undo is deferred to preserve Redo. At history capacity, the helper temporarily reserves a slot and restores the history preference after cleanup. If Photoshop cannot reserve or clean up safely, it defers the analysis. The panel does not permanently cache a deferred bubble as a failed detection.

`npm test` includes a 10,000-scan regression simulation covering retention, selection restoration, undo/redo, capacity, failures and bubble integration. Capacity reservation and failure injection are simulated tests; the native Photoshop checks above did not fill the history limit.

## Evidence limits

The retained history states are confirmed, not a demonstrated explanation for every reported slowdown. The native test does not establish an hours-long CPU/RAM curve, Windows behavior, or performance on the reporters' PSDs. Individual scans include extra cleanup work; the correction targets retained history and repeated session costs, not lower latency for a single scan. Reports without TextShapeR or multi-bubble capture still require a performance recording from an affected session.
