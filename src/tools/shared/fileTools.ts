/**
 * File-system tools for VEC agents — thin wrappers over @mariozechner/pi-coding-agent.
 *
 * Coding tools  (read, bash, edit, write) — for Dev and DevOps agents.
 * ReadOnly tools (read, grep, find, ls)   — for all other specialist agents.
 *
 * The `cwd` defaults to config.workspace (sandboxed workspace directory).
 *
 * Usage:
 *   import { getCodingTools, getReadOnlyTools, getGlobTool } from "./fileTools.js";
 *   tools: [...getCodingTools(), getGlobTool(), ...]   // dev / devops
 *   tools: [...getReadOnlyTools(), ...]                // ba / qa / security / architect / etc.
 */

import { createCodingTools, createReadOnlyTools } from "@mariozechner/pi-coding-agent";
import { globSync } from "glob";
import path from "path";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../config.js";
import { getEmployeeId } from "../../ar/roster.js";

/** Full coding tools: read, bash, edit, write — for Dev/DevOps agents. */
export function getCodingTools(cwd?: string): AgentTool[] {
  return createCodingTools(cwd ?? config.workspace) as AgentTool[];
}

/** Read-only tools: read, grep, find, ls — for all other specialist agents. */
export function getReadOnlyTools(cwd?: string): AgentTool[] {
  return createReadOnlyTools(cwd ?? config.workspace) as AgentTool[];
}

// ── Path sandboxing ──────────────────────────────────────────────────────────

const AGENTS_DIR = path.resolve(config.workspace, "agents");
const MEMORY_DIR = path.resolve(config.memoryDir);

/**
 * Check if a resolved path is allowed for the given agent.
 *
 * Rules:
 * 1. Within workspace: block other agents' private folders (workspace/agents/{other}/)
 * 2. Outside workspace: block everything EXCEPT the agent's own memory folder
 */
function isPathAllowed(agentId: string, filePath: string): boolean {
  const workspace = path.resolve(config.workspace);
  const resolved = path.resolve(workspace, filePath);

  // ── Inside workspace ──
  if (resolved.startsWith(workspace + path.sep) || resolved === workspace) {
    // Block access to other agents' private workspace folders
    if (resolved.startsWith(AGENTS_DIR + path.sep)) {
      const ownDir = path.resolve(AGENTS_DIR, getEmployeeId(agentId));
      if (!resolved.startsWith(ownDir + path.sep) && resolved !== ownDir) {
        return false;
      }
    }
    return true;
  }

  // ── Outside workspace — only allow agent's own memory dir ──
  const ownMemory = path.resolve(MEMORY_DIR, agentId);
  if (resolved === ownMemory || resolved.startsWith(ownMemory + path.sep)) {
    return true;
  }

  // Everything else outside workspace is blocked
  return false;
}

function accessDenied(toolName: string, filePath: string) {
  return {
    content: [{
      type: "text" as const,
      text:
        `ACCESS DENIED: '${toolName}' cannot access '${filePath}'.\n` +
        `You can only access your own agent folder, shared/, and projects/.\n` +
        `Other agents' private folders and memory are not accessible.`,
    }],
    details: {},
  };
}

// ── Bash workspace containment ────────────────────────────────────────────
//
// Strategy: agents can use ANY command, but every path in the command must
// resolve inside the workspace (or the agent's own memory dir).
//
// 1. Extract all path-like tokens from the command string
// 2. Resolve each relative to workspace CWD
// 3. If ANY path escapes the allowed roots → block
// 4. A small blocklist catches truly dangerous patterns that don't involve
//    paths at all (sudo, shutdown, eval evasion, etc.)

const WORKSPACE_RESOLVED = path.resolve(config.workspace);

