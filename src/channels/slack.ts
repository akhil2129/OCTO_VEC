/**
 * Slack channel for TOWER.
 *
 * Routes messages from an authorized Slack channel OR direct messages (DMs)
 * to the PM agent and streams the response back. Supports the same slash
 * commands as CLI and Telegram.
 *
 * Uses Socket Mode (WebSocket) — no public URL required.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN   — Bot User OAuth Token (xoxb-...)
 *   SLACK_APP_TOKEN   — App-Level Token (xapp-..., scope: connections:write)
 *   SLACK_CHANNEL_ID  — Channel ID where the bot listens and posts (C0123456789)
 *
 * DMs: The bot also responds to direct messages. Add `message.im` to your
 * Slack app's Event Subscriptions alongside `message.channels`.
 */

import { App, LogLevel } from "@slack/bolt";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { ATPDatabase } from "../atp/database.js";
import { MessageQueue } from "../atp/messageQueue.js";
import { EventLog } from "../atp/eventLog.js";
import { AGENT_DISPLAY_NAMES } from "../atp/agentMessageQueue.js";
import type { PMAgent } from "../agents/pmAgent.js";
import type { VECChannel } from "./types.js";
import { founder } from "../identity.js";
import { loadAgentMemory, isFirstInteraction, markFirstInteractionDone } from "../memory/agentMemory.js";
import { ActiveChannelState } from "./activeChannel.js";

// Slack max message length
const SLACK_MAX = 4000;

/** Split a long string into <= SLACK_MAX chunks, preferring newline boundaries. */
function splitMessage(text: string): string[] {
  if (text.length <= SLACK_MAX) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > SLACK_MAX) {
    const slice = remaining.slice(0, SLACK_MAX);
    const lastNl = slice.lastIndexOf("\n");
    const cutAt = lastNl > SLACK_MAX / 2 ? lastNl + 1 : SLACK_MAX;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Safe fire-and-forget Slack API call — never throws. */
async function slackSend(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[Slack]", (err as Error)?.message ?? err);
  }
}

class SlackChannel implements VECChannel {
  private app: App;
  private channelId: string;

  // State for capturing the current PM response destined for Slack
  private pendingChannel: string | null = null;
  private pendingThreadTs: string | undefined = undefined;
  private buffer = "";

  constructor(
    botToken: string,
    appToken: string,
    channelId: string,
    private pmAgent: PMAgent,
  ) {
    this.channelId = channelId;

    this.app = new App({
      token: botToken,
      socketMode: true,
      appToken,
      logLevel: LogLevel.ERROR, // suppress verbose Bolt logging
    });

    // Subscribe to PM events — capture text and fire reply on agent_end
    pmAgent.subscribe((event: AgentEvent) => {
      if (this.pendingChannel === null) return; // not a Slack-triggered prompt

      if (event.type === "message_update") {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta" && ae.delta) {
          this.buffer += ae.delta;
        }
      } else if (event.type === "agent_end") {
        void this.flushReply();
      }
    });

    // Handle incoming messages
    this.app.message(async ({ message }) => {
      const msg = message as unknown as Record<string, unknown>;
      console.log(`[Slack] message event — channel: ${msg.channel}, subtype: ${msg.subtype ?? "none"}, text: ${typeof msg.text === "string" ? msg.text.slice(0, 80) : "(no text)"}`);

      // Only handle regular user messages (not bot messages, edits, etc.)
      if (msg.subtype) return; // skip bot messages, edits, joins, etc.
      if (!msg.text || typeof msg.text !== "string") return;

      await this.handleMessage(msg.text, msg.channel as string, msg.ts as string);
    });

