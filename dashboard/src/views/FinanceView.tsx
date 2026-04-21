import { useState, useMemo, useEffect, useCallback } from "react";
import { usePolling, postApi } from "../hooks/useApi";
import { useEmployees } from "../context/EmployeesContext";
import {
  Search, X, List, Building2, ChevronUp, ChevronDown,
  AlertTriangle, Pencil, Check, User,
  Wallet, CircleDollarSign, Target, Users, Database, Cpu, CalendarDays,
} from "lucide-react";
import ConfirmModal from "../components/ConfirmModal";

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentUsage {
  agentId: string; turns: number; inputTokens: number; outputTokens: number;
  totalTokens: number; costUsd: number; lastActivity: string; model?: string;
}
interface FinanceTotals {
  totalTurns: number; totalInputTokens: number; totalOutputTokens: number;
  totalTokens: number; totalCostUsd: number; sessionStart: string;
}
interface FinanceData { totals: FinanceTotals; agents: AgentUsage[]; }

interface LimitConfig { dailyLimit?: number; monthlyLimit?: number; enabled: boolean; }
interface BudgetConfig {
  org: LimitConfig & { alertThreshold: number };
  departments: Record<string, LimitConfig>;
  agents: Record<string, LimitConfig>;
}
interface LimitStatus {
  dailySpend: number; monthlySpend: number;
  dailyLimit?: number; monthlyLimit?: number;
  dailyPct: number; monthlyPct: number;
  exceeded: boolean; warning: boolean; enabled: boolean;
}
interface BudgetData {
  config: BudgetConfig;
  status: { org: LimitStatus & { alertThreshold: number }; departments: Record<string, LimitStatus>; agents: Record<string, LimitStatus>; };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string { return n.toLocaleString("en-US"); }
function fmtUsd(n: number): string { return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }); }
function fmtUsdShort(n: number): string {
  const d = n > 0 && n < 1 ? 4 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function barColor(pct: number, exceeded: boolean): string {
  if (exceeded) return "var(--red)";
  if (pct >= 0.8) return "var(--orange)";
  if (pct >= 0.5) return "var(--yellow)";
  return "var(--green)";
}

const GRID_COLS = "1fr 120px 80px 110px 110px 90px 90px";
const DEPT_ORDER = ["Management", "Product", "Engineering", "Analysis", "Design", "Documentation", "Governance"];
type SortKey = "turns" | "inputTokens" | "outputTokens" | "costUsd" | "lastActivity";
type SortDir = "asc" | "desc" | "none";
function compareFn(key: SortKey, dir: SortDir) {
  if (dir === "none") return () => 0;
  return (a: AgentUsage, b: AgentUsage) => {
    const cmp = key === "lastActivity"
      ? new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime()
      : a[key] - b[key];
    return dir === "asc" ? cmp : -cmp;
  };
}

type FinanceTab = "usage" | "budgets";

// ── Shared Components ────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={{
      width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
      background: on ? "var(--green)" : "var(--bg-hover)", position: "relative", transition: "background 0.15s", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 3, left: on ? 19 : 3,
        width: 14, height: 14, borderRadius: 7, background: "#fff",
        transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      }} />
    </button>
  );
}

function UsdInput({ value, onChange, placeholder, wide }: {
  value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; wide?: boolean;
}) {
  const [text, setText] = useState(value != null ? value.toString() : "");
  useEffect(() => setText(value != null ? value.toString() : ""), [value]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>$</span>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { const n = parseFloat(text); onChange(isNaN(n) || n <= 0 ? undefined : n); }}
        placeholder={placeholder ?? "—"}
        style={{
          width: wide ? 100 : 80, padding: "6px 10px", borderRadius: 6,
          border: "1px solid var(--border)", background: "var(--bg-primary)",
          color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
          outline: "none", textAlign: "right",
        }}
      />
    </div>
  );
}

