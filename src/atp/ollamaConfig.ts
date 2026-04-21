/**
 * Ollama support — local or remote Ollama server using the OpenAI-compatible API.
 *
 * Ollama exposes /v1/chat/completions (OpenAI-compatible), so we use the
 * openai-completions provider from pi-ai with a custom baseUrl.
 *
 * Config is stored in data/ollama-config.json and also respects OLLAMA_BASE_URL env var.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
import type { Model } from "@mariozechner/pi-ai";

const OLLAMA_CONFIG_PATH = join(config.dataDir, "ollama-config.json");

interface OllamaStoredConfig {
  baseUrl: string;
  models?: string[];
}

let cachedModels: string[] = [];

// ── Config read/write ──────────────────────────────────────────────────────

export function getOllamaConfig(): { baseUrl: string } | null {
  const envUrl = process.env.OLLAMA_BASE_URL;
  if (envUrl) return { baseUrl: envUrl };
  try {
    if (existsSync(OLLAMA_CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(OLLAMA_CONFIG_PATH, "utf-8")) as OllamaStoredConfig;
      if (raw.baseUrl) return { baseUrl: raw.baseUrl };
    }
  } catch { /* ignore */ }
  return null;
}

export function setOllamaBaseUrl(baseUrl: string): void {
  mkdirSync(config.dataDir, { recursive: true });
  const existing = loadStoredConfig();
  writeFileSync(OLLAMA_CONFIG_PATH, JSON.stringify({ ...existing, baseUrl }, null, 2));
  process.env.OLLAMA_BASE_URL = baseUrl;
}

function loadStoredConfig(): OllamaStoredConfig {
  try {
    if (existsSync(OLLAMA_CONFIG_PATH)) {
      return JSON.parse(readFileSync(OLLAMA_CONFIG_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { baseUrl: "" };
}

// ── Model discovery ────────────────────────────────────────────────────────

export function getCachedOllamaModels(): string[] {
  return cachedModels;
}

export async function refreshOllamaModels(): Promise<string[]> {
  const cfg = getOllamaConfig();
  if (!cfg?.baseUrl) return [];
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { models?: Array<{ name: string }> };
    cachedModels = (data.models ?? []).map(m => m.name);
    // Persist cached list so it survives restarts
    const stored = loadStoredConfig();
    writeFileSync(OLLAMA_CONFIG_PATH, JSON.stringify({ ...stored, models: cachedModels }, null, 2));
    return cachedModels;
  } catch (err) {
    console.error("[Ollama] Failed to fetch models:", (err as Error).message);
    return cachedModels;
  }
}

// ── Model object factory ──────────────────────────────────────────────────

/**
 * Build a pi-ai Model object for an Ollama model.
 * Uses the openai-completions API pointed at the Ollama base URL.
 */
export function getOllamaModel(modelId: string): Model<"openai-completions"> {
  const cfg = getOllamaConfig();
  const baseUrl = (cfg?.baseUrl ?? "http://localhost:11434").replace(/\/$/, "");
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "ollama",
    baseUrl: `${baseUrl}/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 4096,
  };
}

// ── Init: restore cached models from disk on module load ──────────────────

(function initCachedModels() {
  try {
    if (existsSync(OLLAMA_CONFIG_PATH)) {
      const stored = JSON.parse(readFileSync(OLLAMA_CONFIG_PATH, "utf-8")) as OllamaStoredConfig;
      if (stored.models?.length) cachedModels = stored.models;
    }
  } catch { /* ignore */ }
})();
