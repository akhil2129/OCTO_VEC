/**
 * Discord channel for TOWER.
 *
 * Routes messages from an authorized Discord text channel OR direct messages (DMs)
 * to the PM agent and streams the response back. Supports the same slash commands
 * as CLI, Telegram, and Slack.
 *
 * Uses WebSocket Gateway — no public URL required.
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN  — Bot token from Discord Developer Portal
 *   DISCORD_CHANNEL_ID — Authorized text channel ID (right-click → Copy Channel ID)
 *
 * DMs: The bot also responds to direct messages automatically.
 * Note: Enable "Message Content Intent" in the Discord Developer Portal.
 */

import { Client, GatewayIntentBits, ChannelType, type Message, type TextChannel, type DMChannel } from "discord.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

/** Channel type that supports send() and sendTyping(). */
type SendableChannel = TextChannel | DMChannel;
import { ATPDatabase } from "../atp/database.js";
import { MessageQueue } from "../atp/messageQueue.js";
import { EventLog } from "../atp/eventLog.js";
import { AGENT_DISPLAY_NAMES } from "../atp/agentMessageQueue.js";
import type { PMAgent } from "../agents/pmAgent.js";
import type { VECChannel } from "./types.js";
import { founder } from "../identity.js";
import { loadAgentMemory, isFirstInteraction, markFirstInteractionDone } from "../memory/agentMemory.js";
import { ActiveChannelState } from "./activeChannel.js";

// Discord max message length
const DISCORD_MAX = 2000;

/** Split a long string into <= DISCORD_MAX chunks, preferring newline boundaries. */
function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > DISCORD_MAX) {
    const slice = remaining.slice(0, DISCORD_MAX);
    const lastNl = slice.lastIndexOf("\n");
    const cutAt = lastNl > DISCORD_MAX / 2 ? lastNl + 1 : DISCORD_MAX;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Safe fire-and-forget Discord API call — never throws. */
async function discordSend(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[Discord]", (err as Error)?.message ?? err);
  }
}

class DiscordChannel implements VECChannel {
  private client: Client;
  private channelId: string;
  private botToken: string;

  // State for capturing the current PM response destined for Discord
  private pendingChannel: SendableChannel | null = null;
  private buffer = "";
  private typingTimer: NodeJS.Timeout | null = null;

