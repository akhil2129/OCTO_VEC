/**
 * OCTO-FLOW: SAST Scan — runs Semgrep static analysis via Docker.
 *
 * Prerequisites:
 *   - Docker available in PATH
 *   - Internet access (Semgrep downloads rules on first run)
 *
 * The scanner runs as a Docker container (no local install needed).
 * Uses `--config=auto` for the recommended ruleset (OWASP Top 10, injection, crypto, etc.).
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { config, sharedWorkspace } from "../config.js";
import type { FlowContext, FlowResult } from "./index.js";

/** Severity levels in descending order of importance. */
const SEVERITY_ORDER = ["ERROR", "WARNING", "INFO"] as const;

/** Map Semgrep severity → human-readable label. */
const SEVERITY_LABEL: Record<string, string> = {
  ERROR: "CRITICAL/HIGH",
  WARNING: "MEDIUM",
  INFO: "LOW",
};

export async function semgrepScanFlow(ctx: FlowContext): Promise<FlowResult> {
  const { taskId, targetPath, options } = ctx;

  // ── 1. Resolve absolute target path ──────────────────────────────────────
  const absTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(config.workspace, targetPath);

  // Safety: ensure the target is inside the workspace
  const normalizedTarget = path.resolve(absTarget);
  const normalizedWorkspace = path.resolve(config.workspace);
  if (normalizedTarget !== normalizedWorkspace && !normalizedTarget.startsWith(normalizedWorkspace + path.sep)) {
    return {
      success: false,
      summary: `Scan target "${targetPath}" resolves outside the workspace. Only workspace paths are allowed.`,
    };
  }

  // ── 2. Severity threshold for pass/fail ────────────────────────────────
  const failSeverity = (options?.fail_severity ?? "ERROR").toUpperCase();

  // ── 3. Run Semgrep via Docker ──────────────────────────────────────────
  const dockerMountPath = absTarget.replace(/\\/g, "/");

  const semgrepCmd = [
    "docker run --rm",
    `-v "${dockerMountPath}:/src"`,
    "semgrep/semgrep",
    "semgrep scan",
    "--config=auto",
    "--json",
    "--quiet",
    "--no-git-ignore",
    "/src",
  ].join(" ");

  let rawOutput = "";
  let scanFailed = false;
  try {
    rawOutput = execSync(semgrepCmd, {
      encoding: "utf-8",
      timeout: 300_000, // 5 min for large projects
      maxBuffer: 50 * 1024 * 1024, // 50MB — Semgrep JSON can be large
      env: { ...process.env, MSYS_NO_PATHCONV: "1" }, // prevent Git Bash mangling /src on Windows
    });
  } catch (err: any) {
    // Semgrep exits non-zero when findings exist — check if we still got JSON
    if (err?.stdout) {
      rawOutput = err.stdout;
    } else {
      scanFailed = true;
      rawOutput = String(err?.stderr ?? err?.message ?? err);
    }
  }

  // ── 4. Parse JSON results ──────────────────────────────────────────────
  let findings: SemgrepFinding[] = [];
  let parseError = "";

  if (!scanFailed) {
    try {
      const parsed = JSON.parse(rawOutput);
      findings = (parsed.results ?? []).map((r: any) => ({
        ruleId: r.check_id ?? "unknown",
        severity: r.extra?.severity ?? "INFO",
        message: r.extra?.message ?? r.message ?? "No message",
        file: r.path ?? "unknown",
        line: r.start?.line ?? 0,
        endLine: r.end?.line ?? 0,
        metadata: r.extra?.metadata ?? {},
      }));
    } catch {
      parseError = "Failed to parse Semgrep JSON output.";
      scanFailed = true;
    }
  }

  // ── 5. Build markdown report ───────────────────────────────────────────
  const report = buildMarkdownReport({
    taskId,
    targetPath: absTarget,
    scanFailed,
    parseError,
    rawOutput: scanFailed ? rawOutput : "",
    findings,
  });

  // ── 6. Write report ───────────────────────────────────────────────────
  const reportsDir = path.join(sharedWorkspace, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const reportFileName = `sast-scan-${taskId.toLowerCase()}-${Date.now()}.md`;
  const reportPath = path.join(reportsDir, reportFileName);
  writeFileSync(reportPath, report, "utf-8");

  const relativeReportPath = `shared/reports/${reportFileName}`;

  // ── 7. Determine pass/fail based on severity threshold ─────────────────
  const failSeverities = SEVERITY_ORDER.slice(
    0,
    SEVERITY_ORDER.indexOf(failSeverity as any) + 1,
  );
  const criticalFindings = findings.filter((f) =>
    failSeverities.includes(f.severity as any),
  );
  const hasCritical = criticalFindings.length > 0;

  // Build summary counts
  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as keyof typeof counts]++;
  }
  const countStr = `${counts.ERROR} critical/high, ${counts.WARNING} medium, ${counts.INFO} low`;

  if (scanFailed) {
    return {
      success: false,
      summary: `SAST scan encountered errors. Partial report saved to ${relativeReportPath}.`,
      reportPath: relativeReportPath,
      details: (parseError || rawOutput).substring(0, 500),
    };
  }

  return {
    success: !hasCritical,
    summary: hasCritical
      ? `SAST scan FAILED — ${findings.length} findings (${countStr}). Report: ${relativeReportPath}`
      : `SAST scan PASSED — ${findings.length} findings (${countStr}). Report: ${relativeReportPath}`,
    reportPath: relativeReportPath,
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface SemgrepFinding {
  ruleId: string;
  severity: string;
  message: string;
  file: string;
  line: number;
  endLine: number;
  metadata: Record<string, any>;
}

// ── Markdown report builder ────────────────────────────────────────────────────

interface ReportOptions {
  taskId: string;
  targetPath: string;
  scanFailed: boolean;
  parseError: string;
  rawOutput: string;
  findings: SemgrepFinding[];
}

function buildMarkdownReport(opts: ReportOptions): string {
  const { taskId, targetPath, scanFailed, parseError, rawOutput, findings } = opts;
  const now = new Date().toISOString();

  const lines: string[] = [
    `# SAST Scan Report — ${taskId}`,
    ``,
    `**Generated:** ${now}`,
    `**Scanner:** Semgrep (config=auto)`,
    `**Scanned Path:** \`${targetPath}\``,
    `**Total Findings:** ${findings.length}`,
    ``,
  ];

  if (scanFailed) {
    lines.push(`> **WARNING:** Scanner encountered errors. Results below may be partial.`);
    if (parseError) lines.push(`> ${parseError}`);
    if (rawOutput) {
      lines.push(``, "```", rawOutput.substring(0, 1000), "```", ``);
    }
    lines.push(``);
  }

  // ── Summary table ───────────────────────────────────────────────────────
  const counts = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as keyof typeof counts]++;
  }

  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(`| Critical/High (ERROR) | ${counts.ERROR} |`);
  lines.push(`| Medium (WARNING) | ${counts.WARNING} |`);
  lines.push(`| Low (INFO) | ${counts.INFO} |`);
  lines.push(``);

  // ── Findings by severity ────────────────────────────────────────────────
  if (!findings.length) {
    lines.push(`## Findings`);
    lines.push(``);
    lines.push(`_No security findings detected. Code looks clean._`);
    lines.push(``);
  } else {
    lines.push(`## Findings`);
    lines.push(``);

    for (const sev of SEVERITY_ORDER) {
      const group = findings.filter((f) => f.severity === sev);
      if (!group.length) continue;

      const label = SEVERITY_LABEL[sev] ?? sev;
      lines.push(`### ${label} (${group.length})`);
      lines.push(``);

      for (const f of group) {
        // Strip /src/ prefix from Docker paths for readability
        const cleanFile = f.file.replace(/^\/src\//, "");
        const lineRef = f.line ? `:${f.line}` : "";
        lines.push(`- **\`${cleanFile}${lineRef}\`** — ${f.message}`);
        lines.push(`  - Rule: \`${f.ruleId}\``);
        if (f.metadata?.cwe) {
          const cwes = Array.isArray(f.metadata.cwe) ? f.metadata.cwe.join(", ") : f.metadata.cwe;
          lines.push(`  - CWE: ${cwes}`);
        }
        if (f.metadata?.owasp) {
          const owasp = Array.isArray(f.metadata.owasp) ? f.metadata.owasp.join(", ") : f.metadata.owasp;
          lines.push(`  - OWASP: ${owasp}`);
        }
      }
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`_Generated by OCTO-FLOWS SAST Scan (Semgrep) | VEC-ATP_`);

  return lines.join("\n");
}
