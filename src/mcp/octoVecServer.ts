/**
 * OCTO-VEC MCP Server
 *
 * Exposes the running OCTO-VEC agent runtime as MCP tools that Claude Code
 * (or any MCP client) can call directly.
 *
 * Usage (via .mcp.json or `claude mcp add`):
 *   command: "tsx"
 *   args:    ["src/mcp/octoVecServer.ts"]
 *   env:     { "VEC_API_URL": "http://localhost:3000" }
 *
 * The server communicates with the running OCTO-VEC dashboard API via HTTP.
 * Localhost requests are auto-authenticated — no API key needed.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = process.env.VEC_API_URL ?? "http://localhost:3000";

// ── Auth cookie cache ─────────────────────────────────────────────────────────

let _cookie = "";

async function apiGet(path: string): Promise<unknown> {
  await ensureAuth();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: _cookie },
  });
  if (res.status === 401) { _cookie = ""; await ensureAuth(); return apiGet(path); }
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  await ensureAuth();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: _cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { _cookie = ""; await ensureAuth(); return apiPost(path, body); }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(path: string): Promise<unknown> {
  await ensureAuth();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: { Cookie: _cookie },
  });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  return res.json();
}

async function ensureAuth(): Promise<void> {
  if (_cookie) return;
  const res = await fetch(`${BASE_URL}/api/auth/local-login`, { method: "POST" });
  const setCookie = res.headers.get("set-cookie") ?? "";
  _cookie = setCookie.split(";")[0] ?? "";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function text(obj: unknown): { content: { type: "text"; text: string }[] } {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2),
      },
    ],
  };
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "octo-vec",
  version: "1.0.0",
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "list_agents",
  "List all agents in the OCTO-VEC runtime with their current status (running / paused / stopped) and whether they are enabled.",
  {},
  async () => {
    const data = await apiGet("/api/agents/runtime") as { agents: unknown[] };
    return text(data.agents ?? data);
  }
);

server.tool(
  "get_agent_info",
  "Get detailed info about a specific agent including their employee profile, skills, department, and status.",
  { agent_id: z.string().describe("Agent ID e.g. 'maya', 'alex-dev'") },
  async ({ agent_id }) => {
    const employees = await apiGet("/api/employees") as unknown[];
    const runtime = await apiGet("/api/agents/runtime") as { agents: { agent_id: string }[] };
    const emp = (employees as { agent_key?: string }[]).find(e => e.agent_key === agent_id);
    const rt = runtime.agents.find(a => a.agent_id === agent_id);
    if (!emp && !rt) throw new Error(`Agent '${agent_id}' not found`);
    return text({ employee: emp ?? null, runtime: rt ?? null });
  }
);

server.tool(
  "send_message",
  "Send a message to an OCTO-VEC agent. The agent will process it on its next loop cycle.",
  {
    to: z.string().describe("Agent ID to send the message to (e.g. 'maya', 'pm', 'alex-dev')"),
    message: z.string().describe("The message content to send"),
  },
  async ({ to, message }) => {
    const result = await apiPost("/api/send-message", { to, message });
    return text(result);
  }
);

server.tool(
  "steer_agent",
  "Steer a running agent mid-task — inject a message that redirects or refines what the agent is currently doing without a full interrupt.",
  {
    agent_id: z.string().describe("Agent ID to steer"),
    message: z.string().describe("Steering instruction — what the agent should do instead or additionally"),
  },
  async ({ agent_id, message }) => {
    const result = await apiPost("/api/steer", { agent_id, message });
    return text(result);
  }
);

server.tool(
  "interrupt_agent",
  "Interrupt an agent, stopping its current task immediately. Optionally provide a reason.",
  {
    agent_id: z.string().describe("Agent ID to interrupt"),
    reason: z.string().optional().describe("Why you are interrupting this agent"),
  },
  async ({ agent_id, reason }) => {
    const result = await apiPost("/api/interrupt", { agent_id, reason });
    return text(result);
  }
);

server.tool(
  "pause_agent",
  "Pause an agent so it stops processing new messages until resumed.",
  { agent_id: z.string().describe("Agent ID to pause") },
  async ({ agent_id }) => {
    const result = await apiPost(`/api/agents/${agent_id}/pause`);
    return text(result);
  }
);

server.tool(
  "resume_agent",
  "Resume a previously paused agent.",
  { agent_id: z.string().describe("Agent ID to resume") },
  async ({ agent_id }) => {
    const result = await apiPost(`/api/agents/${agent_id}/resume`);
    return text(result);
  }
);

server.tool(
  "create_agent",
  "Create and start a new specialist agent from a role template.",
  {
    template: z.string().describe("Role template ID (e.g. 'developer', 'designer', 'qa')"),
    name: z.string().describe("Human name for the agent (e.g. 'Sam', 'Jordan')"),
    skills: z.array(z.string()).optional().describe("List of skill IDs to enable"),
    color: z.string().optional().describe("Hex color for agent avatar e.g. '#5b8def'"),
  },
  async ({ template, name, skills, color }) => {
    const result = await apiPost("/api/agents", { template, name, skills, color });
    return text(result);
  }
);

server.tool(
  "delete_agent",
  "Permanently remove an agent from the roster. This cannot be undone.",
  { agent_id: z.string().describe("Agent ID to remove") },
  async ({ agent_id }) => {
    const result = await apiDelete(`/api/agents/${agent_id}`);
    return text(result);
  }
);

server.tool(
  "list_role_templates",
  "List all available agent role templates you can use to create new agents.",
  {},
  async () => {
    const data = await apiGet("/api/role-templates");
    return text(data);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// TASK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "list_tasks",
  "List all tasks in the system. Optionally filter by agent or status.",
  {
    agent_id: z.string().optional().describe("Filter to tasks assigned to this agent"),
    status: z.enum(["todo", "in_progress", "completed", "failed"]).optional().describe("Filter by task status"),
  },
  async ({ agent_id, status }) => {
    const tasks = await apiGet("/api/tasks") as { agent_id?: string; status?: string }[];
    let filtered = tasks;
    if (agent_id) filtered = filtered.filter(t => t.agent_id === agent_id);
    if (status) filtered = filtered.filter(t => t.status === status || (status === "todo" && t.status === "pending"));
    return text(filtered);
  }
);

server.tool(
  "create_task",
  "Create a new task and assign it to an agent.",
  {
    description: z.string().describe("What the agent should do — be specific and actionable"),
    agent_id: z.string().describe("Agent ID to assign this task to"),
    priority: z.enum(["low", "medium", "high"]).default("medium").describe("Task priority"),
    scheduled_date: z.string().optional().describe("ISO date string for when to run this task (e.g. '2026-04-18')"),
  },
  async ({ description, agent_id, priority, scheduled_date }) => {
    // Use send-message which creates tasks through the PM, or direct API
    const result = await apiPost("/api/send-message", {
      to: agent_id,
      message: `[TASK] ${description}`,
    });
    return text({ ok: true, sent_to: agent_id, message: description, api_result: result });
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// MONITORING & EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "get_events",
  "Get the most recent system events — agent actions, messages sent, tool calls, errors.",
  { limit: z.number().default(30).describe("Max number of events to return") },
  async ({ limit }) => {
    const events = await apiGet("/api/events") as unknown[];
    return text(events.slice(0, limit));
  }
);

server.tool(
  "get_errors",
  "Get recent errors from the agent runtime, classified by type (rate_limit, timeout, network, quota, crashed).",
  {},
  async () => {
    const data = await apiGet("/api/errors");
    return text(data);
  }
);

server.tool(
  "get_chat_log",
  "Get the recent chat history between users and agents.",
  { limit: z.number().default(50).describe("Max messages to return") },
  async ({ limit }) => {
    const messages = await apiGet("/api/chat-log") as unknown[];
    return text(messages.slice(0, limit));
  }
);

server.tool(
  "get_message_flow",
  "Get the inter-agent message flow log — see how messages are routed between agents.",
  {},
  async () => {
    const data = await apiGet("/api/message-flow");
    return text(data);
  }
);

server.tool(
  "get_pending_approvals",
  "List all pending tool-use approvals waiting for human review.",
  {},
  async () => {
    const data = await apiGet("/api/approvals");
    return text(data);
  }
);

server.tool(
  "resolve_approval",
  "Approve or reject a pending agent tool-use request.",
  {
    id: z.string().describe("Approval ID from get_pending_approvals"),
    approved: z.boolean().describe("true to approve, false to reject"),
    message: z.string().optional().describe("Optional message to send back to the agent"),
  },
  async ({ id, approved, message }) => {
    const result = await apiPost("/api/approve", { id, approved, message });
    return text(result);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE & FILES
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "list_workspace_files",
  "List files and folders in the OCTO-VEC workspace directory tree.",
  {
    root: z.string().optional().describe("Subdirectory to list (relative to workspace root). Omit for root."),
  },
  async ({ root }) => {
    const path = root ? `?root=${encodeURIComponent(root)}` : "";
    const data = await apiGet(`/api/workspace-tree${path}`);
    return text(data);
  }
);

server.tool(
  "read_workspace_file",
  "Read the contents of a file in the workspace.",
  {
    path: z.string().describe("File path relative to the workspace root (e.g. 'projects/my-app/src/index.ts')"),
  },
  async ({ path }) => {
    const data = await apiGet(`/api/workspace-file?path=${encodeURIComponent(path)}`) as { content?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return text(data.content ?? data);
  }
);

server.tool(
  "write_workspace_file",
  "Write content to a file in the workspace. Creates the file if it doesn't exist.",
  {
    path: z.string().describe("File path relative to workspace root"),
    content: z.string().describe("File content to write"),
  },
  async ({ path, content }) => {
    const result = await apiPost("/api/workspace-save", { path, content });
    return text(result);
  }
);

server.tool(
  "get_git_status",
  "Get the git status of the workspace — current branch, staged, modified, and untracked files.",
  {
    root: z.string().optional().describe("Subdirectory root (relative to workspace). Omit for workspace root."),
  },
  async ({ root }) => {
    const q = root ? `?root=${encodeURIComponent(root)}` : "";
    const data = await apiGet(`/api/workspace-git-status${q}`);
    return text(data);
  }
);

server.tool(
  "get_git_log",
  "Get the git commit log for the workspace.",
  {
    root: z.string().optional().describe("Subdirectory root"),
    max: z.number().default(20).describe("Max commits to return"),
  },
  async ({ root, max }) => {
    const params = new URLSearchParams({ max: String(max) });
    if (root) params.set("root", root);
    const data = await apiGet(`/api/workspace-git-log?${params}`);
    return text(data);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCE / USAGE
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "get_token_usage",
  "Get token usage statistics and estimated costs for the OCTO-VEC runtime.",
  {},
  async () => {
    const data = await apiGet("/api/finance");
    return text(data);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER STATUS
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "list_mcp_servers",
  "List all MCP servers configured in the OCTO-VEC runtime and their connection status.",
  {},
  async () => {
    const data = await apiGet("/api/mcp-status");
    return text(data);
  }
);

server.tool(
  "get_system_info",
  "Get overall system information: workspace path, company name, model config, active agents count.",
  {},
  async () => {
    const [settings, runtime] = await Promise.all([
      apiGet("/api/settings"),
      apiGet("/api/agents/runtime") as Promise<{ agents: unknown[] }>,
    ]);
    const rt = runtime as { agents: { status: string }[] };
    return text({
      ...(settings as object),
      agents_total: rt.agents.length,
      agents_running: rt.agents.filter(a => a.status === "running").length,
    });
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is reserved for MCP protocol
  process.stderr.write("[octo-vec MCP] Server started\n");
}

main().catch((err) => {
  process.stderr.write(`[octo-vec MCP] Fatal: ${err.message}\n`);
  process.exit(1);
});
