/**
 * Migration utility — copies old data/ and memory/ from the project directory
 * to the new USER_DATA_DIR (~/.octo-vec or %APPDATA%/octo-vec).
 *
 * Run via: vec --migrate  (or:  tsx src/tower.ts --migrate)
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { USER_DATA_DIR } from "./config.js";

const OLD_DATA = join(process.cwd(), "data");
const OLD_MEMORY = join(process.cwd(), "memory");

/** Recursively copy a directory, skipping files that already exist at destination. */
function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else if (!existsSync(dstPath)) {
      copyFileSync(srcPath, dstPath);
    }
  }
}

export async function runMigration(): Promise<void> {
  const hasOldData = existsSync(OLD_DATA);
  const hasOldMemory = existsSync(OLD_MEMORY);

  if (!hasOldData && !hasOldMemory) {
    console.log("  No data/ or memory/ directory found at cwd — nothing to migrate.");
    return;
  }

  console.log(`\n  Migrating to: ${USER_DATA_DIR}\n`);
  mkdirSync(USER_DATA_DIR, { recursive: true });

  if (hasOldData) {
    // Individual files to migrate (skip prompts/ — they now live in core/)
    const filesToMigrate = [
      "roster.json",
      "atp.db", "atp.db-shm", "atp.db-wal",
      "model-config.json", "api-keys.json",
      "channel-config.json",
      "mcp-servers.json",
      "agent-groups.json",
      "agent-tool-config.json",
      "dashboard-secret.key",
      "token-usage.json",
      "events.json", "pm_queue.json", "agent_messages.json",
      "message_flow.json", "chat-log.json",
      "codex-oauth.json",
    ];

    for (const file of filesToMigrate) {
      const src = join(OLD_DATA, file);
      const dst = join(USER_DATA_DIR, file);
      if (existsSync(src) && !existsSync(dst)) {
        copyFileSync(src, dst);
        console.log(`  Migrated: ${file}`);
      }
    }

    // Migrate agent-history/ subdirectory
    const oldHistory = join(OLD_DATA, "agent-history");
    if (existsSync(oldHistory) && statSync(oldHistory).isDirectory()) {
      const newHistory = join(USER_DATA_DIR, "agent-history");
      mkdirSync(newHistory, { recursive: true });
      for (const f of readdirSync(oldHistory)) {
        const src = join(oldHistory, f);
        const dst = join(newHistory, f);
        if (!existsSync(dst) && statSync(src).isFile()) {
          copyFileSync(src, dst);
          console.log(`  Migrated: agent-history/${f}`);
        }
      }
    }
  }

  // Migrate memory/ directory tree
  if (hasOldMemory) {
    const newMemory = join(USER_DATA_DIR, "memory");
    copyDirRecursive(OLD_MEMORY, newMemory);
    console.log(`  Migrated: memory/ (recursive)`);
  }

  console.log(`\n  Migration complete. Data is now at: ${USER_DATA_DIR}`);
  console.log(`  You can delete the old data/ and memory/ directories if everything looks correct.\n`);
}
