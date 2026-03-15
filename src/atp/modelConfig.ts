/**
 * ModelConfig — per-agent model overrides and provider priority management.
 *
 * Reads ALL providers and models from @mariozechner/pi-ai's generated registry.
 * Persists to data/model-config.json. Agents without overrides use the
 * primary model (from config/env). Supports primary/secondary/fallback tiers.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "../config.js";
// pi-ai's generated model registry — the single source of truth
import { MODELS } from "@mariozechner/pi-ai/dist/models.generated.js";
import { getEnvApiKey } from "@mariozechner/pi-ai/dist/env-api-keys.js";

const CONFIG_PATH = join(config.dataDir, "model-config.json");
const KEYS_PATH = join(config.dataDir, "api-keys.json");

// ── Provider display names ──────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI",
  cerebras: "Cerebras",
  "github-copilot": "GitHub Copilot",
  google: "Google Gemini",
  "google-antigravity": "Google Antigravity",
  "google-gemini-cli": "Gemini CLI",
  "google-vertex": "Google Vertex AI",
  groq: "Groq",
  huggingface: "Hugging Face",
  "kimi-coding": "Kimi Coding",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax CN",
  mistral: "Mistral",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI (Grok)",
  zai: "ZhipuAI (GLM)",
};

// Env var hints for display in the UI (matches pi-ai's getEnvApiKey)
const ENV_KEY_HINTS: Record<string, string> = {
  "amazon-bedrock": "AWS_ACCESS_KEY_ID",
  anthropic: "ANTHROPIC_API_KEY",
  "azure-openai-responses": "AZURE_OPENAI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  "github-copilot": "GITHUB_TOKEN",
  google: "GEMINI_API_KEY",
  "google-antigravity": "GEMINI_API_KEY",
  "google-gemini-cli": "GEMINI_API_KEY",
  "google-vertex": "GOOGLE_APPLICATION_CREDENTIALS",
  groq: "GROQ_API_KEY",
  huggingface: "HF_TOKEN",
  "kimi-coding": "KIMI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  "minimax-cn": "MINIMAX_CN_API_KEY",
  mistral: "MISTRAL_API_KEY",
  openai: "OPENAI_API_KEY",
  "openai-codex": "OPENAI_API_KEY",
  opencode: "OPENCODE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "AI_GATEWAY_API_KEY",
  xai: "XAI_API_KEY",
  zai: "ZAI_API_KEY",
};

// ── Provider icons (local assets from lobe-icons) ───────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  "amazon-bedrock": "bedrock",
  anthropic: "anthropic",
  "azure-openai-responses": "azure",
  cerebras: "cerebras",
  "github-copilot": "githubcopilot",
  google: "gemini",
  "google-antigravity": "antigravity",
  "google-gemini-cli": "gemini",
  "google-vertex": "googlecloud",
  groq: "groq",
  huggingface: "huggingface",
  "kimi-coding": "kimi",
  minimax: "minimax",
  "minimax-cn": "minimax",
  mistral: "mistral",
  openai: "openai",
  "openai-codex": "codex",
  opencode: "openai",
  openrouter: "openrouter",
  "vercel-ai-gateway": "vercel",
  xai: "xai",
  zai: "chatglm",
};

// ── Provider detection ───────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  envKey: string;
  models: string[];
  iconUrl: string;
}

/** Build the full provider list dynamically from pi-ai's model registry. */
export function getProviders(): ProviderInfo[] {
  const providerIds = Object.keys(MODELS as Record<string, Record<string, unknown>>);
  return providerIds.map((id) => {
    const modelsMap = (MODELS as Record<string, Record<string, unknown>>)[id] ?? {};
    const modelIds = Object.keys(modelsMap);
    const configured = !!getEnvApiKey(id);
    const slug = PROVIDER_ICONS[id] ?? id;
    return {
      id,
      name: PROVIDER_LABELS[id] ?? id,
      configured,
      envKey: ENV_KEY_HINTS[id] ?? "",
      models: modelIds,
      iconUrl: `/icons/providers/${slug}.svg`,
    };
  });
}

