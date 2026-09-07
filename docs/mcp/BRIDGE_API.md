# TypeR MCP Bridge API

> MCP v2 validates commands and arguments against the shared contract in
> `plugins/typer/mcp/contract.mjs`. Mutations require `requestId`; document
> writes require `documentId`. See [AI_TYPESETTING_V2.md](AI_TYPESETTING_V2.md)
> for new commands, units, page boundaries, operation recovery and undo.
> The legacy command descriptions below describe the original v1 payloads;
> use the live `tools/list` schemas as the authoritative v2 input contract.

Contract between the HTTP bridge hosted inside the TypeR CEP panel
(`app_src/mcpBridge.jsx`) and the standalone MCP stdio server (`mcp/server.js`).

## Transport & discovery

- The bridge listens on `127.0.0.1` only, on the first free port in
  `17845..17854`.
- On startup it writes a discovery file to `<os.tmpdir()>/typer-mcp-bridge.json`:

```json
{
  "port": 17845,
  "token": "64-hex-chars",
  "pid": 1234,
  "version": "3.0.0",
  "startedAt": 1723000000000
}
```

- The file is rewritten on every panel reload (token rotates). The MCP server
  re-reads it before each request if a request fails to connect.
- All requests except `GET /health` require header `X-TypeR-Token: <token>`.
  Wrong/missing token → `403 {"ok":false,"error":"forbidden"}`.

## Endpoints

- `GET /health` → `200 {"ok":true,"service":"typer-mcp-bridge","version":"..."}`
- `POST /rpc` — body `{"command":"<name>","params":{...}}`
  - Success: `200 {"ok":true,"result":{...}}`
  - Failure: `200 {"ok":false,"error":"message"}` (transport-level problems use
    4xx/5xx: `400 bad_json`, `403 forbidden`, `404 not_found`,
    `413 payload_too_large` for bodies over 20 MB)
- Commands run **sequentially** through an internal queue (one evalScript chain
  at a time). Default timeout 30 s; `detect_bubbles`, `get_snapshot`,
  `preview_fonts`, `preview_text_shapes`, `batch_paste`, `edit_layer`, and
  `save_document`: 120 s.
- On `busy_timeout` the in-flight Photoshop operation cannot be aborted: the
  bridge answers immediately but keeps holding the queue (bounded by one more
  timeout period) until the operation settles, and discards its panel-state
  side effects (a timed-out `batch_paste` does not move the line cursor). The
  layers it created in Photoshop may still exist — check before retrying.

## Common types

- `Bounds` (document pixels): `{ "left": n, "top": n, "right": n, "bottom": n }`
- `LineSummary`: `{ "rawIndex": n, "displayIndex": n|null, "text": "...", "ignore": bool, "styleId": "id|null", "styleName": "name|null" }`
  (`displayIndex` is the human line number shown in the panel; `styleId` comes
  from `line.usedStyle || line.style`.)
- `StyleSummary`: `{ "id": "...", "name": "...", "folder": "...|null", "prefixes": [".."], "textType": "point|paragraph|null", "fontPostScriptName": "...", "fontFamily": "...", "fontStyle": "...", "fontSize": n, "alignment": "...", "colorHex": "#rrggbb|null", "pointText": bool }`

## Commands

### status
Params: none.
Result: `{ "version": "3.0.0", "linesTotal": n, "currentLineIndex": n, "stylesTotal": n, "multiBubbleMode": bool, "storedSelections": n, "direction": "ltr|rtl", "imagesTotal": n }`

### get_state
Params: `{ "includeText": bool=false }`
Result: `{ "lines": [LineSummary], "currentLineIndex": n, "currentLine": LineSummary|null, "currentStyleId": "...", "direction": "ltr|rtl", "multiBubbleMode": bool, "storedSelections": n, "images": [{"name","path","page":n|null}], "lastOpenedImagePath": "...|null", "settings": { "pastePointText": bool, "internalPadding": n, "textScale": n|null }, "text": "..."? }`

### set_text
Params: `{ "text": "full script text" }` → replaces the panel text (dispatch `setText`).
Result: `{ "linesTotal": n }`

### set_current_line
Params: `{ "rawIndex": n }` (index into `lines`).
Result: `{ "currentLineIndex": n }`

### next_line / prev_line
Params: none. Result: `{ "currentLineIndex": n }`

### get_styles
Params: none. Result: `{ "styles": [StyleSummary], "currentStyleId": "..." }`

### select_style
Params: `{ "styleId": "..." }`. Result: `{ "currentStyleId": "..." }`
(The bridge waits out the panel's deferred style-prefix recompute before
answering, so a follow-up `get_state` reads fresh `lines[].styleId`.)

### search_fonts
Searches the fonts installed in Photoshop (panel font cache).
Params: `{ "query": "substring|empty", "limit": 1..100 = 30 }`
Result: `{ "fonts": [ { "name", "family", "style", "postScriptName" } ] }`

