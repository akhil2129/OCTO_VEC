/**
 * Three-tier memory tools for VEC agents.
 *
 * STM  — Short-Term / Working Memory: today's scratchpad, auto-resets daily.
 * LTM  — Long-Term / Episodic Memory: daily journal files (YYYY-MM-DD_memory.md).
 * SLTM — Super-Long-Term / Identity Memory: permanent beliefs, never resets.
 *
 * Usage:
 *   import { getMemoryTools, getMemoryToolsSlim } from "./memoryTools.js";
 *   tools: [...getMemoryTools("ba"), ...]
 */

import fs from "fs";
import path from "path";
import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../config.js";
import { searchAgentMemory } from "../../memory/agentMemory.js";

const AGENT_NAMES: Record<string, string> = {
  pm: "Project Manager",
  ba: "Business Analyst",
  dev: "Developer",
  qa: "QA Engineer",
  researcher: "Researcher",
  architect: "Architect",
  security: "Security Engineer",
  devops: "DevOps Engineer",
  techwriter: "Technical Writer",
};

const STM_MAX_ENTRIES = 20;

// ── Path helpers ──────────────────────────────────────────────────────────────

function agentDir(agentId: string): string {
  const d = path.join(config.memoryDir, agentId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function stmPath(agentId: string): string {
  return path.join(agentDir(agentId), "stm.md");
}

function sltmPath(agentId: string): string {
  return path.join(agentDir(agentId), "sltm.md");
}

function ltmDir(agentId: string): string {
  const d = path.join(agentDir(agentId), "ltm");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function ltmPath(agentId: string, dateStr?: string): string {
  const ds = dateStr ?? today();
  return path.join(ltmDir(agentId), `${ds}_memory.md`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  const d = new Date();
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// ── Header helpers ────────────────────────────────────────────────────────────

function ensureStmHeader(filePath: string, agentId: string): void {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    const name = AGENT_NAMES[agentId] ?? agentId;
    fs.writeFileSync(
      filePath,
      `# ${name} - Short Term Memory (Working Memory)\n\n` +
        `_Current session scratchpad. Resets daily._\n\n` +
        `**Date**: ${today()}\n\n`,
      "utf-8"
    );
  }
}

function ensureSltmHeader(filePath: string, agentId: string): void {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    const name = AGENT_NAMES[agentId] ?? agentId;
    fs.writeFileSync(
      filePath,
      `# ${name} - Super Long Term Memory (Identity & Core Beliefs)\n\n` +
        `_Permanent memory. Core beliefs, learned patterns, perspectives._\n\n`,
      "utf-8"
    );
  }
}

function ensureLtmHeader(filePath: string, agentId: string, dateStr: string): void {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    const name = AGENT_NAMES[agentId] ?? agentId;
    fs.writeFileSync(
      filePath,
      `# ${name} - Daily Journal (${dateStr})\n\n` +
        `_What happened today, what I learned, what I'd do differently._\n\n`,
      "utf-8"
    );
  }
}

function autoResetStm(agentId: string): void {
  const filePath = stmPath(agentId);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  if (!content.includes(`**Date**: ${today()}`)) {
    ensureStmHeader(filePath, agentId); // overwrites with fresh header for today
  }
}

function capStm(agentId: string): void {
  const filePath = stmPath(agentId);
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const entryIndices = lines
    .map((l, i) => (l.startsWith("- ") ? i : -1))
    .filter((i) => i >= 0);
  if (entryIndices.length <= STM_MAX_ENTRIES) return;
  const cut = entryIndices[entryIndices.length - STM_MAX_ENTRIES];
  const header = lines.slice(0, entryIndices[0]);
  const kept = lines.slice(cut);
  fs.writeFileSync(filePath, [...header, ...kept].join("\n") + "\n", "utf-8");
}

// ── Tool result helper ────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ── Full memory tool set ──────────────────────────────────────────────────────

export function getMemoryTools(agentId: string): AgentTool[] {
  const read_stm: AgentTool = {
    name: "read_stm",
    label: "Read Short-Term Memory",
    description:
      "Read your Short-Term Memory (current working context for today). " +
      "Use this at the start of a task to recall what you were working on.",
    parameters: Type.Object({}),
    execute: async () => {
      autoResetStm(agentId);
      const p = stmPath(agentId);
      ensureStmHeader(p, agentId);
      return ok(fs.readFileSync(p, "utf-8"));
    },
  };

  const write_stm: AgentTool = {
    name: "write_stm",
    label: "Write Short-Term Memory",
    description:
      "Write a new entry to your Short-Term Memory (working scratchpad). " +
      "Use this to note current thoughts, active task context, or quick reminders. " +
      "Keep entries brief — this is working memory, not a journal.",
    parameters: Type.Object({ entry: Type.String({ description: "The note to add to STM" }) }),
    execute: async (_, params: any) => {
      autoResetStm(agentId);
      const p = stmPath(agentId);
      ensureStmHeader(p, agentId);
      fs.appendFileSync(p, `- [${now()}] ${params.entry}\n`, "utf-8");
      capStm(agentId);
      return ok(`STM updated. Entry added at ${now()}.`);
    },
  };

  const clear_stm: AgentTool = {
    name: "clear_stm",
    label: "Clear Short-Term Memory",
    description:
      "Clear your Short-Term Memory completely. Use when switching to a completely new context.",
    parameters: Type.Object({}),
    execute: async () => {
      const p = stmPath(agentId);
      ensureStmHeader(p, agentId);
      return ok("STM cleared.");
    },
  };

  const read_ltm_today: AgentTool = {
    name: "read_ltm_today",
    label: "Read Today's LTM Journal",
    description:
      "Read today's Long-Term Memory journal entry. " +
      "This is your daily episodic memory — what happened today.",
    parameters: Type.Object({}),
    execute: async () => {
      const ds = today();
      const p = ltmPath(agentId, ds);
      ensureLtmHeader(p, agentId, ds);
      return ok(fs.readFileSync(p, "utf-8"));
    },
  };

  const write_ltm: AgentTool = {
    name: "write_ltm",
    label: "Write LTM Journal",
    description:
      "Write to today's Long-Term Memory journal. " +
      "Record what happened, what you learned, what you'd do differently. " +
      "Think of this as your daily work journal.",
    parameters: Type.Object({ entry: Type.String({ description: "The journal entry to record" }) }),
    execute: async (_, params: any) => {
      const ds = today();
      const p = ltmPath(agentId, ds);
      ensureLtmHeader(p, agentId, ds);
      fs.appendFileSync(p, `### [${now()}]\n${params.entry}\n\n`, "utf-8");
      return ok(`LTM journal updated for ${ds}.`);
    },
  };

  const read_ltm_by_date: AgentTool = {
    name: "read_ltm_by_date",
    label: "Read Past LTM Journal",
    description:
      "Read a past Long-Term Memory journal entry by date. " +
      "Use format YYYY-MM-DD. Returns that day's journal if it exists.",
    parameters: Type.Object({
      date_str: Type.String({ description: "Date in YYYY-MM-DD format" }),
    }),
    execute: async (_, params: any) => {
      const ds = params.date_str.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        return ok(`Invalid date format: ${ds}. Use YYYY-MM-DD.`);
      }
      const p = ltmPath(agentId, ds);
      if (!fs.existsSync(p)) return ok(`No journal entry found for ${ds}.`);
      return ok(fs.readFileSync(p, "utf-8"));
    },
  };

  const list_ltm_entries: AgentTool = {
    name: "list_ltm_entries",
    label: "List LTM Entries",
    description:
      "List all your past Long-Term Memory journal dates. " +
      "Shows which days you have journal entries for.",
    parameters: Type.Object({}),
    execute: async () => {
      const dir = ltmDir(agentId);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith("_memory.md"))
        .sort();
      if (!files.length) return ok("No journal entries yet.");
      const entries = files.map((f) => f.replace("_memory.md", ""));
      return ok(`Journal entries (${entries.length} days):\n${entries.map((e) => `- ${e}`).join("\n")}`);
    },
  };

  const read_sltm: AgentTool = {
    name: "read_sltm",
    label: "Read Super Long-Term Memory",
    description:
      "Read your Super Long-Term Memory (identity, core beliefs, learned patterns). " +
      "This is your permanent memory that shapes who you are. Read this to remember " +
      "important lessons, perspectives on other agents, and behavioral patterns.",
    parameters: Type.Object({}),
    execute: async () => {
      const p = sltmPath(agentId);
      ensureSltmHeader(p, agentId);
      return ok(fs.readFileSync(p, "utf-8"));
    },
  };

  const write_sltm: AgentTool = {
    name: "write_sltm",
    label: "Write Super Long-Term Memory",
    description:
      "Write to your Super Long-Term Memory (permanent identity memory). " +
      "ONLY use this for truly important insights that should change how you think or behave. " +
      "Examples: core lessons from major failures/successes, relationship notes about other agents, " +
      "perspective shifts, behavioral patterns to reinforce. This memory NEVER resets.",
    parameters: Type.Object({ entry: Type.String({ description: "The permanent insight to record" }) }),
    execute: async (_, params: any) => {
      const p = sltmPath(agentId);
      ensureSltmHeader(p, agentId);
      fs.appendFileSync(p, `### [${now()}]\n${params.entry}\n\n`, "utf-8");
      return ok("SLTM updated. This is now part of your permanent identity memory.");
    },
  };

  const search_memory: AgentTool = {
    name: "search_memory",
    label: "Search Memory",
    description:
      "Search across all your memory files (SLTM, STM, LTM journals) for a keyword or phrase. " +
      "Use this to recall past decisions, conversations, preferences, or facts you've recorded.",
    parameters: Type.Object({
      query: Type.String({ description: "Keyword or phrase to search for in memory files" }),
    }),
    execute: async (_, params: any) => {
      return ok(searchAgentMemory(agentId, params.query));
    },
  };

  return [
    read_stm, write_stm, clear_stm,
    read_ltm_today, write_ltm, read_ltm_by_date, list_ltm_entries,
    read_sltm, write_sltm,
    search_memory,
  ];
}

/**
 * Slim version — 6 essential tools (for agents with many other tools).
 */
export function getMemoryToolsSlim(agentId: string): AgentTool[] {
  const all = getMemoryTools(agentId);
  const byName = new Map(all.map((t) => [t.name, t]));
  return [
    byName.get("write_stm")!,
    byName.get("write_ltm")!,
    byName.get("write_sltm")!,
    byName.get("search_memory")!,
  ];
}
