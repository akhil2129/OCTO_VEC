/**
 * PM task-management tools for VEC-ATP.
 * Factory that injects database, message queue, agent queue, and agent registry.
 *
 * Tools:
 *   create_and_assign_task, start_task, start_tasks,
 *   send_task_message, send_priority_message,
 *   check_task_status, list_all_tasks, read_messages
 *
 * Usage:
 *   import { getPMTaskTools } from "./taskTools.js";
 *   tools: [...getPMTaskTools({ db, pmQueue, agentQueue, agents }), ...]
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { ATPDatabase } from "../../atp/database.js";
import { MessageQueue } from "../../atp/messageQueue.js";
import { AgentMessageQueue } from "../../atp/agentMessageQueue.js";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";
import type { VECAgent } from "../../atp/inboxLoop.js";
import { AGENT_PROMPT_TIMEOUT_MS } from "../../atp/inboxLoop.js";
import { AgentInterrupt } from "../../atp/agentInterrupt.js";

const TASK_PROMPT_TIMEOUT_MS = AGENT_PROMPT_TIMEOUT_MS * 3; // tasks may take longer than inbox replies

function withTimeout(promise: Promise<void>, ms: number, label: string): Promise<void> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[timeout] ${label} did not complete within ${ms / 1000}s`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface PMTaskToolDeps {
  db: typeof ATPDatabase;
  pmQueue: typeof MessageQueue;
  agentQueue: typeof AgentMessageQueue;
  agents: Map<string, VECAgent>;
}

const TASK_ID_RE = /^TASK-\d+$/;

function normalizeTaskId(taskId: string): string {
  return taskId.trim().toUpperCase();
}

function isValidTaskId(taskId: string): boolean {
  return TASK_ID_RE.test(taskId);
}

/** Resolve "today", "tomorrow", or "YYYY-MM-DD" to a "YYYY-MM-DD" string. */
function resolveScheduledDate(input: string): string {
  const s = input.trim().toLowerCase();
  const today = new Date();
  if (s === "today") return today.toISOString().slice(0, 10);
  if (s === "tomorrow") {
    today.setDate(today.getDate() + 1);
    return today.toISOString().slice(0, 10);
  }
  // Validate YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return input.trim();
  return ""; // invalid — treat as immediate
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ── Background task runner ────────────────────────────────────────────────────

function runAgentInBackground(
  agent: VECAgent,
  taskId: string,
  agentId: string,
  deps: PMTaskToolDeps
): void {
  // Fire and forget — do NOT await
  // Clear any accumulated conversation history so the task starts from a clean
  // context (inbox replies from prior turns must not pollute the task prompt).
  agent.clearHistory();

  const taskPrompt =
    `You have been assigned ATP Task ${taskId}. ` +
    `Start by reading task details, then complete the work and update task status when done.`;

  withTimeout(agent.prompt(taskPrompt), TASK_PROMPT_TIMEOUT_MS, `${agentId} task ${taskId}`)
    .then(() => {
      // Agent handles status updates via update_my_task; log completion here as a safety check
      const latest = deps.db.getTask(taskId);
      if (latest && latest.status === "in_progress") {
        // Agent returned without calling update_my_task — force-complete
        deps.db.updateTaskStatus(taskId, "completed", "Agent finished but did not call update_my_task.");
        deps.pmQueue.pushSimple(agentId, taskId, `Task ${taskId} auto-completed (agent returned without status update).`, "status_update");
        EventLog.log(EventType.TASK_COMPLETED, agentId, taskId, `${agentId.toUpperCase()} auto-completed ${taskId} (no explicit update)`);
      }
    })
    .catch((e: unknown) => {
      deps.db.updateTaskStatus(taskId, "failed", `Agent error: ${e}`);
      deps.pmQueue.pushSimple(agentId, taskId, `Task ${taskId} FAILED with error: ${e}`, "error");
      EventLog.log(EventType.TASK_FAILED, agentId, taskId, `${agentId.toUpperCase()} agent crashed on ${taskId}: ${e}`);
    });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function startTaskInternal(taskId: string, deps: PMTaskToolDeps): string {
  const normalizedId = normalizeTaskId(taskId);
  if (!isValidTaskId(normalizedId)) {
    return `ERROR: Invalid task ID '${taskId}'. Use format TASK-001.`;
  }

  const task = deps.db.getTask(normalizedId);
  if (!task) return `ERROR: Task ${normalizedId} not found.`;

  if (task.status === "in_progress") {
    return `ACK: ${normalizedId} is already running on ${task.agent_id}.`;
  }
  if (task.status === "completed") {
    return `ACK: ${normalizedId} is already completed.`;
  }
  if (task.status !== "pending" && task.status !== "failed") {
    return `Task ${normalizedId} is already ${task.status}.`;
  }

  // Block tasks scheduled for a future date
  if (task.scheduled_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (task.scheduled_date > today) {
      return `ACK: ${normalizedId} is scheduled for ${task.scheduled_date} — not starting yet. It will be auto-released on that date.`;
    }
  }

  const agent = deps.agents.get(task.agent_id);
  if (!agent) {
    return `ERROR: No agent found for agent_id '${task.agent_id}'. Available: ${[...deps.agents.keys()].join(", ")}`;
  }

  EventLog.log(EventType.PM_DELEGATING, "pm", normalizedId, `Delegating ${normalizedId} to ${task.agent_id} agent`);
  EventLog.log(EventType.TASK_STARTED, task.agent_id, normalizedId, `${task.agent_id.toUpperCase()} agent dispatched for ${normalizedId}`);

  // Prefer the rich executeTask() path (marks in_progress, injects memory, detailed prompt)
  // over the generic agent.prompt() fallback.
  if (typeof agent.executeTask === "function") {
    const agentId = task.agent_id;
    withTimeout(agent.executeTask(normalizedId), TASK_PROMPT_TIMEOUT_MS, `${agentId} task ${normalizedId}`)
      .catch((e: unknown) => {
        deps.db.updateTaskStatus(normalizedId, "failed", `Agent error: ${e}`);
        deps.pmQueue.pushSimple(agentId, normalizedId, `Task ${normalizedId} FAILED with error: ${e}`, "error");
        EventLog.log(EventType.TASK_FAILED, agentId, normalizedId, `${agentId.toUpperCase()} agent crashed on ${normalizedId}: ${e}`);
      });
  } else {
    runAgentInBackground(agent, normalizedId, task.agent_id, deps);
  }

  return `ACK: Dispatched ${normalizedId} to ${task.agent_id}; running asynchronously.`;
}

function sendMessageToAssignee(
  taskId: string,
  message: string,
  priority: "normal" | "priority",
  deps: PMTaskToolDeps
): string {
  const normalizedId = normalizeTaskId(taskId);
  if (!isValidTaskId(normalizedId)) {
    return `ERROR: Invalid task ID '${taskId}'. Use format TASK-001.`;
  }

  const task = deps.db.getTask(normalizedId);
  if (!task) return `ERROR: Task ${normalizedId} not found.`;

  deps.agentQueue.push("pm", task.agent_id, normalizedId, message, priority);

  EventLog.log(EventType.MESSAGE_SENT, "pm", normalizedId, `PM sent ${priority} message to ${task.agent_id} for ${normalizedId}`, message.slice(0, 500));

  let runtimeNote = "";
  if (priority === "priority") {
    const liveAgent = deps.agents.get(task.agent_id);
    if (liveAgent?.isRunning) {
      const urgentPrompt =
        `PRIORITY MESSAGE FROM PM for ${normalizedId}:\n${message}\n\n` +
        "Handle this immediately and adapt your current execution now.";
      try {
        if (typeof liveAgent.steer === "function") {
          liveAgent.steer(urgentPrompt);
          runtimeNote = " Live steer injected into the running agent.";
          EventLog.log(EventType.MESSAGE_SENT, "pm", normalizedId, `PM steered ${task.agent_id} for ${normalizedId}`);
        } else if (typeof liveAgent.followUp === "function") {
          liveAgent.followUp(urgentPrompt);
          runtimeNote = " Agent has no steer(); queued as immediate follow-up.";
          EventLog.log(EventType.MESSAGE_SENT, "pm", normalizedId, `PM queued follow-up to ${task.agent_id} for ${normalizedId}`);
        }
      } catch (err) {
        EventLog.log(
          EventType.AGENT_TOOL_CALL,
          "pm",
          normalizedId,
          `PM failed runtime priority delivery to ${task.agent_id} for ${normalizedId}: ${String(err)}`
        );
      }
    }
  }

  const tag = priority === "priority" ? "PRIORITY" : "MSG";
  const note = task.status === "pending"
    ? " NOTE: Task is still pending; start it for the agent to handle this now."
    : "";
  return `ACK: [${tag}] sent to ${task.agent_id} for ${normalizedId}.${runtimeNote}${note}`;
}

// ── Scheduled task auto-release ───────────────────────────────────────────────

/**
 * Dispatch all pending tasks whose scheduled_date is today or earlier.
 * Called at startup and hourly from tower.ts so tasks auto-release on their date.
 */
export function releaseDueTasks(deps: PMTaskToolDeps): void {
  const dueTasks = deps.db.getDueTasks();
  for (const task of dueTasks) {
    EventLog.log(
      EventType.PM_DELEGATING, "system", task.task_id,
      `Scheduler: auto-releasing ${task.task_id} (scheduled=${task.scheduled_date})`
    );
    startTaskInternal(task.task_id, deps);
  }
}

// ── Tool factory ──────────────────────────────────────────────────────────────

export function getPMTaskTools(deps: PMTaskToolDeps): AgentTool[] {
  const create_and_assign_task: AgentTool = {
    name: "create_and_assign_task",
    label: "Create & Assign Task",
    description:
      "Create a new task in the Agent Task Portal and assign it to an agent. " +
      "Optionally auto-starts (dispatches) the task immediately.",
    parameters: Type.Object({
      description: Type.String({ description: "What the agent needs to do" }),
      agent_id: Type.String({
        description: "Which agent to assign: ba, dev, qa, security, devops, techwriter, architect, researcher",
      }),
      priority: Type.Optional(
        Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")], {
          description: "'high', 'medium', or 'low' (default: medium)",
        })
      ),
      folder_access: Type.Optional(
        Type.String({ description: "Comma-separated file/folder paths the agent can access" })
      ),
      scheduled_date: Type.Optional(
        Type.String({
          description: "When to run this task. Use 'today', 'tomorrow', or 'YYYY-MM-DD'. Omit for immediate dispatch.",
        })
      ),
      auto_start: Type.Optional(
        Type.Boolean({ description: "If true (default), immediately dispatch the task to the agent" })
      ),
    }),
    execute: async (_, params: any) => {
      const agentId = params.agent_id.trim().toLowerCase();
      if (!deps.agents.has(agentId)) {
        return ok(`ERROR: Unknown agent_id '${params.agent_id}'. You must use the agent_id (e.g. 'architect', 'dev', 'ba'), NOT the agent's name. Available IDs: ${[...deps.agents.keys()].filter(k => k !== "pm").join(", ")}`);
      }

      const scheduledDate = params.scheduled_date ? resolveScheduledDate(params.scheduled_date) : "";
      const today = new Date().toISOString().slice(0, 10);
      const isFuture = scheduledDate && scheduledDate > today;

      const task = deps.db.createTask(
        params.description,
        agentId,
        params.priority ?? "medium",
        params.folder_access ?? "",
        scheduledDate
      );

      const scheduleNote = scheduledDate ? ` scheduled=${scheduledDate}` : "";
      EventLog.log(EventType.TASK_CREATED, "pm", task.task_id, `Created ${task.task_id} and assigned to ${agentId}${scheduleNote}`, params.description);

      const createdAck = scheduledDate
        ? `ACK: Assigned ${task.task_id} to ${task.agent_id} (priority=${task.priority}, scheduled=${scheduledDate}). Will auto-start on that date.`
        : `ACK: Assigned ${task.task_id} to ${task.agent_id} (priority=${task.priority}, status=${task.status}).`;

      // If scheduled for a future date, never auto-start — it will be released by the scheduler
      if (isFuture) return ok(createdAck);

      const autoStart = params.auto_start !== false; // default true
      if (!autoStart) return ok(createdAck);

      const dispatchAck = startTaskInternal(task.task_id, deps);
      return ok(`${createdAck}\n${dispatchAck}`);
    },
  };

  const start_task: AgentTool = {
    name: "start_task",
    label: "Start Task",
    description:
      "Start execution of a task. Dispatches the task to the assigned agent who works asynchronously. " +
      "Use read_messages later to check for completion notifications.",
    parameters: Type.Object({
      task_id: Type.String({ description: "The task ID to start (e.g. 'TASK-001')" }),
    }),
    execute: async (_, params: any) => ok(startTaskInternal(params.task_id, deps)),
  };

  const start_tasks: AgentTool = {
    name: "start_tasks",
    label: "Start Multiple Tasks",
    description: "Start multiple tasks asynchronously in one call.",
    parameters: Type.Object({
      task_ids: Type.String({
        description: "Comma or space-separated task IDs (e.g. 'TASK-001,TASK-002')",
      }),
    }),
    execute: async (_, params: any) => {
      const parts = params.task_ids.trim().split(/[\s,]+/).filter(Boolean);
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const part of parts) {
        const n = normalizeTaskId(part);
        if (!seen.has(n)) { seen.add(n); ids.push(n); }
      }
      if (!ids.length) return ok("ERROR: No task IDs provided. Example: TASK-001,TASK-002");
      const results = ids.map((id) => startTaskInternal(id, deps));
      return ok(results.join("\n\n"));
    },
  };

  const send_task_message: AgentTool = {
    name: "send_task_message",
    label: "Send Task Message",
    description:
      "Send a normal (non-interrupting) message to the agent assigned to a task. " +
      "The message is queued for the agent to read at its next checkpoint.",
    parameters: Type.Object({
      task_id: Type.String({ description: "ATP task ID (e.g. 'TASK-001')" }),
      message: Type.String({ description: "The message content" }),
    }),
    execute: async (_, params: any) =>
      ok(sendMessageToAssignee(params.task_id, params.message, "normal", deps)),
  };

  const send_priority_message: AgentTool = {
    name: "send_priority_message",
    label: "Send Priority Message",
    description:
      "Send a priority interrupt message to the agent assigned to a task. " +
      "The agent should interrupt current flow and handle this first.",
    parameters: Type.Object({
      task_id: Type.String({ description: "ATP task ID (e.g. 'TASK-001')" }),
      message: Type.String({ description: "The urgent message content" }),
    }),
    execute: async (_, params: any) =>
      ok(sendMessageToAssignee(params.task_id, params.message, "priority", deps)),
  };

  const check_task_status: AgentTool = {
    name: "check_task_status",
    label: "Check Task Status",
    description: "Check the current status of a task in ATP.",
    parameters: Type.Object({
      task_id: Type.String({ description: "The task ID to check (e.g. 'TASK-001')" }),
    }),
    execute: async (_, params: any) => {
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Use format TASK-001.`);
      }
      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`Task ${normalizedId} not found.`);
      const text =
        `Task: ${task.task_id}\n` +
        `  Description: ${task.description}\n` +
        `  Agent: ${task.agent_id}\n` +
        `  Priority: ${task.priority}\n` +
        `  Status: ${task.status}\n` +
        `  Result: ${task.result || "N/A"}\n` +
        `  Created: ${task.created_at}\n` +
        `  Updated: ${task.updated_at}`;
      return ok(text);
    },
  };

  const list_all_tasks: AgentTool = {
    name: "list_all_tasks",
    label: "List All Tasks",
    description:
      "Show the ATP task board with all tasks. " +
      "Optionally filter by status: pending, in_progress, completed, failed.",
    parameters: Type.Object({
      status_filter: Type.Optional(
        Type.String({
          description: "Filter by status: 'pending', 'in_progress', 'completed', 'failed', or empty for all",
        })
      ),
    }),
    execute: async (_, params: any) => {
      const status = (params.status_filter ?? "").trim().toLowerCase();
      const allowed = new Set(["", "pending", "in_progress", "completed", "failed"]);
      if (!allowed.has(status)) {
        return ok("ERROR: Invalid status filter. Use pending, in_progress, completed, failed, or empty.");
      }
      if (!status) return ok(deps.db.taskBoard());
      const tasks = deps.db.getAllTasks(status);
      if (!tasks.length) return ok(`No tasks found with status '${status}'.`);
      const header = `${"ID".padEnd(10)} ${"Agent".padEnd(8)} ${"Priority".padEnd(8)} ${"Status".padEnd(14)} Description`;
      const sep = "-".repeat(70);
      const rows = tasks.map(
        (t) =>
          `${t.task_id.padEnd(10)} ${t.agent_id.padEnd(8)} ${t.priority.padEnd(8)} ${t.status.padEnd(14)} ${t.description.substring(0, 35)}`
      );
      return ok([`Tasks with status '${status}'`, header, sep, ...rows].join("\n"));
    },
  };

  const read_messages: AgentTool = {
    name: "read_messages",
    label: "Read PM Messages",
    description:
      "Read and clear all messages from your PM inbox queue. " +
      "Other agents send you status updates here when they complete tasks.",
    parameters: Type.Object({}),
    execute: async () => {
      EventLog.log(EventType.PM_READING_QUEUE, "pm", "", "PM checking inbox");
      if (deps.pmQueue.isEmpty()) return ok("No new messages in your inbox.");
      const messages = deps.pmQueue.popAll();
      const lines = [`You have ${messages.length} message(s):\n`];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        lines.push(`  ${i + 1}. [${msg.from_agent}] Task ${msg.task_id}: ${msg.message}`);
      }
      return ok(lines.join("\n"));
    },
  };

  const cancel_task: AgentTool = {
    name: "cancel_task",
    label: "Cancel Task",
    description:
      "Mark a task as cancelled (inactive) without deleting it. " +
      "Use when a task is no longer needed but you want to keep the record. " +
      "If the task is currently running, interrupt the agent first.",
    parameters: Type.Object({
      task_id: Type.String({ description: "The task ID to cancel (e.g. 'TASK-001')" }),
      reason: Type.Optional(Type.String({ description: "Why the task is being cancelled" })),
    }),
    execute: async (_, params: any) => {
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Use format TASK-001.`);
      }
      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`ERROR: Task ${normalizedId} not found.`);
      if (task.status === "cancelled") return ok(`ACK: ${normalizedId} is already cancelled.`);
      const reason = (params.reason ?? "Cancelled by PM").slice(0, 300);
      deps.db.updateTaskStatus(normalizedId, "cancelled", reason);
      EventLog.log(EventType.TASK_FAILED, "pm", normalizedId, `PM cancelled ${normalizedId}: ${reason}`);
      return ok(`ACK: ${normalizedId} marked as cancelled.\nReason: ${reason}`);
    },
  };

  const delete_task: AgentTool = {
    name: "delete_task",
    label: "Delete Task",
    description:
      "Permanently delete a task from ATP. This cannot be undone. " +
      "Only delete tasks that are completed, failed, or cancelled. " +
      "Do NOT delete in-progress tasks — cancel or interrupt them first.",
    parameters: Type.Object({
      task_id: Type.String({ description: "The task ID to delete permanently (e.g. 'TASK-001')" }),
    }),
    execute: async (_, params: any) => {
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Use format TASK-001.`);
      }
      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`ERROR: Task ${normalizedId} not found.`);
      if (task.status === "in_progress") {
        return ok(`ERROR: ${normalizedId} is currently in_progress. Cancel or interrupt it first.`);
      }
      const deleted = deps.db.deleteTask(normalizedId);
      if (!deleted) return ok(`ERROR: Could not delete ${normalizedId}.`);
      EventLog.log(EventType.TASK_FAILED, "pm", normalizedId, `PM permanently deleted ${normalizedId}`);
      return ok(`ACK: ${normalizedId} permanently deleted from ATP.`);
    },
  };

  const interrupt_agent: AgentTool = {
    name: "interrupt_agent",
    label: "Interrupt Agent",
    description:
      "Request an immediate stop for an agent that is currently executing a task. " +
      "The agent will throw at its next tool call boundary and the task will be marked failed. " +
      "Use when a task needs to be cancelled, reprioritised, or the agent is misbehaving.",
    parameters: Type.Object({
      agent_id: Type.String({
        description: "The agent to interrupt: ba, dev, qa, security, devops, techwriter, architect, researcher",
      }),
      reason: Type.Optional(
        Type.String({ description: "Why the agent is being interrupted (included in the failure log)" })
      ),
    }),
    execute: async (_, params: any) => {
      const agentId = params.agent_id.trim().toLowerCase();
      if (!deps.agents.has(agentId)) {
        return ok(`ERROR: Unknown agent '${agentId}'. Available: ${[...deps.agents.keys()].join(", ")}`);
      }
      const reason = (params.reason ?? "Interrupted by PM").slice(0, 200);
      // 1. Native abort — stops LLM generation mid-stream immediately
      deps.agents.get(agentId)?.abort();
      // 2. Flag fallback — caught at the next tool boundary if abort didn't fully stop the loop
      AgentInterrupt.request(agentId, reason);
      EventLog.log(EventType.TASK_FAILED, "pm", "", `PM requested interrupt for ${agentId}: ${reason}`);
      return ok(`ACK: ${agentId} aborted (mid-stream) + flagged (next tool boundary).\nReason: ${reason}`);
    },
  };

  const unblock_agent: AgentTool = {
    name: "unblock_agent",
    label: "Unblock Agent",
    description:
      "Clear any pending interrupt flag for an agent so they can run tools again. " +
      "Use when Sir asks to 'unblock' or 'clear the stop' on an agent. " +
      "Note: interrupts are one-shot and self-clear on the next tool call anyway — " +
      "this tool is for safety if an interrupt is still pending before the agent's next tool boundary.",
    parameters: Type.Object({
      agent_id: Type.String({
        description: "The agent to unblock: ba, dev, qa, security, devops, techwriter, architect, researcher",
      }),
    }),
    execute: async (_, params: any) => {
      const agentId = params.agent_id.trim().toLowerCase();
      AgentInterrupt.clear(agentId);
      EventLog.log(EventType.AGENT_TOOL_CALL, "pm", "", `PM cleared interrupt flag for ${agentId}`);
      return ok(
        `ACK: ${agentId} interrupt flag cleared. They can now run tool calls freely.\n` +
        `Note: Interrupts are one-shot — if the flag already fired, ${agentId} was already unblocked.`
      );
    },
  };

  const restart_task: AgentTool = {
    name: "restart_task",
    label: "Restart Task",
    description:
      "Force-restart a task regardless of its current status. " +
      "Aborts the agent if in_progress, resets the task to pending, then re-dispatches it. " +
      "Use when a task is stuck, stalled, or needs to be re-executed from scratch.",
    parameters: Type.Object({
      task_id: Type.String({ description: "The task ID to restart (e.g. 'TASK-001')" }),
      reason: Type.Optional(Type.String({ description: "Why the task is being restarted (for the log)" })),
    }),
    execute: async (_, params: any) => {
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Use format TASK-001.`);
      }
      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`ERROR: Task ${normalizedId} not found.`);
      if (task.status === "cancelled") {
        return ok(`ERROR: ${normalizedId} is cancelled. Create a new task instead.`);
      }

      const reason = (params.reason ?? "Restarted by PM").slice(0, 200);

      // Abort + clear interrupt flag for the agent if it might be running
      const agent = deps.agents.get(task.agent_id);
      if (agent) {
        agent.abort();
        AgentInterrupt.request(task.agent_id, reason);
      }

      // Reset task to pending so startTaskInternal can dispatch it
      deps.db.updateTaskStatus(normalizedId, "pending", `Restarting: ${reason}`);
      EventLog.log(EventType.TASK_CREATED, "pm", normalizedId, `PM restarting ${normalizedId}: ${reason}`);

      const dispatchAck = startTaskInternal(normalizedId, deps);
      return ok(`ACK: ${normalizedId} reset to pending and re-dispatched.\n${dispatchAck}`);
    },
  };

  const reschedule_task: AgentTool = {
    name: "reschedule_task",
    label: "Reschedule Task",
    description:
      "Change the scheduled date of a pending task. Use 'today', 'tomorrow', 'YYYY-MM-DD', or '' to make it immediate.",
    parameters: Type.Object({
      task_id: Type.String({ description: "The task ID to reschedule (e.g. 'TASK-001')" }),
      scheduled_date: Type.String({
        description: "New date: 'today', 'tomorrow', 'YYYY-MM-DD', or '' to release immediately",
      }),
    }),
    execute: async (_, params: any) => {
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Use format TASK-001.`);
      }
      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`ERROR: Task ${normalizedId} not found.`);
      if (task.status !== "pending") {
        return ok(`ERROR: Can only reschedule pending tasks. ${normalizedId} is ${task.status}.`);
      }

      const newDate = params.scheduled_date ? resolveScheduledDate(params.scheduled_date) : "";
      deps.db.updateTaskScheduledDate(normalizedId, newDate);
      EventLog.log(EventType.TASK_CREATED, "pm", normalizedId, `PM rescheduled ${normalizedId} to '${newDate || "immediate"}'`);

      const today = new Date().toISOString().slice(0, 10);
      if (!newDate || newDate <= today) {
        // Release immediately
        const dispatchAck = startTaskInternal(normalizedId, deps);
        return ok(`ACK: ${normalizedId} rescheduled to immediate — dispatching now.\n${dispatchAck}`);
      }
      return ok(`ACK: ${normalizedId} rescheduled to ${newDate}. Will auto-start on that date.`);
    },
  };

  return [
    create_and_assign_task,
    start_task,
    start_tasks,
    restart_task,
    reschedule_task,
    send_task_message,
    send_priority_message,
    check_task_status,
    list_all_tasks,
    read_messages,
    cancel_task,
    delete_task,
    interrupt_agent,
    unblock_agent,
  ];
}
