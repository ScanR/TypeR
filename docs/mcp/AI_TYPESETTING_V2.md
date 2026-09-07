# TypeR MCP v2

The standalone entry point (`mcp/server.js`) and the packaged plugin
(`plugins/typer/mcp/server.mjs`) now share one transport and the same 47-tool
contract in `plugins/typer/mcp/contract.mjs`. No npm dependencies are needed
to run either server. Node 18 or later and an open TypeR Photoshop panel are
required. Building TypeR still requires the root package's Node version.

## Read, measure, apply, review

1. Read `typer_get_state` and `typer_get_document`. Record `documentId`,
   `documentKey`, `scriptRevision`, the current tab, and `pageRange`.
2. Inspect `typer_get_page_image` and `typer_detect_bubbles`. Work in document
   pixels. Call `typer_get_region_image` for a detailed crop.
3. Reuse a TypeR style or capture one from a reference text layer with
   `typer_capture_style`. Font contact sheets help choose faces; they are
   canvas estimates, not measurements of the Photoshop layout.
4. Use `typer_measure_text` for a specific composition, or `typer_fit_text`
   for a bounded set of text-break/size candidates. Both use Photoshop on a
   disposable document at the original resolution. No source PSD history is
   changed by measurement.
5. Apply selected text with `typer_typeset_bubbles`. Include `lineIndex`,
   exact `text`, chosen `typography`, and `autoShape:false` to preserve it.
   The response contains the created `layerId` and rendered bounds.
6. Run `typer_review_page`, inspect image crops, and repair the specific
   layers. Save the PSD explicitly, export a PNG/JPEG if needed, then advance.

Example write (IDs are illustrative, obtain current values from the tools):

```json
{
  "documentId": 42,
  "requestId": "chapter-8-page-3-dialogue-v1",
  "entries": [{
    "lineIndex": 17,
    "text": "Bonjour !\nComment vas-tu ?",
    "bounds": { "left": 100, "top": 200, "right": 450, "bottom": 480 },
    "typography": { "fontPostScriptName": "ArialMT", "fontSize": 24 },
    "autoShape": false
  }]
}
```

## Units and limits

- Bounds, offsets, paragraph-box dimensions, image margins and padding use
  **document pixels**. Font size, fixed leading and baseline shift use
  **points**. Tracking uses thousandths of an em. Scale uses percentages.
- A `typography` override affects one operation/layer, not the shared style.
  Supported attributes include font, size, leading, tracking, scales,
  baseline, alignment, direction, color and outline. Global TypeR text scale
  applies before explicit per-operation point-size overrides.
- `typer_edit_layer.textRuns` applies character attributes to UTF-16 ranges
  `[from,to)` of the final plain text. Ranges may not exceed the text length.
  Paragraph attributes and outlines remain layer-wide.
- `typer_transform_layer` supports relative rotation/scale, absolute left/top,
  paragraph-box dimensions and editable Photoshop text warps. Confirm results
  visually, especially on older Photoshop versions.
- `typer_fit_text` measures at most 24 candidates. Defaults stay between 85%
  and 100% of the style's current point size. A null `best` means no tested
  candidate fits; it is not permission to shrink further or rewrite dialogue.
- Photoshop fit checks cover the rectangular text bounds and substituted
  base font. They do not certify optical centering, bubble-tail clearance,
  per-glyph fallback, or arbitrary contour containment. `contourChecked:false`
  makes this explicit. Inspect the real crop before accepting a composition.
- Batch entries accept sampled `shapeProfile` rows and simple polygons to
  guide TextShapeR line breaking. A concave polygon with disconnected
  horizontal spans must be split. Placement remains geometrically centered
  inside the supplied bounds; use targeted optical corrections afterwards.

## Document and request identity

Every mutation requires a caller-selected `requestId`. Document writes also
require the active `documentId`. An optional `expectedDocumentKey` binds the
request to the host session, protecting against reopened documents with
reused IDs. Checks run inside each ExtendScript call before the action.

Requests are serialized across the panel bridge. A timed-out host operation
continues to own the queue until it actually settles. `typer_get_operation`
can be queried while that queue is busy and reports pending/completed/failed
results. Retrying an already completed request with identical arguments
returns its original result. Reusing an ID with different arguments fails.
Failed, undone or interrupted writes are not silently replayed.

