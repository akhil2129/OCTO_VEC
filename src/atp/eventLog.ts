/**
 * Live event log for the VEC-ATP system.
 * Records everything that happens in real-time.
 */

import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { EventType, type Event } from "./models.js";

const LOG_PATH = path.join(config.dataDir, "events.json");
const MAX_EVENTS = 200;

function ensureFile(): void {
  if (!fs.existsSync(LOG_PATH)) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, "[]", "utf-8");
  }
}

function read(): Event[] {
  ensureFile();
  const text = fs.readFileSync(LOG_PATH, "utf-8").trim();
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) ? (data as Event[]) : [];
  } catch {
    return [];
  }
}

function write(events: Event[]): void {
  // Atomic write via temp file
  const tmp = LOG_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(events, null, 2), "utf-8");
  fs.renameSync(tmp, LOG_PATH);
}

export const EventLog = {
  log(
    event_type: EventType | string,
    agent_id = "",
    task_id = "",
    message = "",
    details = ""
  ): void {
    const events = read();
    events.push({
      timestamp: new Date().toISOString(),
      event_type: event_type as EventType,
      agent_id,
      task_id,
      message,
      details,
    });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    write(events);
  },

  getEvents(limit = 50, since = ""): Event[] {
    let events = read();
    if (since) events = events.filter((e) => e.timestamp > since);
    return events.slice(-limit);
  },

  clear(): void {
    write([]);
  },
};

export type EventLogType = typeof EventLog;
