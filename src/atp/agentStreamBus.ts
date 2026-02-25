/**
 * AgentStreamBus — server-side EventEmitter that broadcasts token-level
 * LLM streaming events from every agent to the dashboard's SSE clients.
 *
 * Usage:
 *   import { publishAgentStream } from "./agentStreamBus.js";
 *   agent.subscribe(event => publishAgentStream("dev", event));
 *
 * The SSE endpoint in dashboard/server.ts subscribes and forwards tokens
 * as newline-delimited JSON to every connected browser.
 */

import { EventEmitter } from "events";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

// ── Token shape ───────────────────────────────────────────────────────────────

export type StreamTokenType =
  | "agent_start"
  | "text"
  | "thinking_start"
  | "thinking"
  | "thinking_end"
  | "tool_start"
  | "tool_end"
  | "agent_end";

export interface StreamToken {
  agentId: string;
  type: StreamTokenType;
  content: string;     // text delta for "text", tool name for "tool_start"
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string; // truncated text output of the tool call (for tool_end)
  isError?: boolean;
}

// ── Bus ───────────────────────────────────────────────────────────────────────

class AgentStreamBusImpl extends EventEmitter {}

export const agentStreamBus = new AgentStreamBusImpl();
agentStreamBus.setMaxListeners(100); // allow many concurrent SSE clients

// ── Publisher ─────────────────────────────────────────────────────────────────

/**
 * Convert a pi-agent-core AgentEvent into a StreamToken and emit it on the bus.
 * Call this inside any agent's subscribe() handler.
 */
export function publishAgentStream(agentId: string, event: AgentEvent): void {
  const emit = (tok: StreamToken) => agentStreamBus.emit("token", tok);

  switch (event.type) {
    case "agent_start":
      emit({ agentId, type: "agent_start", content: "" });
      break;

    case "message_update": {
      const ae = (event as any).assistantMessageEvent;
      if (!ae) break;
      if (ae.type === "text_delta" && ae.delta) {
        emit({ agentId, type: "text", content: ae.delta });
      }
      if (ae.type === "thinking_start") {
        emit({ agentId, type: "thinking_start", content: "" });
      }
      if (ae.type === "thinking_delta" && ae.delta) {
        emit({ agentId, type: "thinking", content: ae.delta });
      }
      if (ae.type === "thinking_end") {
        emit({ agentId, type: "thinking_end", content: "" });
      }
      break;
    }

    case "tool_execution_start":
      emit({
        agentId,
        type: "tool_start",
        content: (event as any).toolName ?? "",
        toolName: (event as any).toolName,
        toolArgs:
          (event as any).args && typeof (event as any).args === "object"
            ? ((event as any).args as Record<string, unknown>)
            : undefined,
      });
      break;

    case "tool_execution_end": {
      const e = event as any;
      // Extract text content from the AgentToolResult
      let toolResult = "";
      if (e.result?.content && Array.isArray(e.result.content)) {
        toolResult = e.result.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => String(c.text || ""))
          .join("")
          .substring(0, 400); // cap at 400 chars for the stream panel
      }
      emit({
        agentId,
        type: "tool_end",
        content: "",
        toolName: e.toolName,
        toolResult,
        isError: e.isError ?? false,
      });
      break;
    }

    case "agent_end":
      emit({ agentId, type: "agent_end", content: "" });
      break;

    default:
      break;
  }
}
