/**
 * OCTO-FLOWS — named automated pipelines that agents can trigger as tools.
 *
 * Each flow is a TypeScript module that exports an executor function.
 * The registry maps flow name → executor. To add a new flow:
 *   1. Create src/flows/myFlow.ts exporting an async (ctx) => FlowResult
 *   2. Register it in FLOW_REGISTRY below
 *   3. It becomes available via the run_flow tool automatically
 */

import { codeScanFlow } from "./codeScanFlow.js";
import { semgrepScanFlow } from "./semgrepScanFlow.js";
import { gitleaksScanFlow } from "./gitleaksScanFlow.js";
import { trivyScanFlow } from "./trivyScanFlow.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FlowResult {
  success: boolean;
  /** One-line summary for the agent. */
  summary: string;
  /** Workspace-relative path to the generated report (if any). */
  reportPath?: string;
  /** Additional info — errors, warnings, timing. */
  details?: string;
}

export interface FlowContext {
  taskId: string;
  agentId: string;
  /** Path to scan/analyze — relative to workspace root or absolute. */
  targetPath: string;
  /** Flow-specific key/value options. */
  options?: Record<string, string>;
}

type FlowExecutor = (ctx: FlowContext) => Promise<FlowResult>;

// ── Registry ───────────────────────────────────────────────────────────────────

const FLOW_REGISTRY: Record<string, FlowExecutor> = {
  "code-scan": codeScanFlow,
  "sast-scan": semgrepScanFlow,
  "secret-scan": gitleaksScanFlow,
  "sca-scan": trivyScanFlow,
};

/** All registered flow names — exposed for tool descriptions. */
export const FLOW_NAMES = Object.keys(FLOW_REGISTRY);

// ── Dispatcher ─────────────────────────────────────────────────────────────────

export async function runFlow(name: string, ctx: FlowContext): Promise<FlowResult> {
  const executor = FLOW_REGISTRY[name];
  if (!executor) {
    return {
      success: false,
      summary: `Unknown flow: '${name}'. Available flows: ${FLOW_NAMES.join(", ")}`,
    };
  }
  try {
    return await executor(ctx);
  } catch (err) {
    return {
      success: false,
      summary: `Flow '${name}' threw an error: ${String(err)}`,
      details: String(err),
    };
  }
}
