/**
 * PM employee registry tools for VEC-ATP.
 *
 * Tools:
 *   view_employee_directory, view_org_chart,
 *   lookup_employee, set_employee_status
 *
 * Usage:
 *   import { getPMEmployeeTools } from "./employeeTools.js";
 *   tools: [...getPMEmployeeTools(db), ...]
 */

import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { ATPDatabase } from "../../atp/database.js";
import { EventLog } from "../../atp/eventLog.js";
import { EventType } from "../../atp/models.js";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export function getPMEmployeeTools(db: typeof ATPDatabase): AgentTool[] {
  const view_employee_directory: AgentTool = {
    name: "view_employee_directory",
    label: "View Employee Directory",
    description:
      "View the VEC employee directory — all virtual employees, their designations, " +
      "departments, hierarchy level, and current availability status.",
    parameters: Type.Object({
      status_filter: Type.Optional(
        Type.String({
          description: "Filter by status: 'available', 'busy', or 'offline'. Empty = show all.",
        })
      ),
      department_filter: Type.Optional(
        Type.String({ description: "Filter by department name (e.g. 'Engineering'). Empty = show all." })
      ),
    }),
    execute: async (_, params: any) => {
      const status = (params.status_filter ?? "").trim().toLowerCase() || undefined;
      const dept = (params.department_filter ?? "").trim() || undefined;
      if (status && !["available", "busy", "offline"].includes(status)) {
        return ok("ERROR: status_filter must be 'available', 'busy', or 'offline'.");
      }
      const result = db.employeeDirectory({ status, department: dept });
      EventLog.log(EventType.AGENT_TOOL_CALL, "pm", "", `PM viewed employee directory (status=${status ?? "all"}, dept=${dept ?? "all"})`);
      return ok(result);
    },
  };

  const view_org_chart: AgentTool = {
    name: "view_org_chart",
    label: "View Org Chart",
    description:
      "View the VEC org chart showing the full reporting hierarchy — " +
      "who reports to whom, each employee's designation and current status.",
    parameters: Type.Object({}),
    execute: async () => {
      const result = db.orgChart();
      EventLog.log(EventType.AGENT_TOOL_CALL, "pm", "", "PM viewed org chart");
      return ok(result);
    },
  };

  const lookup_employee: AgentTool = {
    name: "lookup_employee",
    label: "Lookup Employee",
    description:
      "Look up a specific employee by their employee ID (EMP-001) or agent key (e.g. 'ba', 'dev').",
    parameters: Type.Object({
      identifier: Type.String({
        description: "Employee ID like 'EMP-003' or agent key like 'ba'.",
      }),
    }),
    execute: async (_, params: any) => {
      const id = params.identifier.trim();
      const emp = id.toUpperCase().startsWith("EMP-")
        ? db.getEmployee(id.toUpperCase())
        : db.getEmployeeByAgentId(id.toLowerCase());

      if (!emp) return ok(`No employee found for '${id}'.`);

      let reportsToStr = "nobody (top of hierarchy)";
      if (emp.reports_to) {
        const manager = db.getEmployee(emp.reports_to);
        reportsToStr = manager
          ? `${manager.name} (${manager.designation}) [${emp.reports_to}]`
          : emp.reports_to;
      }

      const directReports = db.getDirectReports(emp.employee_id);
      const reportsStr = directReports.length
        ? directReports.map((r) => `${r.name} [${r.employee_id}]`).join(", ")
        : "none";

      EventLog.log(EventType.AGENT_TOOL_CALL, "pm", "", `PM looked up employee ${emp.employee_id} (${emp.agent_id})`);

      const joinedAt = emp.joined_at.slice(0, 10); // YYYY-MM-DD from ISO string
      const text =
        `Employee: ${emp.name}\n` +
        `  ID: ${emp.employee_id}  |  Agent key: ${emp.agent_id}\n` +
        `  Designation: ${emp.designation}\n` +
        `  Department: ${emp.department}\n` +
        `  Hierarchy level: ${emp.hierarchy_level}\n` +
        `  Reports to: ${reportsToStr}\n` +
        `  Direct reports: ${reportsStr}\n` +
        `  Status: ${emp.status}\n` +
        `  Skills: ${emp.skills || "N/A"}\n` +
        `  Joined: ${joinedAt}`;
      return ok(text);
    },
  };

  const set_employee_status: AgentTool = {
    name: "set_employee_status",
    label: "Set Employee Status",
    description:
      "Update a virtual employee's availability status. " +
      "Use 'busy' when dispatching tasks and 'available' when the task completes.",
    parameters: Type.Object({
      agent_id: Type.String({ description: "The agent's short key (e.g. 'ba', 'dev', 'qa')" }),
      status: Type.Union([Type.Literal("available"), Type.Literal("busy"), Type.Literal("offline")], {
        description: "'available', 'busy', or 'offline'",
      }),
    }),
    execute: async (_, params: any) => {
      const emp = db.updateEmployeeStatus(params.agent_id.trim().toLowerCase(), params.status);
      if (!emp) {
        return ok(`ERROR: No employee found with agent_id '${params.agent_id}'.`);
      }
      EventLog.log(EventType.AGENT_TOOL_CALL, "pm", "", `PM set ${emp.name} (${emp.agent_id}) status to ${params.status}`);
      return ok(`Employee ${emp.name} (${emp.agent_id}) status updated to '${params.status}'.`);
    },
  };

  return [view_employee_directory, view_org_chart, lookup_employee, set_employee_status];
}
