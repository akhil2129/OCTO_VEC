import { useState, useMemo } from "react";
import { usePolling, postApi } from "../hooks/useApi";
import { useEmployees } from "../context/EmployeesContext";
import { Search, X, List, Building2, ChevronUp, ChevronDown } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal";

interface AgentUsage {
  agentId: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  lastActivity: string;
  model?: string;
}

interface FinanceTotals {
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  sessionStart: string;
}

interface FinanceData {
  totals: FinanceTotals;
  agents: AgentUsage[];
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtUsdShort(n: number): string {
  const digits = n > 0 && n < 1 ? 4 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const GRID_COLS = "1fr 120px 80px 110px 110px 90px 90px";

const DEPT_ORDER = ["Management", "Product", "Engineering", "Analysis", "Design", "Documentation", "Governance"];

type SortKey = "turns" | "inputTokens" | "outputTokens" | "costUsd" | "lastActivity";
type SortDir = "asc" | "desc" | "none";

function compareFn(key: SortKey, dir: SortDir) {
  if (dir === "none") return () => 0;
  return (a: AgentUsage, b: AgentUsage) => {
    let cmp: number;
    if (key === "lastActivity") {
      cmp = new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
    } else {
      cmp = a[key] - b[key];
    }
    return dir === "asc" ? cmp : -cmp;
  };
}

export default function FinanceView() {
  const { data, lastRefresh } = usePolling<FinanceData>("/api/finance", 5000);
  const { employees } = useEmployees();
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "department">("list");
  const [sortKey, setSortKey] = useState<SortKey>("costUsd");
  const [sortDir, setSortDir] = useState<SortDir>("none");

  const totals = data?.totals;
  const agents = data?.agents ?? [];
  const empMap = new Map((employees ?? []).map((e) => [e.agent_key, e]));

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      // Cycle: none → desc → asc → none
      setSortDir((d) => d === "none" ? "desc" : d === "desc" ? "asc" : "none");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Filter + sort agents
  const filtered = useMemo(() => {
    let list = [...agents];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => {
        const emp = empMap.get(a.agentId);
        return (
          a.agentId.toLowerCase().includes(q) ||
          (emp?.name ?? "").toLowerCase().includes(q) ||
          (emp?.role ?? "").toLowerCase().includes(q) ||
          (a.model ?? "").toLowerCase().includes(q)
        );
      });
    }
    return list.sort(compareFn(sortKey, sortDir));
  }, [agents, empMap, search, sortKey, sortDir]);

