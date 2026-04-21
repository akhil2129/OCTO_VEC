/**
 * AR Department — Tool profile assembly.
 * Builds the full toolset for a specialist agent based on their roster entry.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { RosterEntry } from "./roster.js";
import { getSpecialistTaskTools } from "../tools/domain/baseSpecialistTools.js";
import { getTodoTool } from "../tools/shared/todoTools.js";
import { getReminderTools } from "../tools/shared/reminderTools.js";
import { getMemoryToolsSlim } from "../tools/shared/memoryTools.js";
import { getMessagingTools } from "../tools/shared/messagingTools.js";
import { getDateTool } from "../tools/shared/dateTools.js";
import { getWebTools } from "../tools/shared/webTools.js";
import { getMCPTools } from "../mcp/mcpBridge.js";
import { getClaudeTool } from "../tools/shared/claudeTool.js";
import {
  getCodingTools,
  getReadOnlyTools,
  getScopedWriteTools,
  getGlobTool,
  sandboxFileTools,
} from "../tools/shared/fileTools.js";
import { getBAFileTools } from "../tools/domain/baFileTools.js";
import { getGitReadTools, getGitWriteTools, getGitAdminTools } from "../tools/domain/gitTools.js";
import { qaTools } from "../tools/domain/qaTools.js";
import { securityFlowTools } from "../tools/domain/securityFlowTools.js";
import { getSEOTools, getSocialTools, getGEOTools, getAllMarketingTools } from "../tools/domain/marketingTools.js";
import {
  getExcelTools, getPresentationTools, getDocumentTools,
  getPdfTools, getAllProductivityTools,
} from "../tools/domain/productivityTools.js";
import type { AgentInbox } from "../atp/agentMessageQueue.js";

// ── Domain tool bundles keyed by roster.json "domain_tools" strings ───────────

const DOMAIN_TOOL_BUNDLES: Record<string, AgentTool[]> = {
  qa: qaTools,
  security: securityFlowTools,
  seo: getSEOTools(),
  social: getSocialTools(),
  geo: getGEOTools(),
  marketing: getAllMarketingTools(),
  excel: getExcelTools(),
  presentation: getPresentationTools(),
  document: getDocumentTools(),
  pdf: getPdfTools(),
  productivity: getAllProductivityTools(),
};

// ── Public API ────────────────────────────────────────────────────────────────

export interface ToolsetDeps {
  db: any;
  pmQueue: any;
  agentQueue: any;
}

/**
 * Build the full tool array for a specialist agent.
 * This replaces the per-agent manual tool list construction in each old *Agent.ts constructor.
 */
export function buildToolset(
  entry: RosterEntry,
  inbox: AgentInbox,
  deps: ToolsetDeps
): AgentTool[] {
  const agentId = entry.agent_id;
  const tools: AgentTool[] = [];

  // 1. Task management tools (all specialists)
  tools.push(...getSpecialistTaskTools(agentId, deps));

  // 2. Personal todo list
  tools.push(getTodoTool(agentId));

  // 2b. Reminder tools
  tools.push(...getReminderTools(agentId));

  // 3. Memory tools
  tools.push(...getMemoryToolsSlim(agentId));

  // 4. File tools — based on tool_profile
  const fileTools = buildFileTools(entry);
  tools.push(...sandboxFileTools(agentId, fileTools));

  // 5. Capability extras
  if (entry.capabilities.glob) {
    tools.push(getGlobTool());
  }
  // Git tools — tiered by git_level (fallback: git:true = "write")
  const gitLevel = entry.capabilities.git_level
    ?? (entry.capabilities.git ? "write" : undefined);
  if (gitLevel) {
    tools.push(...getGitReadTools(agentId));
    if (gitLevel === "write" || gitLevel === "admin") {
      tools.push(...getGitWriteTools(agentId));
    }
    if (gitLevel === "admin") {
      tools.push(...getGitAdminTools(agentId));
    }
  }

  // 6. Domain-specific tool bundles
  for (const bundleName of entry.domain_tools) {
    const bundle = DOMAIN_TOOL_BUNDLES[bundleName];
    if (bundle) tools.push(...bundle);
  }

  // 6b. Productivity tools — all agents with write access get doc creation
  const writableProfiles = ["ba", "scoped_write", "coding", "coding_extended"];
  if (writableProfiles.includes(entry.tool_profile)) {
    const hasProductivity = entry.domain_tools.some((d: string) =>
      ["productivity", "excel", "presentation", "document", "pdf"].includes(d));
    if (!hasProductivity) tools.push(...getAllProductivityTools());
  }

  // 7. Messaging (filter out broadcast — PM-only)
  tools.push(
    ...getMessagingTools(agentId, inbox).filter(
      (t) => t.name !== "broadcast_message"
    )
  );

  // 8. Shared utilities
  tools.push(getDateTool());
  tools.push(...getWebTools());
  tools.push(...getMCPTools());

  // 9. Claude Code bridge — any agent can delegate work to Claude
  tools.push(getClaudeTool(agentId));

  return tools;
}

// ── File tool profile builder ─────────────────────────────────────────────────

function buildFileTools(entry: RosterEntry): AgentTool[] {
  switch (entry.tool_profile) {
    case "coding":
      return getCodingTools();

    case "coding_extended": {
      // Coding tools + deduplicated read-only extras (grep, find, ls)
      const coding = getCodingTools();
      const ro = getReadOnlyTools();
      const codingNames = new Set(coding.map((t) => t.name));
      const extras = ro.filter((t) => !codingNames.has(t.name));
      return [...coding, ...extras];
    }

    case "scoped_write":
      return [...getReadOnlyTools(), ...getScopedWriteTools()];

    case "ba":
      return getBAFileTools();

    case "pm":
      return getReadOnlyTools();

    default:
      console.warn(
        `[toolProfiles] Unknown profile '${entry.tool_profile}' for ${entry.agent_id} — defaulting to read-only`
      );
      return getReadOnlyTools();
  }
}
