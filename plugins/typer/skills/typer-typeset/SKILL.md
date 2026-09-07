---
name: typer-typeset
description: Autonomously typeset manga, comics, webtoon, or BD pages in Adobe Photoshop through the TypeR MCP tools. Use when asked to inspect PSD pages, detect or order speech bubbles, map dialogue from TypeR's TextBlock to bubbles, choose or create typography styles and fonts, paste and center text, run TextShapeR, review or correct text layers, save a page, or progress through a chapter with minimal human intervention.
---

# TypeR Autonomous Typeset

Drive the TypeR Photoshop panel through its MCP tools. Keep the workflow page-scoped, observable, and reversible.

## Start every session

1. Call `typer_status`. If the panel is disconnected, ask the user to open Photoshop and show the TypeR panel; do not substitute filesystem or UI automation.
2. Call `typer_get_state` and `typer_get_document` to read the script, current raw line, page mappings, active PSD, direction, padding, text scale, and style catalog.
3. Preserve an already loaded script. Call `typer_set_script` only when the user explicitly supplies a replacement or TypeR has no usable script.
4. Call `typer_get_page_image`, then `typer_detect_bubbles`. Use `rtl: true` for manga unless the script/page clearly reads left-to-right.

## Typeset one page

1. Inspect the returned page image and bubble boxes. Reject obvious panels, gutters, balloons containing existing translated text, SFX regions, captions, and non-dialogue white areas.
2. Map bubbles to script lines. Start from TypeR's current usable line, follow visual reading order, and honor explicit style prefixes or previously used line styles.
3. Call `typer_get_styles` when the context summary is insufficient. Choose styles by semantic name/folder/prefix first, then by font and size. When no existing style fits, call `typer_search_fonts`, shortlist plausible faces, then call `typer_preview_fonts` with real dialogue from the target bubble. Compare the rendered sheet before calling `typer_save_style`.
4. Call `typer_typeset_bubbles` with `dryRun: true`. Pass explicit `lineIndex` and `styleId` whenever they are known; do not rely on a moving cursor for a nontrivial page.
5. For every bubble, call `typer_preview_text_shapes` with the real bubble `bounds`, resolved `styleId`, and dialogue/`lineIndex`. Inspect the contact sheet over the real page crop and choose the best visible variant. Use its exact `variants[index].text`; do not infer line breaks from the image alone. Fix omissions, double bubbles, and reading-order mistakes before writing.
6. Call `typer_typeset_bubbles` again without `dryRun`. Pass the chosen line breaks as explicit text and disable `autoShape` for that entry so the final write preserves the selected silhouette.
7. Call `typer_get_layers`, then `typer_get_page_image` to visually review the rendered page. Check every placed layer for overflow, collisions, bad silhouette, wrong font/style, and optical centering. Also compare ordinary dialogue across the whole page: its apparent size should form a coherent system instead of changing bubble by bubble.
8. Repair shape or style with `typer_edit_layer`/`typer_shape_text`. When automatic placement is visibly off, first call `typer_align` with the exact `layerId` and bubble bounds. Re-render the page; if geometric centering still looks optically wrong because of an irregular balloon or tail, call `typer_nudge_layer` with the same `layerId` and a small `deltaX`/`deltaY`, then inspect again. Adjust font size with targeted `typer_change_text_size` only when necessary, re-align after every size change, and use `typer_undo` when a correction worsens the result or a batch is fundamentally wrong.
9. Call `typer_save_document` only after the page passes review.
10. Call `typer_next_page`, then repeat from `typer_get_state`, `typer_get_page_image`, and `typer_detect_bubbles`.

## Mapping rules

- Treat detections as page-scoped. Re-run `typer_detect_bubbles` after opening another page or materially changing the document.
- Preserve script punctuation, capitalization, markdown emphasis, and speaker/style prefixes as interpreted by TypeR.
- Use one dialogue per independent bubble. For connected double bubbles returned as two detections, map two consecutive dialogues unless visual reading makes another mapping clear.
- Skip narration boxes, SFX, handwritten notes, or existing lettered elements unless the user included matching script lines or requested them.
- When detections miss a bubble, estimate document-space `bounds` from the page image when reliable. Otherwise ask for a Photoshop selection, then use `typer_paste_text`.
- Prefer a confident autonomous choice over pausing for minor typography taste. Surface only material ambiguity that could swap speakers/dialogue or damage a saved page.

## Typography rules

