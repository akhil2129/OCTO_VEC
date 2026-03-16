import { useState, useEffect, useCallback } from "react";
import {
  Plus, Trash2, Save, RefreshCw, Server, ChevronDown, ChevronRight,
  Shield, Search, MessageSquare, Cpu, Box, ExternalLink,
  Zap, Settings2, Database, Eye, Star, Check, X, Package,
  Hash, Globe, Radio, Gamepad2, FolderOpen,
} from "lucide-react";
import { postApi, apiUrl } from "../hooks/useApi";
import { usePolling } from "../hooks/useApi";
import Dropdown, { type DropdownOption } from "../components/Dropdown";
import MCP_DIRECTORY, { CATEGORY_META, type MCPDirectoryEntry, type MCPCategory } from "../data/mcpDirectory";

// ── Types ────────────────────────────────────────────────────────────────────

interface MCPServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface MCPConfig {
  mcpServers: Record<string, MCPServer>;
}

interface MCPStatus {
  servers: { name: string; tools: string[]; connected: boolean }[];
}

interface ModelSlot {
  provider: string;
  model: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  envKey: string;
  models: string[];
  iconUrl: string;
}

interface ModelConfigData {
  providers: ProviderInfo[];
  config: {
    primary: ModelSlot;
    secondary: ModelSlot | null;
    fallback: ModelSlot | null;
    agentModels: Record<string, ModelSlot>;
  };
}

interface IntegrationInfo {
  searxng: { configured: boolean; enabled: boolean; url: string };
  sonarqube: { configured: boolean; enabled: boolean; hostUrl: string; token: string | null; projectBaseKey: string; scannerImage: string };
  gitleaks: { configured: boolean; enabled: boolean; image: string };
  semgrep: { configured: boolean; enabled: boolean; image: string };
  trivy: { configured: boolean; enabled: boolean; image: string };
  postTaskScansEnabled: boolean;
}

interface SystemSettings {
  system: {
    companyName: string;
    workspace: string;
    dashboardPort: number;
    cliEnabled: boolean;
    debounceMs: number;
    contextWindow: number;
    compactThreshold: number;
  };
  llm: {
    provider: string;
    model: string;
    thinkingLevel: string;
    temperature: number;
    maxTokens: number;
  };
  proactive: {
    enabled: boolean;
    intervalSecs: number;
  };
  integrations: IntegrationInfo;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }

// ── Settings section type ────────────────────────────────────────────────────

type SettingsSection = "general" | "models" | "channels" | "integrations" | "mcp";

const SECTION_NAV: { key: SettingsSection; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "general", label: "General", icon: <Settings2 size={15} />, color: "var(--text-secondary)" },
  { key: "models", label: "Models", icon: <Box size={15} />, color: "var(--purple)" },
  { key: "channels", label: "Channels", icon: <Radio size={15} />, color: "var(--blue)" },
  { key: "integrations", label: "Integrations", icon: <Zap size={15} />, color: "var(--orange)" },
  { key: "mcp", label: "MCP Servers", icon: <Server size={15} />, color: "var(--green)" },
];

// ── Logo icon helper ─────────────────────────────────────────────────────────

function LogoIcon({ src, fallback, size = 20 }: { src: string; fallback: React.ReactNode; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: 3, filter: "var(--icon-filter, none)" }}
      onError={() => setFailed(true)}
    />
  );
}

// ── Credential input field ────────────────────────────────────────────────────

function CredentialField({ label, placeholder, value, onChange, isSecret = true }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  isSecret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type={isSecret && !show ? "password" : "text"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1, padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--bg-tertiary)",
            color: "var(--text-primary)", fontSize: 12, fontFamily: "monospace",
            outline: "none",
          }}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
        />
        {isSecret && (
          <button
            onClick={() => setShow(!show)}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-hover)", color: "var(--text-muted)",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
            title={show ? "Hide" : "Show"}
          >
            <Eye size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Integration card ────────────────────────────────────────────────────────

// ── Config row (read-only) ──────────────────────────────────────────────────

function ConfigRow({ label, value, icon }: { label: string; value: string | number | boolean; icon?: React.ReactNode }) {
  const display = typeof value === "boolean" ? (value ? "Enabled" : "Disabled") : String(value);
  const isBool = typeof value === "boolean";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 0",
      borderBottom: "1px solid var(--border)",
    }}>
      {icon && (
        <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex" }}>
          {icon}
        </span>
      )}
      <span style={{ fontSize: 13, color: "var(--text-secondary)", flex: 1 }}>{label}</span>
      {isBool ? (
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 5,
          background: value ? "var(--green-bg)" : "var(--bg-tertiary)",
          color: value ? "var(--green)" : "var(--text-muted)",
        }}>
          {display}
        </span>
      ) : (
        <span style={{
          fontSize: 12, color: "var(--text-primary)", fontFamily: "monospace",
          background: "var(--bg-tertiary)", padding: "3px 10px", borderRadius: 5,
        }}>
          {display}
        </span>
      )}
    </div>
  );
}

// ── Editable path row ────────────────────────────────────────────────────────

