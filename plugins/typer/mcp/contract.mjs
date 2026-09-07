// Shared by the packaged server, standalone entry point and CEP bridge.
const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const number = (description, extra = {}) => ({ type: "number", description, ...extra });
const integer = (description, extra = {}) => ({ type: "integer", description, ...extra });
const boolean = (description) => ({ type: "boolean", description });
const bounds = object({
  left: number("Left edge in document pixels."),
  top: number("Top edge in document pixels."),
  right: number("Right edge in document pixels."),
  bottom: number("Bottom edge in document pixels."),
}, ["left", "top", "right", "bottom"]);
const profile = string("TextShapeR profile.", { enum: ["balanced", "tall", "wide"] });
const styleProperties = {
  styleId: string("Existing style ID to update; omit to create."),
  name: string("Style name."),
  fontPostScriptName: string("Installed Photoshop PostScript font name."),
  fontFamily: string("Installed font family."),
  fontStyle: string("Font face/style."),
  fontSize: number("Font size.", { exclusiveMinimum: 0 }),
  alignment: string("Paragraph alignment.", { enum: ["left", "center", "right", "justifyAll", "justifyLeft", "justifyCenter", "justifyRight"] }),
  color: object({ r: number("Red.", { minimum: 0, maximum: 255 }), g: number("Green.", { minimum: 0, maximum: 255 }), b: number("Blue.", { minimum: 0, maximum: 255 }) }, ["r", "g", "b"]),
  pointText: boolean("Use Photoshop point text."),
  select: boolean("Select the saved style; defaults to true."),
};
const batchEntry = object({
  bounds,
  lineIndex: integer("Raw TypeR script line index."),
  text: string("Explicit text; overrides lineIndex."),
  styleId: string("TypeR style ID override."),
  autoShape: boolean("Run TextShapeR for this bubble."),
  forceShape: boolean("Reshape text containing explicit line breaks."),
  allowHyphenation: boolean("Allow TextShapeR hyphenation."),
  profile,
}, ["bounds"]);

