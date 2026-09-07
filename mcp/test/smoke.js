#!/usr/bin/env node
// Smoke test for the TypeR MCP server. Talks raw JSON-RPC over stdio to
// mcp/server.js without relying on a client SDK, then spins up a
// fake HTTP bridge and exercises one real tool call end to end.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = process.env.TYPER_MCP_SERVER_PATH || path.join(__dirname, "..", "server.js");

const EXPECTED_TOOLS = [
  "typer_status",
  "typer_get_state",
  "typer_set_script",
  "typer_set_current_line",
  "typer_next_line",
  "typer_prev_line",
  "typer_get_styles",
  "typer_select_style",
  "typer_search_fonts",
  "typer_preview_fonts",
  "typer_save_style",
  "typer_get_document",
  "typer_get_page_image",
  "typer_detect_bubbles",
  "typer_typeset_bubbles",
  "typer_paste_text",
  "typer_apply_text",
  "typer_align",
  "typer_nudge_layer",
  "typer_change_text_size",
  "typer_shape_text",
  "typer_preview_text_shapes",
  "typer_get_layers",
  "typer_select_layer",
  "typer_edit_layer",
  "typer_next_page",
  "typer_previous_page",
  "typer_open_image",
  "typer_save_document",
  "typer_deselect",
  "typer_undo",
  "typer_get_region_image", "typer_measure_text", "typer_fit_text", "typer_capture_style",
  "typer_transform_layer", "typer_manage_layers", "typer_set_page_mapping", "typer_manage_tabs",
  "typer_edit_script_lines", "typer_get_progress", "typer_set_progress", "typer_review_page",
  "typer_get_operation", "typer_export_page", "typer_sample_bubble", "typer_learning",
];

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

