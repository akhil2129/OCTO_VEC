/**
 * OCTO-FLOW: Secret Scan — runs Gitleaks via Docker to detect leaked secrets.
 *
 * Prerequisites:
 *   - Docker available in PATH
 *
 * Scans a directory (not git history) for hardcoded secrets, API keys, tokens,
 * passwords, and other credentials using pattern matching + entropy detection.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { config, sharedWorkspace } from "../config.js";
import type { FlowContext, FlowResult } from "./index.js";

export async function gitleaksScanFlow(ctx: FlowContext): Promise<FlowResult> {
  const { taskId, targetPath } = ctx;

  // ── 1. Resolve absolute target path ──────────────────────────────────────
  const absTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(config.workspace, targetPath);

  const normalizedTarget = path.resolve(absTarget);
  const normalizedWorkspace = path.resolve(config.workspace);
  if (!normalizedTarget.startsWith(normalizedWorkspace)) {
    return {
      success: false,
      summary: `Scan target "${targetPath}" resolves outside the workspace. Only workspace paths are allowed.`,
    };
  }

  // ── 2. Run Gitleaks via Docker ─────────────────────────────────────────
  const dockerMountPath = absTarget.replace(/\\/g, "/");

  // Write report to a temp file via a second mount — Gitleaks log output
  // goes to stderr, but --report-path=/dev/stdout doesn't reliably route
  // through Docker's stdout capture on Windows.
  const tmpDir = path.join(sharedWorkspace, ".tmp");
  mkdirSync(tmpDir, { recursive: true });
  const tmpBasename = `gitleaks-${taskId}-${Date.now()}.json`;
  const tmpReportPath = path.join(tmpDir, tmpBasename);
  const dockerTmpDir = tmpDir.replace(/\\/g, "/");

  const gitleaksCmd = [
    "docker run --rm",
    `-v "${dockerMountPath}:/src"`,
    `-v "${dockerTmpDir}:/tmp/out"`,
    "zricethezav/gitleaks:latest",
    "detect",
    "--source=/src",
    "--no-git",
    "--report-format=json",
    `--report-path=/tmp/out/${tmpBasename}`,
    "--exit-code=0", // don't fail on findings — we handle pass/fail ourselves
  ].join(" ");

  let scanFailed = false;
  let execError = "";
  try {
    execSync(gitleaksCmd, {
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    });
  } catch (err: any) {
    // Gitleaks exits 1 when it finds leaks in some versions
    if (!existsSync(tmpReportPath)) {
      scanFailed = true;
      execError = String(err?.stderr ?? err?.message ?? err);
    }
  }

  // ── 3. Parse JSON report file ────────────────────────────────────────────
  let findings: GitleaksFinding[] = [];
  let parseError = "";

  if (!scanFailed && existsSync(tmpReportPath)) {
    try {
      const raw = readFileSync(tmpReportPath, "utf-8").trim();
      if (raw && raw !== "null") {
        const parsed = JSON.parse(raw);
        findings = (Array.isArray(parsed) ? parsed : []).map((r: any) => ({
          ruleId: r.RuleID ?? "unknown",
          description: r.Description ?? "Secret detected",
          file: r.File ?? "unknown",
          startLine: r.StartLine ?? 0,
          endLine: r.EndLine ?? 0,
          match: redactSecret(r.Match ?? ""),
          secret: redactSecret(r.Secret ?? ""),
          commit: r.Commit ?? "",
          entropy: r.Entropy ?? 0,
          tags: r.Tags ?? [],
        }));
      }
    } catch {
      parseError = "Failed to parse Gitleaks JSON report file.";
      scanFailed = true;
    }
    // Clean up temp file
    try { unlinkSync(tmpReportPath); } catch { /* ignore */ }
  } else if (!scanFailed) {
    // No report file and no error = no findings (Gitleaks doesn't create file when clean)
    findings = [];
  }

  // ── 4. Build markdown report ───────────────────────────────────────────
  const report = buildMarkdownReport({ taskId, targetPath: absTarget, scanFailed, parseError, rawOutput: scanFailed ? execError : "", findings });

  // ── 5. Write report ───────────────────────────────────────────────────
  const reportsDir = path.join(sharedWorkspace, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const reportFileName = `secret-scan-${taskId.toLowerCase()}-${Date.now()}.md`;
  const reportPath = path.join(reportsDir, reportFileName);
  writeFileSync(reportPath, report, "utf-8");

  const relativeReportPath = `shared/reports/${reportFileName}`;

  // ── 6. Determine pass/fail ─────────────────────────────────────────────
  const hasLeaks = findings.length > 0;

  if (scanFailed) {
    return {
      success: false,
      summary: `Secret scan encountered errors. Partial report saved to ${relativeReportPath}.`,
      reportPath: relativeReportPath,
      details: (parseError || execError).substring(0, 500),
    };
  }

  return {
    success: !hasLeaks,
    summary: hasLeaks
      ? `Secret scan FAILED — ${findings.length} leaked secret(s) found! Report: ${relativeReportPath}`
      : `Secret scan PASSED — no leaked secrets detected. Report: ${relativeReportPath}`,
    reportPath: relativeReportPath,
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface GitleaksFinding {
  ruleId: string;
  description: string;
  file: string;
  startLine: number;
  endLine: number;
  match: string;
  secret: string;
  commit: string;
  entropy: number;
  tags: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Redact the middle of a secret so the report doesn't contain live credentials. */
function redactSecret(s: string): string {
  if (s.length <= 8) return "****";
  return s.slice(0, 4) + "****" + s.slice(-4);
}

// ── Markdown report builder ────────────────────────────────────────────────────

interface ReportOptions {
  taskId: string;
  targetPath: string;
  scanFailed: boolean;
  parseError: string;
  rawOutput: string;
  findings: GitleaksFinding[];
}

function buildMarkdownReport(opts: ReportOptions): string {
  const { taskId, targetPath, scanFailed, parseError, rawOutput, findings } = opts;
  const now = new Date().toISOString();

  const lines: string[] = [
    `# Secret Scan Report — ${taskId}`,
    ``,
    `**Generated:** ${now}`,
    `**Scanner:** Gitleaks (file-system mode, no-git)`,
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

  // ── Summary ─────────────────────────────────────────────────────────────
  if (!findings.length) {
    lines.push(`## Result: CLEAN`);
    lines.push(``);
    lines.push(`_No leaked secrets detected in the scanned files._`);
    lines.push(``);
  } else {
    lines.push(`## Result: SECRETS FOUND`);
    lines.push(``);
    lines.push(`> **ACTION REQUIRED:** ${findings.length} leaked secret(s) detected. These must be rotated immediately and removed from source code.`);
    lines.push(``);

    // Group by rule
    const byRule: Record<string, GitleaksFinding[]> = {};
    for (const f of findings) {
      if (!byRule[f.ruleId]) byRule[f.ruleId] = [];
      byRule[f.ruleId].push(f);
    }

    lines.push(`### Findings by Type`);
    lines.push(``);
    lines.push(`| Type | Count |`);
    lines.push(`|------|-------|`);
    for (const [rule, group] of Object.entries(byRule)) {
      lines.push(`| ${rule} | ${group.length} |`);
    }
    lines.push(``);

    lines.push(`### Details`);
    lines.push(``);

    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const cleanFile = f.file.replace(/^\/src\//, "");
      lines.push(`#### Finding ${i + 1}: ${f.description}`);
      lines.push(``);
      lines.push(`- **File:** \`${cleanFile}:${f.startLine}\``);
      lines.push(`- **Rule:** \`${f.ruleId}\``);
      lines.push(`- **Match:** \`${f.match}\``);
      if (f.entropy > 0) lines.push(`- **Entropy:** ${f.entropy.toFixed(2)}`);
      lines.push(`- **Action:** Rotate this credential immediately, then remove from source code.`);
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`_Generated by OCTO-FLOWS Secret Scan (Gitleaks) | VEC-ATP_`);

  return lines.join("\n");
}
