/**
 * Persistent chat log for user ↔ agent messages.
 *
 * Captures every message between Sir (the founder) and VEC agents,
 * regardless of channel (CLI, Telegram, Dashboard). The dashboard
 * Teams panel reads from this log to show the full conversation history.
 *
 * Storage: data/chat-log.json  (max 200 entries, oldest dropped first)
 */

import fs from "fs";
import path from "path";
import { config } from "../config.js";

export interface ChatEntry {
  id: string;
  timestamp: string;
  /** Agent key or "user" */
  from: string;
  /** Agent key or "user" */
  to: string;
  message: string;
  /** Where the message originated */
  channel: "cli" | "telegram" | "dashboard" | "agent";
}

const LOG_PATH = path.join(config.dataDir, "chat-log.json");
const MAX_ENTRIES = 200;

class UserChatLogClass {
  private read(): ChatEntry[] {
    try {
      const raw = fs.readFileSync(LOG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(entries: ChatEntry[]): void {
    try {
      fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
      fs.writeFileSync(LOG_PATH, JSON.stringify(entries), "utf-8");
    } catch {
      // Non-fatal
    }
  }

  /** Append a new chat entry. */
  log(entry: Omit<ChatEntry, "id" | "timestamp">): void {
    const entries = this.read();
    entries.push({
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
    });
    // Trim to max
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
    this.write(entries);
  }

  /** Read last `limit` entries (default 100). */
  getRecent(limit: number = 100): ChatEntry[] {
    const entries = this.read();
    return entries.slice(-limit);
  }

  clear(): void {
    this.write([]);
  }
}

export const UserChatLog = new UserChatLogClass();
