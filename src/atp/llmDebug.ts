import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import { EventLog } from "./eventLog.js";
import { EventType } from "./models.js";

export type PromptOutcome = "completed" | "error";

interface PromptDebugOptions {
  enabled: boolean;
  stallMs: number;
  modelLabel: string;
  inputChars: number;
}

interface PromptDebugMonitor {
  stop: (outcome: PromptOutcome, err?: unknown) => void;
}

function classifyMessageUpdate(event: AgentEvent): string | null {
  if (event.type !== "message_update") return null;
  const ae = (event as any).assistantMessageEvent;
  if (!ae?.type) return null;
  if (ae.type === "text_delta") return "text_delta";
  if (ae.type === "thinking_delta") return "thinking_delta";
  if (ae.type === "text_start") return "text_start";
  if (ae.type === "thinking_start") return "thinking_start";
  if (ae.type === "text_end") return "text_end";
  if (ae.type === "thinking_end") return "thinking_end";
  return null;
}

/**
 * Per-prompt debug monitor for "stuck in thinking" diagnosis.
 * Logs stall events when no stream/tool progress is observed.
 */
export function startPromptDebugMonitor(
  agent: Agent,
  agentId: string,
  agentLabel: string,
  opts: PromptDebugOptions
): PromptDebugMonitor {
  if (!opts.enabled) {
    return { stop: () => {} };
  }

  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let lastProgressLabel = "prompt_start";
  let textDeltas = 0;
  let thinkingDeltas = 0;
  let toolStarts = 0;
  let toolEnds = 0;
  let stallReports = 0;

  const markProgress = (label: string): void => {
    lastProgressAt = Date.now();
    lastProgressLabel = label;
  };

  EventLog.log(
    EventType.AGENT_THINKING,
    agentId,
    "",
    `${agentLabel} DEBUG: monitor ON | model=${opts.modelLabel} | input_chars=${opts.inputChars} | stall_threshold=${Math.round(
      opts.stallMs / 1000
    )}s`
  );

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    const updateType = classifyMessageUpdate(event);
    if (updateType) {
      if (updateType === "text_delta") textDeltas += 1;
      if (updateType === "thinking_delta") thinkingDeltas += 1;
      markProgress(updateType);
      return;
    }

    if (event.type === "tool_execution_start") {
      toolStarts += 1;
      markProgress(`tool_start:${event.toolName}`);
      return;
    }

    if (event.type === "tool_execution_end") {
      toolEnds += 1;
      markProgress(`tool_end:${event.toolName}:${event.isError ? "error" : "ok"}`);
      return;
    }

    if (event.type === "agent_end") {
      markProgress("agent_end");
    }
  });

  const interval = setInterval(() => {
    const idleMs = Date.now() - lastProgressAt;
    if (idleMs < opts.stallMs) return;

    stallReports += 1;
    EventLog.log(
      EventType.AGENT_THINKING,
      agentId,
      "",
      `${agentLabel} DEBUG: stalled ${Math.round(idleMs / 1000)}s without stream/tool progress (last=${lastProgressLabel})`
    );

    // Prevent spam; only report once per threshold window unless more progress occurs.
    lastProgressAt = Date.now();
    lastProgressLabel = `${lastProgressLabel} (stall-reported-${stallReports})`;
  }, Math.min(5_000, opts.stallMs));

  return {
    stop: (outcome: PromptOutcome, err?: unknown) => {
      clearInterval(interval);
      unsubscribe();
      const elapsedMs = Date.now() - startedAt;
      const summary =
        `${agentLabel} DEBUG: monitor OFF | outcome=${outcome}` +
        ` | elapsed_ms=${elapsedMs}` +
        ` | text_deltas=${textDeltas}` +
        ` | thinking_deltas=${thinkingDeltas}` +
        ` | tool_starts=${toolStarts}` +
        ` | tool_ends=${toolEnds}` +
        ` | last_progress=${lastProgressLabel}`;
      EventLog.log(EventType.AGENT_THINKING, agentId, "", summary);

      if (err) {
        EventLog.log(EventType.TASK_FAILED, agentId, "", `${agentLabel} DEBUG: prompt error detail: ${err}`);
      }
    },
  };
}

