/**
 * Background inbox listener for VEC agents.
 * Keeps agents "alive" — they periodically check their inbox and respond to
 * messages from other agents, just like real employees checking their messages.
 *
 * Also includes the PM proactive / event-driven loop.
 *
 * Replaces Python threading.Thread + stop_event.wait() with setInterval.
 * A `running` flag prevents concurrent executions per agent.
 */

import { AgentInbox, AGENT_DISPLAY_NAMES, registerInboxWaker, unregisterInboxWaker } from "./agentMessageQueue.js";
import { EventLog } from "./eventLog.js";
import { EventType } from "./models.js";
import { config } from "../config.js";
import { founder } from "../identity.js";
import { loadAgentMemory } from "../memory/agentMemory.js";

export const POLL_INTERVAL_MS = 15_000; // 15 seconds between inbox checks
export const PM_PROACTIVE_INTERVAL_MS = 60_000; // 60 seconds between PM proactive checks
export const AGENT_PROMPT_TIMEOUT_MS = 120_000; // 2 min max per LLM call

// ── Timeout wrapper ───────────────────────────────────────────────────────────

function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[timeout] ${label} did not respond within ${ms / 1000}s`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Rate-limit helpers ────────────────────────────────────────────────────────

const RETRY_AFTER_RE =
  /Please try again in\s*(?:(?<mins>\d+)m)?\s*(?<secs>\d+(?:\.\d+)?)s/i;
const RETRY_AFTER_MS_RE = /Please try again in\s*(?<ms>\d+(?:\.\d+)?)ms/i;

function isRateLimitError(err: unknown): boolean {
  const text = String(err).toLowerCase();
  return (
    text.includes("rate limit") ||
    text.includes("rate_limit_exceeded") ||
    text.includes("error code: 429")
  );
}

function extractRetryAfterMs(err: unknown, defaultMs = 60_000): number {
  const text = String(err);

  const msMatch = RETRY_AFTER_MS_RE.exec(text);
  if (msMatch?.groups?.ms) {
    return Math.max(5_000, parseFloat(msMatch.groups.ms) + 2_000);
  }

  const m = RETRY_AFTER_RE.exec(text);
  if (!m?.groups) return defaultMs;
  const mins = parseFloat(m.groups.mins ?? "0");
  const secs = parseFloat(m.groups.secs ?? "0");
  const totalMs = (mins * 60 + secs) * 1_000;
  return Math.max(5_000, totalMs + 3_000);
}

// ── Minimal agent interface ───────────────────────────────────────────────────

/** Any VEC agent must expose an inbox and a prompt() method. */
export interface VECAgent {
  readonly inbox: AgentInbox;
  prompt(text: string): Promise<void>;
  /** Clear accumulated LLM conversation history so the next prompt starts fresh. */
  clearHistory(): void;
  /** Abort any in-flight LLM generation immediately (stops mid-stream). */
  abort(): void;
  /**
   * Optional rich task execution path — marks the task in_progress, injects
   * agent memory, builds a detailed prompt, and has interrupt/fallback logic.
   * Preferred over plain prompt() for task dispatch.
   */
  executeTask?(taskId: string): Promise<void>;
  /**
   * True while executeTask() is actively running. Used by the inbox loop to
   * avoid concurrent LLM calls (inbox prompt + task execution at the same time).
   */
  readonly isRunning?: boolean;
  /**
   * Subscribe to the agent's raw LLM events (AgentEvent from pi-agent-core).
   * Used by the inbox loop to detect whether the agent called message_agent
   * in response to a user message (plain-text fallback detection).
   * Returns an unsubscribe function.
   */
  subscribeEvents?(fn: (event: any) => void): () => void;
  /**
   * Queue a message to be processed after the agent's current LLM run finishes.
   * Uses pi-agent-core's Agent.followUp() — safe to call while the agent is busy.
   * Falls back to next poll if not implemented.
   */
  followUp?(text: string): void;
  /**
   * Queue a steering message to interrupt the current run at the next tool boundary.
   * Uses pi-agent-core's Agent.steer() for urgent, mid-task instructions.
   */
  steer?(text: string): void;
}

// ── Message formatting ────────────────────────────────────────────────────────

import type { AgentMessage } from "./models.js";

function formatInboxMessages(messages: AgentMessage[]): string {
  return messages
    .map((msg) => {
      const sender = AGENT_DISPLAY_NAMES[msg.from_agent] ?? msg.from_agent;
      const taskRef = msg.task_id ? ` [re: ${msg.task_id}]` : "";
      const tag = msg.priority === "priority" ? " [PRIORITY]" : "";
      // Include agent key explicitly so agents know what key to use in message_agent()
      return `From ${sender} [key: '${msg.from_agent}']${taskRef}${tag}: ${msg.message}`;
    })
    .join("\n");
}

function isFounderPriorityMessage(msg: AgentMessage): boolean {
  return msg.from_agent.trim().toLowerCase() === "user" && msg.priority === "priority";
}

const STATUS_TRIGGER_EVENT_TYPES = new Set([
  EventType.TASK_STARTED,
  EventType.TASK_IN_PROGRESS,
  EventType.TASK_COMPLETED,
  EventType.TASK_FAILED,
]);
const TASK_ID_RE = /^TASK-\d+$/;

// ── Inbox loop ────────────────────────────────────────────────────────────────

/**
 * Start a background interval that periodically checks an agent's inbox.
 * When messages are found, invokes the agent's prompt() to process them.
 * Returns the interval handle; call clearInterval() to stop.
 */
export function startInboxLoop(
  agent: VECAgent,
  agentId: string,
  pollIntervalMs: number = POLL_INTERVAL_MS,
  afterPrompt?: () => Promise<void>
): NodeJS.Timeout {
  let cooldownUntil = 0; // epoch ms
  let running = false;
  let busyAckSent = false; // true once we've auto-acked the user while isRunning

  // The tick is extracted so it can be called both from setInterval AND from
  // the instant wake trigger fired by AgentMessageQueue.push().
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      if (now < cooldownUntil) return;

      // Skip inbox entirely if the agent's executeTask is actively running.
      // This prevents a concurrent agent.prompt() call from corrupting the
      // ongoing task execution context.
      if (agent.isRunning) {
        // Let the founder know we received their message but are currently busy.
        // Send this acknowledgement only once per busy period so we don't spam.
        if (!busyAckSent && agent.inbox.peek({ from_agent: "user" }).length > 0) {
          agent.inbox.send(
            "user",
            "Sir, I'm currently executing a task. I'll read your message and respond as soon as I'm done.",
            "",
            "normal"
          );
          busyAckSent = true;
          EventLog.log(
            EventType.MESSAGE_SENT, agentId, "",
            `${agentId.toUpperCase()} auto-ack: busy executing task (will respond after)`
          );
        }
        return;
      }
      busyAckSent = false; // Agent is free — reset for next busy period

      if (!agent.inbox.hasMessages()) return;

      // PM-first rule: founder priority messages are shown first.
      // IMPORTANT: We use peek() here, NOT read(). Messages stay in the queue so
      // the agent's read_inbox() tool can still read them. Without this, the agent
      // calls read_inbox(), gets "inbox is empty" (because we already popped them),
      // and concludes there is nothing to do — producing no response.
      // Record timestamp BEFORE peek so cleanup only removes messages that existed
      // at this moment. Any new messages that arrive during the LLM call (which can
      // take 30-120s) will survive the cleanup and be picked up on the next tick.
      const peekTimestamp = new Date().toISOString();
      let messages: AgentMessage[];
      let cleanupOpts: { priority?: string; from_agent?: string; before?: string } | undefined;
      if (agentId === "pm" && agent.inbox.hasMessages({ priority: "priority", from_agent: "user" })) {
        cleanupOpts = { priority: "priority", from_agent: "user", before: peekTimestamp };
        messages = agent.inbox.peek({ priority: "priority", from_agent: "user" });
      } else {
        cleanupOpts = { before: peekTimestamp };
        messages = agent.inbox.peek();
      }
      if (!messages.length) return;

      const inboxText = formatInboxMessages(messages);
      const hasPriority = messages.some((m) => m.priority === "priority");
      const hasFounderPriority = messages.some(isFounderPriorityMessage);

      EventLog.log(
        EventType.AGENT_THINKING,
        agentId,
        "",
        `${agentId.toUpperCase()} inbox dispatch (${messages.length} message(s)) -> starting LLM request`
      );

      // NOTE: History is NOT cleared here — compaction (makeCompactionTransform)
      // keeps context bounded. Clearing here would break multi-turn conversations
      // (user sends two messages 15 s apart and the agent forgets the first one).
      // Tasks call clearMessages() themselves when they need a clean slate.

      // Load agent's memory and prepend to give context
      const memory = loadAgentMemory(agentId);

      // Identity reminder — restate name at the top of the user-turn so models that
      // drift from long system prompts (Kimi K2, Llama-3) stay anchored to their persona.
      const displayName = AGENT_DISPLAY_NAMES[agentId] ?? agentId;
      const firstName = displayName.split(" ")[0];

      let prompt =
        `IDENTITY: You are ${displayName}. Stay fully in character.\n\n` +
        (memory ? `${memory}\n\n` : "") +
        `You have ${messages.length} new message(s) in your inbox:\n\n` +
        `${inboxText}\n\n` +
        "WHAT TO DO NOW (choose the first that applies):\n" +
        `1. GREETING / CASUAL CHAT from ${founder.name}: call message_agent(to_agent='${founder.agentKey}', message='...') immediately. Done.\n` +
        `2. QUESTION or STATUS REQUEST from any agent (pm, ba, dev, etc.): call message_agent(to_agent='<sender_key>', message='...') with a direct reply. Done.\n` +
        `3. BUILD / CREATE request with NO existing task: call self_assign_task(description='...') then STOP.\n` +
        `4. WORK on existing TASK-XXX: call read_task_details('TASK-XXX'), do the work, call update_my_task.\n` +
        `5. INFORMATIONAL only (genuinely no reply needed): do nothing.\n\n` +
        "REPLY RULES:\n" +
        `- To reach ${founder.name} you MUST call message_agent(to_agent='${founder.agentKey}', ...). Plain text responses are invisible.\n` +
        `- Always address ${founder.name} as \"Sir\". Sign off: \"- ${firstName}\".\n` +
        "- Keep replies to 1-3 sentences. Warm, direct.\n" +
        "- Use agent keys when messaging (e.g. 'pm', 'ba', 'dev'), NOT display names.";

      if (agentId === "pm") {
        const hasFounderMessage = messages.some(
          (m) => m.from_agent.trim().toLowerCase() === "user"
        );

        if (hasFounderMessage) {
          // ── Conversation mode: STANDALONE prompt (does NOT use base prompt) ──
          // Two sub-modes: (A) Sir wants a reply, (B) Sir wants you to take action.
          // Standalone so there are no conflicting WHAT TO DO NOW instructions.
          prompt =
            `IDENTITY: You are ${displayName}. Stay fully in character.\n\n` +
            (memory ? `${memory}\n\n` : "") +
            `DIRECT MESSAGE FROM ${founder.name.toUpperCase()}:\n\n` +
            `${inboxText}\n\n` +
            `Read Sir's message and choose ONE path:\n\n` +
            `PATH A — Sir wants a REPLY (question, status check, greeting, info):\n` +
            `  → You MAY call list_all_tasks or read_messages ONCE if needed.\n` +
            `  → Call message_agent(to_agent='${founder.agentKey}', ...) ONCE with your reply.\n` +
            `  → Then STOP. No further tool calls.\n\n` +
            `PATH B — Sir wants you to TAKE AN ACTION (ping agents, create tasks, ask ba/dev, etc.):\n` +
            `  → Do the action(s) first (e.g. message_agent to 'ba', message_agent to 'dev').\n` +
            `  → Then call message_agent(to_agent='${founder.agentKey}', ...) ONCE to confirm.\n` +
            `  → Then STOP.\n\n` +
            `HARD RULES:\n` +
            `  - Max 1 message to Sir per trigger. Never two.\n` +
            `  - Do NOT loop: no repeated check_task_status or read_messages.\n` +
            `  - Do NOT create tasks unless Sir explicitly asked for work to be done.\n` +
            `  - Always address Sir as "Sir". Sign off: "- ${firstName}".`;
        } else {
          // ── Task-management mode: standalone prompt (replaces base WHAT TO DO NOW) ─
          // Agent messages from BA/DEV arrived. PM must relay or ignore — no looping.
          // We do NOT append the base prompt here to avoid conflicting instructions.
          prompt =
            `IDENTITY: You are ${displayName}. Stay fully in character.\n\n` +
            (memory ? `${memory}\n\n` : "") +
            `You have ${messages.length} message(s) from agents in your inbox:\n\n` +
            `${inboxText}\n\n` +
            `RULE: You just received message(s) from your agents. Forward a brief summary to Sir.\n\n` +
            `→ Call message_agent(to_agent='${founder.agentKey}') ONCE with 1-2 line summary.\n` +
            `→ e.g. "Sir, Rohan is idle and ready for next task. No blockers. — Arjun"\n` +
            `→ e.g. "Sir, Kavya completed the analysis and sent results to Dev. — Arjun"\n` +
            `→ Then STOP. No more tool calls.\n\n` +
            `ONLY skip if the agent literally only said "OK", "Got it", or "ACK" with zero substance.\n` +
            `HARD RULES: Max 1 message to Sir. No loops. Do NOT create tasks unless Sir asked.`;
        }
      }

      if (hasPriority) {
        prompt += "\n\nSome messages are marked PRIORITY — handle those first.";
      }
      if (agentId === "pm" && hasFounderPriority) {
        prompt +=
          `\n\nIMPORTANT: Sir sent a PRIORITY message. Reply to him with message_agent ONCE, then STOP completely.`;
      }

      // Subscribe to detect whether the agent calls message_agent.
      // For user messages: capture plain text and auto-forward if model narrates instead of using tools.
      // For PM task-management mode (agent messages only): same — if PM narrates instead of
      // calling message_agent(to_agent='user'), we auto-forward the text to the user.
      const hadUserMessage = messages.some((m) => m.from_agent.trim().toLowerCase() === "user");
      const isPmTaskMode = agentId === "pm" && !hadUserMessage;
      let messageAgentCalled = false;
      let capturedText = "";
      let unsub: (() => void) | undefined;
      if ((hadUserMessage || isPmTaskMode) && agent.subscribeEvents) {
        unsub = agent.subscribeEvents((event: any) => {
          if (event.type === "tool_execution_start" && event.toolName === "message_agent") {
            messageAgentCalled = true;
          }
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta" &&
            event.assistantMessageEvent?.delta
          ) {
            capturedText += event.assistantMessageEvent.delta;
          }
        });
      }

      try {
        await withTimeout(agent.prompt(prompt), AGENT_PROMPT_TIMEOUT_MS, `${agentId} inbox`);

        // Fallback: agent produced plain text but forgot to call message_agent.
        // Auto-forward the captured text so the user actually receives the reply.
        // Covers: (a) user messages to any agent, (b) PM task-management mode.
        if ((hadUserMessage || isPmTaskMode) && !messageAgentCalled && capturedText.trim()) {
          agent.inbox.send("user", capturedText.trim(), "", "normal");
          EventLog.log(
            EventType.MESSAGE_SENT, agentId, "",
            `${agentId.toUpperCase()} auto-forwarded plain-text reply to user (message_agent not called)`
          );
        }

        // Cleanup: consume any messages still in queue (peek left them there).
        // The agent may have already consumed them via read_inbox() — if so,
        // this read() just returns [] harmlessly. If the agent skipped read_inbox,
        // this clears them so they don't re-trigger the inbox loop next tick.
        // NOTE: We only clean up on SUCCESS. On error (catch block below) we leave
        // messages in the queue so they can be retried on the next inbox cycle.
        // cleanupOpts always has `before` set — this only removes messages that existed
        // at peek time, preserving any new messages that arrived during the LLM call.
        agent.inbox.read(cleanupOpts ?? { before: peekTimestamp });

        // After the inbox prompt, if the agent left any tasks in_progress without
        // calling update_my_task, route them through executeTask() for proper
        // completion tracking and re-prompt logic.
        if (afterPrompt) {
          try { await afterPrompt(); } catch (e) { /* never crash the inbox loop */ }
        }
      } catch (err) {
        const errStr = String(err);

        // "Agent is already processing a prompt" — happens when the instant waker
        // fires while the agent is mid-LLM call (e.g. task execution, PM proactive).
        // Use followUp() to queue the message inside pi-agent-core so it is
        // delivered immediately after the current run finishes — no cooldown needed.
        if (errStr.includes("already processing")) {
          if (agent.followUp) {
            agent.followUp(prompt);
            EventLog.log(
              EventType.AGENT_THINKING, agentId, "",
              `${agentId.toUpperCase()} busy — inbox queued as followUp (will process after current LLM run)`
            );
          } else {
            // No followUp support — messages stay via peek(), next poll will retry.
            EventLog.log(
              EventType.AGENT_THINKING, agentId, "",
              `${agentId.toUpperCase()} busy (no followUp) — will retry on next poll tick`
            );
          }
          return; // No cooldown, no error ack to user
        }

        const isRL = isRateLimitError(err);
        let backoffMs = 30_000;
        if (isRL) {
          backoffMs = extractRetryAfterMs(err);
        }
        // Always set a cooldown on error. With peek(), messages stay in queue on
        // failure. Without a cooldown we'd retry every 15 s — which could spam
        // the user with error acks if the problem is persistent.
        cooldownUntil = Date.now() + backoffMs;
        EventLog.log(
          EventType.TASK_FAILED,
          agentId,
          "",
          `${agentId.toUpperCase()} inbox error: ${err} | cooling down ${Math.round(backoffMs / 1000)}s`
        );
        // Acknowledge the human sender once so they know something went wrong.
        try {
          if (messages.some((m) => m.from_agent.trim().toLowerCase() === "user")) {
            agent.inbox.send(
              "user",
              `Sir, I hit an error processing your message. I'll retry in ~${Math.round(backoffMs / 1000)}s.`,
              "",
              "normal"
            );
          }
        } catch {
          // Never let the fallback crash the loop
        }
      } finally {
        unsub?.(); // Always unsubscribe the event listener
      }
    } catch (err) {
      console.error(`[inbox-${agentId}]`, err);
    } finally {
      running = false;
    }
  };

  // Register this agent's tick as an instant waker so any inbound message
  // triggers processing immediately instead of waiting for the poll interval.
  registerInboxWaker(agentId, () => { tick().catch(() => {}); });

  // Also keep the regular poll interval as a fallback (catches missed wakes,
  // handles proactive checks, etc.)
  return setInterval(() => { tick().catch(() => {}); }, pollIntervalMs);
}

