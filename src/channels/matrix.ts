/**
 * Matrix channel for TOWER.
 *
 * Routes messages from an authorized Matrix room to the PM agent and streams
 * the response back. Supports the same slash commands as CLI and Telegram.
 *
 * Uses matrix-bot-sdk — works with any Matrix homeserver (Element, Synapse, etc.).
 *
 * Required env vars:
 *   MATRIX_HOMESERVER_URL  — homeserver URL (e.g. "https://matrix.org")
 *   MATRIX_ACCESS_TOKEN    — bot user access token
 *   MATRIX_ROOM_ID         — authorized room ID (e.g. "!abc123:matrix.org")
 */

import {
  MatrixClient,
  SimpleFsStorageProvider,
  AutojoinRoomsMixin,
} from "matrix-bot-sdk";
import { join } from "path";
import { mkdirSync } from "fs";
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
import { config } from "../config.js";

const MATRIX_STORAGE_DIR = join(config.dataDir, "matrix-store");

// Matrix max message length (practical limit)
const MATRIX_MAX = 4000;

/** Split a long string into <= MATRIX_MAX chunks, preferring newline boundaries. */
function splitMessage(text: string): string[] {
  if (text.length <= MATRIX_MAX) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MATRIX_MAX) {
    const slice = remaining.slice(0, MATRIX_MAX);
    const lastNl = slice.lastIndexOf("\n");
    const cutAt = lastNl > MATRIX_MAX / 2 ? lastNl + 1 : MATRIX_MAX;
    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Safe fire-and-forget Matrix send — never throws. */
async function matrixSend(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error("[Matrix]", (err as Error)?.message ?? err);
  }
}

class MatrixChannel implements VECChannel {
  private client: MatrixClient;
  private roomId: string;

  // State for capturing the current PM response
  private pendingRoomId: string | null = null;
  private buffer = "";

