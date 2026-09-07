#!/usr/bin/env node

// Dependency-free MCP proxy packaged with the TypeR Codex plugin. The TypeR
// Photoshop panel owns the authenticated localhost bridge; this process only
// translates MCP stdio calls to that bridge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_NAME = "typer-mcp";
const SERVER_VERSION = "2.0.0";
const RPC_TIMEOUT_MS = Math.max(10_000, Number(process.env.TYPER_MCP_TOOL_TIMEOUT_MS) || 130_000);
const DISCOVERY_PATH = process.env.TYPER_MCP_DISCOVERY || path.join(os.tmpdir(), "typer-mcp-bridge.json");
const BRIDGE_ERROR = "TypeR bridge not running. Open Photoshop with the TypeR panel  and retry.";

import contract from "./contract.mjs";
const { specs, tools, validate } = contract;
const specByName = new Map(specs.map((spec) => [spec[0], spec]));

function readDiscovery() {
  try {
    const info = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
    if (typeof info.port !== "number" || typeof info.token !== "string") throw new Error();
    return info;
  } catch {
    throw new Error(BRIDGE_ERROR);
  }
}

async function requestBridge(route, options = {}, info = readDiscovery()) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}${route}`, { ...options, signal: controller.signal });
    if (response.status === 403) throw new Error("TypeR bridge rejected a stale token. Reload the TypeR panel and retry.");
    if (!response.ok) throw new Error(`TypeR bridge returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("TypeR bridge timed out while Photoshop was processing the operation.");
    if (error?.message?.startsWith("TypeR bridge")) throw error;
    throw new Error(BRIDGE_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

async function callBridge(command, params = {}) {
  const discovery = readDiscovery();
  const { token } = discovery;
  const body = await requestBridge("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TypeR-Token": token },
    body: JSON.stringify({ command, params }),
  }, discovery);
  if (body?.ok !== true) throw new Error(body?.error || `TypeR command ${command} failed.`);
  return body.result;
}

const textContent = (value) => ({ type: "text", text: JSON.stringify(value, null, 2) });

async function callTool(name, args) {
  const spec = specByName.get(name);
  if (!spec) throw new Error(`Unknown TypeR tool: ${name}`);
  const [, command, , schema, mode] = spec;
  validate(schema, args);
  if (mode === "status") {
    const [health, status] = await Promise.all([requestBridge("/health"), callBridge(command, args)]);
    return { content: [textContent({ health, status })], structuredContent: { health, status } };
  }
  const result = await callBridge(command, args);
  if (mode === "image") {
    const data = fs.readFileSync(result.path);
    const metadata = { ...result };
    if (result.temporary === true) { try { fs.unlinkSync(result.path); } catch {} }
    delete metadata.path;
    return {
      content: [
        { type: "image", data: data.toString("base64"), mimeType: "image/png" },
        textContent(metadata),
      ],
      structuredContent: metadata,
    };
  }
  return { content: [textContent(result)], structuredContent: result };
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function respond(message) {
  if (!message || message.jsonrpc !== "2.0" || message.id === undefined) return;
  try {
    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: "Call typer_status and typer_get_document first. Supply documentId and a unique requestId for writes. After a timeout query typer_get_operation using that ID; never blindly retry under a new ID. Inspect crops, reuse styles and measure or fit text with Photoshop. Stay inside the current script page. Batch create, review, repair targeted layers, save, then navigate. Canvas previews are estimates. Only the user or explicit review may validate training examples.",
      };
    } else if (message.method === "ping") {
      result = {};
    } else if (message.method === "tools/list") {
      result = { tools };
    } else if (message.method === "tools/call") {
      result = await callTool(message.params?.name, message.params?.arguments || {});
    } else {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    if (message.method === "tools/call") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error?.message || String(error) }], isError: true } });
    } else {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error?.message || String(error) } });
    }
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        void respond(JSON.parse(line));
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
    }
    newline = buffer.indexOf("\n");
  }
});
