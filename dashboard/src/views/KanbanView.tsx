import { useState, useMemo } from "react";
import Markdown from "react-markdown";
import { usePolling } from "../hooks/useApi";
import { useAgentStream } from "../hooks/useSSE";
import { useEmployees } from "../context/EmployeesContext";
import Dropdown from "../components/Dropdown";
import type { Task, Employee, TaskStatus } from "../types";

const COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "todo",        label: "To Do",       color: "var(--text-muted)" },
  { status: "in_progress", label: "In Progress", color: "var(--blue)" },
  { status: "completed",   label: "Done",        color: "var(--green)" },
  { status: "failed",      label: "Failed",      color: "var(--red)" },
  { status: "cancelled",   label: "Cancelled",   color: "var(--text-muted)" },
];

function timeAgo(ts: string): string {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function TaskCard({ task, employees, streaming }: { task: Task; employees: Employee[]; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const emp = employees.find((e) => e.agent_key === task.agent_id);
  const agentColor = emp?.color || "var(--text-muted)";

  return (
    <div
      onClick={() => setOpen((v) => !v)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "12px 14px",
        marginBottom: 6,
        background: hovered ? "var(--bg-hover)" : "var(--bg-card)",
        borderRadius: 10,
        border: "1px solid var(--border)",
        cursor: "pointer",
        transition: "background 0.12s",
      }}
    >
      {/* Top: task id + time */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 7 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", letterSpacing: "0.03em" }}>
          {task.task_id.slice(0, 8).toUpperCase()}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>{timeAgo(task.updated_at)}</span>
      </div>

      {/* Description */}
      <div className={open ? "md-content" : "md-content md-clamp"} style={{ marginBottom: 10 }}>
        <Markdown>{task.description}</Markdown>
      </div>

      {/* Expanded result */}
      {open && task.result && (
        <div className="md-content md-result" style={{ marginBottom: 10 }}>
          <Markdown>{task.result}</Markdown>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          background: `color-mix(in srgb, ${agentColor} 15%, transparent)`,
          border: `1.5px solid color-mix(in srgb, ${agentColor} 30%, transparent)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 700, color: agentColor, flexShrink: 0,
        }}>
          {emp ? emp.name.charAt(0) : task.agent_id.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>
          {emp ? emp.name.split(" ")[0] : task.agent_id}
        </span>
        {streaming && task.status === "in_progress" && (
          <span style={{
            marginLeft: "auto", fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
            padding: "2px 7px", borderRadius: 5,
            background: "color-mix(in srgb, var(--blue) 10%, transparent)",
            color: "var(--blue)",
          }}>
            working
          </span>
        )}
      </div>
    </div>
  );
}

type AgentFilter = "all" | string;

export default function KanbanView() {
  const { data: tasks } = usePolling<Task[]>("/api/tasks", 3000);
  const { employees } = useEmployees();
  const { activeAgents } = useAgentStream();
  const [agentFilter, setAgentFilter] = useState<AgentFilter>("all");

  const all = tasks ?? [];
  const emps = employees ?? [];
  const filtered = agentFilter === "all" ? all : all.filter((t) => t.agent_id === agentFilter);

  const agentKeys = Array.from(new Set(all.map((t) => t.agent_id)));

  const dropdownOptions = useMemo(() => [
    { value: "all", label: "All agents" },
    ...agentKeys.map((k) => {
      const emp = emps.find((e) => e.agent_key === k);
      return {
        value: k,
        label: emp ? emp.name : k,
        dot: (emp?.color ?? "").replace("var(--", "").replace(")", ""),
      };
    }),
  ], [agentKeys, emps]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div>
          <h1 className="page-title">Kanban</h1>
          <div className="page-subtitle">{all.length} tasks</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Dropdown value={agentFilter} onChange={setAgentFilter} options={dropdownOptions} placeholder="All agents" />
        </div>
      </div>

      {/* Board */}
      <div style={{
        flex: 1, minHeight: 0,
        overflowX: "auto", overflowY: "hidden",
        padding: "0 20px 16px",
        display: "flex", gap: 10,
        alignItems: "flex-start",
      }}>
        {COLUMNS.map((col) => {
          const colTasks = filtered.filter((t) => t.status === col.status);

          return (
            <div key={col.status} style={{
              flex: 1, minWidth: 210, maxHeight: "100%",
              display: "flex", flexDirection: "column",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
            }}>
              {/* Column header */}
              <div style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", gap: 8,
                flexShrink: 0,
              }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: col.color, flexShrink: 0,
                }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
                  {col.label}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 500,
                  padding: "2px 7px", borderRadius: 5,
                  background: "var(--bg-tertiary)",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}>
                  {colTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "10px 10px 6px" }}>
                {colTasks.length === 0 ? (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11, padding: "28px 0", opacity: 0.45 }}>
                    Empty
                  </div>
                ) : colTasks.map((task) => (
                  <TaskCard
                    key={task.task_id}
                    task={task}
                    employees={emps}
                    streaming={activeAgents[task.agent_id] ?? false}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