  constructor(homeserverUrl: string, accessToken: string, roomId: string, private pmAgent: PMAgent) {
    this.roomId = roomId;

    mkdirSync(MATRIX_STORAGE_DIR, { recursive: true });
    const storage = new SimpleFsStorageProvider(join(MATRIX_STORAGE_DIR, "bot.json"));

    this.client = new MatrixClient(homeserverUrl, accessToken, storage);
    AutojoinRoomsMixin.setupOnClient(this.client);

    // Subscribe to PM events
    pmAgent.subscribe((event: AgentEvent) => {
      if (this.pendingRoomId === null) return;

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
    this.client.on("room.message", async (roomId: string, event: any) => {
      if (roomId !== this.roomId) return;

      // Skip our own messages
      const sender = event?.sender;
      if (!sender || sender === (await this.client.getUserId())) return;

      // Only handle text messages
      const content = event?.content;
      if (!content || content.msgtype !== "m.text" || !content.body) return;

      await this.handleText(roomId, content.body);
    });
  }

  private async handleText(roomId: string, text: string): Promise<void> {
    const cmd = text.trim();

    // ── Slash-style commands ──────────────────────────────────────────────
    if (cmd === "!board") {
      const board = ATPDatabase.taskBoard();
      await matrixSend(() => this.client.sendText(roomId, board));
      return;
    }

    if (cmd === "!queue") {
      const msgs = MessageQueue.peek();
      if (!msgs.length) {
        await matrixSend(() => this.client.sendText(roomId, "[PM Queue] Empty."));
      } else {
        const lines = [`[PM Queue] ${msgs.length} message(s):`];
        for (const m of msgs) {
          const ref = m.task_id ? ` ${m.task_id}` : "";
          lines.push(`  [${m.type}] ${m.from_agent}${ref}: ${m.message.substring(0, 100)}`);
        }
        await matrixSend(() => this.client.sendText(roomId, lines.join("\n")));
      }
      return;
    }

    if (cmd === "!events") {
      const events = EventLog.getEvents(20);
      if (!events.length) {
        await matrixSend(() => this.client.sendText(roomId, "[Events] None recorded yet."));
      } else {
        const lines = [`[Events] Last ${events.length}:`];
        for (const e of events) {
          const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : "?";
          const ref = e.task_id ? ` | ${e.task_id}` : "";
          lines.push(`  ${ts} [${e.event_type}] ${e.agent_id || "-"}${ref} — ${(e.message || "").substring(0, 80)}`);
        }
        await matrixSend(() => this.client.sendText(roomId, lines.join("\n")));
      }
      return;
    }

    if (cmd === "!dir") {
      const dir = ATPDatabase.employeeDirectory();
      await matrixSend(() => this.client.sendText(roomId, dir));
      return;
    }

    if (cmd === "!agents") {
      const lines = Object.entries(AGENT_DISPLAY_NAMES)
        .filter(([id]) => id !== "user")
        .map(([id, name]) => `  ${id.padEnd(12)} ${name}`);
      await matrixSend(() => this.client.sendText(roomId, ["Agents:", ...lines].join("\n")));
      return;
    }

    if (cmd === "!help") {
      const help = [
        "TOWER — VEC Commands",
        "!board   — Task board",
        "!queue   — PM message queue",
        "!events  — Recent events (last 20)",
        "!dir     — Employee directory",
        "!agents  — Agent list",
        "!help    — This help",
        "",
        "Send any other text to talk to Arjun (PM).",
      ].join("\n");
      await matrixSend(() => this.client.sendText(roomId, help));
      return;
    }

    // ── Route to PM agent ─────────────────────────────────────────────────
    this.pendingRoomId = roomId;
    this.buffer = "";

    // Send typing indicator
    await matrixSend(() => this.client.setTyping(roomId, true, 30_000));

    const memory = loadAgentMemory("pm");
    const firstTime = isFirstInteraction("pm");
    if (firstTime) markFirstInteractionDone("pm");

    const founderPrompt =
      (memory ? `${memory}\n\n` : "") +
      (firstTime
        ? `[FIRST INTERACTION — Sir is messaging you for the first time.]\n` +
          `Introduce yourself briefly and warmly — one sentence. Then respond to what he said. Natural, not robotic.\n\n`
        : "") +
      `[Message from ${founder.name} (Sir) via Matrix — agent key: '${founder.agentKey}']\n` +
      `Sir says: ${text}`;

    ActiveChannelState.set("matrix");
    try {
      await this.pmAgent.prompt(founderPrompt);
    } catch (err) {
      this.clearPending();
      await matrixSend(() => this.client.sendText(roomId, `Error talking to PM: ${err}`));
    }
  }

  private async flushReply(): Promise<void> {
    const roomId = this.pendingRoomId;
    const text = this.buffer.trim();
    this.clearPending();

    if (!roomId || !text) return;

    // Stop typing indicator
    await matrixSend(() => this.client.setTyping(roomId, false));

    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await matrixSend(() => this.client.sendText(roomId, chunk));
    }
  }

  private clearPending(): void {
    this.pendingRoomId = null;
    this.buffer = "";
  }

  /** Send a proactive message to the authorized room. */
  async sendToUser(text: string): Promise<void> {
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await matrixSend(() => this.client.sendText(this.roomId, chunk));
    }
  }

  async start(): Promise<void> {
    try {
      await this.client.start();
      console.log(`  Matrix connected`);
    } catch (err) {
      console.error("[Matrix] Failed to start:", (err as Error)?.message ?? err);
    }
  }

  async stop(): Promise<void> {
    this.clearPending();
    this.client.stop();
  }
}

/**
 * Create and return a MatrixChannel if all required env vars are set,
 * otherwise returns null (Matrix silently disabled).
 */
export function createMatrixChannel(pmAgent: PMAgent): VECChannel | null {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL?.trim() ?? "";
  const accessToken = process.env.MATRIX_ACCESS_TOKEN?.trim() ?? "";
  const roomId = process.env.MATRIX_ROOM_ID?.trim() ?? "";

  if (!homeserverUrl || !accessToken || !roomId) {
    return null;
  }

  if (!roomId.startsWith("!")) {
    console.warn("[Matrix] MATRIX_ROOM_ID should start with '!' (e.g. '!abc123:matrix.org') — Matrix disabled.");
    return null;
  }

  return new MatrixChannel(homeserverUrl, accessToken, roomId, pmAgent);
}
