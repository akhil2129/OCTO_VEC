/**
 * File-system tools for VEC agents — thin wrappers over @mariozechner/pi-coding-agent.
 *
 * Coding tools  (read, bash, edit, write) — for Dev and DevOps agents.
 * ReadOnly tools (read, grep, find, ls)   — for all other specialist agents.
 *
 * The `cwd` defaults to config.workspace (sandboxed workspace directory).
 *
 * Usage:
 *   import { getCodingTools, getReadOnlyTools } from "./fileTools.js";
 *   tools: [...getCodingTools(), ...]   // dev / devops
 *   tools: [...getReadOnlyTools(), ...]  // ba / qa / security / architect / etc.
 */

import { createCodingTools, createReadOnlyTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { config } from "../../config.js";

/** Full coding tools: read, bash, edit, write — for Dev/DevOps agents. */
export function getCodingTools(cwd?: string): AgentTool[] {
  return createCodingTools(cwd ?? config.workspace) as AgentTool[];
}

/** Read-only tools: read, grep, find, ls — for all other specialist agents. */
export function getReadOnlyTools(cwd?: string): AgentTool[] {
  return createReadOnlyTools(cwd ?? config.workspace) as AgentTool[];
}