// ── Config types ─────────────────────────────────────────────────────────────

export interface ModelSlot {
  provider: string;
  model: string;
}

export interface ModelConfigStore {
  primary: ModelSlot;
  secondary: ModelSlot | null;
  fallback: ModelSlot | null;
  agentModels: Record<string, ModelSlot>;
}

// ── Load / Save ──────────────────────────────────────────────────────────────

function defaultConfig(): ModelConfigStore {
  return {
    primary: { provider: config.modelProvider, model: config.model },
    secondary: null,
    fallback: null,
    agentModels: {},
  };
}

let store: ModelConfigStore = loadConfig();

function loadConfig(): ModelConfigStore {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      return {
        primary: raw.primary ?? { provider: config.modelProvider, model: config.model },
        secondary: raw.secondary ?? null,
        fallback: raw.fallback ?? null,
        agentModels: raw.agentModels ?? {},
      };
    }
  } catch { /* ignore */ }
  return defaultConfig();
}

function saveConfig(): void {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(store, null, 2));
  } catch { /* best-effort */ }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getModelConfig(): ModelConfigStore {
  return store;
}

export function setModelConfig(cfg: Partial<ModelConfigStore>): void {
  if (cfg.primary) store.primary = cfg.primary;
  if (cfg.secondary !== undefined) store.secondary = cfg.secondary;
  if (cfg.fallback !== undefined) store.fallback = cfg.fallback;
  if (cfg.agentModels !== undefined) store.agentModels = cfg.agentModels;
  saveConfig();
}

export function setAgentModel(agentId: string, slot: ModelSlot | null): void {
  if (slot) {
    store.agentModels[agentId] = slot;
  } else {
    delete store.agentModels[agentId];
  }
  saveConfig();
}

/** Get the effective model for an agent (override or primary). */
export function getEffectiveModel(agentId: string): ModelSlot {
  return store.agentModels[agentId] ?? store.primary;
}

export function resetModelConfig(): void {
  store = defaultConfig();
  saveConfig();
}

// ── API Key store ─────────────────────────────────────────────────────────────

function loadApiKeys(): Record<string, string> {
  try {
    if (existsSync(KEYS_PATH)) {
      return JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

/** Inject stored API keys into process.env so getEnvApiKey() picks them up. */
export function injectStoredApiKeys(): void {
  const keys = loadApiKeys();
  for (const [provider, key] of Object.entries(keys)) {
    const envVar = ENV_KEY_HINTS[provider];
    if (envVar && key) {
      process.env[envVar] = key;
    }
  }
}

/** Set (or clear) a provider API key — persists to disk and injects into env. */
export function setProviderApiKey(providerId: string, apiKey: string): void {
  const keys = loadApiKeys();
  const envVar = ENV_KEY_HINTS[providerId];
  if (!envVar) return;
  if (apiKey) {
    keys[providerId] = apiKey;
    process.env[envVar] = apiKey;
  } else {
    delete keys[providerId];
    delete process.env[envVar];
  }
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  } catch { /* best-effort */ }
}

/** Return a masked version of a stored key (for UI display), or null if none. */
export function getProviderKeyMask(providerId: string): string | null {
  const keys = loadApiKeys();
  const key = keys[providerId];
  if (!key) return null;
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

/** Look up per-model cost rates (USD per 1M tokens) from the pi-ai registry. */
export function getModelCostRates(provider: string, modelId: string): {
  inputPerM: number; outputPerM: number; cacheReadPerM: number;
} | null {
  const m = (MODELS as Record<string, Record<string, any>>)[provider]?.[modelId];
  if (!m?.cost) return null;
  return { inputPerM: m.cost.input, outputPerM: m.cost.output, cacheReadPerM: m.cost.cacheRead ?? 0 };
}

// Inject stored keys on module load (before config is used)
injectStoredApiKeys();
