import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import os from "os";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import { getEmployeeId, getSpecialistEntries } from "./ar/roster.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * PACKAGE_ROOT — the root of the installed npm package.
 * Used ONLY to locate read-only shipped assets (core/prompts, core/roster.json, dashboard/dist).
 */
export const PACKAGE_ROOT = join(__dirname, "..");

/** @deprecated Use PACKAGE_ROOT instead. Alias kept for any stragglers. */
export const PROJECT_ROOT = PACKAGE_ROOT;

/**
 * USER_DATA_DIR — cross-platform directory for all mutable runtime state.
 *   Windows:   %APPDATA%/octo-vec
 *   Mac/Linux: ~/.octo-vec
 * Override with VEC_DATA_DIR env var for CI/testing.
 */
export const USER_DATA_DIR: string = process.env.VEC_DATA_DIR
  ?? (process.platform === "win32"
    ? join(process.env.APPDATA ?? join(os.homedir(), "AppData", "Roaming"), "octo-vec")
    : join(os.homedir(), ".octo-vec"));

/** Read-only core assets shipped with the package. */
export const CORE_DIR = join(PACKAGE_ROOT, "core");
export const CORE_PROMPTS_DIR = join(CORE_DIR, "prompts");
export const DEFAULT_ROSTER_PATH = join(CORE_DIR, "roster.json");

// ── Early bootstrap ────────────────────────────────────────────────────────
// Seed USER_DATA_DIR + roster.json BEFORE any other module tries to load it.
// This must happen here (not in main()) because modules like agentMessageQueue.ts
// call loadRoster() at top-level import time.
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync } from "fs";
mkdirSync(USER_DATA_DIR, { recursive: true });
const _userRoster = join(USER_DATA_DIR, "roster.json");
if (!existsSync(_userRoster) && existsSync(DEFAULT_ROSTER_PATH)) {
  copyFileSync(DEFAULT_ROSTER_PATH, _userRoster);
}

// ── Persistent settings file (workspace override, etc.) ───────────────────
const SETTINGS_PATH = join(USER_DATA_DIR, "settings.json");
function loadPersistedSettings(): Record<string, string> {
  try {
    if (existsSync(SETTINGS_PATH)) return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch { /* ignore corrupt file */ }
  return {};
}
function savePersistedSettings(data: Record<string, string>): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
}
const _persisted = loadPersistedSettings();

const thinkingLevelRaw = (process.env.VEC_THINKING_LEVEL ?? "off").trim().toLowerCase();
const thinkingLevel: ThinkingLevel =
  thinkingLevelRaw === "minimal" ||
  thinkingLevelRaw === "low" ||
  thinkingLevelRaw === "medium" ||
  thinkingLevelRaw === "high" ||
  thinkingLevelRaw === "xhigh"
    ? thinkingLevelRaw
    : "off";
const debugLlm = !["0", "false", "no"].includes(
  (process.env.VEC_DEBUG_LLM ?? "0").trim().toLowerCase()
);
const debugLlmStallSecs = Math.max(
  5,
  parseInt(process.env.VEC_DEBUG_LLM_STALL_SECS ?? "20", 10)
);

