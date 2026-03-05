/**
 * Codex OAuth credential manager.
 *
 * Usage:
 *   new Agent({ getApiKey: codexApiKeyResolver() })
 *
 * Returns undefined for non-codex providers — safe to always pass in AgentOptions.
 * Returns undefined (no-op) when VEC_MODEL_PROVIDER is not "openai-codex".
 */
import { getOAuthApiKey } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PROJECT_ROOT, config } from "../config.js";

const CREDS_PATH = join(PROJECT_ROOT, "data", "codex-oauth.json");

function loadCreds(): Record<string, any> {
  if (!existsSync(CREDS_PATH)) {
    throw new Error(
      `Codex OAuth credentials not found at ${CREDS_PATH}.\n` +
      `See docs/config.md for Codex OAuth setup instructions.`
    );
  }
  return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
}

/**
 * Returns a getApiKey resolver for Codex OAuth, or undefined if not using Codex.
 * Pass the result directly into new Agent({ getApiKey: codexApiKeyResolver() }).
 */
export function codexApiKeyResolver():
  | ((provider: string) => Promise<string | undefined>)
  | undefined {
  if (config.modelProvider !== "openai-codex") return undefined;

  let creds = loadCreds();

  return async (provider: string) => {
    if (provider !== "openai-codex") return undefined;

    const result = await getOAuthApiKey("openai-codex", creds);
    if (!result) return undefined;

    // Persist refreshed token if it changed
    if (result.newCredentials !== creds["openai-codex"]) {
      creds = { ...creds, "openai-codex": result.newCredentials };
      writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));
    }

    return result.apiKey;
  };
}
