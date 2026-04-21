/**
 * ask_claude tool — lets any OCTO-VEC agent delegate work to Claude Code.
 *
 * Spawns `claude -p "<prompt>"` as a subprocess (non-interactive mode) and
 * returns Claude's response. Claude Code has full access to its built-in tools
 * (Read, Edit, Bash, WebSearch, etc.) and runs in the agent's workspace.
 *
 * Claude Code binary is discovered automatically from PATH or common install
 * locations. The call blocks until Claude finishes or times out (5 min).
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../config.js";

// ── Binary discovery ──────────────────────────────────────────────────────────

function findClaudeBinary(): string | null {
  const candidates = [
    // Windows — common install paths
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\Claude\\claude.exe`,
    `${process.env.USERPROFILE ?? "C:\\Users\\user"}\\.local\\bin\\claude.exe`,
    `${process.env.USERPROFILE ?? "C:\\Users\\user"}\\.claude\\local\\claude.exe`,
    // Unix
    `${process.env.HOME ?? "/root"}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Fallback: rely on PATH
  return "claude";
}

const CLAUDE_BIN = findClaudeBinary() ?? "claude";

// ── Helper ────────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ── Tool factory ──────────────────────────────────────────────────────────────

export function getClaudeTool(agentId: string): AgentTool {
  const ask_claude: AgentTool = {
    name: "ask_claude",
    label: "Ask Claude Code",
    description:
      "Delegate a task or question to Claude Code (Anthropic's AI coding assistant). " +
      "Claude Code can read files, edit code, search the web, run shell commands, and answer complex questions. " +
      "Use this when you need a second opinion, want code reviewed/written, need research done, " +
      "or want to offload a technical task to a highly capable AI. " +
      "Claude runs with full access to the workspace and returns its full response. " +
      "Blocks until Claude finishes — use a clear, specific prompt for best results.",
    parameters: Type.Object({
      prompt: Type.String({
        description:
          "The task or question for Claude Code. Be specific — include file paths, context, and what you want back.",
      }),
      cwd: Type.Optional(
        Type.String({
          description:
            "Working directory for Claude (relative to workspace root, e.g. 'projects/patient-registry'). " +
            "Defaults to the workspace root.",
        })
      ),
      allowed_tools: Type.Optional(
        Type.String({
          description:
            "Comma-separated list of Claude Code tools to allow. " +
            "E.g. 'Read,Edit,Bash' or 'Read,WebSearch'. " +
            "Omit to allow all built-in Claude Code tools.",
        })
      ),
      timeout_seconds: Type.Optional(
        Type.Number({
          description: "Max seconds to wait for Claude's response (default: 120, max: 300).",
        })
      ),
    }),
    execute: async (_, params: any) => {
      const prompt: string = params.prompt?.trim();
      if (!prompt) return ok("ERROR: prompt is required.");

      const timeoutSecs = Math.min(params.timeout_seconds ?? 120, 300);
      const cwd = params.cwd
        ? `${config.workspace}/${params.cwd}`.replace(/\/\//g, "/")
        : config.workspace;

      const args: string[] = [
        "--print",                   // non-interactive, print output
        "--output-format", "text",   // plain text response
        "--dangerously-skip-permissions", // non-interactive requires this
        prompt,
      ];

      if (params.allowed_tools) {
        args.push("--allowedTools", params.allowed_tools);
      }

      let result: ReturnType<typeof spawnSync>;
      try {
        result = spawnSync(CLAUDE_BIN, args, {
          cwd,
          timeout: timeoutSecs * 1000,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, // 10 MB
          env: { ...process.env },
          shell: false,
        });
      } catch (err: any) {
        return ok(`ERROR: Failed to spawn Claude Code — ${err.message}. Make sure the 'claude' CLI is installed and on PATH.`);
      }

      if (result.error) {
        const msg = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
          ? `Claude Code timed out after ${timeoutSecs}s.`
          : `Claude Code process error: ${result.error.message}`;
        return ok(`ERROR: ${msg}`);
      }

      const stdout = (result.stdout as string)?.trim() ?? "";
      const stderr = (result.stderr as string)?.trim() ?? "";

      if (!stdout && stderr) {
        return ok(`Claude Code returned no output.\nStderr: ${stderr.slice(0, 500)}`);
      }

      const header = `[Claude Code response for ${agentId}]\n\n`;
      return ok(header + (stdout || "(no output)"));
    },
  };

  return ask_claude;
}
