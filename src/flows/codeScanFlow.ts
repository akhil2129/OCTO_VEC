/**
 * OCTO-FLOW: Code Scan — runs SonarQube static analysis via Docker.
 *
 * Prerequisites:
 *   - SonarQube server running: docker compose up -d
 *   - SONAR_TOKEN set in .env
 *   - Docker available in PATH
 *
 * The scanner runs as a Docker container (no local install needed).
 * It joins vec-net to resolve http://vec-sonarqube:9000 internally.
 */

import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { config, sharedWorkspace } from "../config.js";
import type { FlowContext, FlowResult } from "./index.js";

export async function codeScanFlow(ctx: FlowContext): Promise<FlowResult> {
  const { taskId, targetPath } = ctx;

  // ── 1. Resolve absolute target path ──────────────────────────────────────
  const absTarget = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(config.workspace, targetPath);

  // Safety: ensure the target is inside the workspace — never scan our own source
  const normalizedTarget = path.resolve(absTarget);
  const normalizedWorkspace = path.resolve(config.workspace);
  if (normalizedTarget !== normalizedWorkspace && !normalizedTarget.startsWith(normalizedWorkspace + path.sep)) {
    return {
      success: false,
      summary: `Scan target "${targetPath}" resolves outside the workspace. Only workspace paths are allowed.`,
    };
  }

  // ── 2. Derive SonarQube project key and name ────────────────────────────
  const folderName = path.basename(absTarget);
  const projectKey = `${config.sonarProjectBaseKey}-${folderName}-${taskId}`
    .toLowerCase()
    .replace(/[^a-z0-9\-_.:]/g, "-");
  const projectName = `${folderName} (${taskId})`;

  // ── 3. Validate token ────────────────────────────────────────────────────
  const token = config.sonarToken;
  if (!token) {
    return {
      success: false,
      summary:
        "SONAR_TOKEN is not set in .env. Run SonarQube (docker compose up -d), " +
        "login at http://localhost:9000, generate a token, and add it to .env.",
    };
  }

  // ── 4. Run sonar-scanner via Docker ──────────────────────────────────────
  const internalSonarUrl = "http://vec-sonarqube:9000";

  // Convert Windows path to Docker-compatible mount (forward slashes)
  const dockerMountPath = absTarget.replace(/\\/g, "/");

  const scannerCmd = [
    "docker run --rm",
    "--network vec-net",
    `-v "${dockerMountPath}:/usr/src"`,
    config.sonarScannerImage,
    `-Dsonar.projectKey=${projectKey}`,
    `-Dsonar.projectName="${projectName}"`,
    `-Dsonar.sources=.`,
    `-Dsonar.exclusions=**/node_modules/**,**/dist/**,**/build/**,**/.next/**,**/coverage/**,**/*.min.js,**/*.bundle.js`,
    `-Dsonar.host.url=${internalSonarUrl}`,
    `-Dsonar.token=${token}`,
    `-Dsonar.scm.disabled=true`,
  ].join(" ");

  let scanOutput = "";
  let scanFailed = false;
  try {
    scanOutput = execSync(scannerCmd, {
      encoding: "utf-8",
      timeout: 180_000, // 3 min for large projects
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    });
  } catch (err: any) {
    scanFailed = true;
    scanOutput = String(err?.stdout ?? err?.message ?? err);
  }

  // ── 5. Fetch results from SonarQube Web API ─────────────────────────────
  const externalUrl = config.sonarHostUrl;
  const authHeaderValue = `Basic ${Buffer.from(`${token}:`).toString("base64")}`;

  async function sonarFetch(apiPath: string): Promise<any> {
    try {
      const res = await fetch(`${externalUrl}${apiPath}`, {
        headers: { Authorization: authHeaderValue },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // Wait a few seconds for SonarQube to process the scan results
  if (!scanFailed) {
    await new Promise((r) => setTimeout(r, 5000));
  }

  const issuesData = await sonarFetch(
    `/api/issues/search?componentKeys=${projectKey}&resolved=false&ps=50&facets=severities,types`,
  );
  const measuresData = await sonarFetch(
    `/api/measures/component?component=${projectKey}&metricKeys=bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density,ncloc,security_hotspots`,
  );

  // ── 6. Build markdown report ─────────────────────────────────────────────
  const report = buildMarkdownReport({
    taskId,
    projectKey,
    targetPath: absTarget,
    scanFailed,
    scanOutput,
    issuesData,
    measuresData,
    sonarUrl: externalUrl,
  });

  // ── 7. Write report ─────────────────────────────────────────────────────
  const reportsDir = path.join(sharedWorkspace, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const reportFileName = `code-scan-${taskId.toLowerCase()}-${Date.now()}.md`;
  const reportPath = path.join(reportsDir, reportFileName);
  writeFileSync(reportPath, report, "utf-8");

  const relativeReportPath = `shared/reports/${reportFileName}`;

  return {
    success: !scanFailed,
    summary: scanFailed
      ? `Code scan encountered errors. Partial report saved to ${relativeReportPath}.`
      : `Code scan complete. Report saved to ${relativeReportPath}.`,
    reportPath: relativeReportPath,
    details: scanFailed ? scanOutput.substring(0, 500) : undefined,
  };
}

// ── Markdown report builder ────────────────────────────────────────────────────

interface ReportOptions {
  taskId: string;
  projectKey: string;
  targetPath: string;
  scanFailed: boolean;
  scanOutput: string;
  issuesData: any;
  measuresData: any;
  sonarUrl: string;
}

function buildMarkdownReport(opts: ReportOptions): string {
  const { taskId, projectKey, targetPath, scanFailed, issuesData, measuresData, sonarUrl } = opts;
  const now = new Date().toISOString();

  const lines: string[] = [
    `# Code Scan Report — ${taskId}`,
    ``,
    `**Generated:** ${now}`,
    `**Project Key:** \`${projectKey}\``,
    `**Scanned Path:** \`${targetPath}\``,
    `**SonarQube Dashboard:** [View in Browser](${sonarUrl}/dashboard?id=${projectKey})`,
    ``,
  ];

  if (scanFailed) {
    lines.push(`> **WARNING:** Scanner exited with errors. Results below may be partial.`);
    lines.push(``);
  }

  // ── Metrics table ──────────────────────────────────────────────────────────
  lines.push(`## Metrics`);
  lines.push(``);

  const measures: Record<string, string> = {};
  if (measuresData?.component?.measures) {
    for (const m of measuresData.component.measures) {
      measures[m.metric] = m.value ?? "N/A";
    }
  }

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Lines of Code | ${measures["ncloc"] ?? "N/A"} |`);
  lines.push(`| Bugs | ${measures["bugs"] ?? "N/A"} |`);
  lines.push(`| Vulnerabilities | ${measures["vulnerabilities"] ?? "N/A"} |`);
  lines.push(`| Security Hotspots | ${measures["security_hotspots"] ?? "N/A"} |`);
  lines.push(`| Code Smells | ${measures["code_smells"] ?? "N/A"} |`);
  lines.push(`| Coverage | ${measures["coverage"] ?? "N/A"}% |`);
  lines.push(`| Duplications | ${measures["duplicated_lines_density"] ?? "N/A"}% |`);
  lines.push(``);

  // ── Issues by severity ─────────────────────────────────────────────────────
  lines.push(`## Issues`);
  lines.push(``);

  const issues: any[] = issuesData?.issues ?? [];
  if (!issues.length) {
    lines.push(`_No open issues found._`);
    lines.push(``);
  } else {
    const bySeverity: Record<string, any[]> = {};
    for (const issue of issues) {
      const sev = issue.severity ?? "UNKNOWN";
      if (!bySeverity[sev]) bySeverity[sev] = [];
      bySeverity[sev].push(issue);
    }

    const severityOrder = ["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "INFO"];
    for (const sev of severityOrder) {
      const group = bySeverity[sev];
      if (!group?.length) continue;

      lines.push(`### ${sev} (${group.length})`);
      lines.push(``);
      for (const issue of group) {
        const component = (issue.component ?? "").split(":").pop() ?? issue.component;
        const line = issue.line ? `:${issue.line}` : "";
        const type = issue.type ?? "ISSUE";
        lines.push(`- **[${type}]** \`${component}${line}\` — ${issue.message ?? "No message"}`);
      }
      lines.push(``);
    }
  }

  // ── Total ──────────────────────────────────────────────────────────────────
  const total = issuesData?.total ?? issues.length;
  lines.push(`**Total open issues:** ${total}`);
  if ((issuesData?.total ?? 0) > 50) {
    lines.push(`_(Showing first 50 of ${issuesData.total} — view full list in SonarQube dashboard)_`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`_Generated by OCTO-FLOWS Code Scan | VEC-ATP_`);

  return lines.join("\n");
}
