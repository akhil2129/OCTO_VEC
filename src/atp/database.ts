/**
 * SQLite-backed Agent Task Portal database.
 * Stores tasks with status, assignments, priorities, and results.
 * Also manages the employee registry.
 */

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import {
  Priority,
  TaskStatus,
  EmployeeStatus,
  type Task,
  type Employee,
} from "./models.js";

const DB_PATH = path.join(config.dataDir, "atp.db");

function openDb(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id      TEXT PRIMARY KEY,
      description  TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      priority     TEXT NOT NULL DEFAULT 'medium',
      status       TEXT NOT NULL DEFAULT 'pending',
      folder_access TEXT DEFAULT '',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      result       TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS employees (
      employee_id     TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      designation     TEXT NOT NULL,
      department      TEXT NOT NULL,
      hierarchy_level INTEGER NOT NULL DEFAULT 3,
      reports_to      TEXT DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'available',
      skills          TEXT DEFAULT '',
      joined_at       TEXT NOT NULL
    );
  `);
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    task_id: row.task_id as string,
    description: row.description as string,
    agent_id: row.agent_id as string,
    priority: (row.priority as string) as Priority,
    status: (row.status as string) as TaskStatus,
    folder_access: (row.folder_access as string) || "",
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    result: (row.result as string) || "",
  };
}

function rowToEmployee(row: Record<string, unknown>): Employee {
  return {
    employee_id: row.employee_id as string,
    agent_id: row.agent_id as string,
    name: row.name as string,
    designation: row.designation as string,
    department: row.department as string,
    hierarchy_level: row.hierarchy_level as number,
    reports_to: (row.reports_to as string) || "",
    status: (row.status as string) as EmployeeStatus,
    skills: (row.skills as string) || "",
    joined_at: row.joined_at as string,
  };
}

const SEED_EMPLOYEES = [
  {
    employee_id: "EMP-001", agent_id: "pm",
    name: "Arjun Sharma", designation: "Project Manager",
    department: "Management", hierarchy_level: 1, reports_to: "",
    skills: "planning,delegation,risk-management,communication",
  },
  {
    employee_id: "EMP-002", agent_id: "architect",
    name: "Priya Nair", designation: "Solutions Architect",
    department: "Engineering", hierarchy_level: 2, reports_to: "EMP-001",
    skills: "system-design,database-schema,api-design,tech-stack",
  },
  {
    employee_id: "EMP-003", agent_id: "ba",
    name: "Kavya Nair", designation: "Business Analyst",
    department: "Analysis", hierarchy_level: 3, reports_to: "EMP-001",
    skills: "requirements,user-stories,gap-analysis,kpis,process-mapping",
  },
  {
    employee_id: "EMP-004", agent_id: "researcher",
    name: "Shreya Joshi", designation: "Research Specialist",
    department: "Analysis", hierarchy_level: 3, reports_to: "EMP-001",
    skills: "technology-research,best-practices,security-research,comparative-analysis",
  },
  {
    employee_id: "EMP-005", agent_id: "dev",
    name: "Rohan Mehta", designation: "Senior Developer",
    department: "Engineering", hierarchy_level: 3, reports_to: "EMP-002",
    skills: "python,javascript,typescript,code-review,unit-testing,debugging,refactoring",
  },
  {
    employee_id: "EMP-006", agent_id: "qa",
    name: "Preethi Raj", designation: "QA Engineer",
    department: "Engineering", hierarchy_level: 3, reports_to: "EMP-002",
    skills: "test-planning,test-cases,bug-reporting,coverage-analysis",
  },
  {
    employee_id: "EMP-007", agent_id: "security",
    name: "Vikram Singh", designation: "Security Engineer",
    department: "Engineering", hierarchy_level: 3, reports_to: "EMP-002",
    skills: "vulnerability-scanning,dependency-audit,code-security,owasp",
  },
  {
    employee_id: "EMP-008", agent_id: "devops",
    name: "Aditya Kumar", designation: "DevOps Engineer",
    department: "Engineering", hierarchy_level: 3, reports_to: "EMP-002",
    skills: "ci-cd,docker,kubernetes,deployment,monitoring,infrastructure",
  },
  {
    employee_id: "EMP-009", agent_id: "techwriter",
    name: "Anjali Patel", designation: "Technical Writer",
    department: "Documentation", hierarchy_level: 3, reports_to: "EMP-001",
    skills: "api-docs,readme,user-guides,deployment-guides,changelogs",
  },
];

class ATPDatabaseClass {
  private db: Database.Database;

  constructor() {
    this.db = openDb();
    initDb(this.db);
    this.seedEmployees();
  }

  // ── Task ID generation ──────────────────────────────────────────────────────

  getNextTaskId(): string {
    const row = this.db
      .prepare("SELECT task_id FROM tasks ORDER BY task_id DESC LIMIT 1")
      .get() as { task_id: string } | undefined;
    if (!row) return "TASK-001";
    const num = parseInt(row.task_id.split("-")[1], 10);
    return `TASK-${String(num + 1).padStart(3, "0")}`;
  }

  // ── Task CRUD ──────────────────────────────────────────────────────────────

  createTask(
    description: string,
    agent_id: string,
    priority: string = "medium",
    folder_access: string = ""
  ): Task {
    const task_id = this.getNextTaskId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tasks (task_id, description, agent_id, priority, status, folder_access, created_at, updated_at, result)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, '')
    `).run(task_id, description, agent_id.trim().toLowerCase(), priority, folder_access, now, now);
    return this.getTask(task_id)!;
  }

  getTask(task_id: string): Task | undefined {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(task_id.trim().toUpperCase()) as Record<string, unknown> | undefined;
    return row ? rowToTask(row) : undefined;
  }

  getTasksForAgent(agent_id: string, status?: string): Task[] {
    let rows: Record<string, unknown>[];
    if (status) {
      rows = this.db
        .prepare("SELECT * FROM tasks WHERE agent_id = ? AND status = ? ORDER BY priority, created_at")
        .all(agent_id.toLowerCase(), status) as Record<string, unknown>[];
    } else {
      rows = this.db
        .prepare("SELECT * FROM tasks WHERE agent_id = ? ORDER BY priority, created_at")
        .all(agent_id.toLowerCase()) as Record<string, unknown>[];
    }
    return rows.map(rowToTask);
  }

  updateTaskStatus(task_id: string, status: string, result = ""): Task | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE task_id = ?")
      .run(status, result, now, task_id.trim().toUpperCase());
    return this.getTask(task_id);
  }

  getAllTasks(status?: string): Task[] {
    let rows: Record<string, unknown>[];
    if (status) {
      rows = this.db
        .prepare("SELECT * FROM tasks WHERE status = ? ORDER BY priority, created_at")
        .all(status) as Record<string, unknown>[];
    } else {
      rows = this.db
        .prepare("SELECT * FROM tasks ORDER BY status, priority, created_at")
        .all() as Record<string, unknown>[];
    }
    return rows.map(rowToTask);
  }

  deleteTask(task_id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM tasks WHERE task_id = ?")
      .run(task_id.trim().toUpperCase());
    return result.changes > 0;
  }

  clearAllTasks(): number {
    const result = this.db.prepare("DELETE FROM tasks").run();
    return result.changes;
  }

  taskBoard(): string {
    const tasks = this.getAllTasks();
    if (!tasks.length) return "No tasks in ATP.";
    const header = `${"ID".padEnd(10)} ${"Agent".padEnd(8)} ${"Priority".padEnd(8)} ${"Status".padEnd(14)} Description`;
    const separator = "-".repeat(70);
    const rows = tasks.map(
      (t) =>
        `${t.task_id.padEnd(10)} ${t.agent_id.padEnd(8)} ${t.priority.padEnd(8)} ${t.status.padEnd(14)} ${t.description.substring(0, 35)}`
    );
    return [header, separator, ...rows].join("\n");
  }

  // ── Employee Registry ──────────────────────────────────────────────────────

  getNextEmployeeId(): string {
    const row = this.db
      .prepare("SELECT employee_id FROM employees ORDER BY employee_id DESC LIMIT 1")
      .get() as { employee_id: string } | undefined;
    if (!row) return "EMP-001";
    const num = parseInt(row.employee_id.split("-")[1], 10);
    return `EMP-${String(num + 1).padStart(3, "0")}`;
  }

  registerEmployee(opts: {
    agent_id: string;
    name: string;
    designation: string;
    department: string;
    hierarchy_level: number;
    reports_to?: string;
    skills?: string;
    employee_id?: string;
  }): Employee {
    const existing = this.db
      .prepare("SELECT employee_id FROM employees WHERE agent_id = ?")
      .get(opts.agent_id.trim().toLowerCase()) as { employee_id: string } | undefined;
    if (existing) return this.getEmployeeByAgentId(opts.agent_id)!;

    const eid = opts.employee_id ?? this.getNextEmployeeId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO employees (employee_id, agent_id, name, designation, department, hierarchy_level, reports_to, status, skills, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)
    `).run(
      eid,
      opts.agent_id.trim().toLowerCase(),
      opts.name,
      opts.designation,
      opts.department,
      opts.hierarchy_level,
      opts.reports_to ?? "",
      opts.skills ?? "",
      now
    );
    return this.getEmployee(eid)!;
  }

  getEmployee(employee_id: string): Employee | undefined {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE employee_id = ?")
      .get(employee_id.trim().toUpperCase()) as Record<string, unknown> | undefined;
    return row ? rowToEmployee(row) : undefined;
  }

  getEmployeeByAgentId(agent_id: string): Employee | undefined {
    const row = this.db
      .prepare("SELECT * FROM employees WHERE agent_id = ?")
      .get(agent_id.trim().toLowerCase()) as Record<string, unknown> | undefined;
    return row ? rowToEmployee(row) : undefined;
  }

  listEmployees(opts: { status?: string; department?: string } = {}): Employee[] {
    let query = "SELECT * FROM employees WHERE 1=1";
    const params: string[] = [];
    if (opts.status) { query += " AND status = ?"; params.push(opts.status); }
    if (opts.department) { query += " AND department = ?"; params.push(opts.department); }
    query += " ORDER BY hierarchy_level, employee_id";
    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEmployee);
  }

  updateEmployeeStatus(agent_id: string, status: string): Employee | undefined {
    this.db
      .prepare("UPDATE employees SET status = ? WHERE agent_id = ?")
      .run(status, agent_id.trim().toLowerCase());
    return this.getEmployeeByAgentId(agent_id);
  }

  getDirectReports(employee_id: string): Employee[] {
    const rows = this.db
      .prepare("SELECT * FROM employees WHERE reports_to = ? ORDER BY hierarchy_level, employee_id")
      .all(employee_id.trim().toUpperCase()) as Record<string, unknown>[];
    return rows.map(rowToEmployee);
  }

  orgChart(): string {
    const employees = this.listEmployees();
    if (!employees.length) return "No employees registered.";
    const byId = new Map(employees.map((e) => [e.employee_id, e]));
    const lines: string[] = ["VEC - Virtual Employed Company  |  Org Chart", "=".repeat(55)];
    const icons: Record<string, string> = { available: "[+]", busy: "[~]", offline: "[-]" };

    const render = (empId: string, indent: number): void => {
      const emp = byId.get(empId);
      if (!emp) return;
      const icon = icons[emp.status] ?? "[?]";
      const prefix = "  ".repeat(indent) + (indent > 0 ? "|-- " : "");
      lines.push(`${prefix}${icon} [${emp.employee_id}] ${emp.name}  -  ${emp.designation}  (${emp.department})`);
      const reports = employees
        .filter((e) => e.reports_to === empId)
        .sort((a, b) => a.hierarchy_level - b.hierarchy_level);
      for (const r of reports) render(r.employee_id, indent + 1);
    };

    const roots = employees.filter((e) => !e.reports_to);
    for (const root of roots) render(root.employee_id, 0);
    lines.push("", `Total: ${employees.length} employee(s)`);
    return lines.join("\n");
  }

  employeeDirectory(opts: { status?: string; department?: string } = {}): string {
    const employees = this.listEmployees(opts);
    if (!employees.length) return "No employees found.";
    const header = `${"EMP-ID".padEnd(9)} ${"Agent".padEnd(7)} ${"Name".padEnd(18)} ${"Designation".padEnd(22)} ${"Dept".padEnd(14)} ${"Lvl".padEnd(4)} ${"Status".padEnd(10)} Skills`;
    const separator = "-".repeat(105);
    const rows = employees.map(
      (e) =>
        `${e.employee_id.padEnd(9)} ${e.agent_id.padEnd(7)} ${e.name.padEnd(18)} ${e.designation.padEnd(22)} ` +
        `${e.department.padEnd(14)} ${String(e.hierarchy_level).padEnd(4)} ${e.status.padEnd(10)} ${e.skills.substring(0, 30)}`
    );
    return [header, separator, ...rows].join("\n");
  }

  private seedEmployees(): void {
    // Agents without a live process — they appear in the directory as offline so PM
    // knows not to contact them. Add an agent_id here to remove it from PM's roster.
    const OFFLINE_AGENTS = new Set(["qa", "security", "devops", "techwriter", "architect", "researcher"]);

    for (const emp of SEED_EMPLOYEES) {
      this.registerEmployee(emp);
      // Update name if it changed (keeps existing records in sync with new seed data)
      this.db
        .prepare("UPDATE employees SET name = ? WHERE agent_id = ? AND name != ?")
        .run(emp.name, emp.agent_id, emp.name);
      // Force ghost agents offline every startup so PM never messages them
      if (OFFLINE_AGENTS.has(emp.agent_id)) {
        this.db
          .prepare("UPDATE employees SET status = 'offline' WHERE agent_id = ?")
          .run(emp.agent_id);
      }
    }
  }
}

// Singleton instance
export const ATPDatabase = new ATPDatabaseClass();
export type ATPDatabaseType = ATPDatabaseClass;