### preview_fonts
Renders a PNG contact sheet with the actual installed Photoshop faces. Pass an
ordered `fontPostScriptNames` shortlist from `search_fonts`, or a `query`, plus
contextual `text`, `limit`, `columns`, `fontSize`, `width`, `uppercase`, and
`theme`.
Result: `{ "path", "imageWidth", "imageHeight", "sample", "fonts" }`.
The MCP server returns the PNG as image content and the ordered font metadata
as structured content so each visible card maps to its exact PostScript name.

### save_style
Creates a style derived from the current style, or updates `styleId`, using an
installed font. Dispatches `saveStyle` (and `setCurrentStyleId` unless
`select:false`).
Params: `{ "styleId": "id|null", "name": "...", "fontPostScriptName": "...", "fontFamily": "...", "fontStyle": "...", "fontSize": n, "alignment": "...", "color": {"r","g","b"}, "pointText": bool, "select": bool=true }`
Result: `{ "style": StyleSummary }`

### document_info
Host `getTypeRMcpDocumentInfo()`.
Params: none.
Result: `{ "id": n, "name": "...", "path": "abs path|null (unsaved)", "width": n, "height": n, "resolution": n, "saved": bool, "activeLayer": { "id": n, "name": "...", "isText": bool } | null }`

### save_document
Host `saveTypeRMcpDocument(data)` — saves in place (`doc.save()`), or to an
explicit layered PSD path with optional `asCopy`.
Params: `{ "path": "abs .psd path|null", "asCopy": bool=false }`
Result: `{ "saved": true, "path": "abs path|null", "asCopy": bool }`

### get_snapshot
Exports a downscaled PNG of the active document (host `exportDocumentSnapshot`).
Params: `{ "maxDim": n=1500 }`
Result: `{ "path": "C:\\...\\typer_snapshot.png", "docWidth": n, "docHeight": n, "imageWidth": n, "imageHeight": n }`
The MCP server reads the PNG from `path` itself (same machine).

### detect_bubbles
Headless version of the bubbleDetect modal: snapshot → canvas decode →
`detectLearnedBubbles(pixels, getDetectionOptions(sensitivity), learning)` →
`orderBubbles(bubbles, rtl)`. Learning weights come from storage key
`bubbleDetectionLearning`.
Params: `{ "sensitivity": 1..10 = 5, "rtl": bool = state.direction==="rtl", "maxDim": 1500 }`
Result:
```json
{
  "docWidth": n, "docHeight": n,
  "snapshotPath": "...png",
  "bubbles": [
    {
      "id": n, "order": n,
      "docBounds": Bounds,
      "confidence": 0.93,
      "area": n, "fillRatio": 0.8,
      "suggestedLine": LineSummary|null
    }
  ]
}
```
`order` follows reading order (RTL aware). `suggestedLine` mirrors
`assignLinesToBubbles(orderedBubbles, lines, currentLineIndex)`.
`docBounds` is `bubbleToSelection(bubble, scaleX, scaleY)` — already in
document pixels, usable directly by `batch_paste`.

### batch_paste
Creates one text layer per entry (host `createTextLayersInStoredSelections`),
then advances the panel line state (`commitLineBatch`).
Params:
```json
{
  "entries": [
    { "bounds": Bounds, "lineIndex": n | null, "text": "override|null", "styleId": "id|null", "autoShape": bool, "forceShape": bool, "profile": "balanced|tall|wide" }
  ],
  "pointText": bool|null, "padding": n|null, "advanceLines": bool=true,
  "autoShape": bool=true, "allowHyphenation": bool=true,
  "profile": "balanced|tall|wide", "dryRun": bool=false
}
```
- If `text` is set it is used verbatim (may contain `\n` from shape_text);
  otherwise the text of `lineIndex` (or the next usable line) is used.
- TextShapeR runs automatically against every bubble unless the entry disables
  it. Explicit line breaks are preserved unless `forceShape` is true.
- `dryRun:true` returns final placements and shaped text without changing Photoshop.
- Style resolution: explicit `styleId` → line's style → current style, scaled by
  `textScale` (same as `buildStoredSelectionPayload`).
- `advanceLines:false` leaves `currentLineIndex` untouched (used when pasting
  with explicit `text`).
Result includes `{ "pasted": n, "nextLineIndex": n, "placements": [...] }`.

### paste_text
Single-bubble convenience = `batch_paste` with one entry and
`advanceLines:false`, or paste into the **live Photoshop selection** when
`bounds` is omitted (host `createTextLayerInSelection`).
Params: `{ "text": "...", "styleId": "id|null", "bounds": Bounds|null, "pointText": bool|null, "padding": n|null }`
Result: `{ "pasted": 1 }`

### apply_to_active
Applies text and/or style to the active text layer (host `setActiveLayerText`).
Params: `{ "text": "...|null", "styleId": "id|null" }` (at least one).
Result: `{ "ok": true }`