const specs = [
  ["typer_status", "status", "Check the TypeR bridge and return current line, style, direction, and page counts. Call this first.", object(), "status"],
  ["typer_get_state", "get_state", "Read TypeR script state, cursor, styles, settings, image mappings, and usable lines.", object({ includeText: boolean("Include the full raw TextBlock script.") })],
  ["typer_set_script", "set_text", "Replace the complete TypeR TextBlock script.", object({ text: string("Full script, one dialogue per line with optional Page markers and style prefixes.") }, ["text"])],
  ["typer_set_current_line", "set_current_line", "Select a raw TextBlock line index.", object({ rawIndex: integer("Raw script line index.", { minimum: 0 }) }, ["rawIndex"])],
  ["typer_next_line", "next_line", "Advance to the next TextBlock line.", object()],
  ["typer_prev_line", "prev_line", "Move to the previous TextBlock line.", object()],
  ["typer_get_styles", "get_styles", "List TypeR styles with IDs, prefixes, font, size, alignment, color, and point-text mode.", object()],
  ["typer_select_style", "select_style", "Select a TypeR style for subsequent operations.", object({ styleId: string("Style ID returned by typer_get_styles.") }, ["styleId"])],
  ["typer_search_fonts", "search_fonts", "Search fonts installed in Photoshop by family, face, name, or PostScript name.", object({ query: string("Case-insensitive search."), limit: integer("Maximum results.", { minimum: 1, maximum: 100 }) })],
  ["typer_preview_fonts", "preview_fonts", "Render a visual contact sheet with the actual installed Photoshop fonts so their tone, weight, width, and readability can be compared.", object({ fontPostScriptNames: { type: "array", minItems: 1, maxItems: 24, items: { type: "string" }, description: "Ordered shortlist returned by typer_search_fonts." }, query: string("Alternative search when no shortlist is provided."), text: string("Contextual sample dialogue to render.", { maxLength: 500 }), limit: integer("Maximum fonts.", { minimum: 1, maximum: 24 }), columns: integer("Sheet columns.", { minimum: 1, maximum: 3 }), fontSize: integer("Sample size in pixels.", { minimum: 18, maximum: 96 }), width: integer("Output image width.", { minimum: 700, maximum: 2400 }), uppercase: boolean("Render uppercase."), theme: string("Sheet theme.", { enum: ["light", "dark"] }) }), "image"],
  ["typer_save_style", "save_style", "Create a TypeR style or update one by ID using an installed Photoshop font.", object(styleProperties)],
  ["typer_get_document", "document_info", "Read the active Photoshop document, dimensions, save state, and active layer.", object()],
  ["typer_get_page_image", "get_snapshot", "Render the active Photoshop page for visual inspection.", object({ maxDim: integer("Maximum rendered dimension.", { minimum: 300, maximum: 4000 }) }), "image"],
  ["typer_detect_bubbles", "detect_bubbles", "Detect and order speech bubbles, returning document bounds and suggested script lines.", object({ sensitivity: integer("Detector sensitivity 1-10.", { minimum: 1, maximum: 10 }), rtl: boolean("Order right-to-left."), maxDim: integer("Maximum snapshot dimension.", { minimum: 300, maximum: 4000 }) })],
  ["typer_typeset_bubbles", "batch_paste", "Dry-run or create centered text layers for a whole page with automatic TextShapeR shaping.", object({ entries: { type: "array", minItems: 1, items: batchEntry, description: "One entry per bubble." }, pointText: boolean("Override point/paragraph text."), padding: number("Inner padding.", { minimum: 0 }), advanceLines: boolean("Advance the TextBlock cursor."), autoShape: boolean("Run TextShapeR by default."), allowHyphenation: boolean("Allow hyphenation."), profile, dryRun: boolean("Compute placements without changing Photoshop.") }, ["entries"])],
  ["typer_paste_text", "paste_text", "Paste one styled text layer into explicit bounds or the current Photoshop selection.", object({ text: string("Text to paste."), styleId: string("TypeR style ID."), bounds, pointText: boolean("Override point/paragraph text."), padding: number("Inner padding.", { minimum: 0 }) }, ["text"])],
  ["typer_apply_text", "apply_to_active", "Apply text and/or a TypeR style to the active Photoshop text layer.", object({ text: string("Replacement text."), styleId: string("Style ID to apply.") })],
  ["typer_align", "align_active", "Automatically center a text layer inside explicit bubble bounds or the current selection.", object({ layerId: integer("Optional Photoshop layer ID to target."), resizeTextBox: boolean("Resize paragraph text before centering."), padding: number("Inner padding.", { minimum: 0 }), bounds })],
  ["typer_nudge_layer", "nudge_layer", "Manually correct optical centering by moving a text layer in document pixels; positive X moves right and positive Y moves down.", object({ layerId: integer("Photoshop layer ID returned by typer_get_layers."), deltaX: number("Horizontal offset in document pixels; positive moves right."), deltaY: number("Vertical offset in document pixels; positive moves down.") }, ["layerId"])],
  ["typer_change_text_size", "change_text_size", "Grow or shrink a targeted text layer by a signed size delta.", object({ layerId: integer("Optional Photoshop layer ID to target."), delta: number("Signed font-size delta.") }, ["delta"])],
  ["typer_shape_text", "shape_text", "Generate ranked TextShapeR line-break variants for a bubble shape.", object({ text: string("Dialogue text."), width: number("Bubble width.", { exclusiveMinimum: 0 }), height: number("Bubble height.", { exclusiveMinimum: 0 }), limit: integer("Maximum variants.", { minimum: 1, maximum: 12 }), allowHyphenation: boolean("Allow hyphenation."), manualLineCount: integer("Force a line count.", { minimum: 1 }), profile, shapeProfile: { type: "object", description: "Normalized bubble outline rows." } }, ["text"])],
  ["typer_preview_text_shapes", "preview_text_shapes", "Render TextShapeR variants in the actual TypeR font and size, overlaid on the real Photoshop bubble crop when bounds are supplied.", object({ text: string("Dialogue; omit when lineIndex is supplied."), lineIndex: integer("Raw TypeR line index.", { minimum: 0 }), styleId: string("TypeR style override."), bounds, width: number("Bubble width without bounds.", { exclusiveMinimum: 0 }), height: number("Bubble height without bounds.", { exclusiveMinimum: 0 }), shapeProfile: { type: "object", description: "Normalized bubble outline rows." }, shapeSamples: integer("Outline sample rows.", { minimum: 7, maximum: 31 }), limit: integer("Variants on the sheet.", { minimum: 2, maximum: 12 }), allowHyphenation: boolean("Allow hyphenation."), profile, fontSize: number("Preview size override.", { minimum: 6, maximum: 300 }), lineHeight: number("Line-height multiplier.", { minimum: 0.8, maximum: 1.8 }), columns: integer("Sheet columns.", { minimum: 1, maximum: 3 }), sheetWidth: integer("Output width.", { minimum: 800, maximum: 2400 }), theme: string("Sheet theme.", { enum: ["light", "dark"] }), maxDim: integer("Page snapshot maximum dimension.", { minimum: 600, maximum: 3000 }) }), "image"],
  ["typer_get_layers", "get_layers", "List rendered Photoshop text layers with stable IDs, text, bounds, and optional surrounding bubbles.", object({ scanBubbles: boolean("Scan the bubble around each layer; slower.") })],
  ["typer_select_layer", "select_layer", "Select a Photoshop text layer by stable ID.", object({ layerId: integer("Layer ID returned by typer_get_layers.") }, ["layerId"])],
  ["typer_edit_layer", "edit_layer", "Edit, restyle, reshape, and re-center one Photoshop text layer by ID.", object({ layerId: integer("Photoshop layer ID."), text: string("Replacement text."), styleId: string("TypeR style ID."), autoShape: boolean("Run TextShapeR."), allowHyphenation: boolean("Allow hyphenation."), profile, align: boolean("Re-center after editing."), resizeTextBox: boolean("Resize paragraph text box."), padding: number("Inner padding.", { minimum: 0 }) }, ["layerId"])],
  ["typer_next_page", "next_page", "Advance to the next Page marker and open its mapped PSD/image.", object()],
  ["typer_previous_page", "previous_page", "Return to the previous Page marker and open its mapped PSD/image.", object()],
  ["typer_open_image", "open_image", "Open an explicit Photoshop file or a page from TypeR's mapped image list.", object({ path: string("Absolute PSD/image path."), page: integer("Mapped page number.") })],
  ["typer_save_document", "save_document", "Save the active layered PSD, optionally to another path or as a copy.", object({ path: string("Optional destination PSD path."), asCopy: boolean("Save as copy.") })],
  ["typer_deselect", "deselect", "Clear the active Photoshop selection.", object()],
  ["typer_undo", "undo", "Undo the last TypeR Photoshop change.", object()],
];