    // Handle /vec slash command (optional — if registered in Slack app settings)
    this.app.command("/vec", async ({ command, ack }) => {
      await ack();
      if (!this.isAuthorized(command.channel_id)) return;
      await this.handleCommand(command.text.trim(), command.channel_id, command.trigger_id);
    });
  }

  /** Allow the configured channel AND any direct message to the bot. */
  private isAuthorized(channel: string): boolean {
    return channel === this.channelId || channel.startsWith("D");
  }

  private async handleMessage(text: string, channel: string, threadTs: string): Promise<void> {
    console.log(`[Slack] handleMessage — channel: ${channel}, authorized: ${this.isAuthorized(channel)}, channelId: ${this.channelId}`);
    if (!this.isAuthorized(channel)) return;

    const cmd = text.trim();

    // ── Slash-style commands (prefixed with !) ──────────────────────────────
    if (cmd.startsWith("!")) {
      await this.handleCommand(cmd.slice(1).trim(), channel, threadTs);
      return;
    }

    // ── Route to PM agent ─────────────────────────────────────────────────
    this.pendingChannel = channel;
    this.pendingThreadTs = threadTs;
    this.buffer = "";

    // Inject PM's memory + founder context so PM responds naturally
    const memory = loadAgentMemory("pm");
    const firstTime = isFirstInteraction("pm");
    if (firstTime) markFirstInteractionDone("pm");

    const founderPrompt =
      (memory ? `${memory}\n\n` : "") +
      (firstTime
        ? `[FIRST INTERACTION — Sir is messaging you for the first time.]\n` +
          `Introduce yourself briefly and warmly — one sentence. Then respond to what he said. Natural, not robotic.\n\n`
        : "") +
      `[Message from ${founder.name} (Sir) via Slack — agent key: '${founder.agentKey}']\n` +
      `Sir says: ${text}`;

    // Mark this as a Slack-originated prompt so PM replies route back here only
    ActiveChannelState.set("slack");
    try {
      await this.pmAgent.prompt(founderPrompt);
    } catch (err) {
      this.clearPending();
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel,
          text: `Error talking to PM: ${err}`,
          thread_ts: threadTs,
        }),
      );
    }
  }

  private async handleCommand(cmd: string, channel: string, threadTs: string): Promise<void> {
    if (cmd === "board") {
      const board = ATPDatabase.taskBoard();
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel,
          text: `\`\`\`\n${board}\n\`\`\``,
          thread_ts: threadTs,
        }),
      );
      return;
    }

    if (cmd === "queue") {
      const msgs = MessageQueue.peek();
      if (!msgs.length) {
        await slackSend(() =>
          this.app.client.chat.postMessage({
            channel,
            text: "[PM Queue] Empty.",
            thread_ts: threadTs,
          }),
        );
      } else {
        const lines = [`[PM Queue] ${msgs.length} message(s):`];
        for (const m of msgs) {
          const ref = m.task_id ? ` ${m.task_id}` : "";
          lines.push(`  [${m.type}] ${m.from_agent}${ref}: ${m.message.substring(0, 100)}`);
        }
        await slackSend(() =>
          this.app.client.chat.postMessage({
            channel,
            text: lines.join("\n"),
            thread_ts: threadTs,
          }),
        );
      }
      return;
    }

    if (cmd === "events") {
      const events = EventLog.getEvents(20);
      if (!events.length) {
        await slackSend(() =>
          this.app.client.chat.postMessage({
            channel,
            text: "[Events] None recorded yet.",
            thread_ts: threadTs,
          }),
        );
      } else {
        const lines = [`[Events] Last ${events.length}:`];
        for (const e of events) {
          const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?";
          const ref = e.task_id ? ` | ${e.task_id}` : "";
          lines.push(`  ${ts} [${e.event_type}] ${e.agent_id || "-"}${ref} — ${(e.message || "").substring(0, 80)}`);
        }
        await slackSend(() =>
          this.app.client.chat.postMessage({
            channel,
            text: lines.join("\n"),
            thread_ts: threadTs,
          }),
        );
      }
      return;
    }

    if (cmd === "dir") {
      const dir = ATPDatabase.employeeDirectory();
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel,
          text: `\`\`\`\n${dir}\n\`\`\``,
          thread_ts: threadTs,
        }),
      );
      return;
    }

    if (cmd === "agents") {
      const lines = Object.entries(AGENT_DISPLAY_NAMES)
        .filter(([id]) => id !== "user")
        .map(([id, name]) => `  ${id.padEnd(12)} ${name}`);
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel,
          text: ["Agents:", ...lines].join("\n"),
          thread_ts: threadTs,
        }),
      );
      return;
    }

    if (cmd === "help") {
      const help = [
        "*TOWER — VEC Commands*",
        "`!board`   — Task board",
        "`!queue`   — PM message queue",
        "`!events`  — Recent events (last 20)",
        "`!dir`     — Employee directory",
        "`!agents`  — Agent list",
        "`!help`    — This help",
        "",
        "Send any other text to talk to Arjun (PM).",
      ].join("\n");
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel,
          text: help,
          thread_ts: threadTs,
        }),
      );
      return;
    }

    // Unknown command — treat as regular message
    await this.handleMessage(cmd, channel, threadTs);
  }

  private async flushReply(): Promise<void> {
    const channel = this.pendingChannel;
    const threadTs = this.pendingThreadTs;
    const text = this.buffer.trim();
    this.clearPending();

    if (!channel || !text) return;

    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel,
          text: chunk,
          thread_ts: threadTs,
        }),
      );
    }
  }

  private clearPending(): void {
    this.pendingChannel = null;
    this.pendingThreadTs = undefined;
    this.buffer = "";
  }

  /** Send a proactive message to the authorized channel (e.g. PM -> user forwarding). */
  async sendToUser(text: string): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await slackSend(() =>
        this.app.client.chat.postMessage({
          channel: this.channelId,
          text: chunk,
        }),
      );
    }
  }

  async start(): Promise<void> {
    try {
      await this.app.start();
      console.log(`  [Slack] Bot started — channel: ${this.channelId} + DMs`);
    } catch (err) {
      console.error("[Slack] Failed to start:", (err as Error)?.message ?? err);
    }
  }

  async stop(): Promise<void> {
    this.clearPending();
    await this.app.stop();
  }
}

/**
 * Create and return a SlackChannel if SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and
 * SLACK_CHANNEL_ID are set, otherwise returns null (Slack silently disabled).
 */
export function createSlackChannel(pmAgent: PMAgent): VECChannel | null {
  const botToken = process.env.SLACK_BOT_TOKEN?.trim() ?? "";
  const appToken = process.env.SLACK_APP_TOKEN?.trim() ?? "";
  const channelId = process.env.SLACK_CHANNEL_ID?.trim() ?? "";

  if (!botToken || !appToken || !channelId) {
    return null;
  }

  if (!botToken.startsWith("xoxb-")) {
    console.warn("[Slack] SLACK_BOT_TOKEN should start with 'xoxb-' — Slack disabled.");
    return null;
  }

  if (!appToken.startsWith("xapp-")) {
    console.warn("[Slack] SLACK_APP_TOKEN should start with 'xapp-' — Slack disabled.");
    return null;
  }

  return new SlackChannel(botToken, appToken, channelId, pmAgent);
}
