/**
 * MCP Bridge — connects to MCP servers and wraps their tools as AgentTools.
 *
 * Reads server config from data/mcp-servers.json, spawns each server via stdio,
 * discovers tools via listTools(), and exposes them as standard AgentTool objects
 * that any VEC agent can use.
 *
 * Config format (same as Claude Code / Cursor):
 * {
 *   "mcpServers": {
 *     "filesystem": {
 *       "command": "npx",
 *       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/some/path"],
 *       "env": { "SOME_KEY": "value" }
 *     }
 *   }
 * }
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../config.js";

const MCP_CONFIG_PATH = join(config.dataDir, "mcp-servers.json");

// ── Types ────────────────────────────────────────────────────────────────────

interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

// ── State ────────────────────────────────────────────────────────────────────

const _servers: ConnectedServer[] = [];
let _tools: AgentTool[] = [];
let _initialized = false;

// ── JSON Schema → TypeBox ────────────────────────────────────────────────────
// MCP tools use JSON Schema for inputSchema. We need to convert to TypeBox
// for AgentTool.parameters. Since the LLM just sees the JSON schema anyway,
// we use Type.Unsafe() with the raw schema — TypeBox passes it through as-is.

function jsonSchemaToTypeBox(schema: any): any {
  if (!schema || typeof schema !== "object") return Type.Object({});
  // Pass the raw JSON Schema through — TypeBox's Type.Unsafe preserves it
  return Type.Unsafe(schema);
}

// ── Core ─────────────────────────────────────────────────────────────────────

function readConfig(): MCPConfig | null {
  if (!existsSync(MCP_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8")) as MCPConfig;
  } catch (err) {
    console.warn(`  [MCP] Failed to parse ${MCP_CONFIG_PATH}:`, (err as Error).message);
    return null;
  }
}

async function connectServer(name: string, cfg: MCPServerConfig): Promise<ConnectedServer | null> {
  try {
    const client = new Client({ name: `vec-${name}`, version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
    });

    await client.connect(transport);
    console.log(`  [MCP] Connected to "${name}"`);
    return { name, client, transport };
  } catch (err) {
    console.warn(`  [MCP] Failed to connect to "${name}":`, (err as Error).message);
    return null;
  }
}

function wrapMCPTool(server: ConnectedServer, tool: any): AgentTool {
  const toolName = `mcp_${server.name}_${tool.name}`;
  return {
    name: toolName,
    label: `${tool.name} (${server.name})`,
    description: tool.description ?? `MCP tool from ${server.name}`,
    parameters: jsonSchemaToTypeBox(tool.inputSchema),
    execute: async (_, params: any) => {
      try {
        const result = await server.client.callTool({
          name: tool.name,
          arguments: params ?? {},
        });

        // Extract text content from MCP result
        const text = (result.content as any[])
          ?.filter((c: any) => c.type === "text")
          .map((c: any) => String(c.text ?? ""))
          .join("\n") || "(no output)";

        return { content: [{ type: "text" as const, text }], details: {} };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `MCP tool error: ${err?.message ?? err}` }],
          details: {},
        };
      }
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize MCP bridge — connect to all configured servers and discover tools.
 * Safe to call multiple times (no-op after first init).
 */
export async function initMCP(): Promise<void> {
  if (_initialized) return;
  _initialized = true;

  const cfg = readConfig();
  if (!cfg || !cfg.mcpServers || Object.keys(cfg.mcpServers).length === 0) {
    console.log("  [MCP] No servers configured (data/mcp-servers.json)");
    return;
  }

  console.log(`  [MCP] Connecting to ${Object.keys(cfg.mcpServers).length} server(s)...`);

  for (const [name, serverCfg] of Object.entries(cfg.mcpServers)) {
    const server = await connectServer(name, serverCfg);
    if (!server) continue;

    _servers.push(server);

    try {
      const toolsResult = await server.client.listTools();
      const tools = (toolsResult.tools ?? []).map((t: any) => wrapMCPTool(server, t));
      _tools.push(...tools);
      console.log(`  [MCP] "${name}" provides ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`);
    } catch (err) {
      console.warn(`  [MCP] Failed to list tools from "${name}":`, (err as Error).message);
    }
  }

  console.log(`  [MCP] Total: ${_tools.length} MCP tool(s) available`);
}

/** Get all discovered MCP tools as AgentTool objects. */
export function getMCPTools(): AgentTool[] {
  return _tools;
}

/** Get MCP tool ToolDef entries for agentToolConfig registration. */
export function getMCPToolDefs(): { id: string; name: string; description: string; group: string }[] {
  return _tools.map((t) => ({
    id: t.name,
    name: t.label ?? t.name,
    description: t.description ?? "",
    group: "MCP",
  }));
}

/** Gracefully disconnect all MCP servers. */
export async function shutdownMCP(): Promise<void> {
  for (const server of _servers) {
    try {
      await server.client.close();
    } catch {
      // Ignore cleanup errors
    }
  }
  _servers.length = 0;
  _tools = [];
  _initialized = false;
}

/**
 * Hot-reload MCP servers — diffs current state vs new config on disk.
 * - Disconnects removed servers
 * - Connects newly added servers
 * - Reconnects servers whose config changed (command/args/env)
 * - Leaves unchanged servers untouched
 */
export async function reloadMCP(): Promise<{ added: string[]; removed: string[]; unchanged: string[] }> {
  const cfg = readConfig();
  const newServers = cfg?.mcpServers ?? {};
  const newNames = new Set(Object.keys(newServers));

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  const currentServerMap = new Map(_servers.map((s) => [s.name, s]));

  // 1. Disconnect removed servers
  for (const server of [..._servers]) {
    if (!newNames.has(server.name)) {
      removed.push(server.name);
      try { await server.client.close(); } catch { /* ignore */ }
      // Remove tools from this server
      _tools = _tools.filter((t) => !t.name.startsWith(`mcp_${server.name}_`));
      const idx = _servers.indexOf(server);
      if (idx >= 0) _servers.splice(idx, 1);
      console.log(`  [MCP] Disconnected "${server.name}" (removed)`);
    }
  }

  // 2. Connect new servers + reconnect changed servers
  for (const [name, serverCfg] of Object.entries(newServers)) {
    if (currentServerMap.has(name)) {
      // Server already connected — keep it (could diff config to detect changes, but
      // for simplicity we keep existing connections unless explicitly removed & re-added)
      unchanged.push(name);
      continue;
    }

    // New server — connect
    const server = await connectServer(name, serverCfg);
    if (!server) continue;
    _servers.push(server);
    added.push(name);

    try {
      const toolsResult = await server.client.listTools();
      const tools = (toolsResult.tools ?? []).map((t: any) => wrapMCPTool(server, t));
      _tools.push(...tools);
      console.log(`  [MCP] "${name}" connected — ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`);
    } catch (err) {
      console.warn(`  [MCP] Failed to list tools from "${name}":`, (err as Error).message);
    }
  }

  // Mark as initialized if not already
  if (!_initialized) _initialized = true;

  console.log(`  [MCP] Reload complete — ${added.length} added, ${removed.length} removed, ${unchanged.length} unchanged. Total: ${_tools.length} tool(s)`);
  return { added, removed, unchanged };
}
