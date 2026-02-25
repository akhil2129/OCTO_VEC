/**
 * Telegram channel for TOWER.
 *
 * Routes messages from an authorized Telegram chat to the PM agent and streams
 * the response back. Supports the same slash commands as the CLI.
 *
 * Required env vars:
 *   TELEGRAM_BOT_TOKEN   — BotFather token
 *   TELEGRAM_CHAT_ID     — authorized chat ID (positive = private, negative = group/supergroup)
 *
 * Note: For groups, disable bot privacy mode in BotFather so the bot receives all messages.
 */

import { Bot } from "grammy";
import type { Context } from "grammy";
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

// Telegram max message length
const TG_MAX = 4096;

/** Split a long string into ≤ TG_MAX chunks, preferring newline boundaries. */
function splitMessage(text: string): string[] {
  if (text.length <= TG_MAX) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > TG_MAX) {
    // Try to split at a newline near the limit
    const slice = remaining.slice(0, TG_MAX);
    const lastNl = slice.lastIndexOf("\n");
    const cutAt = lastNl > TG_MAX / 2 ? lastNl + 1 : TG_MAX;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Safe fire-and-forget Telegram API call — never throws. */
async function tgSend(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Swallow — don't let Telegram errors crash the agent loop
  }
}

class TelegramChannel implements VECChannel {
  private bot: Bot;
  private authorizedChatId: number;

  // State for capturing the current PM response destined for Telegram
  private pendingChatId: number | null = null;
  private pendingMsgId: number | null = null;
  private buffer = "";
  private typingTimer: NodeJS.Timeout | null = null;

  constructor(token: string, chatId: number, private pmAgent: PMAgent) {
    this.bot = new Bot(token);
    this.authorizedChatId = chatId;

    // Subscribe to PM events — capture text and fire reply on agent_end
    pmAgent.subscribe((event: AgentEvent) => {
      if (this.pendingChatId === null) return; // not a Telegram-triggered prompt

      if (event.type === "message_update") {
        const ae = event.assistantMessageEvent;
        if (ae.type === "text_delta" && ae.delta) {
          this.buffer += ae.delta;
        }
      } else if (event.type === "agent_end") {
        void this.flushReply();
      }
    });

    // Handle incoming text messages
    this.bot.on("message:text", (ctx) => void this.handleText(ctx));

    // Handle commands in groups that may be prefixed with /cmd@botname
    this.bot.on("message", () => {
      // Silently ignore non-text messages (photos, stickers, etc.)
    });

    this.bot.catch((err) => {
      console.error("[Telegram] Error:", err.message);
    });
  }

  private isAuthorized(ctx: Context): boolean {
    return ctx.chat?.id === this.authorizedChatId;
  }