- Reuse an existing TypeR style whenever possible; it carries the project font, stroke, paragraph mode, direction, and team conventions.
- Infer style from line metadata before appearance. A line's `style_id` or prefix outranks a visually similar font.
- Never choose a new font from its name alone. Preview 4-12 plausible candidates with the target dialogue (including accents, punctuation, case, and numerals when relevant). Judge voice, weight, width, x-height, readability at bubble scale, punctuation, and consistency with neighboring pages. Use the selected sheet entry's exact PostScript name in `typer_save_style`.
- Use uppercase preview only for text that will actually be uppercase. For whispers, narration, shouts, radio/phone, and SFX, preview a sample matching that semantic role.
- Treat TextShapeR scores and `fits` as evidence, not the final choice. In `typer_preview_text_shapes`, compare candidates in the real font and bubble crop. Choose the one whose widths follow the contour, preserves natural phrase groups, avoids short/orphaned lines, and has no red overflow. Apply the selected metadata text explicitly and verify it on the rendered page.
- Center dialogue optically inside the main balloon body, not merely inside the bounding rectangle or tail-distorted whitespace. `typer_typeset_bubbles` provides the automatic first pass. After manual edits, geometry changes, or size changes, call `typer_align` with `layerId` and reliable bubble bounds, inspect the full page, then use `typer_nudge_layer` for any remaining visible offset. Move in small increments and verify after each move.
- Treat text size as a page- and chapter-wide composition system, not as an independent fit parameter for each bubble. Establish a normal-dialogue baseline from the project style and neighboring pages, then keep comparable dialogue in a narrow, visually consistent range.
- Judge size at full-page scale. Text must remain comfortably readable without overpowering the artwork or filling every available corner of a bubble; preserve balanced negative space.
- Do not enlarge a short line merely to fill an empty bubble, and do not shrink a long line merely to make it fit. First try a better TextShapeR variant, correct bounds or padding, and re-center the block. Use `typer_change_text_size` only when those corrections are insufficient, with small deliberate adjustments rather than accumulating arbitrary deltas.
- Before saving, compare all ordinary-dialogue bubbles together and correct accidental size jumps. Deliberate bold or emphatic text may depart from the baseline when the script/style calls for it, but the exception must be intentional, controlled, and still readable.
- Never compensate for a wrong bubble assignment with extreme scaling.

## Completion criteria

Finish a page only when:

- each intended bubble has exactly one appropriate text layer;
- dialogue order matches the page and script;
- font/style and direction are consistent with line metadata;
- text stays inside the bubble with balanced line shape and spacing;
- ordinary dialogue sizes are visually harmonious across the page and chapter, with only deliberate bold/emphasis breaking the baseline;
- layers are optically centered after manual correction where automatic centering was insufficient, and no obvious untranslated target was skipped;
- the document has been saved successfully.

Read [tool-contract.md](references/tool-contract.md) when handling custom styles, manual selections, layer repair, or tool errors. Read [typesetting-heuristics.md](references/typesetting-heuristics.md) when bubble order, dialogue mapping, or typography choice is ambiguous.


## MCP v2: measured composition and recovery

- Read `typer_get_document` first. Pass its `documentId` to every document write and preferably every document read. Keep `expectedDocumentKey` when continuing a session.
- Assign a unique `requestId` to each mutation. Retry only with the identical ID and arguments. On a timeout, query `typer_get_operation`; pending/interrupted/failed outcomes are not permission to blindly create another batch.
- Use `typer_get_region_image` for detail. Canvas contact sheets are estimates. Use `typer_measure_text` or `typer_fit_text` to measure candidates in real Photoshop before applying them. Copy the returned exact text and typography into batch entries with `autoShape:false`.
- A fit is a rectangular bound check; inspect the bubble contour, tails, emphasis and optical balance yourself. Text must remain faithful to the script. Fit results never authorize rewriting dialogue.
- Batch results contain stable `layerId` values and automatically persist associations for entries with `lineIndex`. Review with `typer_review_page`, then inspect image crops. Missing links are reported as missing dialogue; associate pre-existing text using `typer_set_progress`.
- `typer_edit_layer` accepts absolute point sizes, leading, tracking, scales, baseline shift, outline and UTF-16 text ranges. `typer_capture_style` can copy a reference layer. `typer_transform_layer` handles rotation, paragraph boxes and editable warps.
- Use `typer_manage_layers` for explicit group/layer changes, `typer_set_page_mapping` for chapter inputs, and `typer_manage_tabs` for script tabs. `typer_edit_script_lines` requires the script revision from `get_state`.
- Undo the exact operation using `typer_undo` and its `operationId`. Newer Photoshop edits block undo rather than discarding them. Panel reloads preserve request results but invalidate host checkpoints.
- Save layered PSDs with `typer_save_document`, export delivery images with `typer_export_page`, then navigate. MCP navigation keeps existing documents open; save them explicitly.
- Train with `typer_learning` only from explicitly validated links, never from unreviewed AI output. A changed script or layer invalidates that validation.