### align_active
Centers the active text layer in the current selection (host
`alignTextLayerToSelection`).
Params: `{ "layerId": n|null, "resizeTextBox": bool = state.resizeTextBoxOnCenter, "padding": n = state.internalPadding, "bounds": Bounds|null }`
Result: `{ "ok": true }`

### nudge_layer
Selects a stable text layer ID and moves it by a manual optical-centering offset.
Positive X moves right; positive Y moves down.
Params: `{ "layerId": n, "deltaX": n=0, "deltaY": n=0 }` (at least one offset must be non-zero).
Result: `{ "ok": true, "layerId": n, "deltaX": n, "deltaY": n }`

### change_text_size
Params: `{ "layerId": n|null, "delta": n }` (pixels, may be negative). Result includes the targeted layer and applied delta.

### get_layers
Reads all rendered text layers of the document (host `getAllRenderedTextLines`).
Params: `{ "scanBubbles": bool=false }`
Result: `{ "layers": [ { "layerId": n, "text": "...", "bounds": Bounds|null, ... } ] }` (host JSON passed through)

### shape_text
Generates line-break variants with TextShapeR (respects current tuning).
Params: `{ "text": "...", "width": n|null, "height": n|null, "limit": n=8, "allowHyphenation": bool=true, "manualLineCount": n|null, "profile": "balanced|tall|wide", "shapeProfile": {...}|null }`
Result: `{ "variants": [ { "lines": ["..",".."], "lineCount": n, "score": n|null } ] }`
(when `manualLineCount` is set, uses `generateManualTextShapeRVariant`).
The chosen variant is applied by pasting `lines.join("\n")` via
`paste_text`/`batch_paste` `text` override.

### preview_text_shapes
Generates TextShapeR variants and renders them as a PNG contact sheet in the
resolved TypeR font and size. With document-space `bounds`, the bridge captures
the current page, crops the real bubble, samples its usable white width at
several heights, and overlays every variant on that crop. Without bounds it
uses `width`/`height` and a schematic ellipse. Red rendered lines overflow the
sampled bubble width.

Params include `text` or `lineIndex`, `styleId`, `bounds` or `width`/`height`,
optional `shapeProfile`, `limit`, TextShapeR settings, preview font/line height,
sheet columns/theme, and snapshot size. Result contains the PNG `path`, font
metadata, sampled profile, and ordered variants with exact `text`, `lines`,
`score`, `fits`, and `maxOverflowRatio`.

### select_layer / edit_layer
`select_layer` targets a stable Photoshop ID returned by `get_layers`.
`edit_layer` updates its text/style, can automatically reshape it against the
surrounding bubble, and optionally re-center it.

### next_page / previous_page
Dispatch the panel actions (follow `Page N` markers in the script and open the
mapped image via `openFile`). Params: none.
Result: `{ "currentLineIndex": n, "openedImagePath": "...|null" }` (path is best effort)

### open_image
Params: `{ "path": "abs path" }` or `{ "page": n }` (resolved through the panel
image list). Result: `{ "opened": "path" }`

### deselect
Clears the Photoshop marquee. Params: none. Result: `{ "ok": true }`

### undo
Host `undoLastTyperChange`. Params: none. Result: `{ "ok": true }`

## Errors

Host failures come back as `{ "ok": false, "error": "<raw host status code>" }` —
the raw code returned by `host.js`, **not** the localized message the panel UI
shows: `"doc"`, `"layer"`, `"noSelection"`, `"smallSelection"`,
`"invalidSelection"`, `"layer_not_found"`, `"scriptError: <detail>"`.
Bridge-level errors: `"no_document"`, `"busy_timeout"`, `"unknown_command"`,
`"bad_params: <detail>"`, `"no_text_layer"`, `"snapshot_failed"`,
`"snapshot_read_failed"`, `"snapshot_decode_failed"`, `"undo_failed"`,
`"internal: <detail>"` (unexpected panel exception).

## MCP server mapping (mcp/server.js)

Tool names are prefixed `typer_`. 1:1 with bridge commands except:

- `typer_get_page_image` → calls `get_snapshot`, reads the PNG from disk and
  returns it as an MCP image content block (base64) plus dims as text. This is
  how the LLM *sees* the page.
- `typer_detect_bubbles` → `detect_bubbles` verbatim (JSON text result).
- `typer_typeset_bubbles` → `batch_paste`.
- Renamed tools: `typer_set_script` → `set_text`, `typer_get_document` →
  `document_info`, `typer_apply_text` → `apply_to_active`, `typer_align` →
  `align_active`.
- `typer_status` merges `GET /health` + `status` and reports a helpful error
  telling the user to open the TypeR panel in Photoshop when the bridge is
  unreachable.

Server behavior:
- Reads the discovery file at every call (cheap) → no stale port/token.
- 404/ECONNREFUSED → error message "TypeR bridge not running. Open Photoshop
  with the TypeR panel and retry."
- No state kept server-side; the panel is the source of truth.
