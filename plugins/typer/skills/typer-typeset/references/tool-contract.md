# TypeR tool contract

MCP v2 requires `requestId` on mutations and `documentId` on document writes. Both MCP entry points use `plugins/typer/mcp/contract.mjs`. Tool schemas are authoritative.

## State and identifiers

`typer_get_state` returns raw script indexes. Use `rawIndex`/`lineIndex` in tool calls; display numbers are presentation-only and may restart on every page.

Style IDs remain stable in TypeR storage. Photoshop layer IDs remain stable inside the open document. Bubble geometry is page-scoped and must not be reused after navigation.

`typer_set_current_line` changes TypeR's cursor. `typer_select_style` changes TypeR's default style. Neither edits Photoshop.

## Detection and page images

Use `typer_get_page_image` for visual reasoning. It returns a rendered image, snapshot dimensions, and original document dimensions.

Use `typer_detect_bubbles` for learned bubble detections in reading order, snapshot/document bounds, suggested script lines, and outline profiles. Sensitivity 5 is the normal starting point. Lower it when panels or margins appear as bubbles; raise it when sealed white bubbles are missing. Confidence is a ranking signal, not proof.

Call both tools again after navigation or material document changes.

## Writing tools

`typer_typeset_bubbles` is the preferred batch operation. Each entry contains document-space `bounds` and one of:

- explicit `text`;
- explicit `lineIndex`;
- neither, to consume usable lines from TypeR's current cursor.

Pass `styleId` explicitly for mixed dialogue/narration/SFX pages. `dryRun: true` returns the final TextShapeR line breaks and placements without changing Photoshop.

`typer_paste_text` is the manual-selection fallback. It creates and centers one explicit text layer in supplied bounds or the current Photoshop selection.

`typer_edit_layer` targets one layer ID. It can replace text, apply a TypeR style, reshape against the surrounding bubble, and align. Set `autoShape: true` when repairing line breaks.

`typer_align` performs the first automatic centering pass. Pass `layerId` to target a layer deterministically and explicit `bounds` when the detected bubble geometry is reliable. Without bounds or a current selection, TypeR attempts bubble-aware alignment around the text layer.

Automatic geometric centering is not always optical centering. After inspecting `typer_get_page_image`, use `typer_nudge_layer` with the stable `layerId` and small document-pixel `deltaX`/`deltaY` offsets. Positive X moves right and positive Y moves down. Re-render the page after each correction; prefer one deliberate move over a chain of untracked nudges.

`typer_change_text_size` accepts an optional `layerId` and a signed `delta`. Use small deltas, then call `typer_align` again and visually re-check because changing size changes the rendered bounds.

`typer_shape_text` compares variants before applying a chosen text with `typer_edit_layer` or `typer_apply_text`.

Prefer `typer_preview_text_shapes` for the final choice. Supply real document-space `bounds` whenever available: TypeR crops the Photoshop page, samples usable bubble width by height, and renders every variant with the resolved TypeR font/size. Red text indicates measured overflow. Pick a visible card, then copy the exact `variants[index].text` metadata into the final batch with `autoShape:false`.

## Styles and fonts

Call `typer_get_styles` before inventing a style. Match in this order:

1. line metadata or prefix;
2. semantic style/folder name;
3. project font family and weight;
4. visual role and size.

Use `typer_search_fonts` to build a shortlist, then call `typer_preview_fonts` with those `fontPostScriptNames` and representative dialogue. The returned image is an ordered contact sheet; its metadata maps each visible index to an exact face. Preview again with a narrower shortlist or different sample when punctuation, accents, uppercase, or condensed width matter.

Only then call `typer_save_style`. Prefer `fontPostScriptName` because it uniquely selects a Photoshop face. Omitting `styleId` creates a style derived from the current style; providing one updates it. Create a new named style for a one-off role instead of mutating a shared project style.

## Review and recovery

Use `typer_get_layers` after writing. Its `text` includes rendered line breaks and `bounds` reveal gross overflow or misplaced layers. Enable `scanBubbles` only for a precise review because it is slower.

Use `typer_get_page_image` for final visual review. If a whole batch is mapped incorrectly, call `typer_undo` with the batch `operationId` and rebuild it. For one or two defects, prefer targeted edits.

`typer_save_document` without a path saves the active document. Provide a `.psd` path for a new destination. `asCopy` preserves the active document's current path.

## Common failures

- **Panel timeout:** open Photoshop and show the TypeR panel, then call `typer_status`.
- **Stale page geometry:** call `typer_get_page_image` and `typer_detect_bubbles` again.
- **Unknown style:** refresh with `typer_get_styles`.
- **No selection:** use explicit bounds with `typer_typeset_bubbles`, or restore a Photoshop selection before `typer_paste_text`.
- **Font not installed:** use `typer_search_fonts`; do not silently substitute a materially different face.
- **Preview fallback or wrong face:** refresh the TypeR panel's Photoshop font list and call `typer_preview_fonts` again with exact PostScript names.
- **Alignment failure:** pass `layerId` explicitly, clear an unrelated selection with `typer_deselect`, then retry `typer_align`. If geometry is correct but the result still looks optically off-center, finish with `typer_nudge_layer`.

See `docs/mcp/AI_TYPESETTING_V2.md` in the TypeR repository for the complete v2 workflow, units, recovery behavior and limitations.
