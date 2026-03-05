/**
 * Security Engineer OCTO-FLOW tools — triggers security scanning pipelines.
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";
import { runFlow, FLOW_NAMES } from "../../flows/index.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export const securityFlowTools: AgentTool[] = [
  {
    name: "run_sast_scan",
    label: "Run SAST Scan",
    description:
      "Run a Semgrep SAST (Static Application Security Testing) scan against a workspace project directory. " +
      "Detects OWASP Top 10 vulnerabilities, injection flaws, insecure crypto, hardcoded secrets, and more. " +
      "Generates a markdown report in shared/reports/ with findings grouped by severity. " +
      "Requires Docker to be running.",
    parameters: Type.Object({
      target_path: Type.String({
        description:
          "Path to the project to scan, relative to the workspace root. " +
          "Examples: 'projects/my-app', 'shared/my-module'. " +
          "Use ls or find to confirm the path before calling this tool.",
      }),
      task_id: Type.Optional(
        Type.String({ description: "ATP task ID for tracking (e.g. TASK-042)" }),
      ),
      fail_severity: Type.Optional(
        Type.String({
          description:
            "Minimum severity to trigger a FAIL verdict. " +
            "One of: ERROR (critical/high), WARNING (medium), INFO (low). Default: ERROR.",
        }),
      ),
    }),
    execute: async (_, params: any) => {
      const taskId = params.task_id ?? "TASK-UNKNOWN";
      EventLog.log(
        EventType.AGENT_TOOL_CALL, "security", taskId,
        `Security triggering SAST Scan on ${params.target_path}`,
      );

      const result = await runFlow("sast-scan", {
        taskId,
        agentId: "security",
        targetPath: params.target_path,
        options: params.fail_severity ? { fail_severity: params.fail_severity } : undefined,
      });

      const statusLine = result.success
        ? "SAST scan PASSED — no critical/high findings."
        : "SAST scan FAILED — critical/high findings detected.";

      return ok(
        `${statusLine}\n\n` +
        `Summary: ${result.summary}\n` +
        (result.reportPath ? `Report: ${result.reportPath}\n` : "") +
        (result.details ? `\nDetails:\n${result.details}` : "") +
        `\n\nNext step: read the report with the read tool. Review each finding. ` +
        `Message Rohan (dev) about critical vulnerabilities that need immediate fixes.`,
      );
    },
  },

  {
    name: "run_secret_scan",
    label: "Run Secret Scan",
    description:
      "Run a Gitleaks secret scan against a workspace project directory. " +
      "Detects leaked API keys, tokens, passwords, private keys, and other credentials. " +
      "Generates a markdown report in shared/reports/ with all findings (redacted). " +
      "Any leaked secret = automatic FAIL. Requires Docker to be running.",
    parameters: Type.Object({
      target_path: Type.String({
        description:
          "Path to the project to scan, relative to the workspace root. " +
          "Examples: 'projects/my-app', 'shared/my-module'.",
      }),
      task_id: Type.Optional(
        Type.String({ description: "ATP task ID for tracking (e.g. TASK-042)" }),
      ),
    }),
    execute: async (_, params: any) => {
      const taskId = params.task_id ?? "TASK-UNKNOWN";
      EventLog.log(
        EventType.AGENT_TOOL_CALL, "security", taskId,
        `Security triggering Secret Scan on ${params.target_path}`,
      );

      const result = await runFlow("secret-scan", {
        taskId,
        agentId: "security",
        targetPath: params.target_path,
      });

      const statusLine = result.success
        ? "Secret scan PASSED — no leaked secrets found."
        : "Secret scan FAILED — leaked secrets detected!";

      return ok(
        `${statusLine}\n\n` +
        `Summary: ${result.summary}\n` +
        (result.reportPath ? `Report: ${result.reportPath}\n` : "") +
        (result.details ? `\nDetails:\n${result.details}` : "") +
        `\n\nNext step: read the report with the read tool. ` +
        `If secrets are found: message Rohan (dev) to rotate credentials immediately and remove from source code.`,
      );
    },
  },

  {
    name: "run_sca_scan",
    label: "Run SCA Scan",
    description:
      "Run a Trivy SCA (Software Composition Analysis) scan against a workspace project directory. " +
      "Detects known CVEs in dependencies by scanning lockfiles (package-lock.json, yarn.lock, etc.). " +
      "Generates a markdown report in shared/reports/ with vulnerable packages, versions, and fixes. " +
      "Requires Docker to be running.",
    parameters: Type.Object({
      target_path: Type.String({
        description:
          "Path to the project to scan, relative to the workspace root. " +
          "Examples: 'projects/my-app', 'shared/my-module'.",
      }),
      task_id: Type.Optional(
        Type.String({ description: "ATP task ID for tracking (e.g. TASK-042)" }),
      ),
      fail_severity: Type.Optional(
        Type.String({
          description:
            "Minimum severity to trigger a FAIL verdict. " +
            "One of: CRITICAL, HIGH, MEDIUM, LOW. Default: HIGH.",
        }),
      ),
    }),
    execute: async (_, params: any) => {
      const taskId = params.task_id ?? "TASK-UNKNOWN";
      EventLog.log(
        EventType.AGENT_TOOL_CALL, "security", taskId,
        `Security triggering SCA Scan on ${params.target_path}`,
      );

      const result = await runFlow("sca-scan", {
        taskId,
        agentId: "security",
        targetPath: params.target_path,
        options: params.fail_severity ? { fail_severity: params.fail_severity } : undefined,
      });

      const statusLine = result.success
        ? "SCA scan PASSED — no critical/high dependency vulnerabilities."
        : "SCA scan FAILED — vulnerable dependencies found!";

      return ok(
        `${statusLine}\n\n` +
        `Summary: ${result.summary}\n` +
        (result.reportPath ? `Report: ${result.reportPath}\n` : "") +
        (result.details ? `\nDetails:\n${result.details}` : "") +
        `\n\nNext step: read the report with the read tool. ` +
        `For fixable vulnerabilities, message Rohan (dev) to update the affected packages.`,
      );
    },
  },

  {
    name: "run_flow",
    label: "Run OCTO-Flow",
    description:
      `Trigger any named OCTO-FLOW pipeline. Available flows: ${FLOW_NAMES.join(", ")}. ` +
      "Use run_sast_scan for Semgrep SAST (it has better defaults). " +
      "Use run_flow for other flows or custom options.",
    parameters: Type.Object({
      flow_name: Type.String({
        description: `Flow to run. One of: ${FLOW_NAMES.join(", ")}`,
      }),
      target_path: Type.String({
        description: "Workspace-relative path to operate on",
      }),
      task_id: Type.Optional(
        Type.String({ description: "ATP task ID for tracking" }),
      ),
      options: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: "Flow-specific key/value options",
        }),
      ),
    }),
    execute: async (_, params: any) => {
      const taskId = params.task_id ?? "TASK-UNKNOWN";
      EventLog.log(
        EventType.AGENT_TOOL_CALL, "security", taskId,
        `Security triggering flow '${params.flow_name}' on ${params.target_path}`,
      );

      const result = await runFlow(params.flow_name, {
        taskId,
        agentId: "security",
        targetPath: params.target_path,
        options: params.options,
      });

      return ok(
        `Flow '${params.flow_name}': ${result.success ? "SUCCESS" : "FAILED"}\n\n` +
        `${result.summary}\n` +
        (result.reportPath ? `Report: ${result.reportPath}\n` : "") +
        (result.details ? `\nDetails:\n${result.details}` : ""),
      );
    },
  },
];