const strings = (description, maxItems = 100) => ({ type: "array", items: string(description), maxItems });
const ids = { type: "array", items: integer("Stable Photoshop layer ID."), minItems: 1, maxItems: 200 };
const shapeProfile = object({ rows: { type: "array", minItems: 2, maxItems: 100, items: object({
  y: number("Normalized height.", { minimum: 0, maximum: 1 }),
  width: number("Normalized usable width.", { minimum: 0, maximum: 1 }),
  left: number("Normalized left.", { minimum: 0, maximum: 1 }),
  right: number("Normalized right.", { minimum: 0, maximum: 1 }),
}, ["y", "width"]) } }, ["rows"]);
const typography = object({
  fontPostScriptName: string("Exact installed font face."),
  fontSize: number("Absolute font size in points.", { minimum: 1, maximum: 1000 }),
  leading: number("Fixed leading in points; disables automatic leading.", { minimum: 1, maximum: 2000 }),
  autoLeading: boolean("Use automatic leading."),
  tracking: number("Tracking in thousandths of an em.", { minimum: -500, maximum: 2000 }),
  horizontalScale: number("Horizontal scale, percent.", { minimum: 10, maximum: 300 }),
  verticalScale: number("Vertical scale, percent.", { minimum: 10, maximum: 300 }),
  baselineShift: number("Baseline shift in points.", { minimum: -1000, maximum: 1000 }),
  alignment: styleProperties.alignment,
  color: styleProperties.color,
  direction: string("Paragraph direction.", { enum: ["ltr", "rtl"] }),
  stroke: object({ enabled: boolean("Enable outline."), size: number("Outline pixels.", { minimum: 0, maximum: 100 }),
    opacity: number("Opacity percent.", { minimum: 0, maximum: 100 }), position: string("Stroke position.", { enum: ["inner", "center", "outer"] }), color: styleProperties.color }),
});
const textRuns = { type: "array", maxItems: 200, items: object({ from: integer("Start UTF-16 character offset.", { minimum: 0 }), to: integer("Exclusive end UTF-16 offset.", { minimum: 1 }), typography }, ["from", "to", "typography"]) };
const extend = (name, properties, required = []) => {
  const schema = specs.find(spec => spec[0] === name)[3];
  Object.assign(schema.properties, properties);
  schema.required.push(...required);
};
extend("typer_save_style", { ...typography.properties, prefixes: strings("Style prefix."), folderId: string("Existing style folder ID; empty string removes folder."), textType: string("Photoshop text mode.", { enum: ["point", "paragraph"] }) });
extend("typer_edit_layer", { bounds, typography, textRuns });
extend("typer_paste_text", { typography, autoShape: boolean("Generate line breaks; defaults to false for explicit text.") });
extend("typer_get_layers", { offset: integer("Pagination offset.", { minimum: 0 }), limit: integer("Page size.", { minimum: 1, maximum: 200 }), includeHidden: boolean("Include hidden text layers."), includeStyles: boolean("Include complete character and paragraph attributes.") });
Object.assign(batchEntry.properties, { shapeProfile, typography, bubbleId: string("Caller-defined stable bubble ID."), polygon: { type: "array", minItems: 3, maxItems: 128, items: object({ x: number("Document pixel X."), y: number("Document pixel Y.") }, ["x", "y"]) } });
extend("typer_typeset_bubbles", { allowCrossPage: boolean("Explicitly allow consuming script lines across page markers; defaults false.") });
extend("typer_undo", { operationId: string("Exact completed operation to undo; omit for latest MCP operation on this document.") });
extend("typer_set_script", { expectedScriptRevision: string("Revision from get_state; prevents overwriting concurrent script changes.") });