// ── PM live loop ──────────────────────────────────────────────────────────────

/**
 * Start PM background intervals:
 * 1. Inbox loop — PM checks and responds to agent messages.
 * 2. Optional event-driven proactive loop — PM reacts to task status updates.
 *
 * Returns array of interval handles.
 */
export function startPmLiveLoop(
  pmAgent: VECAgent,
  proactiveIntervalMs: number = PM_PROACTIVE_INTERVAL_MS,
  inboxIntervalMs: number = POLL_INTERVAL_MS,
  proactiveEnabled: boolean = config.pmProactiveEnabled
): NodeJS.Timeout[] {
  const handles: NodeJS.Timeout[] = [];

  // 1. PM inbox loop (same as other agents)
  handles.push(startInboxLoop(pmAgent, "pm", inboxIntervalMs));

  if (!proactiveEnabled) return handles;

  // 2. PM event-driven follow-up loop
  let cooldownUntil = 0;
  let lastSeenTs = "";
  let running = false;

  // Slight startup delay so agents are ready first.
  const proactiveHandle = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      if (now < cooldownUntil) return;

      const newEvents = EventLog.getEvents(200, lastSeenTs);
      if (newEvents.length) {
        lastSeenTs = newEvents[newEvents.length - 1].timestamp ?? lastSeenTs;
      }

      const statusUpdates = newEvents.filter(
        (e) =>
          STATUS_TRIGGER_EVENT_TYPES.has(e.event_type as EventType) &&
          TASK_ID_RE.test((e.task_id ?? "").trim().toUpperCase()) &&
          (e.agent_id ?? "").trim().toLowerCase() !== "pm"
      );

      if (!statusUpdates.length) return;

      const updatesBlock = statusUpdates
        .slice(-12)
        .map(
          (e) =>
            `- [${e.event_type}] task=${e.task_id || "-"} agent=${e.agent_id || "-"} msg=${e.message || ""}`
        )
        .join("\n");

      const prompt =
        `SYSTEM TRIGGER: Task status updates detected. Act as ${founder.name}'s autonomous PM.\n\n` +
        `Recent updates:\n${updatesBlock}\n\n` +
        "YOUR RULES — act autonomously, minimise interruptions to Sir:\n\n" +
        "ON TASK COMPLETED:\n" +
        `  → Always call message_agent(to_agent='${founder.agentKey}') with a brief one-line completion notice.\n` +
        "  → Tell Sir what was done and where the output is (check task result or read_messages for details).\n" +
        "  → Keep it to 1-2 sentences. No fluff.\n\n" +
        "ON TASK FAILED:\n" +
        "  → First call restart_task to auto-retry once — do NOT disturb Sir for the first failure.\n" +
        `  → If it fails again after restart: call message_agent(to_agent='${founder.agentKey}') explaining the blocker.\n\n` +
        "ON TASK IN_PROGRESS (no change):\n" +
        "  → Do nothing. Agents are working.\n\n" +
        "HARD RULES:\n" +
        "  - Do NOT create new tasks unless Sir explicitly asked in a previous message.\n" +
        "  - Do NOT send greetings, check-ins, or 'all good' updates.\n" +
        `  - Always address Sir as 'Sir'. Sign off as '- Arjun'.\n` +
        "  - One message per proactive trigger — don't send multiple messages.";

      EventLog.log(
        EventType.AGENT_THINKING,
        "pm",
        "",
        `PM proactive trigger (${statusUpdates.length} status update(s)) -> starting LLM request`
      );

      pmAgent.clearHistory();

      try {
        await withTimeout(pmAgent.prompt(prompt), AGENT_PROMPT_TIMEOUT_MS, "pm proactive");
      } catch (err) {
        const errStr = String(err);
        // PM inbox loop may be active at the same time — queue as followUp instead of crashing.
        if (errStr.includes("already processing")) {
          if (pmAgent.followUp) {
            pmAgent.followUp(prompt);
            EventLog.log(EventType.AGENT_THINKING, "pm", "",
              "PM proactive queued as followUp (inbox loop was active)");
          } else {
            EventLog.log(EventType.AGENT_THINKING, "pm", "",
              "PM proactive skipped (busy, no followUp) — will retry next interval");
          }
          return;
        }
        const isRL = isRateLimitError(err);
        if (isRL) {
          cooldownUntil = Date.now() + extractRetryAfterMs(err);
        }
        EventLog.log(
          EventType.TASK_FAILED,
          "pm",
          "",
          `PM proactive loop error: ${err}` +
            (isRL ? ` | cooling down for ${Math.round((cooldownUntil - Date.now()) / 1000)}s` : "")
        );
      }
    } catch (err) {
      console.error("[pm-proactive]", err);
    } finally {
      running = false;
    }
  }, proactiveIntervalMs);

  handles.push(proactiveHandle);
  return handles;
}

// ── Start all inbox loops ─────────────────────────────────────────────────────

/**
 * Start inbox loops for all agents in the registry (except PM, which uses startPmLiveLoop).
 * Returns all interval handles — call clearInterval on each to stop.
 */
export function startAllInboxLoops(
  agentRegistry: Map<string, VECAgent>,
  pollIntervalMs: number = POLL_INTERVAL_MS,
  afterPromptFactory?: (agentId: string, agent: VECAgent) => (() => Promise<void>) | undefined
): NodeJS.Timeout[] {
  const handles: NodeJS.Timeout[] = [];
  for (const [agentId, agent] of agentRegistry) {
    const afterPrompt = afterPromptFactory?.(agentId, agent);
    handles.push(startInboxLoop(agent, agentId, pollIntervalMs, afterPrompt));
  }
  return handles;
}