  private async handleText(ctx: Context): Promise<void> {
    if (!this.isAuthorized(ctx)) return;

    const text = ctx.message?.text ?? "";
    const cmd = text.split("@")[0]; // strip @botname suffix in groups

    // ── Slash commands (mirror CLI) ──────────────────────────────────────
    if (cmd === "/board") {
      const board = ATPDatabase.taskBoard();
      await tgSend(() => ctx.reply(`\`\`\`\n${board}\n\`\`\``, { parse_mode: "Markdown" }));
      return;
    }

    if (cmd === "/queue") {
      const msgs = MessageQueue.peek();
      if (!msgs.length) {
        await tgSend(() => ctx.reply("[PM Queue] Empty."));
      } else {
        const lines = [`[PM Queue] ${msgs.length} message(s):`];
        for (const m of msgs) {
          const ref = m.task_id ? ` ${m.task_id}` : "";
          lines.push(`  [${m.type}] ${m.from_agent}${ref}: ${m.message.substring(0, 100)}`);
        }
        await tgSend(() => ctx.reply(lines.join("\n")));
      }
      return;
    }

    if (cmd === "/events") {
      const events = EventLog.getEvents(20);
      if (!events.length) {
        await tgSend(() => ctx.reply("[Events] None recorded yet."));
      } else {
        const lines = [`[Events] Last ${events.length}:`];
        for (const e of events) {
          const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?";
          const ref = e.task_id ? ` | ${e.task_id}` : "";
          lines.push(`  ${ts} [${e.event_type}] ${e.agent_id || "-"}${ref} — ${(e.message || "").substring(0, 80)}`);
        }
        await tgSend(() => ctx.reply(lines.join("\n")));
      }
      return;
    }

    if (cmd === "/dir") {
      const dir = ATPDatabase.employeeDirectory();
      await tgSend(() => ctx.reply(`\`\`\`\n${dir}\n\`\`\``, { parse_mode: "Markdown" }));
      return;
    }

    if (cmd === "/agents") {
      const lines = Object.entries(AGENT_DISPLAY_NAMES)
        .filter(([id]) => id !== "user")
        .map(([id, name]) => `  ${id.padEnd(12)} ${name}`);
      await tgSend(() => ctx.reply(["Agents:", ...lines].join("\n")));
      return;
    }

    if (cmd === "/help") {
      const help = [
        "*TOWER — VEC Commands*",
        "/board   — Task board",
        "/queue   — PM message queue",
        "/events  — Recent events (last 20)",
        "/dir     — Employee directory",
        "/agents  — Agent list",
        "/help    — This help",
        "",
        "Send any other text to talk to Arjun (PM).",
      ].join("\n");
      await tgSend(() => ctx.reply(help, { parse_mode: "Markdown" }));
      return;
    }

    // ── Route to PM agent ─────────────────────────────────────────────────
    this.pendingChatId = ctx.chat!.id;
    this.pendingMsgId = ctx.message!.message_id;
    this.buffer = "";

    // Send initial typing action and keep refreshing every 4 s
    await tgSend(() => this.bot.api.sendChatAction(this.pendingChatId!, "typing"));
    this.typingTimer = setInterval(() => {
      if (this.pendingChatId !== null) {
        void tgSend(() => this.bot.api.sendChatAction(this.pendingChatId!, "typing"));
      }
    }, 4_000);

    // Inject PM's memory + founder context so PM responds naturally from actual knowledge
    const memory = loadAgentMemory("pm");
    const firstTime = isFirstInteraction("pm");
    if (firstTime) markFirstInteractionDone("pm");
    const founderPrompt =
      (memory ? `${memory}\n\n` : "") +
      (firstTime
        ? `[FIRST INTERACTION — Sir is messaging you for the first time.]\n` +
          `Introduce yourself briefly and warmly — one sentence. Then respond to what he said. Natural, not robotic.\n\n`
        : "") +
      `[Message from ${founder.name} (Sir) via Telegram — agent key: '${founder.agentKey}']\n` +
      `Sir says: ${text}`;

    // Mark this as a Telegram-originated prompt so PM replies route back here only
    ActiveChannelState.set("telegram");
    try {
      await this.pmAgent.prompt(founderPrompt);
    } catch (err) {
      this.clearPending();
      await tgSend(() => ctx.reply(`Error talking to PM: ${err}`));
    }
  }

  private async flushReply(): Promise<void> {
    this.clearTypingTimer();

    const chatId = this.pendingChatId;
    const msgId = this.pendingMsgId;
    const text = this.buffer.trim();
    this.clearPending();

    if (!chatId || !text) return;

    const chunks = splitMessage(text);
    for (let i = 0; i < chunks.length; i++) {
      await tgSend(() =>
        this.bot.api.sendMessage(chatId, chunks[i], {
          reply_parameters: i === 0 && msgId ? { message_id: msgId } : undefined,
        })
      );
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
    this.pendingChatId = null;
    this.pendingMsgId = null;
    this.buffer = "";
  }

  /** Send a proactive message to the authorized chat (e.g. PM → user forwarding). */
  async sendToUser(text: string): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await tgSend(() => this.bot.api.sendMessage(this.authorizedChatId, chunk));
    }
  }

  async start(): Promise<void> {
    // drop_pending_updates: skip messages received while the bot was offline
    // Catch errors from bot.start() so a 409 conflict (another instance running)
    // doesn't crash the whole process — just disable Telegram and keep going.
    this.bot.start({ drop_pending_updates: true }).catch((err: unknown) => {
      const code = (err as { error_code?: number })?.error_code;
      if (code === 409) {
        console.warn(
          "  [Telegram] 409 Conflict — another bot instance is already polling. " +
          "Kill the old process and restart. Telegram channel disabled for this session."
        );
      } else {
        console.error("  [Telegram] Bot crashed:", (err as Error)?.message ?? err);
      }
    });
    console.log(`  [Telegram] Bot started — authorized chat: ${this.authorizedChatId}`);
  }

  async stop(): Promise<void> {
    this.clearPending();
    await this.bot.stop();
  }
}

/**
 * Create and return a TelegramChannel if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set,
 * otherwise returns null (Telegram silently disabled).
 */
export function createTelegramChannel(pmAgent: PMAgent): VECChannel | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatIdStr = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";

  if (!token || !chatIdStr) {
    return null;
  }

  const chatId = parseInt(chatIdStr, 10);
  if (isNaN(chatId)) {
    console.warn("[Telegram] TELEGRAM_CHAT_ID is not a valid integer — Telegram disabled.");
    return null;
  }

  return new TelegramChannel(token, chatId, pmAgent);
}