function EditablePathRow({ label, value, icon, onSave }: {
  label: string; value: string; icon?: React.ReactNode;
  onSave: (newPath: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const handleSave = async () => {
    if (!draft.trim() || draft === value) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(draft.trim()); setEditing(false); } catch { /* keep editing */ }
    setSaving(false);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 0", borderBottom: "1px solid var(--border)",
    }}>
      {icon && <span style={{ color: "var(--text-muted)", flexShrink: 0, display: "flex" }}>{icon}</span>}
      <span style={{ fontSize: 13, color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
      {editing ? (
        <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center" }}>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
            style={{
              flex: 1, fontSize: 12, fontFamily: "monospace", padding: "4px 8px",
              borderRadius: 5, border: "1px solid var(--border)",
              background: "var(--bg-secondary)", color: "var(--text-primary)", outline: "none",
            }}
          />
          <button onClick={handleSave} disabled={saving} style={{
            padding: "4px 10px", fontSize: 11, fontWeight: 600, borderRadius: 5, border: "none",
            background: "var(--accent)", color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "..." : "Save"}
          </button>
          <button onClick={() => { setDraft(value); setEditing(false); }} style={{
            padding: "4px 8px", fontSize: 11, borderRadius: 5, border: "1px solid var(--border)",
            background: "transparent", color: "var(--text-muted)", cursor: "pointer",
          }}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
          <span style={{
            fontSize: 12, color: "var(--text-primary)", fontFamily: "monospace",
            background: "var(--bg-tertiary)", padding: "3px 10px", borderRadius: 5,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360,
          }}>
            {value}
          </span>
          <button onClick={() => setEditing(true)} style={{
            padding: "3px 8px", fontSize: 11, borderRadius: 5, border: "1px solid var(--border)",
            background: "transparent", color: "var(--text-muted)", cursor: "pointer",
          }}>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// ── Model tier row ──────────────────────────────────────────────────────────

function ModelTierRow({ tier, slot, color, icon, providers, onSave, saving }: {
  tier: string;
  slot: ModelSlot | null;
  color: string;
  icon: React.ReactNode;
  providers: ProviderInfo[];
  onSave: (slot: ModelSlot | null) => void;
  saving: boolean;
}) {
  const [selProvider, setSelProvider] = useState(slot?.provider ?? "");
  const [selModel, setSelModel] = useState(slot?.model ?? "");
  const [dirty, setDirty] = useState(false);

  const currentProvider = providers.find((p) => p.id === selProvider);
  const models = currentProvider?.models ?? [];

  const providerOpts: DropdownOption[] = providers.map((p) => ({
    value: p.id,
    label: `${p.name} (${p.models.length})`,
    iconUrl: p.iconUrl,
  }));

  const modelOpts: DropdownOption[] = models.map((m) => ({
    value: m,
    label: m,
  }));

  function handleProviderChange(pid: string) {
    setSelProvider(pid);
    setSelModel("");
    setDirty(true);
  }

  function handleModelChange(mid: string) {
    setSelModel(mid);
    setDirty(true);
  }

  function handleApply() {
    if (selProvider && selModel) {
      onSave({ provider: selProvider, model: selModel });
    }
    setDirty(false);
  }

  function handleClear() {
    onSave(null);
    setSelProvider("");
    setSelModel("");
    setDirty(false);
  }

  return (
    <div style={{
      padding: "14px 16px", borderRadius: 10,
      background: "var(--bg-card)", border: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: slot ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--bg-tertiary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: slot ? color : "var(--text-muted)",
        }}>
          {icon}
        </div>
        <span style={{
          fontSize: 14, fontWeight: 600, color: "var(--text-primary)",
          textTransform: "capitalize", flex: 1,
        }}>
          {tier}
        </span>
        {slot && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 5,
            background: `color-mix(in srgb, ${color} 10%, transparent)`,
            color, letterSpacing: "0.04em",
          }}>
            SET
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Dropdown
          value={selProvider}
          onChange={handleProviderChange}
          options={providerOpts}
          placeholder="Select provider..."
          alignRight={false}
        />
        {selProvider && (
          <Dropdown
            value={selModel}
            onChange={handleModelChange}
            options={modelOpts}
            placeholder={`Select model (${models.length})...`}
            alignRight={false}
          />
        )}
        {dirty && selModel && (
          <button onClick={handleApply} disabled={saving} style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 32, padding: "0 14px", borderRadius: 7, border: "none",
            background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            opacity: saving ? 0.5 : 1, transition: "opacity 0.12s",
          }}>
            <Check size={12} style={{ marginRight: 4 }} /> Apply
          </button>
        )}
        {slot && !dirty && (
          <button onClick={handleClear} disabled={saving} title="Clear this tier" style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, borderRadius: 7, flexShrink: 0,
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-muted)", cursor: "pointer", padding: 0,
            transition: "color 0.12s, border-color 0.12s",
          }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Section label (uppercase) ───────────────────────────────────────────────

function SectionLabel({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
      textTransform: "uppercase", letterSpacing: "0.04em",
      marginBottom: 10,
    }}>
      {title}
      {count !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
          background: "var(--bg-tertiary)", color: "var(--text-muted)",
          fontVariantNumeric: "tabular-nums",
        }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function SettingsView() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  // Allow external navigation (e.g. from walkthrough tour)
  useEffect(() => {
    function onNav(e: Event) {
      const section = (e as CustomEvent).detail as SettingsSection;
      if (section) setActiveSection(section);
    }
    window.addEventListener("settings-nav", onNav);
    return () => window.removeEventListener("settings-nav", onNav);
  }, []);

  // System settings (read-only)
  const { data: settings, refresh: refreshSettings } = usePolling<SystemSettings>("/api/settings", 10000);

  // Model config
  const { data: modelData, refresh: refreshModels } = usePolling<ModelConfigData>("/api/model-config", 10000);
  const [modelSaving, setModelSaving] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);

  // MCP config (editable)
  const [mcpConfig, setMcpConfig] = useState<MCPConfig>({ mcpServers: {} });
  const [mcpStatus, setMcpStatus] = useState<MCPStatus>({ servers: [] });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Channel config (editable)
  interface ChannelInfo { configured: boolean; connected: boolean; botToken: string | null; chatId?: string | null; appToken?: string | null; channelId?: string | null }
  const [channelCfg, setChannelCfg] = useState<{ telegram: ChannelInfo; slack: ChannelInfo; discord: ChannelInfo } | null>(null);
  const [editingChannel, setEditingChannel] = useState<"telegram" | "slack" | "discord" | null>(null);
  const [chFields, setChFields] = useState<Record<string, string>>({});
  const [chTesting, setChTesting] = useState(false);
  const [chTestResult, setChTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [chSaving, setChSaving] = useState(false);

  // Integration config (editable)
  const [integCfg, setIntegCfg] = useState<IntegrationInfo | null>(null);
  const [editingInteg, setEditingInteg] = useState<string | null>(null);
  const [integFields, setIntegFields] = useState<Record<string, string>>({});
  const [integSaving, setIntegSaving] = useState(false);

  // Docker status
  const { data: dockerStatus } = usePolling<{ installed: boolean; running: boolean; version: string | null; error?: string }>("/api/docker-status", 30000);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/channel-config")).then(r => r.json());
      setChannelCfg(res);
    } catch { /* silent */ }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/integration-config")).then(r => r.json());
      setIntegCfg(res);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);
  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  // Refresh channels periodically
  useEffect(() => {
    const h = setInterval(fetchChannels, 8000);
    return () => clearInterval(h);
  }, [fetchChannels]);

  const fetchMCP = useCallback(async () => {
    try {
      const [cfgRes, statusRes] = await Promise.all([
        fetch(apiUrl("/api/mcp-config")).then(r => r.json()),
        fetch(apiUrl("/api/mcp-status")).then(r => r.json()),
      ]);
      setMcpConfig(cfgRes);
      setMcpStatus(statusRes);
      const exp: Record<string, boolean> = {};
      for (const k of Object.keys(cfgRes.mcpServers ?? {})) exp[k] = true;
      setExpanded(exp);
    } catch {
      showToast("Failed to load MCP config");
    }
  }, []);

  useEffect(() => { fetchMCP(); }, [fetchMCP]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function saveModelTier(tier: "primary" | "secondary" | "fallback", slot: ModelSlot | null) {
    setModelSaving(true);
    try {
      await postApi("/api/model-config", { [tier]: slot });
      refreshModels();
      showToast(`${tier.charAt(0).toUpperCase() + tier.slice(1)} model updated`);
    } catch { showToast("Failed to save model config"); }
    finally { setModelSaving(false); }
  }

  async function saveProviderKey(providerId: string, apiKey: string) {
    setKeySaving(true);
    try {
      await postApi("/api/provider-key", { provider: providerId, key: apiKey });
      refreshModels();
      showToast("API key saved");
      setEditingProvider(null);
      setKeyInput("");
    } catch { showToast("Failed to save API key"); }
    finally { setKeySaving(false); }
  }

  async function saveIntegration(key: string, payload: Record<string, unknown>) {
    setIntegSaving(true);
    try {
      const res = await postApi("/api/integration-config", { [key]: payload });
      if (res?.ok) {
        setIntegCfg(res.config);
        showToast(`${key.charAt(0).toUpperCase() + key.slice(1)} saved`);
        setEditingInteg(null);
        setIntegFields({});
      } else {
        showToast("Save failed");
      }
    } catch { showToast("Save failed"); }
    finally { setIntegSaving(false); }
  }

  async function toggleIntegration(key: string, currentlyEnabled: boolean) {
    setIntegSaving(true);
    try {
      // Load current config values so we don't lose them when toggling
      const current = integCfg?.[key as keyof IntegrationInfo] as Record<string, unknown> | undefined;
      const payload = current && typeof current === "object" ? { ...current, enabled: !currentlyEnabled } : { enabled: !currentlyEnabled };
      const res = await postApi("/api/integration-config", { [key]: payload });
      if (res?.ok) {
        setIntegCfg(res.config);
        showToast(`${key} ${!currentlyEnabled ? "enabled" : "disabled"}`);
      }
    } catch { showToast("Toggle failed"); }
    finally { setIntegSaving(false); }
  }

  function updateServer(name: string, patch: Partial<MCPServer>) {
    setMcpConfig(prev => {
      const next = deepClone(prev);
      next.mcpServers[name] = { ...next.mcpServers[name], ...patch };
      return next;
    });
    setDirty(true);
  }

  function removeServer(name: string) {
    setMcpConfig(prev => {
      const next = deepClone(prev);
      delete next.mcpServers[name];
      return next;
    });
    setDirty(true);
  }

  function addEnvVar(name: string) {
    const key = prompt("Environment variable name:");
    if (!key?.trim()) return;
    updateServer(name, {
      env: { ...mcpConfig.mcpServers[name].env, [key.trim()]: "" },
    });
  }

  function removeEnvVar(serverName: string, key: string) {
    const next = { ...mcpConfig.mcpServers[serverName].env };
    delete next[key];
    updateServer(serverName, { env: next });
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const res = await postApi("/api/mcp-config", mcpConfig);
      if (res?.ok) {
        setDirty(false);
        showToast("Saved! MCP servers updated automatically.");
        fetchMCP();
      } else {
        showToast("Save failed");
      }
    } catch {
      showToast("Save failed");
    } finally {
      setSaving(false);
    }
  }

  const serverNames = Object.keys(mcpConfig.mcpServers);
  const s = settings;
  const integ = integCfg ?? s?.integrations ?? null;

  // ── Count stats for sidebar badges ────────────────────────────────────────

  const configuredProviders = modelData?.providers.filter(p => p.configured).length ?? 0;
  const channelCount = [channelCfg?.telegram.configured, channelCfg?.slack.configured, channelCfg?.discord.configured].filter(Boolean).length;
  const integCount = integ ? [integ.searxng.configured && integ.searxng.enabled, integ.sonarqube.configured && integ.sonarqube.enabled, integ.gitleaks.enabled, integ.semgrep.enabled, integ.trivy.enabled].filter(Boolean).length : 0;
  const connectedServers = mcpStatus.servers.filter(s => s.connected).length;

  // ── Section renderers ────────────────────────────────────────────────────

  function renderGeneral() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Quick stats */}
        {s && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Company", value: s.system.companyName, color: "var(--accent)" },
              { label: "Provider", value: s.llm.provider, color: "var(--purple)" },
              { label: "Model", value: s.llm.model.split("/").pop() ?? s.llm.model, color: "var(--blue)" },
              { label: "Dashboard", value: `:${s.system.dashboardPort}`, color: "var(--green)" },
            ].map((stat) => (
              <div key={stat.label} style={{
                flex: "1 1 120px", padding: "14px 16px",
                background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: stat.color, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* System config */}
        <div>
          <SectionLabel title="System" />
          <div className="vec-card" style={{ padding: "4px 16px" }}>
            {s ? (
              <>
                <ConfigRow label="Company Name" value={s.system.companyName} icon={<Globe size={13} />} />
                <EditablePathRow
                  label="Workspace"
                  value={s.system.workspace}
                  icon={<FolderOpen size={13} />}
                  onSave={async (newPath) => {
                    await postApi(apiUrl("/api/workspace"), { path: newPath });
                    refreshSettings();
                  }}
                />
                <ConfigRow label="CLI Enabled" value={s.system.cliEnabled} />
                <ConfigRow label="PM Proactive Loop" value={s.proactive.enabled} />
                {s.proactive.enabled && (
                  <ConfigRow label="Proactive Interval" value={`${s.proactive.intervalSecs}s`} />
                )}
                <ConfigRow label="Dashboard Port" value={s.system.dashboardPort} icon={<Hash size={13} />} />
                <ConfigRow label="Debounce Window" value={`${s.system.debounceMs}ms`} />
                <ConfigRow label="Context Window" value={`${(s.system.contextWindow / 1000).toFixed(0)}K tokens`} />
                <ConfigRow label="Compact Threshold" value={`${(s.system.compactThreshold * 100).toFixed(0)}%`} />
              </>
            ) : (
              <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>Loading...</div>
            )}
          </div>
        </div>

        {/* LLM Defaults */}
        <div>
          <SectionLabel title="LLM Defaults" />
          <div className="vec-card" style={{ padding: "4px 16px" }}>
            {s ? (
              <>
                <ConfigRow label="Provider" value={s.llm.provider} icon={<Cpu size={13} />} />
                <ConfigRow label="Model" value={s.llm.model} icon={<Box size={13} />} />
                <ConfigRow label="Thinking Level" value={s.llm.thinkingLevel} />
                <ConfigRow label="Temperature" value={s.llm.temperature} />
                <ConfigRow label="Max Tokens" value={s.llm.maxTokens.toLocaleString()} />
              </>
            ) : (
              <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>Loading...</div>
            )}
          </div>
          <div style={{
            fontSize: 11, color: "var(--text-muted)", marginTop: 8, paddingLeft: 2,
          }}>
            Environment defaults — overridden by model priority tiers when set.
          </div>
        </div>
      </div>
    );
  }

  function renderModels() {
    if (!modelData) {
      return <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>Loading...</div>;
    }

    const configured = modelData.providers.filter(p => p.configured);
    const unconfigured = modelData.providers.filter(p => !p.configured);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Provider stats */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Providers Ready", value: String(configured.length), color: "var(--green)" },
            { label: "Total Models", value: String(modelData.providers.reduce((a, p) => a + p.models.length, 0)), color: "var(--blue)" },
            { label: "Priority Tiers Set", value: String([modelData.config.primary, modelData.config.secondary, modelData.config.fallback].filter(Boolean).length) + "/3", color: "var(--purple)" },
            { label: "Agent Overrides", value: String(Object.keys(modelData.config.agentModels).length), color: "var(--orange)" },
          ].map((stat) => (
            <div key={stat.label} style={{
              flex: "1 1 120px", padding: "14px 16px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Configured providers */}
        <div>
          <SectionLabel title="Configured Providers" count={configured.length} />
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 8,
          }}>
            {configured.map((p) => (
              <ProviderCard key={p.id} provider={p}
                onClick={() => { setEditingProvider(p.id); setKeyInput(""); }}
              />
            ))}
          </div>
        </div>

        {/* Unconfigured providers */}
        {unconfigured.length > 0 && (
          <div>
            <SectionLabel title="Available Providers" count={unconfigured.length} />
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 8,
            }}>
              {unconfigured.map((p) => (
                <ProviderCard key={p.id} provider={p}
                  onClick={() => { setEditingProvider(p.id); setKeyInput(""); }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Priority tiers */}
        <div>
          <SectionLabel title="Model Priority" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(["primary", "secondary", "fallback"] as const).map((tier) => {
              const slot = modelData.config[tier];
              const tierColors = {
                primary: "var(--accent)",
                secondary: "var(--yellow)",
                fallback: "var(--text-muted)",
              };
              const tierIcons = {
                primary: <Star size={14} />,
                secondary: <Cpu size={14} />,
                fallback: <Shield size={14} />,
              };
              const provs = modelData.providers.filter((p) => p.configured);
              return (
                <ModelTierRow
                  key={tier}
                  tier={tier}
                  slot={slot}
                  color={tierColors[tier]}
                  icon={tierIcons[tier]}
                  providers={provs}
                  onSave={(s) => saveModelTier(tier, s)}
                  saving={modelSaving}
                />
              );
            })}
          </div>
        </div>

        {/* Per-agent overrides */}
        {Object.keys(modelData.config.agentModels).length > 0 && (
          <div>
            <SectionLabel title="Agent Overrides" count={Object.keys(modelData.config.agentModels).length} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(modelData.config.agentModels).map(([agentId, s]) => (
                <span key={agentId} style={{
                  fontSize: 12, padding: "6px 12px", borderRadius: 7,
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  color: "var(--text-secondary)", fontFamily: "monospace",
                }}>
                  @{agentId} &rarr; {s.provider}/{s.model.split("/").pop()}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, paddingLeft: 2 }}>
              Per-agent models can be configured from the Directory view.
            </div>
          </div>
        )}
      </div>
    );
  }

  function openChannelEdit(ch: "telegram" | "slack" | "discord") {
    setEditingChannel(ch);
    setChFields({});
    setChTestResult(null);
  }

  function closeChannelEdit() {
    setEditingChannel(null);
    setChFields({});
    setChTestResult(null);
  }

  async function testChannel() {
    if (!editingChannel) return;
    setChTesting(true);
    setChTestResult(null);
    try {
      const body: Record<string, string> = { channel: editingChannel };
      body.botToken = chFields.botToken ?? "";
      if (editingChannel === "slack") {
        body.appToken = chFields.appToken ?? "";
      }
      const res = await postApi("/api/channel-test", body);
      setChTestResult(res.ok
        ? { ok: true, msg: `Connected as "${res.botName}"` }
        : { ok: false, msg: res.error ?? "Test failed" });
    } catch {
      setChTestResult({ ok: false, msg: "Connection failed" });
    } finally {
      setChTesting(false);
    }
  }

  async function saveChannel() {
    if (!editingChannel) return;
    setChSaving(true);
    try {
      const body: Record<string, string> = { channel: editingChannel };
      body.botToken = chFields.botToken ?? "";
      if (editingChannel === "telegram") {
        body.chatId = chFields.chatId ?? "";
      } else if (editingChannel === "slack") {
        body.appToken = chFields.appToken ?? "";
        body.channelId = chFields.channelId ?? "";
      } else {
        body.channelId = chFields.channelId ?? "";
      }
      const res = await postApi("/api/channel-config", body);
      if (res.ok) {
        // Auto-restart after save
        await postApi("/api/channel-restart", { channel: editingChannel });
        await fetchChannels();
        closeChannelEdit();
        const labels: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
        showToast(`${labels[editingChannel] ?? editingChannel} connected`);
      } else {
        showToast(res.error ?? "Save failed");
      }
    } catch {
      showToast("Save failed");
    } finally {
      setChSaving(false);
    }
  }

  async function disconnectChannel(ch: "telegram" | "slack" | "discord") {
    try {
      const labels: Record<string, string> = { telegram: "Telegram", slack: "Slack", discord: "Discord" };
      await postApi("/api/channel-disconnect", { channel: ch });
      await fetchChannels();
      showToast(`${labels[ch] ?? ch} disconnected`);
    } catch {
      showToast("Disconnect failed");
    }
  }

  function renderChannelEditCard(
    ch: "telegram" | "slack" | "discord",
    info: ChannelInfo | undefined,
    label: string,
    logoUrl: string,
    fallbackIcon: React.ReactNode,
    color: string,
  ) {
    const isEditing = editingChannel === ch;
    const configured = info?.configured ?? false;
    const connected = info?.connected ?? false;

    return (
      <div style={{
        padding: "18px 20px", borderRadius: 12,
        background: "var(--bg-card)", border: `1px solid ${isEditing ? color : "var(--border)"}`,
        transition: "border-color 0.15s",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: isEditing ? 16 : 0 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10,
            background: configured ? `color-mix(in srgb, ${color} 10%, transparent)` : "var(--bg-tertiary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: configured ? color : "var(--text-muted)", flexShrink: 0,
          }}>
            <LogoIcon src={logoUrl} fallback={fallbackIcon} size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
            {configured && !isEditing && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {ch === "telegram" ? `Chat ID: ${info?.chatId ?? ""}` : `Channel: ${info?.channelId ?? ""}`}

              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Status dot */}
            {configured && (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: connected ? "var(--green)" : "var(--red)",
                  boxShadow: connected ? "0 0 6px var(--green)" : "none",
                }} />
                <span style={{ fontSize: 10, fontWeight: 500, color: connected ? "var(--green)" : "var(--red)" }}>
                  {connected ? "Online" : "Offline"}
                </span>
              </div>
            )}
            {/* Status badge */}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
              background: configured
                ? "color-mix(in srgb, var(--green) 10%, transparent)"
                : "var(--bg-tertiary)",
              color: configured ? "var(--green)" : "var(--text-muted)",
              border: `1px solid ${configured ? "color-mix(in srgb, var(--green) 18%, transparent)" : "var(--border)"}`,
              flexShrink: 0, letterSpacing: "0.04em",
            }}>
              {configured ? "CONFIGURED" : "NOT SET"}
            </span>
          </div>
        </div>

        {/* Action buttons (when not editing) */}
        {!isEditing && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => openChannelEdit(ch)}
              style={{
                padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                border: "1px solid var(--border)", background: "var(--bg-hover)",
                color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {configured ? "Update" : "Configure"}
            </button>
            {configured && (
              <button
                onClick={() => disconnectChannel(ch)}
                style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid color-mix(in srgb, var(--red) 30%, transparent)",
                  background: "color-mix(in srgb, var(--red) 8%, transparent)",
                  color: "var(--red)", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        )}

        {/* Edit form */}
        {isEditing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ch === "telegram" ? (
              <>
                <CredentialField
                  label="Bot Token"
                  placeholder="Paste your bot token from @BotFather"
                  value={chFields.botToken ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, botToken: v }))}
                />
                <CredentialField
                  label="Chat ID"
                  placeholder="Your authorized chat ID"
                  value={chFields.chatId ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, chatId: v }))}
                  isSecret={false}
                />
              </>
            ) : ch === "slack" ? (
              <>
                <CredentialField
                  label="Bot Token"
                  placeholder="xoxb-..."
                  value={chFields.botToken ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, botToken: v }))}
                />
                <CredentialField
                  label="App Token"
                  placeholder="xapp-..."
                  value={chFields.appToken ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, appToken: v }))}
                />
                <CredentialField
                  label="Channel ID"
                  placeholder="C0123456789"
                  value={chFields.channelId ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, channelId: v }))}
                  isSecret={false}
                />
              </>
            ) : (
              <>
                <CredentialField
                  label="Bot Token"
                  placeholder="Paste your bot token from Discord Developer Portal"
                  value={chFields.botToken ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, botToken: v }))}
                />
                <CredentialField
                  label="Channel ID"
                  placeholder="Right-click channel → Copy Channel ID"
                  value={chFields.channelId ?? ""}
                  onChange={(v) => setChFields(f => ({ ...f, channelId: v }))}
                  isSecret={false}
                />
              </>
            )}

            {/* Test result */}
            {chTestResult && (
              <div style={{
                padding: "8px 12px", borderRadius: 8, fontSize: 12,
                background: chTestResult.ok
                  ? "color-mix(in srgb, var(--green) 8%, transparent)"
                  : "color-mix(in srgb, var(--red) 8%, transparent)",
                color: chTestResult.ok ? "var(--green)" : "var(--red)",
                border: `1px solid ${chTestResult.ok
                  ? "color-mix(in srgb, var(--green) 20%, transparent)"
                  : "color-mix(in srgb, var(--red) 20%, transparent)"}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {chTestResult.ok ? <Check size={14} /> : <X size={14} />}
                {chTestResult.msg}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                onClick={testChannel}
                disabled={chTesting || !(chFields.botToken)}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid var(--border)", background: "var(--bg-hover)",
                  color: "var(--text-primary)", cursor: chTesting ? "wait" : "pointer",
                  fontFamily: "inherit", opacity: chTesting || !chFields.botToken ? 0.5 : 1,
                }}
              >
                {chTesting ? "Testing..." : "Test Connection"}
              </button>
              <button
                onClick={saveChannel}
                disabled={chSaving || !(chFields.botToken)}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: "none", background: color, color: "#fff",
                  cursor: chSaving ? "wait" : "pointer", fontFamily: "inherit",
                  opacity: chSaving || !chFields.botToken ? 0.5 : 1,
                }}
              >
                {chSaving ? "Saving..." : "Save & Connect"}
              </button>
              <button
                onClick={closeChannelEdit}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid var(--border)", background: "transparent",
                  color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderChannels() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Stats */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{
            flex: "1 1 140px", padding: "14px 16px",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--blue)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {channelCount}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Active Channels</div>
          </div>
          <div style={{
            flex: "1 1 140px", padding: "14px 16px",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-muted)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {3 - channelCount}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Not Configured</div>
          </div>
        </div>

        {/* Channel cards */}
        <div>
          <SectionLabel title="Communication Channels" />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {renderChannelEditCard("telegram", channelCfg?.telegram, "Telegram", "/icons/integrations/telegram.svg", <MessageSquare size={18} />, "var(--blue)")}
            {renderChannelEditCard("slack", channelCfg?.slack, "Slack", "/icons/integrations/slack.svg", <Hash size={18} />, "var(--purple)")}
            {renderChannelEditCard("discord", channelCfg?.discord, "Discord", "/icons/integrations/discord.svg", <Gamepad2 size={18} />, "#5865F2")}
          </div>
        </div>
      </div>
    );
  }

  function openIntegEdit(key: string) {
    if (!integ) return;
    if (editingInteg === key) { setEditingInteg(null); return; }
    const defaults: Record<string, Record<string, string>> = {
      searxng: { url: integ.searxng.url },
      sonarqube: { hostUrl: integ.sonarqube.hostUrl, token: "", projectBaseKey: integ.sonarqube.projectBaseKey, scannerImage: integ.sonarqube.scannerImage },
      gitleaks: { image: integ.gitleaks.image },
      semgrep: { image: integ.semgrep.image },
      trivy: { image: integ.trivy.image },
    };
    setIntegFields(defaults[key] ?? {});
    setEditingInteg(key);
  }

  function renderIntegEditCard(
    key: string,
    name: string,
    logoUrl: string,
    fallbackIcon: React.ReactNode,
    color: string,
    subtitle: string,
    configured: boolean,
    enabled: boolean,
    detail: string,
  ) {
    const isEditing = editingInteg === key;
    const isActive = configured && enabled;
    const f = integFields;
    const setF = (k: string, v: string) => setIntegFields(prev => ({ ...prev, [k]: v }));

    const defaultImages: Record<string, string> = { gitleaks: "zricethezav/gitleaks:latest", semgrep: "semgrep/semgrep", trivy: "aquasec/trivy:latest" };

    return (
      <div style={{
        padding: "18px 20px", borderRadius: 12,
        background: "var(--bg-card)", border: `1px solid ${isEditing ? color : "var(--border)"}`,
        transition: "border-color 0.15s",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: isEditing ? 16 : 0 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10,
            background: isActive ? `color-mix(in srgb, ${color} 10%, transparent)` : "var(--bg-tertiary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: isActive ? color : "var(--text-muted)", flexShrink: 0,
          }}>
            <LogoIcon src={logoUrl} fallback={fallbackIcon} size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{name}</span>
              <span style={{
                fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                background: `color-mix(in srgb, ${color} 10%, transparent)`,
                color, letterSpacing: "0.04em",
              }}>
                {subtitle}
              </span>
            </div>
            {!isEditing && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {detail}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Enabled/Disabled badge */}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
              background: isActive
                ? "color-mix(in srgb, var(--green) 10%, transparent)"
                : "var(--bg-tertiary)",
              color: isActive ? "var(--green)" : "var(--text-muted)",
              border: `1px solid ${isActive ? "color-mix(in srgb, var(--green) 18%, transparent)" : "var(--border)"}`,
              flexShrink: 0, letterSpacing: "0.04em", cursor: "pointer",
            }} onClick={(e) => { e.stopPropagation(); toggleIntegration(key, enabled); }}>
              {enabled ? "ENABLED" : "DISABLED"}
            </span>
          </div>
        </div>

        {/* Action buttons (when not editing) */}
        {!isEditing && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => openIntegEdit(key)}
              style={{
                padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                border: "1px solid var(--border)", background: "var(--bg-hover)",
                color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Configure
            </button>
            {enabled && (
              <button
                onClick={() => toggleIntegration(key, true)}
                style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid color-mix(in srgb, var(--red) 30%, transparent)",
                  background: "color-mix(in srgb, var(--red) 8%, transparent)",
                  color: "var(--red)", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Disable
              </button>
            )}
            {!enabled && (
              <button
                onClick={() => toggleIntegration(key, false)}
                style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid color-mix(in srgb, var(--green) 30%, transparent)",
                  background: "color-mix(in srgb, var(--green) 8%, transparent)",
                  color: "var(--green)", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Enable
              </button>
            )}
          </div>
        )}

        {/* Edit form */}
        {isEditing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {key === "searxng" && (
              <CredentialField label="SearXNG URL" placeholder="http://localhost:8080" value={f.url ?? ""} onChange={(v) => setF("url", v)} isSecret={false} />
            )}
            {key === "sonarqube" && (
              <>
                <CredentialField label="Host URL" placeholder="http://localhost:9000" value={f.hostUrl ?? ""} onChange={(v) => setF("hostUrl", v)} isSecret={false} />
                <CredentialField label="Token" placeholder="squ_..." value={f.token ?? ""} onChange={(v) => setF("token", v)} />
                <CredentialField label="Project Base Key" placeholder="vec" value={f.projectBaseKey ?? ""} onChange={(v) => setF("projectBaseKey", v)} isSecret={false} />
                <CredentialField label="Scanner Docker Image" placeholder="sonarsource/sonar-scanner-cli:latest" value={f.scannerImage ?? ""} onChange={(v) => setF("scannerImage", v)} isSecret={false} />
              </>
            )}
            {(key === "gitleaks" || key === "semgrep" || key === "trivy") && (
              <CredentialField label="Docker Image" placeholder={defaultImages[key] ?? ""} value={f.image ?? ""} onChange={(v) => setF("image", v)} isSecret={false} />
            )}

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setEditingInteg(null)}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid var(--border)", background: "var(--bg-hover)",
                  color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                disabled={integSaving}
                onClick={() => {
                  if (key === "searxng") saveIntegration("searxng", { url: f.url || "", enabled: true });
                  else if (key === "sonarqube") saveIntegration("sonarqube", {
                    hostUrl: f.hostUrl || "http://localhost:9000", token: f.token || "",
                    projectBaseKey: f.projectBaseKey || "vec",
                    scannerImage: f.scannerImage || "sonarsource/sonar-scanner-cli:latest", enabled: true,
                  });
                  else saveIntegration(key, { image: f.image || defaultImages[key] || "", enabled: true });
                }}
                style={{
                  padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: "none", background: color, color: "#fff",
                  cursor: integSaving ? "wait" : "pointer", fontFamily: "inherit",
                  opacity: integSaving ? 0.5 : 1,
                }}
              >
                {integSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderIntegrations() {
    const ICON_BASE = "/icons/integrations";

    type IntegItem = { key: string; name: string; logoUrl: string; fallbackIcon: React.ReactNode; configured: boolean; enabled: boolean; detail: string; color: string; subtitle: string };

    const categories: { title: string; color: string; items: IntegItem[] }[] = [
      {
        title: "Search",
        color: "var(--green)",
        items: [
          {
            key: "searxng", name: "SearXNG", logoUrl: `${ICON_BASE}/searxng.svg`, fallbackIcon: <Search size={16} />,
            configured: integ?.searxng.configured ?? false, enabled: integ?.searxng.enabled ?? false,
            detail: integ?.searxng.configured ? integ.searxng.url : "Not configured",
            color: "var(--green)", subtitle: "WEB SEARCH",
          },
        ],
      },
      {
        title: "Code Quality",
        color: "var(--blue)",
        items: [
          {
            key: "sonarqube", name: "SonarQube", logoUrl: `${ICON_BASE}/sonarqube.svg`, fallbackIcon: <Eye size={16} />,
            configured: integ?.sonarqube.configured ?? false, enabled: integ?.sonarqube.enabled ?? false,
            detail: integ?.sonarqube.configured ? `${integ.sonarqube.hostUrl} (${integ.sonarqube.projectBaseKey})` : "Not configured",
            color: "var(--blue)", subtitle: "ANALYSIS",
          },
        ],
      },
      {
        title: "Security Scanners",
        color: "var(--red)",
        items: [
          {
            key: "gitleaks", name: "Gitleaks", logoUrl: `${ICON_BASE}/gitleaks.svg`, fallbackIcon: <Shield size={16} />,
            configured: true, enabled: integ?.gitleaks.enabled ?? true,
            detail: `Image: ${integ?.gitleaks.image ?? "zricethezav/gitleaks:latest"}`,
            color: "var(--red)", subtitle: "SECRETS",
          },
          {
            key: "semgrep", name: "Semgrep", logoUrl: `${ICON_BASE}/semgrep.svg`, fallbackIcon: <Shield size={16} />,
            configured: true, enabled: integ?.semgrep.enabled ?? true,
            detail: `Image: ${integ?.semgrep.image ?? "semgrep/semgrep"}`,
            color: "var(--orange)", subtitle: "SAST",
          },
          {
            key: "trivy", name: "Trivy", logoUrl: `${ICON_BASE}/trivy.svg`, fallbackIcon: <Database size={16} />,
            configured: true, enabled: integ?.trivy.enabled ?? true,
            detail: `Image: ${integ?.trivy.image ?? "aquasec/trivy:latest"}`,
            color: "var(--purple)", subtitle: "SCA",
          },
        ],
      },
    ];

    const allItems = categories.flatMap(c => c.items);
    const activeCount = allItems.filter(i => i.configured && i.enabled).length;
    const postScans = integ?.postTaskScansEnabled ?? false;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Docker status banner */}
        {dockerStatus && !dockerStatus.running && (
          <div style={{
            padding: "14px 18px", borderRadius: 10,
            background: !dockerStatus.installed ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
            border: `1px solid ${!dockerStatus.installed ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: !dockerStatus.installed ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={!dockerStatus.installed ? "var(--red)" : "var(--orange)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                {!dockerStatus.installed ? "Docker Not Installed" : "Docker Not Running"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {!dockerStatus.installed
                  ? "Security scanners (Gitleaks, Semgrep, Trivy, SonarQube) require Docker to run."
                  : "Docker is installed but the daemon isn't running. Start Docker to use scanners."}
              </div>
            </div>
            {!dockerStatus.installed && (
              <a
                href="https://docs.docker.com/get-docker/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: "var(--accent)", color: "#fff", textDecoration: "none",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                Get Docker
              </a>
            )}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Active", value: String(activeCount), color: "var(--green)" },
            { label: "Total", value: String(allItems.length), color: "var(--orange)" },
          ].map((stat) => (
            <div key={stat.label} style={{
              flex: "1 1 120px", padding: "14px 16px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{stat.label}</div>
            </div>
          ))}
          {/* Post-task scans toggle card */}
          <div
            onClick={async () => {
              setIntegSaving(true);
              try {
                const res = await postApi("/api/integration-config", { postTaskScansEnabled: !postScans });
                if (res?.ok) { setIntegCfg(res.config); showToast(`Post-task scans ${!postScans ? "enabled" : "disabled"}`); }
              } catch { showToast("Toggle failed"); }
              finally { setIntegSaving(false); }
            }}
            style={{
              flex: "1 1 120px", padding: "14px 16px",
              background: "var(--bg-card)",
              border: `1px solid ${postScans ? "color-mix(in srgb, var(--green) 25%, transparent)" : "var(--border)"}`,
              borderRadius: 8, cursor: "pointer", transition: "border-color 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: postScans ? "var(--green)" : "var(--text-muted)", lineHeight: 1 }}>
                {postScans ? "ON" : "OFF"}
              </div>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: postScans ? "var(--green)" : "var(--text-muted)",
                boxShadow: postScans ? "0 0 6px var(--green)" : "none",
                opacity: postScans ? 1 : 0.4,
              }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Post-Task Scans</div>
          </div>
        </div>

        {/* Categorized integrations */}
        {categories.map((cat) => (
          <div key={cat.title}>
            <SectionLabel title={cat.title} count={cat.items.length} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
              {cat.items.map((item) => (
                <div key={item.key}>
                  {renderIntegEditCard(item.key, item.name, item.logoUrl, item.fallbackIcon, item.color, item.subtitle, item.configured, item.enabled, item.detail)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderMCP() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Stats */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { label: "Configured", value: String(serverNames.length), color: "var(--blue)" },
            { label: "Connected", value: String(connectedServers), color: "var(--green)" },
            { label: "Tools Available", value: String(mcpStatus.servers.reduce((a, s) => a + s.tools.length, 0)), color: "var(--purple)" },
            { label: "Directory", value: String(MCP_DIRECTORY.length), color: "var(--text-muted)" },
          ].map((stat) => (
            <div key={stat.label} style={{
              flex: "1 1 100px", padding: "14px 16px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Action bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ flex: 1 }} />
          <button onClick={fetchMCP} style={btnSecondary} title="Refresh status">
            <RefreshCw size={12} /> Refresh
          </button>
          {dirty && (
            <button onClick={saveConfig} disabled={saving} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 14px", borderRadius: 7, border: "none",
              background: "var(--accent)", color: "#fff",
              cursor: saving ? "wait" : "pointer", fontSize: 11,
              fontWeight: 600, fontFamily: "inherit",
              opacity: saving ? 0.7 : 1, transition: "opacity 0.12s",
            }}>
              <Save size={11} /> {saving ? "Saving..." : "Save Changes"}
            </button>
          )}
        </div>

        {/* Server Directory + Custom Servers */}
        <MCPDirectoryPanel
          activeServerNames={serverNames}
          mcpConfig={mcpConfig}
          mcpStatus={mcpStatus}
          onAdd={(entry, envOverrides) => {
            const env: Record<string, string> = {};
            for (const k of Object.keys(entry.envVars)) {
              env[k] = envOverrides?.[k] ?? "";
            }
            setMcpConfig(prev => {
              const next = deepClone(prev);
              next.mcpServers[entry.id] = {
                command: entry.command,
                args: [...entry.args],
                env,
              };
              return next;
            });
            setDirty(true);
            showToast(`Added "${entry.name}" — click Save to apply`);
          }}
          onRemove={(name) => { removeServer(name); }}
          onAddCustom={(name, srv) => {
            setMcpConfig(prev => {
              const next = deepClone(prev);
              next.mcpServers[name] = srv;
              return next;
            });
            setExpanded(prev => ({ ...prev, [name]: true }));
            setDirty(true);
            showToast(`Added "${name}" — click Save to apply`);
          }}
          onUpdateCustom={(name, patch) => { updateServer(name, patch); }}
          onRemoveCustomEnv={(serverName, key) => { removeEnvVar(serverName, key); }}
          onAddCustomEnv={(name) => { addEnvVar(name); }}
          expanded={expanded}
          onToggleExpand={(name) => { setExpanded(p => ({ ...p, [name]: !p[name] })); }}
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const sectionRenderers: Record<SettingsSection, () => React.ReactNode> = {
    general: renderGeneral,
    models: renderModels,
    channels: renderChannels,
    integrations: renderIntegrations,
    mcp: renderMCP,
  };

  const sectionBadges: Record<SettingsSection, string | null> = {
    general: null,
    models: configuredProviders > 0 ? String(configuredProviders) : null,
    channels: channelCount > 0 ? String(channelCount) : null,
    integrations: integCount > 0 ? String(integCount) : null,
    mcp: serverNames.length > 0 ? String(serverNames.length) : null,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div className="page-header" style={{ padding: "24px 28px 16px" }}>
        <h1 className="page-title">Settings</h1>
        <div className="page-subtitle">
          System configuration, integrations &amp; MCP servers
        </div>
      </div>

      {/* Sidebar + Content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Sidebar */}
        <div style={{
          width: 190, flexShrink: 0, padding: "12px 12px 20px",
          borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 2,
          overflow: "auto",
        }}>
          {SECTION_NAV.map((item) => {
            const isActive = activeSection === item.key;
            const badge = sectionBadges[item.key];
            return (
              <button
                key={item.key}
                data-tour-id={`settings-${item.key}`}
                onClick={() => setActiveSection(item.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 7,
                  border: "none",
                  background: isActive ? "var(--bg-hover)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 13, fontWeight: isActive ? 500 : 400,
                  cursor: "pointer", fontFamily: "inherit",
                  textAlign: "left", width: "100%",
                  transition: "background 0.08s, color 0.08s",
                }}
              >
                <span style={{ color: isActive ? item.color : "var(--text-muted)", display: "flex", transition: "color 0.08s" }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                    background: isActive ? `color-mix(in srgb, ${item.color} 12%, transparent)` : "var(--bg-tertiary)",
                    color: isActive ? item.color : "var(--text-muted)",
                    fontVariantNumeric: "tabular-nums",
                    transition: "background 0.08s, color 0.08s",
                  }}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 28px" }}>
          {sectionRenderers[activeSection]()}
        </div>
      </div>

      {/* API Key Modal */}
      {editingProvider && modelData && (() => {
        const provider = modelData.providers.find(p => p.id === editingProvider);
        if (!provider) return null;
        return (
          <APIKeyModal
            provider={provider}
            onClose={() => { setEditingProvider(null); setKeyInput(""); }}
            onSave={(key) => saveProviderKey(provider.id, key)}
            saving={keySaving}
          />
        );
      })()}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 24, right: 24,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "10px 18px",
          fontSize: 13, color: "var(--text-primary)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 9999, animation: "fade-in 0.12s ease-out",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Provider Card (simplified — opens modal on click) ───────────────────────

function ProviderCard({ provider: p, onClick }: {
  provider: ProviderInfo;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 14px", borderRadius: 10, width: "100%",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        transition: "border-color 0.12s, background 0.12s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-card)"; }}
    >
      <img
        src={p.iconUrl}
        alt={p.name}
        style={{
          width: 28, height: 28, flexShrink: 0, borderRadius: 6,
          filter: "var(--icon-filter, none)",
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {p.name}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>
          {p.models.length} model{p.models.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: p.configured ? "var(--green)" : "var(--text-muted)",
        opacity: p.configured ? 1 : 0.3,
      }} />
    </button>
  );
}

// ── API Key Modal ───────────────────────────────────────────────────────────

function APIKeyModal({ provider, onClose, onSave, saving }: {
  provider: ProviderInfo;
  onClose: () => void;
  onSave: (key: string) => void;
  saving: boolean;
}) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      />
      {/* Modal */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)", zIndex: 101,
        background: "var(--bg-secondary)", border: "1px solid var(--border)",
        borderRadius: 16, width: 440, maxWidth: "92vw",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px var(--border)",
        overflow: "hidden", animation: "fade-in 0.12s ease-out",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "18px 22px 14px",
          borderBottom: "1px solid var(--border)",
        }}>
          <img
            src={provider.iconUrl}
            alt={provider.name}
            style={{
              width: 34, height: 34, borderRadius: 8,
              filter: "var(--icon-filter, none)",
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
              {provider.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
              {provider.configured ? "Update API key" : "Configure API key"}
            </div>
          </div>
          <button onClick={onClose} style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 8,
            background: "var(--bg-tertiary)", color: "var(--text-muted)",
            cursor: "pointer", padding: 0, transition: "all 0.12s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Provider info */}
          <div style={{
            display: "flex", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{
              flex: "1 1 100px", padding: "10px 14px", borderRadius: 8,
              background: "var(--bg-card)", border: "1px solid var(--border)",
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--purple)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {provider.models.length}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>Models</div>
            </div>
            <div style={{
              flex: "1 1 100px", padding: "10px 14px", borderRadius: 8,
              background: "var(--bg-card)", border: "1px solid var(--border)",
            }}>
              <div style={{
                fontSize: 12, fontWeight: 600, lineHeight: 1.2,
                color: provider.configured ? "var(--green)" : "var(--text-muted)",
              }}>
                {provider.configured ? "Active" : "Not Set"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>Status</div>
            </div>
          </div>

          {/* Model list */}
          {provider.models.length > 0 && (
            <div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6,
              }}>Available Models</div>
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 4,
                maxHeight: 80, overflowY: "auto",
              }}>
                {provider.models.map(m => (
                  <span key={m} style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 5,
                    background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                    fontFamily: "monospace", border: "1px solid var(--border)",
                  }}>{m.split("/").pop()}</span>
                ))}
              </div>
            </div>
          )}

          {/* Key input */}
          <div>
            <label style={{
              fontSize: 12, fontWeight: 500, color: "var(--text-secondary)",
              marginBottom: 6, display: "block",
            }}>
              API Key
              <span style={{ fontWeight: 400, marginLeft: 6, opacity: 0.6, fontFamily: "monospace", fontSize: 11 }}>
                {provider.envKey}
              </span>
            </label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder={`Paste your ${provider.name} API key...`}
                type={showKey ? "text" : "password"}
                autoFocus
                style={{
                  ...inputStyle, flex: 1, fontSize: 13, fontFamily: "monospace",
                  padding: "10px 12px",
                }}
                onKeyDown={e => e.key === "Enter" && key.trim() && onSave(key)}
              />
              <button
                onClick={() => setShowKey(s => !s)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                  color: showKey ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer", padding: 0, transition: "color 0.12s",
                }}
                title={showKey ? "Hide key" : "Show key"}
              >
                <Eye size={14} />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button onClick={onClose} style={{
              ...btnSecondary, padding: "8px 16px", fontSize: 12, borderRadius: 8,
            }}>Cancel</button>
            <button
              onClick={() => key.trim() && onSave(key)}
              disabled={!key.trim() || saving}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 20px", borderRadius: 8, border: "none",
                background: key.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                color: key.trim() ? "#fff" : "var(--text-muted)",
                fontSize: 12, fontWeight: 600,
                cursor: key.trim() ? "pointer" : "default",
                fontFamily: "inherit",
                opacity: saving ? 0.6 : 1, transition: "opacity 0.12s, background 0.12s",
              }}
            >
              <Save size={13} /> {saving ? "Saving..." : "Save Key"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── MCP Directory Panel ─────────────────────────────────────────────────────

const DIRECTORY_IDS = new Set(MCP_DIRECTORY.map(e => e.id));

/** Categories that have at least one entry in the directory */
const USED_CATEGORIES = Array.from(new Set(MCP_DIRECTORY.map(e => e.category)));

function MCPDirectoryPanel({ activeServerNames, mcpConfig, mcpStatus, onAdd, onRemove, onAddCustom, onUpdateCustom, onRemoveCustomEnv, onAddCustomEnv, expanded, onToggleExpand }: {
  activeServerNames: string[];
  mcpConfig: MCPConfig;
  mcpStatus: MCPStatus;
  onAdd: (entry: MCPDirectoryEntry, envOverrides?: Record<string, string>) => void;
  onRemove: (name: string) => void;
  onAddCustom: (name: string, srv: { command: string; args: string[]; env: Record<string, string> }) => void;
  onUpdateCustom: (name: string, patch: Partial<MCPServer>) => void;
  onRemoveCustomEnv: (serverName: string, key: string) => void;
  onAddCustomEnv: (name: string) => void;
  expanded: Record<string, boolean>;
  onToggleExpand: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<MCPCategory | "all">("all");
  const [showDirectory, setShowDirectory] = useState(false);
  const [setupEntry, setSetupEntry] = useState<MCPDirectoryEntry | null>(null);
  const [envInputs, setEnvInputs] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCmd, setCustomCmd] = useState("npx");
  const [customArgs, setCustomArgs] = useState("");
  const [customEnvKey, setCustomEnvKey] = useState("");
  const [customEnvVal, setCustomEnvVal] = useState("");
  const [customEnv, setCustomEnv] = useState<Record<string, string>>({});

  const customServerNames = activeServerNames.filter(n => !DIRECTORY_IDS.has(n));

  // Active directory servers (ones that are added)
  const activeDirectoryEntries = MCP_DIRECTORY.filter(e => activeServerNames.includes(e.id));

  const q = search.toLowerCase();
  const filtered = MCP_DIRECTORY.filter(e => {
    if (activeServerNames.includes(e.id)) return false; // hide already-added from browse
    if (catFilter !== "all" && e.category !== catFilter) return false;
    if (q && !e.name.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q)
      && !e.tools.some(t => t.toLowerCase().includes(q))) return false;
    return true;
  });

  // Category dropdown options
  const categoryOptions: DropdownOption[] = [
    { value: "all", label: "All Categories" },
    ...USED_CATEGORIES.map(c => ({
      value: c,
      label: CATEGORY_META[c].label,
    })),
  ];

  function handleAddClick(entry: MCPDirectoryEntry) {
    const hasEnv = Object.keys(entry.envVars).length > 0;
    if (hasEnv) {
      setSetupEntry(entry);
      const initial: Record<string, string> = {};
      for (const k of Object.keys(entry.envVars)) initial[k] = "";
      setEnvInputs(initial);
    } else {
      onAdd(entry);
    }
  }

  function confirmSetup() {
    if (!setupEntry) return;
    onAdd(setupEntry, envInputs);
    setSetupEntry(null);
    setEnvInputs({});
  }

  function handleAddCustom() {
    const name = customName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!name) return;
    if (activeServerNames.includes(name)) return;
    onAddCustom(name, {
      command: customCmd.trim(),
      args: customArgs.split("\n").map(s => s.trim()).filter(Boolean),
      env: { ...customEnv },
    });
    setShowCustom(false);
    setCustomName("");
    setCustomCmd("npx");
    setCustomArgs("");
    setCustomEnv({});
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Active Servers ── */}
      {(activeDirectoryEntries.length > 0 || customServerNames.length > 0) && (
        <div>
          <SectionLabel title="Active Servers" count={activeServerNames.length} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Directory-based active servers — compact row style */}
            {activeDirectoryEntries.map(entry => {
              const live = mcpStatus.servers.find(s => s.name === entry.id);
              const catMeta = CATEGORY_META[entry.category];
              return (
                <div key={entry.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 14px", borderRadius: 8,
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: live?.connected ? "var(--green)" : "var(--text-muted)",
                    opacity: live?.connected ? 1 : 0.35,
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
                    {entry.name}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                    background: `color-mix(in srgb, ${catMeta.color} 10%, transparent)`,
                    color: catMeta.color,
                  }}>{catMeta.label}</span>
                  {live?.connected && (
                    <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {live.tools.length} tool{live.tools.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <button
                    onClick={() => onRemove(entry.id)}
                    style={{
                      display: "flex", padding: 4, border: "none", borderRadius: 4,
                      background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                      transition: "color 0.08s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "var(--red)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
                    title="Remove"
                  ><Trash2 size={12} /></button>
                </div>
              );
            })}

            {/* Custom servers — collapsible */}
            {customServerNames.map(name => {
              const srv = mcpConfig.mcpServers[name];
              if (!srv) return null;
              const live = mcpStatus.servers.find(s => s.name === name);
              const isOpen = expanded[name] ?? false;
              return (
                <div key={name} style={{
                  borderRadius: 8, overflow: "hidden",
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                }}>
                  <div
                    onClick={() => onToggleExpand(name)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", cursor: "pointer",
                      borderBottom: isOpen ? "1px solid var(--border)" : "none",
                    }}
                  >
                    {isOpen ? <ChevronDown size={12} style={{ color: "var(--text-muted)" }} />
                      : <ChevronRight size={12} style={{ color: "var(--text-muted)" }} />}
                    <div style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: live?.connected ? "var(--green)" : "var(--text-muted)",
                      opacity: live?.connected ? 1 : 0.35,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{name}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                      background: "var(--bg-tertiary)", color: "var(--text-muted)",
                    }}>CUSTOM</span>
                    {live?.connected && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {live.tools.length} tool{live.tools.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(name); }}
                      title="Remove"
                      style={{
                        display: "flex", padding: 4, border: "none", borderRadius: 4,
                        background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                        transition: "color 0.08s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--red)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
                    ><Trash2 size={12} /></button>
                  </div>
                  {isOpen && (
                    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                      <Field label="Command" hint="e.g. npx, node, python">
                        <input value={srv.command} onChange={e => onUpdateCustom(name, { command: e.target.value })} placeholder="npx" style={inputStyle} />
                      </Field>
                      <Field label="Arguments" hint="One per line">
                        <textarea
                          value={(srv.args ?? []).join("\n")}
                          onChange={e => onUpdateCustom(name, { args: e.target.value.split("\n") })}
                          placeholder={"-y\n@your/mcp-package\n--flag"}
                          rows={3}
                          style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}
                        />
                      </Field>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <label style={labelStyle}>Environment Variables</label>
                          <button onClick={() => onAddCustomEnv(name)} style={btnSecondary}><Plus size={12} /> Add</button>
                        </div>
                        {Object.keys(srv.env ?? {}).length === 0 ? (
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>No environment variables</div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {Object.entries(srv.env ?? {}).map(([k, v]) => (
                              <div key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-secondary)", minWidth: 100, flexShrink: 0 }}>{k}</span>
                                <input value={v} onChange={e => onUpdateCustom(name, { env: { ...srv.env, [k]: e.target.value } })} placeholder="value" style={{ ...inputStyle, flex: 1 }} />
                                <button onClick={() => onRemoveCustomEnv(name, k)} style={{
                                  display: "flex", padding: 4, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", borderRadius: 4,
                                  transition: "color 0.08s",
                                }} onMouseEnter={e => { e.currentTarget.style.color = "var(--red)"; }} onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}>
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {live?.connected && live.tools.length > 0 && (
                        <div>
                          <label style={labelStyle}>Discovered Tools</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                            {live.tools.map(t => (
                              <span key={t} style={{
                                fontSize: 11, padding: "2px 8px", borderRadius: 4,
                                background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                                fontFamily: "monospace",
                              }}>{t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Browse Directory (collapsible) ── */}
      <div>
        <button
          onClick={() => setShowDirectory(d => !d)}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            padding: "10px 14px", borderRadius: 8,
            border: "1px solid var(--border)",
            background: showDirectory ? "var(--bg-card)" : "transparent",
            color: "var(--text-primary)", cursor: "pointer",
            fontSize: 13, fontWeight: 500, fontFamily: "inherit",
            transition: "background 0.1s, border-color 0.1s",
          }}
        >
          {showDirectory ? <ChevronDown size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
          <Package size={14} style={{ color: "var(--green)" }} />
          <span style={{ flex: 1, textAlign: "left" }}>Browse Server Directory</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
            background: "var(--bg-tertiary)", color: "var(--text-muted)",
            fontVariantNumeric: "tabular-nums",
          }}>{MCP_DIRECTORY.length} available</span>
        </button>

        {showDirectory && (
          <div style={{ marginTop: 10, animation: "fade-in 0.12s ease-out" }}>
            {/* Search + Category — single compact row */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
                <Search size={13} style={{
                  position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                  color: "var(--text-muted)", pointerEvents: "none",
                }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search servers..."
                  style={{ ...inputStyle, paddingLeft: 30 }}
                />
              </div>
              <div style={{ width: 160, flexShrink: 0 }}>
                <Dropdown
                  value={catFilter}
                  onChange={v => setCatFilter(v as MCPCategory | "all")}
                  options={categoryOptions}
                  placeholder="Category"
                  alignRight
                />
              </div>
            </div>

            {/* Setup panel (env var input for a server being added) */}
            {setupEntry && (
              <div style={{
                background: "var(--bg-card)", border: "1px solid var(--accent)",
                borderRadius: 8, padding: 14, marginBottom: 12,
                animation: "fade-in 0.12s ease-out",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <Package size={14} style={{ color: "var(--accent)" }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                      {setupEntry.name}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                      Set environment variables
                    </span>
                  </div>
                  <button onClick={() => { setSetupEntry(null); setEnvInputs({}); }} style={{
                    display: "flex", padding: 4, border: "none", borderRadius: 4,
                    background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                  }}>
                    <X size={14} />
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(setupEntry.envVars).map(([varName, hint]) => (
                    <div key={varName} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)",
                        minWidth: 130, flexShrink: 0,
                      }}>{varName}</span>
                      <input
                        value={envInputs[varName] ?? ""}
                        onChange={e => setEnvInputs(p => ({ ...p, [varName]: e.target.value }))}
                        placeholder={hint}
                        type="password"
                        style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }}
                        onKeyDown={e => e.key === "Enter" && confirmSetup()}
                      />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => { setSetupEntry(null); setEnvInputs({}); }} style={btnSecondary}>Cancel</button>
                  <button onClick={confirmSetup} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "6px 14px", borderRadius: 7, border: "none",
                    background: "var(--accent)", color: "#fff",
                    cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                  }}>
                    <Plus size={12} /> Add
                  </button>
                </div>
              </div>
            )}

            {/* Directory grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 8,
            }}>
              {filtered.map(entry => {
                const catMeta = CATEGORY_META[entry.category];
                return (
                  <div key={entry.id} style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: "12px 14px", borderRadius: 8,
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                    transition: "border-color 0.12s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.name}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
                        background: `color-mix(in srgb, ${catMeta.color} 10%, transparent)`,
                        color: catMeta.color, flexShrink: 0,
                      }}>{catMeta.label}</span>
                    </div>

                    <div style={{
                      fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}>{entry.description}</div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
                      <span style={{
                        fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace",
                        flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{entry.tools.slice(0, 3).join(", ")}{entry.tools.length > 3 ? ` +${entry.tools.length - 3}` : ""}</span>
                      {Object.keys(entry.envVars).length > 0 && (
                        <span style={{
                          fontSize: 9, padding: "2px 5px", borderRadius: 3,
                          background: "var(--yellow-bg)", color: "var(--yellow)", flexShrink: 0,
                        }}>KEY</span>
                      )}
                      {entry.docsUrl && (
                        <a href={entry.docsUrl} target="_blank" rel="noopener noreferrer"
                          style={{ display: "flex", padding: 3, borderRadius: 4, color: "var(--text-muted)", flexShrink: 0 }}
                          title="Docs"
                        ><ExternalLink size={11} /></a>
                      )}
                      <button
                        onClick={() => handleAddClick(entry)}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: "4px 10px", borderRadius: 5, border: "none",
                          background: "var(--accent)", color: "#fff",
                          cursor: "pointer", fontSize: 10, fontWeight: 600,
                          fontFamily: "inherit", flexShrink: 0,
                        }}
                      ><Plus size={10} /> Add</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 12 }}>
                No servers match your search.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add Custom Server ── */}
      {!showCustom ? (
        <button
          onClick={() => setShowCustom(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%",
            padding: "10px 14px", borderRadius: 8,
            border: "1px dashed var(--border)", background: "transparent",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
            transition: "border-color 0.12s, color 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        ><Plus size={14} /> Add Custom Server</button>
      ) : (
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--accent)",
          borderRadius: 8, padding: 14,
          animation: "fade-in 0.12s ease-out",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Server size={14} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>Custom Server</span>
            <button onClick={() => setShowCustom(false)} style={{
              display: "flex", padding: 4, border: "none", borderRadius: 4,
              background: "transparent", color: "var(--text-muted)", cursor: "pointer",
            }}><X size={14} /></button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Field label="Name" hint="e.g. my-server">
                  <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="my-custom-server" style={inputStyle} />
                </Field>
              </div>
              <div style={{ flex: 1 }}>
                <Field label="Command" hint="e.g. npx, node">
                  <input value={customCmd} onChange={e => setCustomCmd(e.target.value)} placeholder="npx" style={inputStyle} />
                </Field>
              </div>
            </div>
            <Field label="Arguments" hint="One per line">
              <textarea value={customArgs} onChange={e => setCustomArgs(e.target.value)} placeholder={"-y\n@your/mcp-package"}
                rows={2} style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }} />
            </Field>
            <div>
              <label style={labelStyle}>Environment Variables</label>
              {Object.keys(customEnv).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                  {Object.entries(customEnv).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)", minWidth: 100, flexShrink: 0 }}>{k}</span>
                      <input value={v} onChange={e => setCustomEnv(p => ({ ...p, [k]: e.target.value }))} placeholder="value" style={{ ...inputStyle, flex: 1 }} />
                      <button onClick={() => setCustomEnv(p => { const n = { ...p }; delete n[k]; return n; })}
                        style={{ display: "flex", padding: 4, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", borderRadius: 4 }}
                      ><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={customEnvKey} onChange={e => setCustomEnvKey(e.target.value)} placeholder="VAR_NAME" style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }} />
                <input value={customEnvVal} onChange={e => setCustomEnvVal(e.target.value)} placeholder="value" style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
                <button onClick={() => {
                  if (customEnvKey.trim()) { setCustomEnv(p => ({ ...p, [customEnvKey.trim()]: customEnvVal })); setCustomEnvKey(""); setCustomEnvVal(""); }
                }} style={btnSecondary}><Plus size={12} /></button>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            <button onClick={() => setShowCustom(false)} style={btnSecondary}>Cancel</button>
            <button onClick={handleAddCustom} disabled={!customName.trim() || !customCmd.trim()} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 14px", borderRadius: 7, border: "none",
              background: customName.trim() && customCmd.trim() ? "var(--accent)" : "var(--bg-tertiary)",
              color: customName.trim() && customCmd.trim() ? "#fff" : "var(--text-muted)",
              cursor: customName.trim() && customCmd.trim() ? "pointer" : "default",
              fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            }}><Plus size={12} /> Add Server</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-muted)",
  marginBottom: 4,
  display: "block",
};

const btnSecondary: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)",
  background: "var(--bg-tertiary)", color: "var(--text-secondary)",
  cursor: "pointer", fontSize: 11, fontFamily: "inherit",
  transition: "background 0.08s, color 0.08s",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>
        {label}
        {hint && <span style={{ fontWeight: 400, marginLeft: 6, opacity: 0.7 }}>{hint}</span>}
      </label>
      {children}
    </div>
  );
}