/** Minimal newline-delimited JSON-RPC client wrapping a spawned server process. */
function createClient(env) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });

  let buffer = "";
  const pending = new Map();
  let nextId = 1;
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  function send(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for response to ${method}`));
      }, 15_000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  function getStderr() {
    return stderr;
  }

  function stop() {
    child.kill();
  }

  return { send, notify, stop, getStderr };
}

async function main() {
  // --- Part 1: handshake + tools/list, no bridge running yet. ---
  const discoveryPath = path.join(os.tmpdir(), `typer-mcp-bridge-smoke-${process.pid}.json`);
  if (fs.existsSync(discoveryPath)) fs.unlinkSync(discoveryPath);

  const client = createClient({ TYPER_MCP_DISCOVERY: discoveryPath });

  try {
    const initResponse = await client.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
    });
    if (initResponse.result?.serverInfo?.name === "typer-mcp") {
      pass("initialize handshake succeeded");
    } else {
      fail(`initialize response missing serverInfo.name: ${JSON.stringify(initResponse)}`);
    }

    client.notify("notifications/initialized", {});

    const listResponse = await client.send("tools/list", {});
    const tools = listResponse.result?.tools ?? [];
    const names = new Set(tools.map((t) => t.name));
    const missing = EXPECTED_TOOLS.filter((name) => !names.has(name));
    if (missing.length === 0 && tools.length >= EXPECTED_TOOLS.length) {
      pass(`tools/list returned all ${EXPECTED_TOOLS.length} expected typer_ tools`);
    } else {
      fail(`tools/list missing tools: ${missing.join(", ")}`);
    }
    const batchTool = tools.find((tool) => tool.name === "typer_typeset_bubbles");
    const alignTool = tools.find((tool) => tool.name === "typer_align");
    const fontPreviewTool = tools.find((tool) => tool.name === "typer_preview_fonts");
    const shapePreviewTool = tools.find((tool) => tool.name === "typer_preview_text_shapes");
    if (batchTool?.inputSchema?.properties?.dryRun && batchTool?.inputSchema?.properties?.autoShape) {
      pass("batch typesetting exposes dry-run and automatic TextShapeR controls");
    } else {
      fail("typer_typeset_bubbles is missing dryRun/autoShape schema fields");
    }
    if (alignTool?.inputSchema?.properties?.bounds) {
      pass("alignment accepts explicit bubble bounds");
    } else {
      fail("typer_align is missing explicit bounds support");
    }
    const nudgeTool = tools.find((tool) => tool.name === "typer_nudge_layer");
    if (nudgeTool?.inputSchema?.properties?.layerId && nudgeTool?.inputSchema?.properties?.deltaX && nudgeTool?.inputSchema?.properties?.deltaY) {
      pass("optical centering exposes targeted layer offsets");
    } else {
      fail("typer_nudge_layer is missing targeted offset fields");
    }
    if (fontPreviewTool?.inputSchema?.properties?.fontPostScriptNames && fontPreviewTool?.inputSchema?.properties?.text) {
      pass("font preview exposes shortlist and contextual sample controls");
    } else {
      fail("typer_preview_fonts is missing shortlist/context schema fields");
    }
    if (shapePreviewTool?.inputSchema?.properties?.bounds && shapePreviewTool?.inputSchema?.properties?.styleId) {
      pass("TextShapeR preview exposes real bubble bounds and style controls");
    } else {
      fail("typer_preview_text_shapes is missing bounds/style schema fields");
    }

    const invalid = await client.send("tools/call", { name: "typer_edit_layer", arguments: { layerId: 1, documentId: 1, requestId: "invalid", typography: { fontSize: -10 } } });
    if (invalid.result?.isError && invalid.result.content[0].text.includes("out of range")) pass("invalid typography is rejected before contacting the bridge");
    else fail("invalid typography was not rejected by the shared validator");
    const unsafe = await client.send("tools/call", { name: "typer_typeset_bubbles", arguments: { entries: [{ bounds: { left: 0, top: 0, right: 100, bottom: 100 } }] } });
    if (unsafe.result?.isError && unsafe.result.content[0].text.includes("documentId")) pass("document writes require explicit document identity");
    else fail("document identity was not required");

    // --- Part 2: fake HTTP bridge + typer_status tool call. ---
    const token = "smoke-test-token";
    const bridgeServer = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, service: "typer-mcp-bridge", version: "3.0.0-smoke" }));
        return;
      }
      if (req.method === "POST" && req.url === "/rpc") {
        if (req.headers["x-typer-token"] !== token) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "forbidden" }));
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const parsed = JSON.parse(body || "{}");
          if (parsed.command === "status") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                ok: true,
                result: {
                  version: "3.0.0-smoke",
                  linesTotal: 3,
                  currentLineIndex: 0,
                  stylesTotal: 2,
                  multiBubbleMode: false,
                  storedSelections: 0,
                  direction: "ltr",
                  imagesTotal: 1,
                },
              })
            );
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "unknown_command" }));
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((resolve) => bridgeServer.listen(0, "127.0.0.1", resolve));
    const bridgePort = bridgeServer.address().port;

    fs.writeFileSync(
      discoveryPath,
      JSON.stringify({
        port: bridgePort,
        token,
        pid: process.pid,
        version: "3.0.0-smoke",
        startedAt: Date.now(),
      })
    );

    const callResponse = await client.send("tools/call", {
      name: "typer_status",
      arguments: {},
    });

    const result = callResponse.result;
    if (result && result.isError) {
      fail(`typer_status returned isError: ${JSON.stringify(result)}`);
    } else {
      const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (parsed?.status?.linesTotal === 3 && parsed?.health?.ok === true) {
        pass("typer_status round-tripped through fake bridge correctly");
      } else {
        fail(`typer_status content did not match expectations: ${text}`);
      }
    }

    // --- Part 3: bridge unreachable case (no discovery file). ---
    fs.unlinkSync(discoveryPath);
    const missingBridgeResponse = await client.send("tools/call", {
      name: "typer_status",
      arguments: {},
    });
    const missingResult = missingBridgeResponse.result;
    const missingText = missingResult?.content?.find((c) => c.type === "text")?.text ?? "";
    if (missingResult?.isError && missingText.includes("TypeR bridge not running")) {
      pass("typer_status reports a clear error when the bridge is unreachable");
    } else {
      fail(`Expected a clear bridge-unreachable error, got: ${JSON.stringify(missingResult)}`);
    }

    bridgeServer.close();
  } finally {
    client.stop();
    if (fs.existsSync(discoveryPath)) {
      try {
        fs.unlinkSync(discoveryPath);
      } catch {
        // ignore
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
