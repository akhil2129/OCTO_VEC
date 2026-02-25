/**
 * Common task-management tools shared by all 8 specialist agents.
 * Factory that injects the agent's ID and required dependencies.
 *
 * Tools:
 *   read_my_tasks, read_task_details, update_my_task, read_task_messages
 *
 * Usage:
 *   import { getSpecialistTaskTools } from "./baseSpecialistTools.js";
 *   tools: [...getSpecialistTaskTools("ba", { db, pmQueue, agentQueue }), ...]
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { ATPDatabase } from "../../atp/database.js";
import { MessageQueue } from "../../atp/messageQueue.js";
import { AgentMessageQueue } from "../../atp/agentMessageQueue.js";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";
import { AgentInterrupt } from "../../atp/agentInterrupt.js";

export interface SpecialistTaskDeps {
  db: typeof ATPDatabase;
  pmQueue: typeof MessageQueue;
  agentQueue: typeof AgentMessageQueue;
}

const TASK_ID_RE = /^TASK-\d+$/;

function normalizeTaskId(taskId: string): string {
  return taskId.trim().toUpperCase();
}

function isValidTaskId(taskId: string): boolean {
  return TASK_ID_RE.test(taskId);
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export function getSpecialistTaskTools(agentId: string, deps: SpecialistTaskDeps): AgentTool[] {
  const read_my_tasks: AgentTool = {
    name: "read_my_tasks",
    label: "Read My Tasks",
    description:
      "Read tasks assigned to you from ATP, optionally filtered by status. " +
      "Use this to see what work you have pending or in progress.",
    parameters: Type.Object({
      status: Type.Optional(
        Type.String({
          description: "Filter by status: 'pending', 'in_progress', 'completed', 'failed', or empty for all",
        })
      ),
    }),
    execute: async (_, params: any) => {
      AgentInterrupt.check(agentId);
      const statusFilter = (params.status ?? "").trim().toLowerCase();
      const allowed = new Set(["", "pending", "in_progress", "completed", "failed"]);
      if (!allowed.has(statusFilter)) {
        return ok("ERROR: Invalid status. Use pending, in_progress, completed, failed, or empty.");
      }

      const tasks = deps.db.getTasksForAgent(agentId, statusFilter || undefined);
      if (!tasks.length) {
        return ok(`No tasks found for ${agentId}${statusFilter ? ` with status '${statusFilter}'` : ""}.`);
      }

      const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const statusRank: Record<string, number> = { in_progress: 0, pending: 1, failed: 2, completed: 3 };

      const sorted = [...tasks].sort(
        (a, b) =>
          (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99) ||
          (priorityRank[a.priority] ?? 99) - (priorityRank[b.priority] ?? 99) ||
          a.created_at.localeCompare(b.created_at)
      );

      EventLog.log(EventType.AGENT_TOOL_CALL, agentId, "", `${agentId.toUpperCase()} reading own task queue (filter=${statusFilter || "all"})`);

      const lines = [`${agentId.toUpperCase()} task queue (${sorted.length} task(s)):`];
      for (const t of sorted) {
        lines.push(`- ${t.task_id} | ${t.priority.toUpperCase()} | ${t.status} | ${t.description}`);
      }
      return ok(lines.join("\n"));
    },
  };

  const read_task_details: AgentTool = {
    name: "read_task_details",
    label: "Read Task Details",
    description: "Read full details for a specific ATP task ID assigned to you.",
    parameters: Type.Object({
      task_id: Type.String({ description: "ATP task ID (e.g. 'TASK-001')" }),
    }),
    execute: async (_, params: any) => {
      AgentInterrupt.check(agentId);
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Expected format TASK-XXX.`);
      }

      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`ERROR: Task ${normalizedId} not found.`);
      if (task.agent_id !== agentId) {
        return ok(`ERROR: Task ${normalizedId} is assigned to '${task.agent_id}', not ${agentId}.`);
      }

      EventLog.log(EventType.AGENT_TOOL_CALL, agentId, normalizedId, `${agentId.toUpperCase()} reading details for ${normalizedId}`);

      return ok(
        `Task: ${task.task_id}\n` +
          `  Description: ${task.description}\n` +
          `  Assigned to: ${task.agent_id}\n` +
          `  Priority: ${task.priority}\n` +
          `  Status: ${task.status}\n` +
          `  Folder Access: ${task.folder_access || "N/A"}\n` +
          `  Result: ${task.result || "N/A"}\n` +
          `  Created: ${task.created_at}\n` +
          `  Updated: ${task.updated_at}`
      );
    },
  };

  const update_my_task: AgentTool = {
    name: "update_my_task",
    label: "Update My Task",
    description:
      "Update a task's status in ATP and notify PM. " +
      "Call this when you start, complete, or fail a task.",
    parameters: Type.Object({
      task_id: Type.String({ description: "ATP task ID (e.g. 'TASK-001')" }),
      status: Type.Union(
        [Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("failed")],
        { description: "'in_progress', 'completed', or 'failed'" }
      ),
      result: Type.Optional(
        Type.String({ description: "Deliverable summary or status message (max 4000 chars)" })
      ),
    }),
    execute: async (_, params: any) => {
      AgentInterrupt.check(agentId);
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'.`);
      }

      const task = deps.db.getTask(normalizedId);
      if (!task) return ok(`ERROR: Task ${normalizedId} not found.`);
      if (task.agent_id !== agentId) {
        return ok(`ERROR: Task ${normalizedId} is not assigned to ${agentId}.`);
      }

      const result = (params.result ?? "").slice(0, 4000);
      deps.db.updateTaskStatus(normalizedId, params.status, result);

      deps.pmQueue.pushSimple(
        agentId,
        normalizedId,
        `Task ${normalizedId} status -> ${params.status}: ${result.slice(0, 200)}`,
        "status_update"
      );

      const eventType =
        params.status === "completed"
          ? EventType.TASK_COMPLETED
          : params.status === "failed"
          ? EventType.TASK_FAILED
          : EventType.TASK_IN_PROGRESS;

      EventLog.log(eventType, agentId, normalizedId, `${agentId.toUpperCase()} updated ${normalizedId} -> ${params.status}`);
      EventLog.log(EventType.MESSAGE_SENT, agentId, normalizedId, `${agentId.toUpperCase()} notified PM about ${normalizedId}`);

      return ok(`Task ${normalizedId} updated to '${params.status}'. PM has been notified.`);
    },
  };

  const read_task_messages: AgentTool = {
    name: "read_task_messages",
    label: "Read Task Messages",
    description:
      "Read PM messages for a specific task. Use at checkpoints to check for priority instructions.",
    parameters: Type.Object({
      task_id: Type.String({ description: "ATP task ID (e.g. 'TASK-001')" }),
      priority: Type.Optional(
        Type.Union([Type.Literal("normal"), Type.Literal("priority")], {
          description: "'normal' or 'priority' (default: normal)",
        })
      ),
    }),
    execute: async (_, params: any) => {
      AgentInterrupt.check(agentId);
      const normalizedId = normalizeTaskId(params.task_id);
      if (!isValidTaskId(normalizedId)) {
        return ok(`ERROR: Invalid task ID '${params.task_id}'. Expected format TASK-XXX.`);
      }

      const priority = (params.priority ?? "normal") as "normal" | "priority";
      const messages = deps.agentQueue.popForAgent(agentId, {
        task_id: normalizedId,
        priority,
      });

      if (!messages.length) {
        return ok(`No ${priority} messages for ${normalizedId}.`);
      }

      EventLog.log(EventType.AGENT_TOOL_CALL, agentId, normalizedId, `${agentId.toUpperCase()} read ${messages.length} ${priority} message(s)`);

      const lines = [`${messages.length} ${priority} message(s) for ${normalizedId}:`];
      for (let i = 0; i < messages.length; i++) {
        lines.push(`${i + 1}. [${messages[i].from_agent}] ${messages[i].message}`);
      }
      return ok(lines.join("\n"));
    },
  };

  const self_assign_task: AgentTool = {
    name: "self_assign_task",
    label: "Self-Assign Task",
    description:
      "Create a new task for yourself and mark it in_progress immediately. " +
      "Use this when the founder gives you a direct work request and there is no existing task for it. " +
      "After calling this, the system will automatically route you into full task execution mode.",
    parameters: Type.Object({
      description: Type.String({ description: "Clear description of what needs to be built or done" }),
      priority: Type.Optional(
        Type.Union(
          [Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
          { description: "Task priority (default: high for direct founder requests)" }
        )
      ),
    }),
    execute: async (_, params: any) => {
      AgentInterrupt.check(agentId);
      const priority = (params.priority ?? "high") as string;
      const task = deps.db.createTask(params.description, agentId, priority);
      deps.db.updateTaskStatus(task.task_id, "in_progress");
      EventLog.log(
        EventType.TASK_IN_PROGRESS, agentId, task.task_id,
        `${agentId.toUpperCase()} self-assigned ${task.task_id}: ${params.description}`
      );
      deps.pmQueue.pushSimple(
        agentId, task.task_id,
        `${agentId.toUpperCase()} self-assigned task ${task.task_id} from direct founder request: ${params.description}`,
        "info"
      );
      return ok(
        `Task ${task.task_id} created and marked in_progress.\n` +
        `Description: ${params.description}\n` +
        `The system will now route you into full task execution. Stand by.`
      );
    },
  };

  return [read_my_tasks, read_task_details, update_my_task, read_task_messages, self_assign_task];
}
