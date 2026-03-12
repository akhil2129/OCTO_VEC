/**
 * TokenTracker — tracks per-agent token usage from stream events.
 *
 * Estimates token counts from streamed text (≈4 chars per token).
 * Accumulates per-agent stats: turns, estimated input/output tokens,
 * and estimated cost based on configurable pricing.
 *
 * Persists to data/token-usage.json so stats survive restarts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "../config.js";

const USAGE_PATH = join(config.dataDir, "token-usage.json");

// ── Pricing (USD per 1M tokens) ──────────────────────────────────────────────
// Default rates for common models. Override via env vars if needed.
const INPUT_COST_PER_M = parseFloat(process.env.VEC_INPUT_COST_PER_M ?? "0.50");
const OUTPUT_COST_PER_M = parseFloat(process.env.VEC_OUTPUT_COST_PER_M ?? "1.50");
const USD_TO_INR = parseFloat(process.env.VEC_USD_TO_INR ?? "85.0");

// ── Per-agent accumulator ────────────────────────────────────────────────────

export interface AgentUsage {
  agentId: string;
  turns: number;
  inputTokens: number;   // estimated
  outputTokens: number;  // estimated from streamed text
  totalTokens: number;
  costUsd: number;
  costInr: number;
  lastActivity: string;  // ISO timestamp
}

interface UsageStore {
  agents: Record<string, AgentUsage>;
  sessionStart: string;
}

// ── In-memory state ──────────────────────────────────────────────────────────

let store: UsageStore = loadStore();

// Track chars accumulated during current turn (per agent)
const _turnChars: Record<string, number> = {};

function loadStore(): UsageStore {
  try {
    if (existsSync(USAGE_PATH)) {
      return JSON.parse(readFileSync(USAGE_PATH, "utf-8"));
    }
  } catch { /* ignore corrupt file */ }
  return { agents: {}, sessionStart: new Date().toISOString() };
}

function saveStore(): void {
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(USAGE_PATH, JSON.stringify(store, null, 2));
  } catch { /* best-effort persist */ }
}

function ensureAgent(agentId: string): AgentUsage {
  if (!store.agents[agentId]) {
    store.agents[agentId] = {
      agentId,
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      costInr: 0,
      lastActivity: new Date().toISOString(),
    };
  }
  return store.agents[agentId];
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function computeCost(inputTokens: number, outputTokens: number): { usd: number; inr: number } {
  const usd = (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000;
  return { usd, inr: usd * USD_TO_INR };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Call when an agent starts a turn. */
export function trackTurnStart(agentId: string): void {
  _turnChars[agentId] = 0;
}

/** Call with each text/thinking delta to accumulate output chars. */
export function trackOutputChars(agentId: string, chars: number): void {
  _turnChars[agentId] = (_turnChars[agentId] ?? 0) + chars;
}

/** Call when an agent finishes a turn. Estimates input tokens as ~2x output. */
export function trackTurnEnd(agentId: string): void {
  const agent = ensureAgent(agentId);
  const outputChars = _turnChars[agentId] ?? 0;
  const outputTokens = charsToTokens(outputChars);
  // Rough estimate: input context is typically 2-3x the output for agentic workflows
  const inputTokens = Math.ceil(outputTokens * 2.5);

  agent.turns += 1;
  agent.outputTokens += outputTokens;
  agent.inputTokens += inputTokens;
  agent.totalTokens += inputTokens + outputTokens;
  const cost = computeCost(inputTokens, outputTokens);
  agent.costUsd += cost.usd;
  agent.costInr += cost.inr;
  agent.lastActivity = new Date().toISOString();

  delete _turnChars[agentId];
  saveStore();
}

/** Get usage for all agents. */
export function getAllUsage(): AgentUsage[] {
  return Object.values(store.agents);
}

/** Get aggregate totals. */
export function getTotals(): {
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCostInr: number;
  sessionStart: string;
  pricing: { inputPerM: number; outputPerM: number; usdToInr: number };
} {
  const agents = Object.values(store.agents);
  return {
    totalTurns: agents.reduce((s, a) => s + a.turns, 0),
    totalInputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
    totalOutputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
    totalTokens: agents.reduce((s, a) => s + a.totalTokens, 0),
    totalCostUsd: agents.reduce((s, a) => s + a.costUsd, 0),
    totalCostInr: agents.reduce((s, a) => s + a.costInr, 0),
    sessionStart: store.sessionStart,
    pricing: { inputPerM: INPUT_COST_PER_M, outputPerM: OUTPUT_COST_PER_M, usdToInr: USD_TO_INR },
  };
}

/** Reset all usage data. */
export function resetUsage(): void {
  store = { agents: {}, sessionStart: new Date().toISOString() };
  saveStore();
}