  constructor(
    botToken: string,
    channelId: string,
    private pmAgent: PMAgent,
  ) {
    this.botToken = botToken;
    this.channelId = channelId;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // Subscribe to PM events — capture text and fire reply on agent_end
    pmAgent.subscribe((event: AgentEvent) => {
      if (this.pendingChannel === null) return; // not a Discord-triggered prompt

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
    this.client.on("messageCreate", (message: Message) => {
      // Ignore bot's own messages and other bots
      if (message.author.bot) return;

      const channel = message.channel;
      const channelId = channel.id;
      const isDM = channel.type === ChannelType.DM;

      console.log(`[Discord] message event — channel: ${channelId}, DM: ${isDM}, text: ${message.content.slice(0, 80)}`);

      if (!this.isAuthorized(channelId, isDM)) return;

      void this.handleMessage(message.content, channel as SendableChannel);
    });

    this.client.on("error", (err) => {
      console.error("[Discord] Client error:", err.message);
    });
  }

  /** Allow the configured channel AND any direct message to the bot. */
  private isAuthorized(channelId: string, isDM: boolean): boolean {
    return channelId === this.channelId || isDM;
  }

  private async handleMessage(text: string, channel: SendableChannel): Promise<void> {
    if (!text.trim()) return;

    const cmd = text.trim();

    // ── Slash-style commands (prefixed with !) ──────────────────────────────
    if (cmd.startsWith("!")) {
      await this.handleCommand(cmd.slice(1).trim(), channel);
      return;
    }

    // ── Route to PM agent ─────────────────────────────────────────────────
    this.pendingChannel = channel;
    this.buffer = "";

    // Show typing indicator
    await discordSend(() => channel.sendTyping());
    this.typingTimer = setInterval(() => {
      if (this.pendingChannel !== null) {
        void discordSend(() => channel.sendTyping());
      }
    }, 8_000);

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
      `[Message from ${founder.name} (Sir) via Discord — agent key: '${founder.agentKey}']\n` +
      `Sir says: ${text}`;

    // Mark this as a Discord-originated prompt so PM replies route back here only
    ActiveChannelState.set("discord");
    try {
      await this.pmAgent.prompt(founderPrompt);
    } catch (err) {
      this.clearPending();
      await discordSend(() =>
        channel.send(`Error talking to PM: ${err}`),
      );
    }
  }

  private async handleCommand(cmd: string, channel: SendableChannel): Promise<void> {
    if (cmd === "board") {
      const board = ATPDatabase.taskBoard();
      await discordSend(() => channel.send(`\`\`\`\n${board}\n\`\`\``));
      return;
    }

    if (cmd === "queue") {
      const msgs = MessageQueue.peek();
      if (!msgs.length) {
        await discordSend(() => channel.send("[PM Queue] Empty."));
      } else {
        const lines = [`[PM Queue] ${msgs.length} message(s):`];
        for (const m of msgs) {
          const ref = m.task_id ? ` ${m.task_id}` : "";
          lines.push(`  [${m.type}] ${m.from_agent}${ref}: ${m.message.substring(0, 100)}`);
        }
        await discordSend(() => channel.send(lines.join("\n")));
      }
      return;
    }

    if (cmd === "events") {
      const events = EventLog.getEvents(20);
      if (!events.length) {
        await discordSend(() => channel.send("[Events] None recorded yet."));
      } else {
        const lines = [`[Events] Last ${events.length}:`];
        for (const e of events) {
          const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?";
          const ref = e.task_id ? ` | ${e.task_id}` : "";
          lines.push(`  ${ts} [${e.event_type}] ${e.agent_id || "-"}${ref} — ${(e.message || "").substring(0, 80)}`);
        }
        await discordSend(() => channel.send(lines.join("\n")));
      }
      return;
    }

    if (cmd === "dir") {
      const dir = ATPDatabase.employeeDirectory();
      await discordSend(() => channel.send(`\`\`\`\n${dir}\n\`\`\``));
      return;
    }

    if (cmd === "agents") {
      const lines = Object.entries(AGENT_DISPLAY_NAMES)
        .filter(([id]) => id !== "user")
        .map(([id, name]) => `  ${id.padEnd(12)} ${name}`);
      await discordSend(() => channel.send(["Agents:", ...lines].join("\n")));
      return;
    }

    if (cmd === "help") {
      const help = [
        "**TOWER — VEC Commands**",
        "`!board`   — Task board",
        "`!queue`   — PM message queue",
        "`!events`  — Recent events (last 20)",
        "`!dir`     — Employee directory",
        "`!agents`  — Agent list",
        "`!help`    — This help",
        "",
        "Send any other text to talk to Arjun (PM).",
      ].join("\n");
      await discordSend(() => channel.send(help));
      return;
    }

    // Unknown command — treat as regular message
    await this.handleMessage(cmd, channel);
  }

  private async flushReply(): Promise<void> {
    this.clearTypingTimer();

    const channel = this.pendingChannel;
    const text = this.buffer.trim();
    this.clearPending();

    if (!channel || !text) return;

    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await discordSend(() => channel.send(chunk));
    }
  }

  private clearTypingTimer(): void {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private clearPending(): void {
    this.clearTypingTimer();
    this.pendingChannel = null;
    this.buffer = "";
  }

  /** Send a proactive message to the authorized channel (e.g. PM -> user forwarding). */
  async sendToUser(text: string): Promise<void> {
    const channel = this.client.channels.cache.get(this.channelId);
    if (!channel || !("send" in channel)) return;

    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await discordSend(() => (channel as SendableChannel).send(chunk));
    }
  }

  async start(): Promise<void> {
    try {
      await this.client.login(this.botToken);
      console.log(`  [Discord] Bot started — channel: ${this.channelId} + DMs`);
    } catch (err) {
      console.error("[Discord] Failed to start:", (err as Error)?.message ?? err);
    }
  }

  async stop(): Promise<void> {
    this.clearPending();
    this.client.destroy();
  }
}

/**
 * Create and return a DiscordChannel if DISCORD_BOT_TOKEN and
 * DISCORD_CHANNEL_ID are set, otherwise returns null (Discord silently disabled).
 */
export function createDiscordChannel(pmAgent: PMAgent): VECChannel | null {
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim() ?? "";
  const channelId = process.env.DISCORD_CHANNEL_ID?.trim() ?? "";

  if (!botToken || !channelId) {
    return null;
  }

  return new DiscordChannel(botToken, channelId, pmAgent);
}