Pending IDs and completed results are stored with TypeR's existing storage.
After a panel reload, unfinished records are marked interrupted. Inspect the
document before attempting a new operation. The log retains up to 2,000 IDs;
it fails explicitly at capacity rather than forgetting a write and permitting
duplicates. Request IDs must be unique across the active profile's log.

Document edits use checkpoints. A failed edit rolls back the source document
and the corresponding line/progress state. `typer_undo` can target a completed
operation by its ID. It refuses when Photoshop has newer edits, the original
script/tab has changed, or the host checkpoint is no longer available after a
reload/history eviction. Save/export/file navigation and global style/tab
changes are not covered by document undo.
The session retains at most 16 recent host checkpoints. Full script/progress
undo snapshots stay in memory and are not duplicated into the persisted log.

## Chapter state and review

`typer_set_page_mapping` accepts explicit page numbers and existing absolute
paths. MCP page navigation waits for the host's open result and keeps existing
documents open; save them explicitly. Script consumption stops at a page marker
unless `allowCrossPage:true` is deliberately supplied to the batch.

`typer_manage_tabs` lists, creates, switches and renames tabs.
`typer_edit_script_lines` uses an expected script revision to reject stale
edits. Replacing the script changes its revision and makes old associations
stale instead of silently attaching them to new dialogue.

Batch entries with `lineIndex` create persisted associations containing tab,
document path (or session key for an unsaved document), layer ID, source text,
applied text, geometry and style. Explicit text-only pastes have no inferred
script association. Use `typer_set_progress` to associate them or existing
layers. `typer_get_progress` exposes links and review status.

`typer_review_page` checks missing/duplicate dialogue, missing/hidden layers,
changed text, stale script links, rectangular margin overflow, collisions and
missing base fonts. It always requests visual review; the report is not an
automatic aesthetic approval. `typer_learning` learns only from associations
explicitly marked validated whose script and rendered text still match.

## Additional tools

| Tool | Purpose |
| --- | --- |
| `typer_get_region_image` | Full-resolution crop from bounds or a text layer |
| `typer_measure_text` | Actual Photoshop text measurements |
| `typer_fit_text` | Bounded measured composition search |
| `typer_capture_style` | Read or save a reference layer's typography |
| `typer_transform_layer` | Position, rotation, scales, box size, warp |
| `typer_manage_layers` | Paginated tree, groups, rename, duplicate, move, visibility, delete |
| `typer_set_page_mapping` | Explicit chapter page/PSD mappings |
| `typer_manage_tabs` | List, create, switch, rename script tabs |
| `typer_edit_script_lines` | Revision-checked range edit |
| `typer_get_progress` | Persisted associations and review status |
| `typer_set_progress` | Associate or explicitly validate a layer |
| `typer_review_page` | Localized structural/text/layout diagnostics |
| `typer_get_operation` | Recover the known outcome after a timeout |
| `typer_export_page` | PNG/JPEG delivery without flattening the source PSD |
| `typer_sample_bubble` | Sample the outline around a layer or supplied bounds |
| `typer_learning` | Inspect tuning or learn from validated compositions |

Source-text cleaning/inpainting is outside this implementation. The MCP does
not erase artwork or assume a detected bubble is empty.

## Verification

Live verification on Photoshop 2026 (7 September 2026) used a disposable
two-bubble page: real measurement and candidate fitting, batch creation with
returned layer IDs, exact replay without duplicates, rendered layer reads,
page review, style capture, rotation and its undo, point-size/leading/tracking
and character-color edits and their undo, group creation and undo, region
export, PNG delivery, layered PSD copy, and exact batch undo all succeeded.
Small-height and narrow-box cases were then verified to return `fits:false`,
including incomplete/overset content. Original documents were left intact;
the temporary document and script tab were closed after testing.

Root tests include the real bridge handlers with a simulated host for page
boundaries, document mismatch, partial failure, retry recovery, layer IDs,
panel-state rollback and precise undo. Pure tests cover the shared schema and
review diagnostics. MCP smoke tests exercise both stdio distributions and
reject invalid write parameters before contacting a bridge.

```sh
npm test
npm test --prefix mcp
TYPER_MCP_SERVER_PATH="$PWD/plugins/typer/mcp/server.mjs" node mcp/test/smoke.js
npm run build
npm run test:build
./install_mac.sh
```
