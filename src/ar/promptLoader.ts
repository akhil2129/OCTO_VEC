/**
 * AR Department — Prompt template loader.
 * Reads .md files from data/prompts/ and interpolates {{variable}} placeholders.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { CORE_PROMPTS_DIR } from "../config.js";

const PROMPTS_DIR = CORE_PROMPTS_DIR;

/**
 * Load a prompt template file and interpolate {{variable}} placeholders.
 * Unresolved variables are left as-is for debugging visibility.
 */
export function loadPrompt(
  filename: string,
  vars: Record<string, string>
): string {
  const filePath = join(PROMPTS_DIR, filename);
  const template = readFileSync(filePath, "utf-8");
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in vars) return vars[key];
    return match; // leave unresolved — makes missing vars visible
  });
}
