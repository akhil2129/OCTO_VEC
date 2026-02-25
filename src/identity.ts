/**
 * Founder identity — loaded once from ITS_ME.md at startup.
 * Use `founder.name`, `founder.agentKey`, etc. everywhere instead of hardcoding.
 */

import fs from "fs";
import path from "path";
import { PROJECT_ROOT } from "./config.js";

export interface FounderProfile {
  /** Display name of the founder (e.g. "Akhil"). */
  name: string;
  /** Their role (e.g. "Founder & CEO"). */
  role: string;
  /**
   * System agent key — always "user".
   * This is a routing constant in ATP and should not change.
   */
  agentKey: "user";
  /** Formatted display name for message headers (e.g. "Akhil (Founder)"). */
  displayName: string;
  /** Full raw content of ITS_ME.md — injected into agent prompts for context. */
  raw: string;
}

function parseField(text: string, field: string): string {
  const m = new RegExp(`\\*\\*${field}:\\*\\*\\s*(.+)`).exec(text);
  return m?.[1]?.trim() ?? "";
}

function load(): FounderProfile {
  const filePath = path.join(PROJECT_ROOT, "ITS_ME.md");
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    // ITS_ME.md missing — fall back to bare minimum so the system still boots
    raw = "**Name:** Akhil\n**Role:** Founder & CEO";
  }

  const name = parseField(raw, "Name") || "Akhil";
  const role = parseField(raw, "Role") || "Founder & CEO";

  return {
    name,
    role,
    agentKey: "user",
    displayName: `${name} (Founder)`,
    raw,
  };
}

/** Singleton — loaded synchronously once when this module is first imported. */
export const founder = load();
