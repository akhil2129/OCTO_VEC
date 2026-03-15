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

// ── Fallback pricing (USD per 1M tokens) ─────────────────────────────────────
// Used only when real per-model cost data isn't available from the provider.
const FALLBACK_INPUT_PER_M = parseFloat(process.env.VEC_INPUT_COST_PER_M ?? "0.50");
const FALLBACK_OUTPUT_PER_M = parseFloat(process.env.VEC_OUTPUT_COST_PER_M ?? "1.50");

// ── Per-agent accumulator ────────────────────────────────────────────────────

export interface AgentUsage {
  agentId: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  lastActivity: string;  // ISO timestamp
  model?: string;        // last model used (e.g. "claude-sonnet-4-20250514")
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
      lastActivity: new Date().toISOString(),
    };
  }
  return store.agents[agentId];
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputPerM = FALLBACK_INPUT_PER_M,
  outputPerM = FALLBACK_OUTPUT_PER_M,
): number {
  return (inputTokens * inputPerM + outputTokens * outputPerM) / 1_000_000;
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

/** Call when an agent finishes a turn. Uses real usage data if provided, else estimates. */
export function trackTurnEnd(agentId: string, opts?: {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  inputCostPerM?: number;
  outputCostPerM?: number;
}): void {
  const agent = ensureAgent(agentId);

  let inputTokens: number;
  let outputTokens: number;
  let cost: number;

  if (opts?.inputTokens != null && opts?.outputTokens != null) {
    // Real usage data from the provider
    inputTokens = opts.inputTokens;
    outputTokens = opts.outputTokens;
    cost = opts.costUsd != null
      ? opts.costUsd
      : computeCostUsd(inputTokens, outputTokens, opts.inputCostPerM, opts.outputCostPerM);
  } else {
    // Fallback: estimate from streamed chars
    const outputChars = _turnChars[agentId] ?? 0;
    outputTokens = charsToTokens(outputChars);
    inputTokens = Math.ceil(outputTokens * 2.5);
    cost = computeCostUsd(inputTokens, outputTokens);
  }

  agent.turns += 1;
  agent.outputTokens += outputTokens;
  agent.inputTokens += inputTokens;
  agent.totalTokens += inputTokens + outputTokens;
  agent.costUsd += cost;
  agent.lastActivity = new Date().toISOString();
  if (opts?.model) agent.model = opts.model;

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
  sessionStart: string;
} {
  const agents = Object.values(store.agents);
  return {
    totalTurns: agents.reduce((s, a) => s + a.turns, 0),
    totalInputTokens: agents.reduce((s, a) => s + a.inputTokens, 0),
    totalOutputTokens: agents.reduce((s, a) => s + a.outputTokens, 0),
    totalTokens: agents.reduce((s, a) => s + a.totalTokens, 0),
    totalCostUsd: agents.reduce((s, a) => s + a.costUsd, 0),
    sessionStart: store.sessionStart,
  };
}

/** Reset all usage data. */
export function resetUsage(): void {
  store = { agents: {}, sessionStart: new Date().toISOString() };
  saveStore();
}