/** Patterns that are dangerous regardless of path — always blocked. */
const BASH_ALWAYS_BLOCKED: { pattern: RegExp; reason: string }[] = [
  // Privilege escalation
  { pattern: /\bsudo\b/, reason: "sudo — privilege escalation" },
  { pattern: /\bsu\s+-?\s*\w/, reason: "su — switch user" },

  // System destruction
  { pattern: /\bmkfs\b/, reason: "mkfs — filesystem format" },
  { pattern: /\bdd\s+.*of=\/dev\//, reason: "dd — raw disk write" },
  { pattern: /\bshutdown\b/, reason: "shutdown" },
  { pattern: /\breboot\b/, reason: "reboot" },

  // Shell evasion tricks
  { pattern: /\bbase64\s+-d\b.*\|\s*(ba)?sh/, reason: "base64-decoded shell execution" },
  { pattern: /\beval\s+"?\$\(/, reason: "eval with command substitution" },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, reason: "curl pipe to shell — remote code execution" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, reason: "wget pipe to shell — remote code execution" },

  // Reverse shells / listeners
  { pattern: /\bnc\s+-[a-zA-Z]*l/, reason: "netcat listener" },
  { pattern: /\bncat\b/, reason: "ncat" },
];

/**
 * Extract path-like tokens from a bash command string.
 *
 * Catches:
 *   - Unix absolute paths:    /etc/passwd, /home/user/.ssh/id_rsa
 *   - Windows absolute paths: C:\Users\..., D:/Projects/...
 *   - Relative traversal:     ../../.env, ../../../etc/passwd
 *   - cd targets:             cd /tmp, cd ../..
 *   - Home expansion:         ~/secret  (resolves via HOME)
 *
 * Intentionally ignores:
 *   - URLs (http://, https://, git://) — not filesystem paths
 *   - Bare filenames without slashes (script.py, package.json) — relative to CWD = workspace
 */
function extractPathTokens(command: string): string[] {
  const tokens: string[] = [];

  // Strip URLs so http://... doesn't trigger absolute-path matching
  const urlSafe = command.replace(/https?:\/\/\S+/g, " ").replace(/git:\/\/\S+/g, " ");

  // 1. Unix absolute paths: /foo/bar (but not lone / in pipes like |)
  const unixAbs = urlSafe.match(/(?:^|\s|=|"|')(\/([\w.\-]+\/)*[\w.\-*]+)/g);
  if (unixAbs) {
    for (const m of unixAbs) tokens.push(m.trim().replace(/^["'=]/, ""));
  }

  // 2. Windows absolute paths: C:\foo or C:/foo
  const winAbs = urlSafe.match(/[A-Za-z]:[/\\][\w.\-/\\]*/g);
  if (winAbs) tokens.push(...winAbs);

  // 3. Relative paths with ../ traversal
  const traversal = urlSafe.match(/(?:^|\s|=|"|')(\.\.([/\\][\w.\-]*)+)/g);
  if (traversal) {
    for (const m of traversal) tokens.push(m.trim().replace(/^["'=]/, ""));
  }

  // 4. Home-relative paths: ~/something
  const homeRel = urlSafe.match(/(?:^|\s|=|"|')(~\/[\w.\-/\\]*)/g);
  if (homeRel) {
    for (const m of homeRel) {
      const clean = m.trim().replace(/^["'=]/, "");
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "/";
      tokens.push(clean.replace(/^~/, home));
    }
  }

  return tokens;
}

/**
 * Check if a resolved path is within the allowed roots for bash.
 * Allowed: workspace (+ all subdirs), agent's own memory dir.
 */
function isBashPathAllowed(resolved: string, allowedRoots: string[]): boolean {
  // Normalize separators for cross-platform comparison.
  // On Windows, use case-insensitive comparison; on Linux/Mac, preserve case.
  const isWin = process.platform === "win32";
  const norm = isWin ? resolved.replace(/\\/g, "/").toLowerCase() : resolved;
  for (const root of allowedRoots) {
    const normRoot = isWin ? root.replace(/\\/g, "/").toLowerCase() : root;
    if (norm === normRoot || norm.startsWith(normRoot + "/")) return true;
  }
  return false;
}

function bashBlocked(command: string, reason: string) {
  return {
    content: [{
      type: "text" as const,
      text:
        `SECURITY BLOCK: bash command rejected.\n` +
        `Reason: ${reason}\n` +
        `Command: ${command.substring(0, 120)}${command.length > 120 ? "..." : ""}\n` +
        `All bash commands are restricted to your workspace. Use relative paths within the project.`,
    }],
    details: {},
  };
}

/**
 * Wrap the bash tool with workspace containment.
 * - Blocks always-dangerous patterns (sudo, mkfs, eval evasion, etc.)
 * - Extracts all path tokens from the command
 * - Blocks if any path resolves outside workspace or agent's memory dir
 * - Allows all commands whose paths stay inside the workspace
 */
function wrapBashTool(tool: AgentTool, agentId: string): AgentTool {
  // Pre-compute the allowed root directories for this agent
  const ownMemory = path.resolve(MEMORY_DIR, agentId);
  const allowedRoots = [WORKSPACE_RESOLVED, ownMemory];

  return {
    ...tool,
    execute: async (ctx: any, params: any) => {
      const command: string = params?.command ?? params?.cmd ?? "";
      const cmd = command.trim();

      if (!cmd) return bashBlocked(cmd, "empty command");

      // 1. Always-blocked patterns (no path analysis needed)
      for (const { pattern, reason } of BASH_ALWAYS_BLOCKED) {
        if (pattern.test(cmd)) {
          return bashBlocked(cmd, reason);
        }
      }

      // 2. Extract all path references from the command
      const paths = extractPathTokens(cmd);

      // 3. Resolve each path and check containment
      for (const p of paths) {
        const resolved = path.resolve(WORKSPACE_RESOLVED, p);
        if (!isBashPathAllowed(resolved, allowedRoots)) {
          return bashBlocked(cmd, `path "${p}" resolves outside workspace (${resolved})`);
        }
      }

      return tool.execute(ctx, params);
    },
  };
}

/**
 * Wrap file tools with per-agent path sandboxing.
 * - File tools (read, write, edit, etc.): path param checked against isPathAllowed
 * - Bash tool: workspace containment — all referenced paths must stay inside workspace
 */
export function sandboxFileTools(agentId: string, tools: AgentTool[]): AgentTool[] {
  return tools.map((tool) => {
    // Bash: workspace containment wrapper
    if (tool.name === "bash") return wrapBashTool(tool, agentId);

    return {
      ...tool,
      execute: async (ctx: any, params: any) => {
        const filePath: string = params?.path ?? params?.file_path ?? params?.dir ?? "";
        if (filePath && !isPathAllowed(agentId, filePath)) {
          return accessDenied(tool.name, filePath);
        }
        return tool.execute(ctx, params);
      },
    };
  });
}

// ── Scoped write tools ──────────────────────────────────────────────────────

const DOC_EXTENSIONS = [".md", ".mmd"];

function isDocFile(filePath: string): boolean {
  const lower = (filePath ?? "").toLowerCase();
  return DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function docBlocked(toolName: string, filePath: string) {
  return {
    content: [{
      type: "text" as const,
      text:
        `BLOCKED: '${toolName}' is restricted to .md and .mmd files only.\n` +
        `'${filePath}' is not a documentation file.\n` +
        `You can write/edit documentation files (.md, .mmd) in agents/<your-folder>/ and shared/.`,
    }],
    details: {},
  };
}

/**
 * Scoped write + edit tools for non-Dev agents (QA, Security, Architect, Researcher).
 * Restricted to .md and .mmd files only — these agents write reports, not code.
 * Path sandboxing is applied separately via sandboxFileTools().
 */
export function getScopedWriteTools(): AgentTool[] {
  const base = createCodingTools(config.workspace) as AgentTool[];
  const byName = new Map(base.map((t) => [t.name, t]));

  const writeTool = byName.get("write")!;
  const editTool = byName.get("edit")!;

  return [
    {
      ...writeTool,
      description:
        "Write a .md or .mmd documentation file. Only documentation extensions are allowed — you write reports, not code.",
      execute: async (ctx: any, params: any) => {
        const filePath: string = params?.path ?? params?.file_path ?? "";
        if (filePath && !isDocFile(filePath)) {
          return docBlocked("write", filePath);
        }
        return writeTool.execute(ctx, params);
      },
    },
    {
      ...editTool,
      description:
        "Make targeted edits to a .md or .mmd documentation file. Only documentation extensions are allowed.",
      execute: async (ctx: any, params: any) => {
        const filePath: string = params?.path ?? params?.file_path ?? "";
        if (filePath && !isDocFile(filePath)) {
          return docBlocked("edit", filePath);
        }
        return editTool.execute(ctx, params);
      },
    },
  ];
}

/** Glob tool — find files matching a pattern. Paths are relative to the workspace root. */
export function getGlobTool(cwd?: string): AgentTool {
  const root = cwd ?? config.workspace;
  return {
    name: "glob",
    label: "Glob",
    description:
      "Find files matching a glob pattern. Paths are relative to the workspace root. " +
      "Examples: '**/*.ts', 'src/**/*.py', 'shared/*.md', 'projects/my-app/**'.",
    parameters: Type.Object({
      pattern: Type.String({
        description: "Glob pattern to match against, e.g. '**/*.ts' or 'shared/*.md'",
      }),
    }),
    execute: async (_: any, params: any) => {
      const matches = globSync(params.pattern as string, { cwd: root, nodir: true });
      if (!matches.length) {
        return { content: [{ type: "text" as const, text: `No files matched: ${params.pattern}` }], details: {} };
      }
      // Normalize to forward slashes for consistent output across platforms
      const normalized = matches.map((p) => p.replace(/\\/g, "/"));
      return {
        content: [{ type: "text" as const, text: normalized.join("\n") }],
        details: {},
      };
    },
  };
}
