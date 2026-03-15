/**
 * First-run onboarding — creates ITS_ME.md if it doesn't exist.
 * Prompts the user for their name and role so agents know who they're talking to.
 */

import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import readline from "readline";
import { USER_DATA_DIR } from "./config.js";

const ITS_ME_PATH = join(USER_DATA_DIR, "ITS_ME.md");

export async function runOnboardingIfNeeded(): Promise<void> {
  if (existsSync(ITS_ME_PATH)) return;

  console.log("\n  Welcome to OCTO VEC!\n");
  console.log("  This is your first run. Let's set up your profile.\n");
  console.log(`  Your data will be stored at: ${USER_DATA_DIR}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

  const name = (await ask("  Your name (press Enter for 'User'): ")) || "User";
  const role = (await ask("  Your role (press Enter for 'Founder & CEO'): ")) || "Founder & CEO";

  rl.close();

  const content = `**Name:** ${name}\n**Role:** ${role}\n`;
  writeFileSync(ITS_ME_PATH, content, "utf-8");
  console.log(`\n  Profile created at ${ITS_ME_PATH}`);
  console.log(`  You can edit this file anytime to update your identity.\n`);
}
