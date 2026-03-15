/**
 * OCTO-FLOW: SCA Scan — runs Trivy via Docker to detect dependency vulnerabilities.
 *
 * Prerequisites:
 *   - Docker available in PATH
 *
 * Scans a project's filesystem (package-lock.json, yarn.lock, etc.) for known
 * CVEs in dependencies using the Trivy vulnerability database.
 * Also detects secrets and misconfigurations as a bonus.
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { config, sharedWorkspace } from "../config.js";
import type { FlowContext, FlowResult } from "./index.js";

/** Trivy severity levels in descending order. */
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

export async function trivyScanFlow(ctx: FlowContext): Promise<FlowResult> {
  const { taskId, targetPath, options } = ctx;

  // ── 1. Resolve absolute target path ──────────────────────────────────────
  const absTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(config.workspace, targetPath);

  const normalizedTarget = path.resolve(absTarget);
  const normalizedWorkspace = path.resolve(config.workspace);
  if (normalizedTarget !== normalizedWorkspace && !normalizedTarget.startsWith(normalizedWorkspace + path.sep)) {
    return {
      success: false,
      summary: `Scan target "${targetPath}" resolves outside the workspace. Only workspace paths are allowed.`,
    };
  }

  // ── 2. Severity threshold for pass/fail ────────────────────────────────
  const failSeverity = (options?.fail_severity ?? "HIGH").toUpperCase();

  // ── 3. Run Trivy via Docker ────────────────────────────────────────────
  const dockerMountPath = absTarget.replace(/\\/g, "/");

  // Trivy fs mode: scans filesystem for vulnerable dependencies + secrets
  const trivyCmd = [
    "docker run --rm",
    `-v "${dockerMountPath}:/src"`,
    "aquasec/trivy:latest",
    "fs",
    "--format=json",
    "--scanners=vuln,secret",
    "--skip-dirs=node_modules/.cache",
    "/src",
  ].join(" ");

  let rawOutput = "";
  let scanFailed = false;
  try {
    rawOutput = execSync(trivyCmd, {
      encoding: "utf-8",
      timeout: 300_000, // 5 min
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    });
  } catch (err: any) {
    if (err?.stdout) {
      rawOutput = err.stdout;
    } else {
      scanFailed = true;
      rawOutput = String(err?.stderr ?? err?.message ?? err);
    }
  }

  // ── 4. Parse JSON results ──────────────────────────────────────────────
  let findings: TrivyVuln[] = [];
  let parseError = "";

  if (!scanFailed) {
    try {
      const parsed = JSON.parse(rawOutput);
      const results = parsed.Results ?? [];
      for (const result of results) {
        const vulns = result.Vulnerabilities ?? [];
        for (const v of vulns) {
          findings.push({
            target: result.Target ?? "unknown",
            pkgName: v.PkgName ?? "unknown",
            installedVersion: v.InstalledVersion ?? "",
            fixedVersion: v.FixedVersion ?? "",
            severity: v.Severity ?? "UNKNOWN",
            vulnId: v.VulnerabilityID ?? "",
            title: v.Title ?? v.Description ?? "No description",
            primaryUrl: v.PrimaryURL ?? "",
          });
        }
      }
    } catch {
      parseError = "Failed to parse Trivy JSON output.";
      scanFailed = true;
    }
  }

  // ── 5. Build markdown report ───────────────────────────────────────────
  const report = buildMarkdownReport({ taskId, targetPath: absTarget, scanFailed, parseError, rawOutput: scanFailed ? rawOutput : "", findings });

  // ── 6. Write report ───────────────────────────────────────────────────
  const reportsDir = path.join(sharedWorkspace, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const reportFileName = `sca-scan-${taskId.toLowerCase()}-${Date.now()}.md`;
  const reportPath = path.join(reportsDir, reportFileName);
  writeFileSync(reportPath, report, "utf-8");

  const relativeReportPath = `shared/reports/${reportFileName}`;

  // ── 7. Determine pass/fail based on severity threshold ─────────────────
  const failIdx = SEVERITY_ORDER.indexOf(failSeverity as any);
  const failSeverities = failIdx >= 0 ? SEVERITY_ORDER.slice(0, failIdx + 1) : ["CRITICAL", "HIGH"];
  const criticalFindings = findings.filter((f) =>
    failSeverities.includes(f.severity as any),
  );
  const hasCritical = criticalFindings.length > 0;

  // Build summary counts
  const counts: Record<string, number> = {};
  for (const sev of SEVERITY_ORDER) counts[sev] = 0;
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const countStr = `${counts.CRITICAL} critical, ${counts.HIGH} high, ${counts.MEDIUM} medium, ${counts.LOW} low`;

  if (scanFailed) {
    return {
      success: false,
      summary: `SCA scan encountered errors. Partial report saved to ${relativeReportPath}.`,
      reportPath: relativeReportPath,
      details: (parseError || rawOutput).substring(0, 500),
    };
  }

  return {
    success: !hasCritical,
    summary: hasCritical
      ? `SCA scan FAILED — ${findings.length} vulnerable dependencies (${countStr}). Report: ${relativeReportPath}`
      : `SCA scan PASSED — ${findings.length} findings (${countStr}). Report: ${relativeReportPath}`,
    reportPath: relativeReportPath,
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrivyVuln {
  target: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion: string;
  severity: string;
  vulnId: string;
  title: string;
  primaryUrl: string;
}

// ── Markdown report builder ────────────────────────────────────────────────────

interface ReportOptions {
  taskId: string;
  targetPath: string;
  scanFailed: boolean;
  parseError: string;
  rawOutput: string;
  findings: TrivyVuln[];
}

function buildMarkdownReport(opts: ReportOptions): string {
  const { taskId, targetPath, scanFailed, parseError, rawOutput, findings } = opts;
  const now = new Date().toISOString();

  const lines: string[] = [
    `# SCA Scan Report — ${taskId}`,
    ``,
    `**Generated:** ${now}`,
    `**Scanner:** Trivy (filesystem mode — vuln + secret scanners)`,
    `**Scanned Path:** \`${targetPath}\``,
    `**Total Vulnerabilities:** ${findings.length}`,
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
  const counts: Record<string, number> = {};
  for (const sev of SEVERITY_ORDER) counts[sev] = 0;
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;

  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  for (const sev of SEVERITY_ORDER) {
    if (counts[sev] > 0 || sev === "CRITICAL" || sev === "HIGH") {
      lines.push(`| ${sev} | ${counts[sev]} |`);
    }
  }
  lines.push(``);

  // ── Findings by severity ────────────────────────────────────────────────
  if (!findings.length) {
    lines.push(`## Vulnerabilities`);
    lines.push(``);
    lines.push(`_No known vulnerabilities found in dependencies._`);
    lines.push(``);
  } else {
    lines.push(`## Vulnerabilities`);
    lines.push(``);

    for (const sev of SEVERITY_ORDER) {
      const group = findings.filter((f) => f.severity === sev);
      if (!group.length) continue;

      lines.push(`### ${sev} (${group.length})`);
      lines.push(``);
      lines.push(`| Package | Installed | Fixed | CVE | Description |`);
      lines.push(`|---------|-----------|-------|-----|-------------|`);

      for (const f of group) {
        const fixed = f.fixedVersion || "_no fix yet_";
        const cve = f.primaryUrl ? `[${f.vulnId}](${f.primaryUrl})` : f.vulnId;
        const title = f.title.length > 80 ? f.title.substring(0, 77) + "..." : f.title;
        lines.push(`| ${f.pkgName} | ${f.installedVersion} | ${fixed} | ${cve} | ${title} |`);
      }
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(`_Generated by OCTO-FLOWS SCA Scan (Trivy) | VEC-ATP_`);

  return lines.join("\n");
}