function BudgetProgressBar({ spend, limit, pct, exceeded, height = 8 }: {
  spend: number; limit: number | undefined; pct: number; exceeded: boolean; height?: number;
}) {
  if (!limit) return <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No limit</span>;
  const clamp = Math.min(pct, 1);
  return (
    <div style={{ flex: 1, minWidth: 100 }}>
      <div style={{ height, borderRadius: height / 2, background: "var(--bg-hover)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: height / 2, width: `${clamp * 100}%`,
          background: barColor(pct, exceeded), transition: "width 0.4s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 10, color: exceeded ? "var(--red)" : "var(--text-muted)", fontWeight: exceeded ? 700 : 400 }}>
          {exceeded ? "EXCEEDED" : `${(pct * 100).toFixed(0)}%`}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {fmtUsdShort(spend)} / {fmtUsdShort(limit)}
        </span>
      </div>
    </div>
  );
}

function StatusBadge({ exceeded, warning }: { exceeded: boolean; warning: boolean }) {
  if (exceeded) return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 5, background: "var(--red-bg)", color: "var(--red)" }}>
      <AlertTriangle size={11} /> Exceeded
    </span>
  );
  if (warning) return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 5, background: "var(--orange-bg)", color: "var(--orange)" }}>
      <AlertTriangle size={11} /> Warning
    </span>
  );
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 5, background: "var(--green-bg)", color: "var(--green)" }}>
      <Check size={11} /> OK
    </span>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function FinanceView() {
  const { data, lastRefresh } = usePolling<FinanceData>("/api/finance", 5000);
  const { employees } = useEmployees();
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "department">("list");
  const [sortKey, setSortKey] = useState<SortKey>("costUsd");
  const [sortDir, setSortDir] = useState<SortDir>("none");
  const [tab, setTab] = useState<FinanceTab>("usage");

  // Budget
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [budgetDraft, setBudgetDraft] = useState<BudgetConfig | null>(null);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetEditing, setBudgetEditing] = useState(false);

  const fetchBudgets = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/budgets", { credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        setBudgetData(d);
        if (!budgetDraft) setBudgetDraft(d.config);
      }
    } catch { /* silent */ }
  }, [budgetDraft]);

  useEffect(() => { fetchBudgets(); }, []);
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/finance/budgets", { credentials: "include" });
        if (res.ok) setBudgetData(await res.json());
      } catch {}
    }, 10000);
    return () => clearInterval(id);
  }, []);

  async function saveBudget() {
    if (!budgetDraft) return;
    setBudgetSaving(true);
    try {
      await postApi("/api/finance/budgets", budgetDraft);
      setBudgetEditing(false);
      await fetchBudgets();
    } finally { setBudgetSaving(false); }
  }

  const totals = data?.totals;
  const agents = data?.agents ?? [];
  const empMap = new Map((employees ?? []).map(e => [e.agent_key, e]));
  const status = budgetData?.status;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "none" ? "desc" : d === "desc" ? "asc" : "none");
    else { setSortKey(key); setSortDir("desc"); }
  }

  const filtered = useMemo(() => {
    let list = [...agents];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a => {
        const emp = empMap.get(a.agentId);
        return a.agentId.toLowerCase().includes(q) || (emp?.name ?? "").toLowerCase().includes(q) || (emp?.role ?? "").toLowerCase().includes(q) || (a.model ?? "").toLowerCase().includes(q);
      });
    }
    return list.sort(compareFn(sortKey, sortDir));
  }, [agents, empMap, search, sortKey, sortDir]);

  const departments = useMemo(() => {
    const map = new Map<string, AgentUsage[]>();
    for (const a of filtered) {
      const dept = empMap.get(a.agentId)?.department ?? "Other";
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(a);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ai = DEPT_ORDER.indexOf(a), bi = DEPT_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [filtered, empMap]);

  const maxTokens = Math.max(1, ...filtered.map(a => a.totalTokens));

  async function handleReset() {
    setConfirmReset(false); setResetting(true);
    try { await postApi("/api/finance/reset", {}); } finally { setResetting(false); }
  }

  // Draft helpers
  function getDeptBudget(dept: string): LimitConfig { return budgetDraft?.departments?.[dept] ?? { enabled: false }; }
  function setDeptBudget(dept: string, patch: Partial<LimitConfig>) {
    if (!budgetDraft) return;
    const existing = budgetDraft.departments?.[dept] ?? { enabled: false };
    setBudgetDraft({ ...budgetDraft, departments: { ...budgetDraft.departments, [dept]: { ...existing, ...patch } } });
  }
  function getAgentBudget(id: string): LimitConfig { return budgetDraft?.agents?.[id] ?? { enabled: false }; }
  function setAgentBudget(id: string, patch: Partial<LimitConfig>) {
    if (!budgetDraft) return;
    const existing = budgetDraft.agents?.[id] ?? { enabled: false };
    setBudgetDraft({ ...budgetDraft, agents: { ...budgetDraft.agents, [id]: { ...existing, ...patch } } });
  }

  // ── Agent table rendering ────────────────────────────────────────────────

  function renderAgentRow(agent: AgentUsage, isLast: boolean) {
    const emp = empMap.get(agent.agentId);
    const barPct = Math.max(2, (agent.totalTokens / maxTokens) * 100);
    const as = status?.agents[agent.agentId];
    return (
      <div key={agent.agentId} style={{ borderBottom: isLast ? "none" : "1px solid var(--border)" }}>
        <div style={{
          display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, padding: "10px 14px", alignItems: "center",
          background: as?.exceeded ? "var(--red-bg)" : as?.warning ? "var(--orange-bg)" : "transparent",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", position: "relative",
              background: `color-mix(in srgb, var(--accent) 15%, transparent)`,
              border: "1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "var(--accent)", flexShrink: 0,
            }}>
              {agent.agentId.slice(0, 2).toUpperCase()}
              {as?.exceeded && <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: 4, background: "var(--red)", border: "1.5px solid var(--bg-card)" }} />}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{emp?.name?.split(" ")[0] ?? agent.agentId}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{emp?.role ?? agent.agentId}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.model ?? "\u2014"}</div>
          <div style={{ textAlign: "right", fontSize: 13, fontWeight: 500, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{fmt(agent.turns)}</div>
          <div style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmt(agent.inputTokens)}</div>
          <div style={{ textAlign: "right", fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmt(agent.outputTokens)}</div>
          <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: as?.exceeded ? "var(--red)" : "var(--green)", fontVariantNumeric: "tabular-nums" }}>{fmtUsd(agent.costUsd)}</div>
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--text-muted)" }}>{timeSince(agent.lastActivity)}</div>
        </div>
        <div style={{ padding: "0 14px 10px" }}>
          <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, width: `${barPct}%`, background: as?.exceeded ? "var(--red)" : "var(--accent)", transition: "width 0.3s" }} />
          </div>
        </div>
      </div>
    );
  }

  function SortHeader({ label, colKey, align = "right" }: { label: string; colKey: SortKey; align?: "left" | "right" }) {
    const active = sortKey === colKey && sortDir !== "none";
    return (
      <button onClick={() => toggleSort(colKey)} style={{
        display: "flex", alignItems: "center", gap: 2, justifyContent: align === "right" ? "flex-end" : "flex-start",
        background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
        fontSize: 10, fontWeight: 600, color: active ? "var(--accent)" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap",
      }}>
        {label}
        {active ? (sortDir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />) : (
          <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: 1, opacity: 0.3, lineHeight: 0 }}>
            <ChevronUp size={8} style={{ marginBottom: -3 }} /><ChevronDown size={8} />
          </span>
        )}
      </button>
    );
  }

  function renderTableHeader() {
    return (
      <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        <span>Agent</span><span>Model</span>
        <SortHeader label="Turns" colKey="turns" /><SortHeader label="Input Tokens" colKey="inputTokens" />
        <SortHeader label="Output Tokens" colKey="outputTokens" /><SortHeader label="Cost ($)" colKey="costUsd" />
        <SortHeader label="Last Active" colKey="lastActivity" />
      </div>
    );
  }

  // ── Budget limit row (reusable) ──────────────────────────────────────────

  function BudgetLimitRow({ icon, name, subtitle, lCfg, lStatus, editing, onToggle, onDaily, onMonthly }: {
    icon: React.ReactNode; name: string; subtitle?: string;
    lCfg: LimitConfig; lStatus: LimitStatus | undefined;
    editing: boolean;
    onToggle: () => void; onDaily: (v: number | undefined) => void; onMonthly: (v: number | undefined) => void;
  }) {
    return (
      <div style={{
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        background: lStatus?.exceeded ? "var(--red-bg)" : lStatus?.warning ? "var(--orange-bg)" : "transparent",
        borderBottom: "1px solid var(--border)",
      }}>
        {/* Name */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160 }}>
          <span style={{ color: "var(--text-muted)" }}>{icon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{name}</div>
            {subtitle && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{subtitle}</div>}
          </div>
        </div>

        {/* Toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {editing ? <Toggle on={lCfg.enabled} onToggle={onToggle} /> : (
            <span style={{ fontSize: 11, color: lCfg.enabled ? "var(--green)" : "var(--text-muted)", fontWeight: 600 }}>
              {lCfg.enabled ? "Active" : "Off"}
            </span>
          )}
        </div>

        {/* Daily */}
        <div style={{ minWidth: 130 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>Daily</div>
          {editing ? (
            <UsdInput value={lCfg.dailyLimit} onChange={onDaily} />
          ) : lStatus && lCfg.enabled && lCfg.dailyLimit ? (
            <BudgetProgressBar spend={lStatus.dailySpend} limit={lCfg.dailyLimit} pct={lStatus.dailyPct} exceeded={lStatus.exceeded} />
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{lCfg.dailyLimit ? fmtUsdShort(lCfg.dailyLimit) : "—"}</span>
          )}
        </div>

        {/* Monthly */}
        <div style={{ minWidth: 130 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>Monthly</div>
          {editing ? (
            <UsdInput value={lCfg.monthlyLimit} onChange={onMonthly} />
          ) : lStatus && lCfg.enabled && lCfg.monthlyLimit ? (
            <BudgetProgressBar spend={lStatus.monthlySpend} limit={lCfg.monthlyLimit} pct={lStatus.monthlyPct} exceeded={lStatus.exceeded} />
          ) : (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{lCfg.monthlyLimit ? fmtUsdShort(lCfg.monthlyLimit) : "—"}</span>
          )}
        </div>

        {/* Status */}
        <div style={{ marginLeft: "auto" }}>
          {lCfg.enabled && lStatus ? <StatusBadge exceeded={lStatus.exceeded} warning={lStatus.warning} /> : null}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  // All unique department names
  const allDepts = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees ?? []) { if (e.department) set.add(e.department); }
    for (const d of Object.keys(status?.departments ?? {})) set.add(d);
    return [...set].sort((a, b) => {
      const ai = DEPT_ORDER.indexOf(a), bi = DEPT_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1; if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [employees, status]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
      {/* Header */}
      <div className="page-header" style={{ padding: "0 0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Finance</h1>
          <div className="page-subtitle">
            Token usage, cost tracking & budget limits
            {lastRefresh && <span> · {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button onClick={() => setConfirmReset(true)} disabled={resetting} style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)",
          background: "var(--bg-card)", color: "var(--text-secondary)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          {resetting ? "Resetting..." : "Reset Data"}
        </button>
      </div>

      {/* Summary cards */}
      {totals && (
        <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
          {[
            { label: "Total Spent", value: fmtUsdShort(totals.totalCostUsd), sub: fmtUsd(totals.totalCostUsd), color: "var(--green)", icon: <CircleDollarSign size={32} /> },
            { label: "Total Tokens", value: fmt(totals.totalTokens), sub: `${fmt(totals.totalInputTokens)} in · ${fmt(totals.totalOutputTokens)} out`, color: "var(--blue)", icon: <Database size={32} /> },
            { label: "LLM Turns", value: fmt(totals.totalTurns), sub: `${agents.length} agents`, color: "var(--accent)", icon: <Cpu size={32} /> },
            { label: "Session Start", value: new Date(totals.sessionStart).toLocaleDateString(), sub: timeSince(totals.sessionStart), color: "var(--orange)", icon: <CalendarDays size={32} /> },
          ].map(s => (
            <div key={s.label} style={{
              flex: "1 1 150px", padding: "18px 20px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
              position: "relative", overflow: "hidden",
            }}>
              <div style={{ position: "absolute", top: 14, right: 14, color: s.color, opacity: 0.12 }}>{s.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, fontWeight: 500 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tab bar: Usage | Budgets */}
      <div style={{ display: "flex", marginBottom: 24 }}>
        <div style={{
          display: "inline-flex", background: "var(--bg-secondary)", borderRadius: 10, padding: 4, gap: 2,
        }}>
          {([
            { id: "usage" as FinanceTab, label: "Usage & Costs", icon: <List size={13} /> },
            { id: "budgets" as FinanceTab, label: "Budget Limits", icon: <Wallet size={13} /> },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 18px", border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
              background: tab === t.id ? "var(--bg-card)" : "transparent",
              borderRadius: 7,
              boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
              transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
            }}>
              {t.icon} {t.label}
              {t.id === "budgets" && status?.org.exceeded && (
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--red)", flexShrink: 0 }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ USAGE TAB ═══ */}
      {tab === "usage" && (
        <>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", background: "var(--bg-secondary)", borderRadius: 8, padding: 3, gap: 2, flexShrink: 0 }}>
              {([["list", List, "List"], ["department", Building2, "Dept"]] as const).map(([mode, Icon, label]) => (
                <button key={mode} onClick={() => setViewMode(mode)} title={`${label} view`} style={{
                  display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: viewMode === mode ? 600 : 400, padding: "6px 12px",
                  border: "none", cursor: "pointer", fontFamily: "inherit", borderRadius: 6,
                  background: viewMode === mode ? "var(--bg-card)" : "transparent",
                  color: viewMode === mode ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: viewMode === mode ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  transition: "background 0.12s, color 0.12s",
                }}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 20, padding: "6px 14px", flexShrink: 0 }}>
              <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents..."
                style={{ border: "none", outline: "none", background: "transparent", color: "var(--text-primary)", fontSize: 12.5, width: 180, fontFamily: "inherit", padding: 0 }} />
              {search && <button onClick={() => setSearch("")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer", borderRadius: 3, padding: 0, flexShrink: 0 }}><X size={9} /></button>}
            </div>
            <div style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>Costs based on per-model pricing</div>
          </div>

          {/* Agent breakdown */}
          <div style={{ marginBottom: 20 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--text-muted)", fontSize: 13 }}>
                {search ? "No agents match your search." : "No usage data yet. Agents will appear here once they start processing tasks."}
              </div>
            ) : viewMode === "department" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {departments.map(([dept, deptAgents]) => {
                  const deptCost = deptAgents.reduce((s, a) => s + a.costUsd, 0);
                  const deptTokens = deptAgents.reduce((s, a) => s + a.totalTokens, 0);
                  const deptTurns = deptAgents.reduce((s, a) => s + a.turns, 0);
                  return (
                    <div key={dept}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: "var(--bg-secondary)" }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: "color-mix(in srgb, var(--blue) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Building2 size={14} style={{ color: "var(--blue)" }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{dept}</span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-card)", border: "1px solid var(--border)", padding: "1px 8px", borderRadius: 5, fontFamily: "monospace" }}>{deptAgents.length}</span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 11, alignItems: "center" }}>
                          <span style={{ color: "var(--text-muted)" }}>{fmt(deptTurns)} turns</span>
                          <span style={{ color: "var(--text-muted)" }}>{fmt(deptTokens)} tokens</span>
                          <span style={{ fontSize: 13, color: "var(--green)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtUsdShort(deptCost)}</span>
                        </div>
                      </div>
                      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                        {renderTableHeader()}
                        {deptAgents.map((a, i) => renderAgentRow(a, i === deptAgents.length - 1))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                {renderTableHeader()}
                {filtered.map((a, i) => renderAgentRow(a, i === filtered.length - 1))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══ BUDGETS TAB ═══ */}
      {tab === "budgets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Actions bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, fontSize: 12, color: "var(--text-muted)" }}>
              Set spending limits at organization, department, and individual agent level.
            </div>
            {!budgetEditing ? (
              <button onClick={() => { setBudgetEditing(true); if (budgetData) setBudgetDraft(budgetData.config); }} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)",
              }}>
                <Pencil size={12} /> Edit Budgets
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setBudgetEditing(false); if (budgetData) setBudgetDraft(budgetData.config); }} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  cursor: "pointer", fontFamily: "inherit", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)",
                }}>Cancel</button>
                <button onClick={saveBudget} disabled={budgetSaving} style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", border: "none", background: "var(--accent)", color: "#fff",
                }}>
                  <Check size={12} /> {budgetSaving ? "Saving..." : "Save All"}
                </button>
              </div>
            )}
          </div>

          {/* ── 1. Organization ────────────────────────────────────────────── */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: "color-mix(in srgb, var(--accent) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CircleDollarSign size={16} style={{ color: "var(--accent)" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Organization</span>
              {status?.org.enabled && <StatusBadge exceeded={status.org.exceeded} warning={status.org.warning} />}
            </div>
            {budgetDraft && (
              <BudgetLimitRow
                icon={<CircleDollarSign size={16} />}
                name="Org-wide Limit"
                subtitle="Applies to all agents combined"
                lCfg={budgetDraft.org}
                lStatus={status?.org}
                editing={budgetEditing}
                onToggle={() => setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, enabled: !budgetDraft.org.enabled } })}
                onDaily={v => setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, dailyLimit: v } })}
                onMonthly={v => setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, monthlyLimit: v } })}
              />
            )}
            {budgetEditing && budgetDraft && (
              <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}>Alert Threshold</span>
                <input type="range" min={10} max={100} step={5}
                  value={Math.round((budgetDraft.org.alertThreshold ?? 0.8) * 100)}
                  onChange={e => { const v = parseInt(e.target.value); setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, alertThreshold: Math.min(1, Math.max(0.1, v / 100)) } }); }}
                  style={{ flex: 1, maxWidth: 160 }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <input type="text" inputMode="numeric"
                    value={Math.round((budgetDraft.org.alertThreshold ?? 0.8) * 100)}
                    onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, "")); if (!isNaN(v)) setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, alertThreshold: Math.min(1, Math.max(0.1, v / 100)) } }); }}
                    onBlur={e => { const v = parseInt(e.target.value); if (isNaN(v) || v < 10) setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, alertThreshold: 0.1 } }); else if (v > 100) setBudgetDraft({ ...budgetDraft, org: { ...budgetDraft.org, alertThreshold: 1 } }); }}
                    style={{ width: 32, padding: "2px 4px", fontSize: 13, fontWeight: 600, color: "var(--accent)", textAlign: "center", background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 4 }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>%</span>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>warn before limit</span>
              </div>
            )}
          </div>

          {/* ── 2. Departments ─────────────────────────────────────────────── */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: "color-mix(in srgb, var(--blue) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Building2 size={16} style={{ color: "var(--blue)" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Departments</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", padding: "1px 8px", borderRadius: 5 }}>{allDepts.length}</span>
            </div>
            {allDepts.length === 0 ? (
              <div style={{ padding: "20px", color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>No departments found in roster.</div>
            ) : allDepts.map(dept => {
              const dCfg = getDeptBudget(dept);
              const dStatus = status?.departments?.[dept];
              return (
                <BudgetLimitRow key={dept}
                  icon={<Building2 size={14} />}
                  name={dept}
                  subtitle={`${(employees ?? []).filter(e => e.department === dept).length} agents`}
                  lCfg={dCfg} lStatus={dStatus}
                  editing={budgetEditing}
                  onToggle={() => setDeptBudget(dept, { enabled: !dCfg.enabled })}
                  onDaily={v => setDeptBudget(dept, { dailyLimit: v })}
                  onMonthly={v => setDeptBudget(dept, { monthlyLimit: v })}
                />
              );
            })}
          </div>

          {/* ── 3. Agents ─────────────────────────────────────────────────── */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: "color-mix(in srgb, var(--green) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Users size={16} style={{ color: "var(--green)" }} />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Agents</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-secondary)", border: "1px solid var(--border)", padding: "1px 8px", borderRadius: 5 }}>{agents.length}</span>
            </div>
            {agents.length === 0 ? (
              <div style={{ padding: "20px", color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>No agents with usage data yet.</div>
            ) : agents.map(agent => {
              const emp = empMap.get(agent.agentId);
              const aCfg = getAgentBudget(agent.agentId);
              const aStatus = status?.agents?.[agent.agentId];
              return (
                <BudgetLimitRow key={agent.agentId}
                  icon={<Target size={14} />}
                  name={emp?.name?.split(" ")[0] ?? agent.agentId}
                  subtitle={emp?.department ? `${emp.department} · ${emp.role}` : agent.agentId}
                  lCfg={aCfg} lStatus={aStatus}
                  editing={budgetEditing}
                  onToggle={() => setAgentBudget(agent.agentId, { enabled: !aCfg.enabled })}
                  onDaily={v => setAgentBudget(agent.agentId, { dailyLimit: v })}
                  onMonthly={v => setAgentBudget(agent.agentId, { monthlyLimit: v })}
                />
              );
            })}
          </div>
        </div>
      )}

      {confirmReset && (
        <ConfirmModal title="Reset Finance Data"
          message="This will clear all token usage and cost data for every agent. This action cannot be undone."
          confirmLabel="Reset Data" destructive onConfirm={handleReset} onCancel={() => setConfirmReset(false)} />
      )}
    </div>
  );
}