const fitProperties = { text: string("Dialogue; preserves wording and punctuation."), lineIndex: integer("Raw script line index.", { minimum: 0 }), styleId: string("TypeR style ID."), bounds, typography, shapeProfile,
  pointText: boolean("Point text or paragraph text."), padding: number("Inner margin in pixels.", { minimum: 0 }),
  minFontSize: number("Smallest permitted point size.", { minimum: 1, maximum: 1000 }), maxFontSize: number("Largest permitted point size.", { minimum: 1, maximum: 1000 }),
  allowHyphenation: boolean("Allow word hyphenation."), profile };
specs.push(
  ["typer_get_region_image", "get_region_image", "Render a precise Photoshop region at up to native resolution. Returns document coordinates and image dimensions.", object({ bounds, layerId: integer("Crop around this layer instead of explicit bounds."), margin: number("Extra margin in document pixels.", { minimum: 0, maximum: 2000 }), maxDim: integer("Maximum image dimension.", { minimum: 100, maximum: 4000 }) }), "image"],
  ["typer_measure_text", "measure_text", "Measure a composition using real Photoshop text on a disposable document. Reports actual point size, rendered bounds, line breaks, overflow and font substitution. Does not change the source PSD.", object(fitProperties)],
  ["typer_fit_text", "fit_text", "Compare a bounded set of line-break and size candidates using real Photoshop measurements. Returns exact text, typography and fit diagnostics; never applies or rewrites dialogue.", object({ ...fitProperties, candidates: integer("Maximum measured candidates.", { minimum: 1, maximum: 24 }), variants: integer("Line-break variants to compare.", { minimum: 1, maximum: 6 }) })],
  ["typer_capture_style", "capture_style", "Read the complete typography and outline of a reference text layer. Optionally save it as a new named TypeR style.", object({ layerId: integer("Reference text layer."), name: string("Name when saving."), save: boolean("Save as a new reusable style; defaults false."), prefixes: strings("Script prefix."), folderId: string("Existing folder ID.") }, ["layerId"])],
  ["typer_transform_layer", "transform_layer", "Move or rotate an editable text layer, scale it, resize its paragraph box, or apply a Photoshop text warp. Coordinates are document pixels, sizes are percentages.", object({ layerId: integer("Text layer ID."), x: number("Absolute left bound in pixels."), y: number("Absolute top bound in pixels."), rotation: number("Relative rotation in degrees.", { minimum: -180, maximum: 180 }), scaleX: number("Relative horizontal percent.", { minimum: 10, maximum: 400 }), scaleY: number("Relative vertical percent.", { minimum: 10, maximum: 400 }), width: number("Paragraph box width in pixels.", { minimum: 2 }), height: number("Paragraph box height in pixels.", { minimum: 2 }), warp: object({ style: string("Photoshop warp.", { enum: ["warpNone", "warpArc", "warpArcLower", "warpArcUpper", "warpArch", "warpBulge", "warpFlag", "warpWave", "warpFish", "warpRise", "warpFisheye", "warpInflate", "warpSqueeze", "warpTwist"] }), bend: number("Warp bend percent.", { minimum: -100, maximum: 100 }), horizontal: number("Horizontal distortion.", { minimum: -100, maximum: 100 }), vertical: number("Vertical distortion.", { minimum: -100, maximum: 100 }) }, ["style"]) }, ["layerId"])],
  ["typer_manage_layers", "manage_layers", "Inspect the complete layer tree, or explicitly create, rename, duplicate, move, hide/show or delete layers. Mutations are atomic and undoable.", object({ action: string("Operation.", { enum: ["list", "create_group", "rename", "duplicate", "move", "visibility", "delete"] }), layerIds: ids, parentId: integer("Target group; omit to use document root."), name: string("Group or layer name.", { minLength: 1, maxLength: 200 }), visible: boolean("Requested visibility."), offset: integer("Tree page offset.", { minimum: 0 }), limit: integer("Tree page size.", { minimum: 1, maximum: 500 }) }, ["action"])],
  ["typer_set_page_mapping", "set_page_mapping", "Replace the current tab's explicit page-to-PSD mappings. Does not open a document.", object({ images: { type: "array", maxItems: 5000, items: object({ page: integer("Page number.", { minimum: 1 }), path: string("Absolute local image/PSD path.", { minLength: 1 }) }, ["page", "path"]) } }, ["images"])],
  ["typer_manage_tabs", "manage_tabs", "List, create, switch or rename TypeR script tabs. Creating or switching a tab does not automatically open its PSD through the MCP.", object({ action: string("Tab operation.", { enum: ["list", "create", "switch", "rename"] }), tabId: string("Existing tab ID."), name: string("Tab name.", { minLength: 1 }), text: string("Initial script for a new tab.") }, ["action"])],
  ["typer_edit_script_lines", "edit_script_lines", "Replace a raw line range while checking the script revision. Invalidates affected script-to-layer review links.", object({ start: integer("First raw line.", { minimum: 0 }), deleteCount: integer("Number of raw lines to replace.", { minimum: 0 }), lines: strings("Replacement raw line.", 10000), expectedScriptRevision: string("Revision returned by get_state.") }, ["start", "deleteCount", "lines", "expectedScriptRevision"])],
  ["typer_get_progress", "get_progress", "Read persisted script-to-layer links and per-page review status for the active tab.", object()],
  ["typer_set_progress", "set_progress", "Associate a script line with a rendered layer or mark an existing association reviewed. Never automatically marks AI output as validated.", object({ layerId: integer("Rendered text layer."), lineIndex: integer("Raw script line.", { minimum: 0 }), bounds, bubbleId: string("Stable caller-defined bubble ID."), status: string("Review status.", { enum: ["placed", "needs_review", "validated"] }) }, ["layerId", "lineIndex", "status"])],
  ["typer_review_page", "review_page", "Compare current-page dialogue against persisted layer associations and real Photoshop bounds. Reports missing/duplicate text, stale links, margin overflow, collisions and missing fonts. Optical quality still requires image review.", object({ padding: number("Minimum inner margin in pixels.", { minimum: 0 }), includeImages: boolean("Reserved; use get_region_image for localized inspection.") })],
  ["typer_get_operation", "get_operation", "Recover the known result of a request after a timeout. Pending or interrupted operations must not be retried under a new ID.", object({ operationId: string("requestId supplied to the original mutation.") }, ["operationId"])],
  ["typer_export_page", "export_page", "Export the current page as PNG or JPEG without flattening or modifying the source PSD. Returns the actual output path.", object({ path: string("Absolute output path ending in .png, .jpg or .jpeg."), format: string("Export format.", { enum: ["png", "jpeg"] }), maxDim: integer("Optional downscale limit.", { minimum: 100, maximum: 30000 }), quality: integer("JPEG quality 0-12.", { minimum: 0, maximum: 12 }) }, ["path", "format"])],
  ["typer_sample_bubble", "sample_bubble", "Sample the bubble outline surrounding an existing text layer, or a bounded crop. Use supplied bounds to exclude a tail or split connected lobes; geometry is document-scoped.", object({ layerId: integer("Existing text layer to sample around."), bounds, samples: integer("Outline rows.", { minimum: 7, maximum: 31 }) })],
  ["typer_learning", "learning", "Inspect TextShapeR learning or learn from explicitly validated layer associations. Does not train on unreviewed AI output.", object({ action: string("Learning operation.", { enum: ["get", "learn_validated"] }), layerIds: ids }, ["action"])]
);
extend("typer_learning", { documentId: integer("Expected source document ID for learn_validated.") });

