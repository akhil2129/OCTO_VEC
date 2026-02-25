/**
 * Agent Tool Configuration — catalog of all tools per agent + persistent enable/disable config.
 * Stored in data/agent-tool-config.json as { [agentId]: string[] } (list of enabled tool IDs).
 * Default: all tools enabled (no file entry = all enabled).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { config } from "../config.js";

const CONFIG_PATH = join(config.dataDir, "agent-tool-config.json");

export interface ToolDef {
  id: string;
  name: string;
  description: string;
  group: string;
}

export interface AgentProfile {
  agent_id: string;
  name: string;
  role: string;
  department: string;
  initials: string;
  color: string;
  implemented: boolean;
  tools: ToolDef[];
}

// ── Shared tool sets ──────────────────────────────────────────────────────────

const MEMORY_TOOLS: ToolDef[] = [
  { id: "read_stm",   name: "Read STM",   description: "Read short-term memory (daily scratchpad)", group: "Memory" },
  { id: "write_stm",  name: "Write STM",  description: "Write short-term memory",                   group: "Memory" },
  { id: "read_ltm",   name: "Read LTM",   description: "Read long-term memory journal",              group: "Memory" },
  { id: "write_ltm",  name: "Write LTM",  description: "Write long-term memory journal",             group: "Memory" },
  { id: "read_sltm",  name: "Read SLTM",  description: "Read permanent stable memory",               group: "Memory" },
  { id: "write_sltm", name: "Write SLTM", description: "Write permanent stable memory",              group: "Memory" },
];

const MESSAGING_TOOLS: ToolDef[] = [
  { id: "message_agent", name: "Message Agent", description: "Send a direct message to any agent", group: "Messaging" },
  { id: "read_inbox",    name: "Read Inbox",    description: "Check and clear own inbox",           group: "Messaging" },
];

const DATE_TOOL: ToolDef = { id: "get_current_date", name: "Get Current Date", description: "Get current date and time", group: "Utilities" };

const READONLY_FILE_TOOLS: ToolDef[] = [
  { id: "read_file", name: "Read File",       description: "Read files from disk",           group: "Files" },
  { id: "grep",      name: "Grep",            description: "Search file content by pattern",  group: "Files" },
  { id: "find",      name: "Find Files",      description: "Find files by glob pattern",      group: "Files" },
  { id: "ls",        name: "List Directory",  description: "List directory contents",         group: "Files" },
];

const CODING_FILE_TOOLS: ToolDef[] = [
  { id: "read_file",  name: "Read File",   description: "Read files from disk",            group: "Files" },
  { id: "write_file", name: "Write File",  description: "Create or overwrite files",       group: "Files" },
  { id: "edit_file",  name: "Edit File",   description: "Make targeted edits to a file",  group: "Files" },
  { id: "bash",       name: "Bash",        description: "Execute shell commands",          group: "Files" },
];

const SPECIALIST_TASK_TOOLS: ToolDef[] = [
  { id: "read_my_tasks",     name: "Read My Tasks",   description: "View tasks assigned to me",        group: "Task Management" },
  { id: "update_my_task",    name: "Update My Task",  description: "Update task status & result",      group: "Task Management" },
  { id: "read_task_details", name: "Task Details",    description: "Get full task information",        group: "Task Management" },
  { id: "send_message_to_pm",name: "Message PM",      description: "Escalate or report to PM",        group: "Task Management" },
];

// ── Full agent catalog ────────────────────────────────────────────────────────

export const AGENT_PROFILES: AgentProfile[] = [
  {
    agent_id: "pm",
    name: "Arjun Sharma",
    role: "Project Manager",
    department: "Management",
    initials: "AS",
    color: "#1158c7",
    implemented: true,
    tools: [
      { id: "create_and_assign_task",  name: "Create & Assign Task", description: "Create a task and auto-assign to an agent",  group: "Task Management" },
      { id: "start_task",              name: "Start Task",           description: "Trigger a pending task by ID",               group: "Task Management" },
      { id: "send_task_message",       name: "Send Task Message",    description: "Message the agent assigned to a task",       group: "Task Management" },
      { id: "send_priority_message",   name: "Priority Message",     description: "Send a priority interrupt to an agent",      group: "Task Management" },
      { id: "check_task_status",       name: "Check Task Status",    description: "Check current status of any task",           group: "Task Management" },
      { id: "list_all_tasks",          name: "List All Tasks",       description: "View the full ATP task board",               group: "Task Management" },
      { id: "read_messages",           name: "Read Messages",        description: "Read notifications from agents",             group: "Task Management" },
      { id: "restart_task",            name: "Restart Task",         description: "Force-restart a stuck or stalled task",      group: "Task Management" },
      { id: "cancel_task",             name: "Cancel Task",          description: "Cancel a task (keeps record)",               group: "Task Management" },
      { id: "delete_task",             name: "Delete Task",          description: "Permanently delete a completed task",        group: "Task Management" },
      { id: "interrupt_agent",         name: "Interrupt Agent",      description: "Abort a running agent mid-stream",           group: "Task Management" },
      { id: "unblock_agent",           name: "Unblock Agent",        description: "Clear interrupt flags on an agent",          group: "Task Management" },
      { id: "view_employee_directory", name: "Employee Directory",   description: "List all employees and their status",        group: "HR" },
      { id: "lookup_employee",         name: "Lookup Employee",      description: "Get full details on any employee",           group: "HR" },
      ...READONLY_FILE_TOOLS,
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "architect",
    name: "Priya Nair",
    role: "Architect",
    department: "Engineering",
    initials: "PN",
    color: "#e36209",
    implemented: false,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...READONLY_FILE_TOOLS,
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "ba",
    name: "Kavya Nair",
    role: "Business Analyst",
    department: "Product",
    initials: "KN",
    color: "#7928ca",
    implemented: true,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...READONLY_FILE_TOOLS,
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "researcher",
    name: "Shreya Joshi",
    role: "Researcher",
    department: "Product",
    initials: "SJ",
    color: "#0891b2",
    implemented: false,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...READONLY_FILE_TOOLS,
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "dev",
    name: "Rohan Mehta",
    role: "Senior Developer",
    department: "Engineering",
    initials: "RM",
    color: "#3fb950",
    implemented: true,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...CODING_FILE_TOOLS,
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "qa",
    name: "Preethi Raj",
    role: "QA Engineer",
    department: "Engineering",
    initials: "PR",
    color: "#f59e0b",
    implemented: false,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...READONLY_FILE_TOOLS,
      { id: "bash", name: "Bash", description: "Run test commands and scripts", group: "Files" },
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "security",
    name: "Vikram Singh",
    role: "Security Engineer",
    department: "Engineering",
    initials: "VS",
    color: "#ef4444",
    implemented: false,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...READONLY_FILE_TOOLS,
      { id: "bash", name: "Bash", description: "Run security tools and scans", group: "Files" },
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "devops",
    name: "Aditya Kumar",
    role: "DevOps Engineer",
    department: "Engineering",
    initials: "AK",
    color: "#8b5cf6",
    implemented: false,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      ...CODING_FILE_TOOLS,
      { id: "grep", name: "Grep", description: "Search files", group: "Files" },
      { id: "find", name: "Find Files", description: "Find files by pattern", group: "Files" },
      { id: "ls",   name: "List Directory", description: "List directory contents", group: "Files" },
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
  {
    agent_id: "techwriter",
    name: "Anjali Patel",
    role: "Tech Writer",
    department: "Product",
    initials: "AP",
    color: "#ec4899",
    implemented: false,
    tools: [
      ...SPECIALIST_TASK_TOOLS,
      { id: "read_file",  name: "Read File",  description: "Read files from disk",        group: "Files" },
      { id: "write_file", name: "Write File", description: "Write documentation files",   group: "Files" },
      { id: "edit_file",  name: "Edit File",  description: "Edit existing documents",     group: "Files" },
      { id: "grep",       name: "Grep",       description: "Search file content",         group: "Files" },
      { id: "find",       name: "Find Files", description: "Find files by pattern",       group: "Files" },
      { id: "ls",         name: "List Directory", description: "List directory contents", group: "Files" },
      ...MEMORY_TOOLS,
      ...MESSAGING_TOOLS,
      DATE_TOOL,
    ],
  },
];

// ── Persistence ───────────────────────────────────────────────────────────────

export function readToolConfig(): Record<string, string[]> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function writeToolConfig(cfg: Record<string, string[]>): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

/** Returns list of enabled tool IDs for an agent. Default: all tools in catalog. */
export function getEnabledTools(agentId: string): string[] {
  const stored = readToolConfig();
  if (stored[agentId]) return stored[agentId];
  const profile = AGENT_PROFILES.find((a) => a.agent_id === agentId);
  return profile ? profile.tools.map((t) => t.id) : [];
}

/** Persist a new enabled-tools list for an agent. */
export function setAgentTools(agentId: string, toolIds: string[]): void {
  const cfg = readToolConfig();
  cfg[agentId] = toolIds;
  writeToolConfig(cfg);
}
