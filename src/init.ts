/**
 * First-run bootstrapper — ensures USER_DATA_DIR exists and seeds
 * required files (roster.json) from the package's core/ assets.
 *
 * Called once at the top of tower.ts main() before anything else.
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import { USER_DATA_DIR, DEFAULT_ROSTER_PATH } from "./config.js";

export function initUserDataDir(): void {
  // Create the user data directory tree
  const dirs = [
    USER_DATA_DIR,
    join(USER_DATA_DIR, "memory"),
    join(USER_DATA_DIR, "agent-history"),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Seed roster.json from core/ if missing (first run)
  const userRosterPath = join(USER_DATA_DIR, "roster.json");
  if (!existsSync(userRosterPath)) {
    copyFileSync(DEFAULT_ROSTER_PATH, userRosterPath);
    console.log(`  [init] Created ${userRosterPath} from default template.`);
  }
}