const readOnly = new Set(["status", "get_state", "get_styles", "search_fonts", "preview_fonts", "document_info", "get_snapshot", "detect_bubbles", "get_layers", "shape_text", "preview_text_shapes", "get_region_image", "measure_text", "fit_text", "get_progress", "review_page", "get_operation", "sample_bubble"]);
const panelOnly = new Set(["set_text", "set_current_line", "next_line", "prev_line", "select_style", "save_style", "set_page_mapping", "manage_tabs", "edit_script_lines", "learning"]);
const contextualRead = new Set(["get_snapshot", "get_layers", "detect_bubbles", "preview_text_shapes", "get_region_image", "measure_text", "fit_text", "review_page", "sample_bubble"]);
for (const spec of specs) {
  const [name, command, , schema] = spec;
  if ((!readOnly.has(command) && !panelOnly.has(command) && !["open_image", "next_page", "previous_page"].includes(command)) || contextualRead.has(command)) {
    schema.properties.documentId = integer("Expected active document ID from typer_get_document; a mismatch aborts before host work.");
    if (!readOnly.has(command)) schema.required.push("documentId");
  }
  if (!readOnly.has(command)) {
    schema.properties.requestId = string("Unique retry key. Reuse exactly the same ID and arguments after a timeout.", { minLength: 1, maxLength: 160 });
    schema.required.push("requestId");
  }
  if (contextualRead.has(command) || !readOnly.has(command)) schema.properties.expectedDocumentKey = string("Optional session-scoped document key returned by get_document.");
}