export const config = {
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  modelProvider: (process.env.VEC_MODEL_PROVIDER ?? "groq") as string,
  model: (process.env.VEC_MODEL ?? process.env.GROQ_MODEL ?? "moonshotai/kimi-k2-instruct-0905") as string,
  thinkingLevel,
  debugLlm,
  debugLlmStallSecs,
  temperature: parseFloat(process.env.GROQ_TEMPERATURE ?? "0.7"),
  maxTokens: parseInt(process.env.GROQ_MAX_TOKENS ?? "16384", 10),

  companyName: process.env.COMPANY_NAME ?? "VEC",
  workspace: process.env.VEC_WORKSPACE
    ?? _persisted.workspace
    ?? join(process.cwd(), "workspace"),
  pmProactiveEnabled:
    !["0", "false", "no"].includes(
      (process.env.VEC_PM_PROACTIVE_ENABLED ?? "0").trim().toLowerCase()
    ),
  /** How often the PM proactive loop runs (seconds). Default 30. Set via VEC_PM_PROACTIVE_INTERVAL_SECS. */
  pmProactiveIntervalSecs: Math.max(
    10,
    parseInt(process.env.VEC_PM_PROACTIVE_INTERVAL_SECS ?? "30", 10)
  ),

  dataDir: USER_DATA_DIR,
  memoryDir: join(USER_DATA_DIR, "memory"),
  dashboardPort: parseInt(process.env.VEC_DASHBOARD_PORT ?? "3000", 10),
  /**
   * Inbound message debounce window (ms). Rapid messages within this window
   * are batched into a single agent turn. Set VEC_DEBOUNCE_MS=0 to disable.
   * Default: 1500ms.
   */
  debounceMs: parseInt(process.env.VEC_DEBOUNCE_MS ?? "1500", 10),

  // ── Auto-compaction ────────────────────────────────────────────────────────
  /**
   * Model context window in tokens. Used to detect threshold. Default: 128 000.
   * Override via VEC_CONTEXT_WINDOW if using a model with a different limit.
   */
  contextWindow: parseInt(process.env.VEC_CONTEXT_WINDOW ?? "128000", 10),
  /**
   * Compact when estimated token usage exceeds this fraction of the usable window.
   * Usable = contextWindow - reserveTokens. Default: 0.75.
   */
  compactThreshold: parseFloat(process.env.VEC_COMPACT_THRESHOLD ?? "0.75"),
  /**
   * Messages to always keep at the tail of history after compaction. Default: 20.
   */
  compactKeepRecent: parseInt(process.env.VEC_COMPACT_KEEP_RECENT ?? "20", 10),
  /** Set VEC_CLI_ENABLED=0 to run headless (dashboard + Telegram only, no readline loop). */
  cliEnabled: !["0", "false", "no"].includes(
    (process.env.VEC_CLI_ENABLED ?? "1").trim().toLowerCase()
  ),

  // ── OCTO-FLOWS: SonarQube ───────────────────────────────────────────────────
  sonarHostUrl: process.env.SONAR_HOST_URL ?? "http://localhost:9000",
  sonarToken: process.env.SONAR_TOKEN ?? "",
  sonarProjectBaseKey: process.env.SONAR_PROJECT_BASE_KEY ?? "vec",
  sonarScannerImage: process.env.SONAR_SCANNER_IMAGE ?? "sonarsource/sonar-scanner-cli:latest",

  // ── Web Search (SearXNG) ──────────────────────────────────────────────────
  searxngUrl: process.env.SEARXNG_URL ?? "http://localhost:8888",

  // ── Post-task security scans ───────────────────────────────────────────────
  /** Run automated security scans after coding task completion. Set VEC_POST_TASK_SCANS=0 to disable. */
  postTaskScansEnabled: !["0", "false", "no"].includes(
    (process.env.VEC_POST_TASK_SCANS ?? "1").trim().toLowerCase()
  ),
};

/**
 * Update the workspace directory at runtime and persist to settings.json.
 * Takes effect immediately — new tasks will use the updated path.
 * Existing in-progress tasks keep their original paths until completion.
 */
export function setWorkspace(newPath: string): void {
  config.workspace = newPath;
  const s = loadPersistedSettings();
  s.workspace = newPath;
  savePersistedSettings(s);
}

/** Shared workspace — all agents can read/write cross-agent deliverables here. */
export const sharedWorkspace = join(config.workspace, "shared");

/** Projects folder — standalone software projects built by agents live here. */
export const projectsWorkspace = join(config.workspace, "projects");

/** Per-agent private workspace — agent's own drafts, scratch files, temp outputs. */
export function agentWorkspace(agentId: string): string {
  return join(config.workspace, "agents", getEmployeeId(agentId));
}

/** Build workspace directory list dynamically from roster. */
export function getWorkspaceDirs(): string[] {
  return [
    config.workspace,
    sharedWorkspace,
    projectsWorkspace,
    // specialist agent folders — driven by roster.json
    ...getSpecialistEntries().map((e) => join(config.workspace, "agents", e.employee_id)),
  ];
}
