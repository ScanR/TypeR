# typer-mcp

**MCP v2:** 47 tools, a shared dependency-free transport, document-checked
writes and retry IDs. See [the v2 workflow and tool guide](../docs/mcp/AI_TYPESETTING_V2.md).
The schemas returned by `tools/list` are authoritative. Mutations require
`requestId`; document writes require `documentId` from `typer_get_document`.

MCP stdio server that lets an LLM drive the TypeR Photoshop panel: read/write
the script, look at the current page, detect speech bubbles, and typeset
dialogue — all by proxying to the HTTP bridge exposed by the TypeR CEP panel
(`app_src/mcpBridge.jsx`). See `../docs/mcp/BRIDGE_API.md` for the full wire
contract.

## Prerequisites

- Photoshop running with the **TypeR panel open**. The panel hosts the
  HTTP bridge; without it, every tool call fails with a clear
  "TypeR bridge not running" error.
- Node.js >= 18 (uses the native `fetch`/`AbortController`).

## Install (optional for smoke-test package metadata)

```bash
cd mcp
npm install
```

The server itself has no third-party npm dependencies. Both entry points use
`plugins/typer/mcp/contract.mjs` and `plugins/typer/mcp/server.mjs`.

## Run standalone

```bash
npm start
```

This starts the MCP server on stdio. It re-reads the bridge's discovery file
(`<os.tmpdir()>/typer-mcp-bridge.json`) before every tool call, so it always
picks up the current port/token even if the panel was reloaded.

## Configure in Claude Code

```bash
claude mcp add typer -- node /absolute/path/to/mcp/server.js
```

Or via `.mcp.json`:

```json
{
  "mcpServers": {
    "typer": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.js"]
    }
  }
}
```

## Tools

| Tool | Description |
| --- | --- |
| `typer_status` | Bridge health + panel status (line/style counts, current line, direction). |
| `typer_get_state` | Full panel state: lines, current line/style, images, settings. |
| `typer_set_script` | Replace the panel's full script text. |
| `typer_set_current_line` | Jump the current-line cursor to a raw index. |
| `typer_next_line` / `typer_prev_line` | Move the current-line cursor. |
| `typer_get_styles` | List all text styles and the current one. |
| `typer_select_style` | Set the current text style by id. |
| `typer_search_fonts` / `typer_save_style` | Find installed Photoshop fonts and create/update TypeR styles. |
| `typer_preview_fonts` | Render a visual contact sheet from installed fonts and contextual dialogue. |
| `typer_get_document` | Read the active PSD, dimensions, save state, and active layer. |
| `typer_get_page_image` | Export a snapshot of the active document and return it as an image. |
| `typer_detect_bubbles` | Auto-detect speech bubbles with suggested lines, in reading order. |
| `typer_typeset_bubbles` | Dry-run or create a page batch with automatic TextShapeR shaping. |
| `typer_paste_text` | Paste one piece of text into explicit bounds or the live selection. |
| `typer_apply_text` | Apply new text/style to the active text layer. |
| `typer_align` | Center the active text layer in the current selection. |
| `typer_change_text_size` | Grow/shrink the active text layer's font size. |
| `typer_shape_text` | Generate line-break variants for dialogue text (TextShapeR). |
| `typer_preview_text_shapes` | Visually compare TextShapeR variants in the real font and bubble crop. |
| `typer_get_layers` | Read all rendered text layers of the document. |
| `typer_select_layer` / `typer_edit_layer` | Target and repair one rendered text layer. |
| `typer_next_page` / `typer_previous_page` | Navigate pages, opening the mapped image. |
| `typer_open_image` | Open a specific image by path or page number. |
| `typer_save_document` | Save the active layered PSD, optionally as a copy. |
| `typer_deselect` | Clear the Photoshop marquee selection. |
| `typer_undo` | Undo the last TypeR change. |

## Testing

```bash
npm test
```

Runs `test/smoke.js`, which spawns the server, drives it over raw stdio
JSON-RPC (`initialize` / `notifications/initialized` / `tools/list` /
`tools/call`), and stands up a fake local HTTP bridge to verify a real
`typer_status` round trip and the "bridge not running" error path. No running
Photoshop is required.

## Security

The bridge only listens on `127.0.0.1` and requires a per-session token
(`X-TypeR-Token`, rotated on every panel reload) that this server reads from
a discovery file in the OS temp directory. Nothing here is exposed to the
network.
