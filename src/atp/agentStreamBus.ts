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
import { trackTurnStart, trackOutputChars, trackTurnEnd } from "./tokenTracker.js";
import { getModelCostRates } from "./modelConfig.js";

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

// ── Replay buffer ─────────────────────────────────────────────────────────────
// Keeps the last 400 tokens in memory so new SSE clients can catch up
// on what agents were doing when they connect (or reconnect after a drop).
// Per-agent: only the CURRENT turn is buffered (cleared on agent_start).
// When a turn ends (agent_end received), the buffer is retained so new clients
// can see what each agent last did.

const REPLAY_LIMIT = 400;
const _replayBuffer: StreamToken[] = [];

/** Add a token to the replay buffer. On agent_start, clear previous tokens for that agent. */
function bufferToken(tok: StreamToken): void {
  if (tok.type === "agent_start") {
    // Clear previous tokens for this agent so stale state doesn't replay
    for (let i = _replayBuffer.length - 1; i >= 0; i--) {
      if (_replayBuffer[i].agentId === tok.agentId) _replayBuffer.splice(i, 1);
    }
  }
  _replayBuffer.push(tok);
  if (_replayBuffer.length > REPLAY_LIMIT) _replayBuffer.shift();
}

/** Get the current replay buffer (a snapshot for replaying to new clients). */
export function getReplayBuffer(): StreamToken[] {
  return _replayBuffer.slice();
}

// ── Publisher ─────────────────────────────────────────────────────────────────

/**
 * Convert a pi-agent-core AgentEvent into a StreamToken and emit it on the bus.
 * Call this inside any agent's subscribe() handler.
 */
export function publishAgentStream(agentId: string, event: AgentEvent): void {
  const emit = (tok: StreamToken) => {
    bufferToken(tok);
    agentStreamBus.emit("token", tok);
  };

  switch (event.type) {
    case "agent_start":
      trackTurnStart(agentId);
      emit({ agentId, type: "agent_start", content: "" });
      break;

    case "message_update": {
      const ae = (event as any).assistantMessageEvent;
      if (!ae) break;
      if (ae.type === "text_delta" && ae.delta) {
        trackOutputChars(agentId, ae.delta.length);
        emit({ agentId, type: "text", content: ae.delta });
      }
      if (ae.type === "thinking_start") {
        emit({ agentId, type: "thinking_start", content: "" });
      }
      if (ae.type === "thinking_delta" && ae.delta) {
        trackOutputChars(agentId, ae.delta.length);
        emit({ agentId, type: "thinking", content: ae.delta });
      }
      if (ae.type === "thinking_end") {
        emit({ agentId, type: "thinking_end", content: "" });
      }
      break;
    }

    case "tool_execution_start": {
      const toolArgs = (event as any).args && typeof (event as any).args === "object"
        ? ((event as any).args as Record<string, unknown>)
        : undefined;
      // Count tool argument chars as output (models often produce output via tool calls)
      if (toolArgs) {
        const argsStr = JSON.stringify(toolArgs);
        trackOutputChars(agentId, argsStr.length);
      }
      emit({
        agentId,
        type: "tool_start",
        content: (event as any).toolName ?? "",
        toolName: (event as any).toolName,
        toolArgs,
      });
      break;
    }

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

    case "agent_end": {
      // Extract real usage from AssistantMessages in the event
      const msgs = (event as any).messages ?? [];
      let realInput = 0;
      let realOutput = 0;
      let realCostUsd = 0;
      let model: string | undefined;

      for (const msg of msgs) {
        if (msg.role === "assistant" && msg.usage) {
          realInput += msg.usage.input ?? 0;
          realOutput += msg.usage.output ?? 0;
          realCostUsd += msg.usage.cost?.total ?? 0;
          if (msg.model) model = msg.model;
        }
      }

      const hasRealTokens = realInput > 0 || realOutput > 0;

      if (hasRealTokens) {
        // Use real token counts and cost from the provider
        const rates = model ? getModelCostRates(
          msgs.find((m: any) => m.role === "assistant")?.provider ?? "",
          model,
        ) : null;
        trackTurnEnd(agentId, {
          model,
          inputTokens: realInput,
          outputTokens: realOutput,
          costUsd: realCostUsd > 0 ? realCostUsd : undefined,
          inputCostPerM: rates?.inputPerM,
          outputCostPerM: rates?.outputPerM,
        });
      } else {
        // Fallback to char-based estimation (model name still useful)
        trackTurnEnd(agentId, model ? { model } : undefined);
      }

      emit({ agentId, type: "agent_end", content: "" });
      break;
    }

    default:
      break;
  }
}