// Validate the subset of JSON Schema used by this contract at both entry points.
function validate(schema, value, at = "arguments") {
  const error = message => { throw new Error(`bad_params: ${at} ${message}`); };
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) error("must be an object");
    for (const key of schema.required || []) if (value[key] === undefined) error(`requires ${key}`);
    for (const key of Object.keys(value)) {
      if (schema.properties && schema.properties[key]) validate(schema.properties[key], value[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) error(`contains unknown field ${key}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) error("must be an array");
    if (schema.minItems != null && value.length < schema.minItems) error("has too few items");
    if (schema.maxItems != null && value.length > schema.maxItems) error("has too many items");
    value.forEach((item, index) => validate(schema.items, item, `${at}[${index}]`));
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) error(`must be a finite ${schema.type}`);
    if (schema.minimum != null && value < schema.minimum || schema.maximum != null && value > schema.maximum || schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) error("is out of range");
  } else if (typeof value !== schema.type) error(`must be a ${schema.type}`);
  if (schema.type === "string" && (schema.minLength != null && value.length < schema.minLength || schema.maxLength != null && value.length > schema.maxLength)) error("has invalid length");
  if (schema.enum && !schema.enum.includes(value)) error("has an unsupported value");
}

const tools = specs.map(([name, command, description, inputSchema]) => ({ name, title: name.replace(/^typer_/, "TypeR: ").replace(/_/g, " "), description, inputSchema,
  annotations: { readOnlyHint: readOnly.has(command), destructiveHint: !readOnly.has(command), openWorldHint: false } }));
export default { specs, tools, validate, readOnly: Array.from(readOnly), panelOnly: Array.from(panelOnly) };
