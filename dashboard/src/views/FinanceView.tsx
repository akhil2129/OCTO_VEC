import { useState } from "react";
import { usePolling, postApi } from "../hooks/useApi";
import { useEmployees } from "../context/EmployeesContext";

interface AgentUsage {
  agentId: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costInr: number;
  lastActivity: string;
}

interface FinanceTotals {
  totalTurns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCostInr: number;
  sessionStart: string;
  pricing: { inputPerM: number; outputPerM: number; usdToInr: number };
}

interface FinanceData {
  totals: FinanceTotals;
  agents: AgentUsage[];
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

function fmtInr(n: number): string {
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
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

export default function FinanceView() {
  const { data, lastRefresh } = usePolling<FinanceData>("/api/finance", 5000);
  const { employees } = useEmployees();
  const [resetting, setResetting] = useState(false);

  const totals = data?.totals;
  const agents = data?.agents ?? [];
  const empMap = new Map((employees ?? []).map((e) => [e.agent_key, e]));

  // Sort agents by cost descending
  const sorted = [...agents].sort((a, b) => b.costInr - a.costInr);

  // Bar chart: max tokens for scale
  const maxTokens = Math.max(1, ...agents.map((a) => a.totalTokens));

  async function handleReset() {
    if (!confirm("Reset all finance data? This cannot be undone.")) return;
    setResetting(true);
    try {
      await postApi("/api/finance/reset", {});
    } finally {
      setResetting(false);
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
      {/* Header */}
      <div className="page-header" style={{ padding: "0 0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Finance</h1>
          <div className="page-subtitle">
            Token usage & cost tracking (estimates)
            {lastRefresh && <span> · {lastRefresh.toLocaleTimeString()}</span>}
          </div>
        </div>
        <button
          onClick={handleReset}
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
            { label: "Total Spent", value: fmtInr(totals.totalCostInr), sub: fmtUsd(totals.totalCostUsd), color: "var(--green)" },
            { label: "Total Tokens", value: fmt(totals.totalTokens), sub: `${fmt(totals.totalInputTokens)} in / ${fmt(totals.totalOutputTokens)} out`, color: "var(--blue)" },
            { label: "LLM Turns", value: fmt(totals.totalTurns), sub: `${sorted.length} agents`, color: "var(--purple)" },
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

      {/* Pricing info */}
      {totals && (
        <div style={{
          display: "flex", gap: 16, marginBottom: 20, padding: "10px 14px",
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
          fontSize: 11, color: "var(--text-muted)",
        }}>
          <span>Input: ${totals.pricing.inputPerM}/1M tokens</span>
          <span>Output: ${totals.pricing.outputPerM}/1M tokens</span>
          <span>USD → INR: ₹{totals.pricing.usdToInr}</span>
          <span style={{ marginLeft: "auto", fontStyle: "italic" }}>Set VEC_INPUT_COST_PER_M, VEC_OUTPUT_COST_PER_M, VEC_USD_TO_INR env vars to customize</span>
        </div>
      )}

      {/* Agent breakdown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Per-Agent Breakdown
        </div>

        {sorted.length === 0 ? (
          <div style={{
            padding: 24, textAlign: "center",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            color: "var(--text-muted)", fontSize: 13,
          }}>
            No usage data yet. Agents will appear here once they start processing tasks.
          </div>
        ) : (
          <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            overflow: "hidden",
          }}>
            {/* Table header */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 100px 120px 120px 100px 100px",
              gap: 8, padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em",
            }}>
              <span>Agent</span>
              <span style={{ textAlign: "right" }}>Turns</span>
              <span style={{ textAlign: "right" }}>Input Tokens</span>
              <span style={{ textAlign: "right" }}>Output Tokens</span>
              <span style={{ textAlign: "right" }}>Cost (₹)</span>
              <span style={{ textAlign: "right" }}>Last Active</span>
            </div>

            {/* Rows */}
            {sorted.map((agent, i) => {
              const emp = empMap.get(agent.agentId);
              const barPct = Math.max(2, (agent.totalTokens / maxTokens) * 100);
              return (
                <div key={agent.agentId} style={{
                  borderBottom: i < sorted.length - 1 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 100px 120px 120px 100px 100px",
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
                      {fmtInr(agent.costInr)}
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}