  // Group by department (agents within each dept follow the active sort)
  const departments = useMemo(() => {
    const map = new Map<string, AgentUsage[]>();
    for (const a of filtered) {
      const emp = empMap.get(a.agentId);
      const dept = emp?.department ?? "Other";
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(a);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ai = DEPT_ORDER.indexOf(a), bi = DEPT_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [filtered, empMap]);

  // Bar chart: max tokens for scale
  const maxTokens = Math.max(1, ...filtered.map((a) => a.totalTokens));

  async function handleReset() {
    setConfirmReset(false);
    setResetting(true);
    try {
      await postApi("/api/finance/reset", {});
    } finally {
      setResetting(false);
    }
  }

  function renderAgentRow(agent: AgentUsage, isLast: boolean) {
    const emp = empMap.get(agent.agentId);
    const barPct = Math.max(2, (agent.totalTokens / maxTokens) * 100);
    return (
      <div key={agent.agentId} style={{
        borderBottom: isLast ? "none" : "1px solid var(--border)",
      }}>
        <div style={{
          display: "grid", gridTemplateColumns: GRID_COLS,
          gap: 8, padding: "10px 14px", alignItems: "center",
        }}>
          {/* Agent name */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {(agent.agentId).slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                {emp?.name?.split(" ")[0] ?? agent.agentId}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {emp?.role ?? agent.agentId}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.model ?? "—"}
          </div>
          <div style={{ textAlign: "right", fontSize: 13, fontWeight: 500, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
            {fmt(agent.turns)}
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {fmt(agent.inputTokens)}
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {fmt(agent.outputTokens)}
          </div>
          <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: "var(--green)", fontVariantNumeric: "tabular-nums" }}>
            {fmtUsd(agent.costUsd)}
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>
            {timeSince(agent.lastActivity)}
          </div>
        </div>

        {/* Token bar */}
        <div style={{ padding: "0 14px 10px" }}>
          <div style={{
            height: 4, borderRadius: 2,
            background: "var(--bg-hover)", overflow: "hidden",
          }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: `${barPct}%`,
              background: "var(--accent)",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      </div>
    );
  }

  function SortHeader({ label, colKey, align = "right" }: { label: string; colKey: SortKey; align?: "left" | "right" }) {
    const active = sortKey === colKey && sortDir !== "none";
    return (
      <button
        onClick={() => toggleSort(colKey)}
        style={{
          display: "flex", alignItems: "center", gap: 2,
          justifyContent: align === "right" ? "flex-end" : "flex-start",
          background: "none", border: "none", padding: 0, margin: 0,
          cursor: "pointer", fontFamily: "inherit",
          fontSize: 10, fontWeight: 600, color: active ? "var(--accent)" : "var(--text-muted)",
          textTransform: "uppercase", letterSpacing: "0.04em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        {active ? (
          sortDir === "asc"
            ? <ChevronUp size={10} style={{ flexShrink: 0 }} />
            : <ChevronDown size={10} style={{ flexShrink: 0 }} />
        ) : (
          <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: 1, opacity: 0.3, lineHeight: 0 }}>
            <ChevronUp size={8} style={{ marginBottom: -3 }} />
            <ChevronDown size={8} />
          </span>
        )}
      </button>
    );
  }

  function renderTableHeader() {
    return (
      <div style={{
        display: "grid", gridTemplateColumns: GRID_COLS,
        gap: 8, padding: "10px 14px",
        borderBottom: "1px solid var(--border)",
        fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em",
      }}>
        <span>Agent</span>
        <span>Model</span>
        <SortHeader label="Turns" colKey="turns" />
        <SortHeader label="Input Tokens" colKey="inputTokens" />
        <SortHeader label="Output Tokens" colKey="outputTokens" />
        <SortHeader label="Cost ($)" colKey="costUsd" />
        <SortHeader label="Last Active" colKey="lastActivity" />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
      {/* Header */}
      <div className="page-header" style={{ padding: "0 0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Finance</h1>
          <div className="page-subtitle">
            Token usage & cost tracking
            {lastRefresh && <span> · {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button
          onClick={() => setConfirmReset(true)}
          disabled={resetting}
          style={{
            padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)",
            background: "var(--bg-hover)", color: "var(--text-muted)",
            cursor: "pointer", fontSize: 12, fontFamily: "inherit",
          }}
        >
          {resetting ? "Resetting..." : "Reset Data"}
        </button>
      </div>

      {/* Summary cards */}
      {totals && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          {[
            { label: "Total Spent", value: fmtUsdShort(totals.totalCostUsd), sub: fmtUsd(totals.totalCostUsd), color: "var(--green)" },
            { label: "Total Tokens", value: fmt(totals.totalTokens), sub: `${fmt(totals.totalInputTokens)} in / ${fmt(totals.totalOutputTokens)} out`, color: "var(--blue)" },
            { label: "LLM Turns", value: fmt(totals.totalTurns), sub: `${agents.length} agents`, color: "var(--purple)" },
            { label: "Session Start", value: new Date(totals.sessionStart).toLocaleDateString(), sub: timeSince(totals.sessionStart), color: "var(--orange)" },
          ].map((s) => (
            <div key={s.label} style={{
              flex: "1 1 140px", padding: "14px 16px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar: view toggle + search */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {/* View mode toggle */}
        <div style={{
          display: "flex", borderRadius: 8, overflow: "hidden",
          border: "1px solid var(--border)", flexShrink: 0,
        }}>
          {([["list", List, "List"], ["department", Building2, "Dept"]] as const).map(([mode, Icon, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={`${label} view`}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 11, fontWeight: 500, padding: "5px 10px",
                border: "none", cursor: "pointer", fontFamily: "inherit",
                background: viewMode === mode ? "var(--accent)" : "transparent",
                color: viewMode === mode ? "#fff" : "var(--text-muted)",
                transition: "all 0.08s",
              }}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--bg-tertiary)", border: "1px solid var(--border)",
          borderRadius: 20, padding: "6px 14px", flexShrink: 0,
        }}>
          <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents..."
            style={{
              border: "none", outline: "none", background: "transparent",
              color: "var(--text-primary)", fontSize: 12.5,
              width: 180, fontFamily: "inherit", padding: 0,
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 14, height: 14, border: "none", background: "var(--bg-hover)",
              color: "var(--text-muted)", cursor: "pointer", borderRadius: 3,
              padding: 0, flexShrink: 0,
            }}>
              <X size={9} />
            </button>
          )}
        </div>

        <div style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>
          Costs based on per-model pricing
        </div>
      </div>

      {/* Agent breakdown */}
      <div style={{ marginBottom: 20 }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: 24, textAlign: "center",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            color: "var(--text-muted)", fontSize: 13,
          }}>
            {search
              ? "No agents match your search."
              : "No usage data yet. Agents will appear here once they start processing tasks."}
          </div>
        ) : viewMode === "department" ? (
          /* ── Department grouped view ── */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {departments.map(([dept, deptAgents]) => {
              const deptCost = deptAgents.reduce((s, a) => s + a.costUsd, 0);
              const deptTokens = deptAgents.reduce((s, a) => s + a.totalTokens, 0);
              const deptTurns = deptAgents.reduce((s, a) => s + a.turns, 0);
              return (
                <div key={dept}>
                  {/* Department header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    marginBottom: 8, paddingBottom: 6,
                    borderBottom: "1px solid var(--border)",
                  }}>
                    <Building2 size={14} style={{ color: "var(--text-muted)" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.01em" }}>
                      {dept}
                    </span>
                    <span style={{
                      fontSize: 11, color: "var(--text-muted)", background: "var(--bg-tertiary)",
                      padding: "1px 8px", borderRadius: 5, fontFamily: "monospace",
                    }}>
                      {deptAgents.length}
                    </span>
                    {/* Department totals */}
                    <div style={{ marginLeft: "auto", display: "flex", gap: 14, fontSize: 11 }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        {fmt(deptTurns)} turns
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {fmt(deptTokens)} tokens
                      </span>
                      <span style={{ color: "var(--green)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {fmtUsdShort(deptCost)}
                      </span>
                    </div>
                  </div>

                  {/* Department table */}
                  <div style={{
                    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
                    overflow: "hidden",
                  }}>
                    {renderTableHeader()}
                    {deptAgents.map((agent, i) => renderAgentRow(agent, i === deptAgents.length - 1))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Flat list view ── */
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            overflow: "hidden",
          }}>
            {renderTableHeader()}
            {filtered.map((agent, i) => renderAgentRow(agent, i === filtered.length - 1))}
          </div>
        )}
      </div>

      {/* Reset confirmation modal */}
      {confirmReset && (
        <ConfirmModal
          title="Reset Finance Data"
          message="This will clear all token usage and cost data for every agent. This action cannot be undone."
          confirmLabel="Reset Data"
          destructive
          onConfirm={handleReset}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </div>
  );
}
