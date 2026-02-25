/**
 * Inter-agent messaging tools for VEC agents.
 * Factory that injects the agent's AgentInbox instance.
 *
 * Tools: message_agent, read_inbox, broadcast_message
 *
 * Usage:
 *   import { getMessagingTools } from "./messagingTools.js";
 *   tools: [...getMessagingTools("ba", inbox), ...]
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AgentInbox } from "../../atp/agentMessageQueue.js";
import { AGENT_DISPLAY_NAMES, ALL_AGENT_IDS } from "../../atp/agentMessageQueue.js";
import { founder } from "../../identity.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export function getMessagingTools(agentId: string, inbox: AgentInbox): AgentTool[] {
  const message_agent: AgentTool = {
    name: "message_agent",
    label: "Message Agent",
    description:
      "Send a message to another VEC agent. " +
      `Valid agent keys: ${[...ALL_AGENT_IDS].filter((id) => id !== agentId && id !== "user").join(", ")}, user. ` +
      `Use 'user' to contact ${founder.name} (the founder).`,
    parameters: Type.Object({
      to_agent: Type.String({
        description: "Agent key to send to (e.g. 'pm', 'dev', 'ba', 'user')",
      }),
      message: Type.String({ description: "The message content" }),
      task_id: Type.Optional(
        Type.String({ description: "Related ATP task ID (e.g. TASK-001)" })
      ),
      priority: Type.Optional(
        Type.Union([Type.Literal("normal"), Type.Literal("priority")], {
          description: "'normal' or 'priority'. Use 'priority' only for urgent/blocking issues.",
        })
      ),
    }),
    execute: async (_, params: any) => {
      const toAgent = params.to_agent.trim().toLowerCase();
      if (!ALL_AGENT_IDS.has(toAgent)) {
        return ok(
          `ERROR: Unknown agent key '${params.to_agent}'. Valid keys: ${[...ALL_AGENT_IDS].join(", ")}`
        );
      }
      if (toAgent === agentId) {
        return ok("ERROR: Cannot message yourself.");
      }
      const sent = inbox.send(
        toAgent,
        params.message,
        params.task_id ?? "",
        (params.priority as "normal" | "priority" | undefined) ?? "normal"
      );
      const displayName = AGENT_DISPLAY_NAMES[toAgent] ?? toAgent;
      return ok(`Message sent to ${displayName}${sent.task_id ? ` [${sent.task_id}]` : ""}.`);
    },
  };

  const read_inbox: AgentTool = {
    name: "read_inbox",
    label: "Read Inbox",
    description:
      "Read and consume all messages from your inbox. " +
      `Use this to check for messages from other agents or ${founder.name}.`,
    parameters: Type.Object({
      task_id: Type.Optional(
        Type.String({ description: "Filter by task ID (optional)" })
      ),
      from_agent: Type.Optional(
        Type.String({ description: "Filter by sender agent key (optional)" })
      ),
      priority: Type.Optional(
        Type.Union([Type.Literal("normal"), Type.Literal("priority")], {
          description: "Filter by priority (optional)",
        })
      ),
    }),
    execute: async (_, params: any) => {
      const messages = inbox.read({
        task_id: params.task_id,
        from_agent: params.from_agent,
        priority: params.priority as "normal" | "priority" | undefined,
      });
      if (!messages.length) return ok("Your inbox is empty.");
      const lines = messages.map((msg, i) => {
        const sender = AGENT_DISPLAY_NAMES[msg.from_agent] ?? msg.from_agent;
        const taskRef = msg.task_id ? ` [re: ${msg.task_id}]` : "";
        const tag = msg.priority === "priority" ? " [PRIORITY]" : "";
        return `${i + 1}. From ${sender}${taskRef}${tag}: ${msg.message}`;
      });
      return ok(`${messages.length} message(s):\n${lines.join("\n")}`);
    },
  };

  const broadcast_message: AgentTool = {
    name: "broadcast_message",
    label: "Broadcast Message",
    description:
      "Send the same message to ALL other VEC agents simultaneously. " +
      "Use sparingly — only for truly team-wide announcements.",
    parameters: Type.Object({
      message: Type.String({ description: "The message to broadcast to everyone" }),
      task_id: Type.Optional(
        Type.String({ description: "Related ATP task ID (optional)" })
      ),
      priority: Type.Optional(
        Type.Union([Type.Literal("normal"), Type.Literal("priority")], {
          description: "'normal' or 'priority'",
        })
      ),
    }),
    execute: async (_, params: any) => {
      const sent = inbox.broadcast(
        params.message,
        params.task_id ?? "",
        (params.priority as "normal" | "priority" | undefined) ?? "normal"
      );
      return ok(`Broadcast sent to ${sent.length} agent(s).`);
    },
  };

  return [message_agent, read_inbox, broadcast_message];
}
