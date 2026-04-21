import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plus, Trash2, Save, RefreshCw, Server, ChevronDown, ChevronRight,
  Shield, Search, MessageSquare, Cpu, Box, ExternalLink, Palette, RotateCcw,
  Zap, Settings2, Database, Eye, Star, Check, X, Package,
  Hash, Globe, Radio, Gamepad2, FolderOpen, Smartphone, Users, Grid3X3,
  GitBranch, Upload, Clock, CheckCircle, AlertCircle, EyeOff, Keyboard, Command, CornerDownLeft,
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
  inputType?: "key" | "url";
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

type SettingsSection = "general" | "models" | "channels" | "integrations" | "mcp" | "versioning" | "chat" | "shortcuts" | "mobile";

const SECTION_NAV: { key: SettingsSection; label: string; icon: React.ReactNode; color: string }[] = [
  { key: "general", label: "General", icon: <Settings2 size={15} />, color: "var(--text-secondary)" },
  { key: "chat", label: "Chat", icon: <Palette size={15} />, color: "var(--accent)" },
  { key: "models", label: "Models", icon: <Box size={15} />, color: "var(--purple)" },
  { key: "channels", label: "Channels", icon: <Radio size={15} />, color: "var(--blue)" },
  { key: "integrations", label: "Integrations", icon: <Zap size={15} />, color: "var(--orange)" },
  { key: "mcp", label: "MCP Servers", icon: <Server size={15} />, color: "var(--green)" },
  { key: "versioning", label: "Versioning", icon: <GitBranch size={15} />, color: "var(--cyan, #06b6d4)" },
  { key: "shortcuts", label: "Shortcuts", icon: <Keyboard size={15} />, color: "var(--yellow, #e2b93d)" },
  { key: "mobile", label: "Mobile", icon: <Smartphone size={15} />, color: "var(--green)" },
];

// ── Logo icon helper ─────────────────────────────────────────────────────────

function LogoIcon({ src, fallback, size = 20, colored }: { src: string; fallback: React.ReactNode; size?: number; colored?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: 3 }}
      onError={() => setFailed(true)}
    />
  );
}

// ── MCP Server Icon — loads colored brand SVG from /icons/mcp/ ───────────────

function McpServerIcon({ id, iconDomain, size = 20 }: { id: string; iconDomain?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Package size={size} />;
  const src = iconDomain
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${iconDomain}&size=32`
    : `/icons/mcp/${id}.svg`;
  return (
    <img
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: 3 }}
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
  const [customMCPTrigger, setCustomMCPTrigger] = useState(0);

  // Channel config (editable) — generic interface matching server's MaskedChannelInfo
  interface ChannelInfo { configured: boolean; connected: boolean; fields: Record<string, string | null> }
  const [channelCfg, setChannelCfg] = useState<Record<string, ChannelInfo> | null>(null);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);
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

  // Git config (versioning & backup)
  interface GitConfigData {
    username: string; email: string; token: string;
    provider: "github" | "gitlab" | "bitbucket" | "custom";
    remoteUrl: string; backupEnabled: boolean; backupIntervalHours: number;
    lastBackup: string | null; lastBackupStatus: "success" | "error" | null;
    lastBackupMessage: string | null; configured: boolean;
  }
  const [gitCfg, setGitCfg] = useState<GitConfigData | null>(null);
  const [gitForm, setGitForm] = useState({ username: "", email: "", token: "", provider: "github", remoteUrl: "", backupEnabled: false, backupIntervalHours: 24 });
  const [gitEditing, setGitEditing] = useState(false);
  const [gitSaving, setGitSaving] = useState(false);
  const [gitTesting, setGitTesting] = useState(false);
  const [gitTestResult, setGitTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [gitBacking, setGitBacking] = useState(false);
  const [gitBackupResult, setGitBackupResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showGitToken, setShowGitToken] = useState(false);

  const fetchGitConfig = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/git-config")).then(r => r.json());
      setGitCfg(res);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchGitConfig(); }, [fetchGitConfig]);

  // Chat appearance
  interface ChatColors {
    userBubble: string;
    userText: string;
    agentBubble: string;
    agentText: string;
    timestampUser: string;
    timestampAgent: string;
  }
  const CHAT_DEFAULTS: ChatColors = {
    userBubble: "", agentBubble: "", userText: "#ffffff",
    agentText: "", timestampUser: "rgba(255,255,255,0.6)", timestampAgent: "",
  };
  const [chatColors, setChatColors] = useState<ChatColors>(() => {
    try {
      const saved = localStorage.getItem("vec-chat-colors");
      return saved ? { ...CHAT_DEFAULTS, ...JSON.parse(saved) } : CHAT_DEFAULTS;
    } catch { return CHAT_DEFAULTS; }
  });

  // Persist chat colors and apply as CSS vars
  useEffect(() => {
    const root = document.documentElement;
    if (chatColors.userBubble) root.style.setProperty("--chat-user-bubble", chatColors.userBubble);
    else root.style.removeProperty("--chat-user-bubble");
    if (chatColors.userText) root.style.setProperty("--chat-user-text", chatColors.userText);
    else root.style.removeProperty("--chat-user-text");
    if (chatColors.agentBubble) root.style.setProperty("--chat-agent-bubble", chatColors.agentBubble);
    else root.style.removeProperty("--chat-agent-bubble");
    if (chatColors.agentText) root.style.setProperty("--chat-agent-text", chatColors.agentText);
    else root.style.removeProperty("--chat-agent-text");
    if (chatColors.timestampUser) root.style.setProperty("--chat-ts-user", chatColors.timestampUser);
    else root.style.removeProperty("--chat-ts-user");
    if (chatColors.timestampAgent) root.style.setProperty("--chat-ts-agent", chatColors.timestampAgent);
    else root.style.removeProperty("--chat-ts-agent");
    localStorage.setItem("vec-chat-colors", JSON.stringify(chatColors));
  }, [chatColors]);

  // Keyboard shortcuts
  interface ShortcutDef {
    id: string;
    label: string;
    description: string;
    category: string;
    keys: string; // e.g. "Ctrl+1", "Ctrl+Shift+S"
  }

  const DEFAULT_SHORTCUTS: ShortcutDef[] = [
    { id: "nav-overview", label: "Overview", description: "Go to Overview", category: "Navigation", keys: "Ctrl+1" },
    { id: "nav-kanban", label: "Kanban", description: "Go to Kanban Board", category: "Navigation", keys: "Ctrl+2" },
    { id: "nav-chat", label: "Chat", description: "Go to Chat", category: "Navigation", keys: "Ctrl+3" },
    { id: "nav-live", label: "Live Monitor", description: "Go to Live Monitor", category: "Navigation", keys: "Ctrl+4" },
    { id: "nav-workspace", label: "Workspace", description: "Go to Workspace", category: "Navigation", keys: "Ctrl+5" },
    { id: "nav-events", label: "Events", description: "Go to Events", category: "Navigation", keys: "Ctrl+6" },
    { id: "nav-settings", label: "Settings", description: "Go to Settings", category: "Navigation", keys: "Ctrl+," },
    { id: "editor-save", label: "Save File", description: "Save active file in editor", category: "Editor", keys: "Ctrl+S" },
    { id: "editor-close-tab", label: "Close Tab", description: "Close active editor tab", category: "Editor", keys: "Ctrl+W" },
    { id: "editor-search", label: "Search in File", description: "Search in active file", category: "Editor", keys: "Ctrl+F" },
    { id: "global-search", label: "Global Search", description: "Focus search / command palette", category: "General", keys: "Ctrl+K" },
    { id: "toggle-theme", label: "Toggle Theme", description: "Switch dark / light theme", category: "General", keys: "Ctrl+Shift+T" },
    { id: "send-message", label: "Send Message", description: "Send chat message", category: "Chat", keys: "Enter" },
    { id: "newline-message", label: "New Line", description: "New line in chat input", category: "Chat", keys: "Shift+Enter" },
  ];

  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(DEFAULT_SHORTCUTS);
  const [shortcutsLoaded, setShortcutsLoaded] = useState(false);
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);

  // Load shortcuts from server on mount
  useEffect(() => {
    fetch(apiUrl("/api/shortcuts-config")).then(r => r.json()).then((saved: ShortcutDef[] | null) => {
      if (saved && Array.isArray(saved)) {
        setShortcuts(DEFAULT_SHORTCUTS.map(d => {
          const override = saved.find(p => p.id === d.id);
          return override ? { ...d, keys: override.keys } : d;
        }));
      }
      setShortcutsLoaded(true);
    }).catch(() => setShortcutsLoaded(true));
  }, []);

  // Persist shortcuts to server + localStorage cache + notify other views
  const shortcutsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!shortcutsLoaded) return;
    localStorage.setItem("vec-keyboard-shortcuts", JSON.stringify(shortcuts));
    window.dispatchEvent(new CustomEvent("vec-shortcuts-changed", { detail: shortcuts }));
    // Debounced save to server
    if (shortcutsSaveTimer.current) clearTimeout(shortcutsSaveTimer.current);
    shortcutsSaveTimer.current = setTimeout(() => {
      postApi("/api/shortcuts-config", { shortcuts }).catch(() => {});
    }, 500);
  }, [shortcuts, shortcutsLoaded]);

  const updateShortcutKeys = useCallback((id: string, keys: string) => {
    setShortcuts(prev => prev.map(s => s.id === id ? { ...s, keys } : s));
    setRecordingShortcutId(null);
  }, []);

  const resetShortcut = useCallback((id: string) => {
    const def = DEFAULT_SHORTCUTS.find(d => d.id === id);
    if (def) setShortcuts(prev => prev.map(s => s.id === id ? { ...s, keys: def.keys } : s));
  }, []);

  const resetAllShortcuts = useCallback(() => {
    setShortcuts(DEFAULT_SHORTCUTS);
    showToast("All shortcuts reset to defaults");
  }, []);

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
  const TOTAL_CHANNELS = 16;
  const channelCount = channelCfg ? Object.values(channelCfg).filter(c => c?.configured).length : 0;
  const integCount = integ ? [integ.searxng.configured && integ.searxng.enabled, integ.sonarqube.configured && integ.sonarqube.enabled, integ.gitleaks.enabled, integ.semgrep.enabled, integ.trivy.enabled].filter(Boolean).length : 0;
  const connectedServers = mcpStatus.servers.filter(s => s.connected).length;

  // ── Section renderers ────────────────────────────────────────────────────

  function renderGeneral() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Quick stats */}
        {s && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "Company", value: s.system.companyName, color: "var(--accent)" },
              { label: "Provider", value: s.llm.provider, color: "var(--purple)" },
              { label: "Model", value: s.llm.model.split("/").pop() ?? s.llm.model, color: "var(--blue)" },
              { label: "Dashboard", value: `:${s.system.dashboardPort}`, color: "var(--green)" },
            ].map((stat) => (
              <div key={stat.label} style={{
                flex: "1 1 120px", padding: "16px 18px",
                background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
              }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: stat.color, lineHeight: 1.2, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>{stat.label}</div>
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

  // ── Channel field metadata for rendering forms ──────────────────────────
  const CHANNEL_FIELD_META: Record<string, { fields: { key: string; label: string; placeholder: string; secret?: boolean }[]; color: string; icon: string; note?: string }> = {
    telegram:   { color: "#26A5E4", icon: "telegram.org", fields: [
      { key: "botToken", label: "Bot Token", placeholder: "Paste your bot token from @BotFather", secret: true },
      { key: "chatId", label: "Chat ID", placeholder: "Your authorized chat ID" },
    ]},
    slack:      { color: "#4A154B", icon: "slack.com", fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", secret: true },
      { key: "appToken", label: "App Token", placeholder: "xapp-...", secret: true },
      { key: "channelId", label: "Channel ID", placeholder: "C0123456789" },
    ]},
    discord:    { color: "#5865F2", icon: "discord.com", fields: [
      { key: "botToken", label: "Bot Token", placeholder: "Discord Developer Portal → Bot → Token", secret: true },
      { key: "channelId", label: "Channel ID", placeholder: "Right-click channel → Copy Channel ID" },
    ]},
    whatsapp:   { color: "#25D366", icon: "whatsapp.com", note: "On first connect, a QR code will appear in the server terminal. Scan it with WhatsApp.", fields: [
      { key: "authorizedJid", label: "Authorized JID", placeholder: "919876543210@s.whatsapp.net" },
    ]},
    teams:      { color: "#6264A7", icon: "teams.microsoft.com", fields: [
      { key: "incomingWebhookUrl", label: "Incoming Webhook URL", placeholder: "https://outlook.office.com/webhook/...", secret: true },
      { key: "outgoingWebhookSecret", label: "Outgoing Webhook Secret (optional)", placeholder: "HMAC secret for verifying Teams messages", secret: true },
    ]},
    matrix:     { color: "#0DBD8B", icon: "matrix.org", fields: [
      { key: "homeserverUrl", label: "Homeserver URL", placeholder: "https://matrix.org" },
      { key: "accessToken", label: "Access Token", placeholder: "Bot user access token", secret: true },
      { key: "roomId", label: "Room ID", placeholder: "!abc123:matrix.org" },
    ]},
    signal:     { color: "#3A76F0", icon: "signal.org", note: "Requires signal-cli installed and registered on the server.", fields: [
      { key: "phoneNumber", label: "Phone Number", placeholder: "+1234567890" },
      { key: "recipient", label: "Recipient", placeholder: "+1234567890 or group ID" },
      { key: "cliPath", label: "signal-cli Path (optional)", placeholder: "/usr/local/bin/signal-cli" },
    ]},
    googlechat: { color: "#00AC47", icon: "chat.google.com", fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://chat.googleapis.com/v1/spaces/...", secret: true },
    ]},
    irc:        { color: "#6667AB", icon: "libera.chat", fields: [
      { key: "server", label: "Server", placeholder: "irc.libera.chat" },
      { key: "port", label: "Port", placeholder: "6697" },
      { key: "nickname", label: "Nickname", placeholder: "octo-vec" },
      { key: "channel", label: "Channel", placeholder: "#my-channel" },
      { key: "authNick", label: "Auth Nick (authorized user)", placeholder: "your-nick" },
      { key: "useTls", label: "Use TLS (true/false)", placeholder: "true" },
    ]},
    line:       { color: "#00C300", icon: "line.me", fields: [
      { key: "channelAccessToken", label: "Channel Access Token", placeholder: "LINE Developers → Messaging API", secret: true },
      { key: "channelSecret", label: "Channel Secret", placeholder: "LINE channel secret", secret: true },
      { key: "userId", label: "User ID", placeholder: "Target user ID to send messages to" },
    ]},
    mattermost: { color: "#0058CC", icon: "developers.mattermost.com", fields: [
      { key: "serverUrl", label: "Server URL", placeholder: "https://mattermost.example.com" },
      { key: "botToken", label: "Bot Token", placeholder: "Bot access token", secret: true },
      { key: "channelId", label: "Channel ID", placeholder: "Channel ID to listen on" },
      { key: "authUser", label: "Auth User (authorized username)", placeholder: "admin" },
    ]},
    twitch:     { color: "#9146FF", icon: "twitch.tv", fields: [
      { key: "botUsername", label: "Bot Username", placeholder: "my_bot" },
      { key: "oauthToken", label: "OAuth Token", placeholder: "oauth:...", secret: true },
      { key: "channel", label: "Channel", placeholder: "#my-channel" },
      { key: "authUser", label: "Auth User (authorized username)", placeholder: "streamer-name" },
    ]},
    nostr:      { color: "#8B5CF6", icon: "nostr.com", fields: [
      { key: "privateKey", label: "Private Key (hex)", placeholder: "nsec or hex private key", secret: true },
      { key: "relayUrl", label: "Relay URL", placeholder: "wss://relay.damus.io" },
      { key: "authPubkey", label: "Auth Pubkey (authorized user)", placeholder: "npub or hex pubkey" },
    ]},
    nextcloud:  { color: "#0082C9", icon: "nextcloud.com", fields: [
      { key: "serverUrl", label: "Server URL", placeholder: "https://cloud.example.com" },
      { key: "username", label: "Username", placeholder: "bot-user" },
      { key: "password", label: "Password", placeholder: "App password", secret: true },
      { key: "roomToken", label: "Room Token", placeholder: "Talk room token" },
      { key: "authUser", label: "Auth User (authorized username)", placeholder: "admin" },
    ]},
    synology:   { color: "#B6002B", icon: "synology.com", fields: [
      { key: "incomingUrl", label: "Incoming Webhook URL", placeholder: "Synology Chat incoming webhook URL", secret: true },
      { key: "outgoingToken", label: "Outgoing Webhook Token", placeholder: "Token for verifying outgoing webhooks", secret: true },
    ]},
    feishu:     { color: "#3370FF", icon: "feishu.cn", fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "Feishu bot webhook URL", secret: true },
      { key: "verificationToken", label: "Verification Token", placeholder: "Event verification token", secret: true },
    ]},
  };

  const CHANNEL_LABELS: Record<string, string> = {
    telegram: "Telegram", slack: "Slack", discord: "Discord", whatsapp: "WhatsApp",
    teams: "Teams", matrix: "Matrix", signal: "Signal", googlechat: "Google Chat",
    irc: "IRC", line: "LINE", mattermost: "Mattermost", twitch: "Twitch",
    nostr: "Nostr", nextcloud: "Nextcloud Talk", synology: "Synology Chat", feishu: "Feishu/Lark",
  };

  const CHANNEL_ORDER = [
    "telegram", "slack", "discord", "whatsapp", "teams", "matrix",
    "signal", "googlechat", "irc", "line", "mattermost", "twitch",
    "nostr", "nextcloud", "synology", "feishu",
  ];

  // Real brand favicon domains for gstatic favicon service (same as MCP icons)
  const CHANNEL_ICON_DOMAINS: Record<string, string> = {
    telegram: "telegram.org", slack: "slack.com", discord: "discord.com", whatsapp: "whatsapp.com",
    teams: "teams.microsoft.com", matrix: "matrix.org", signal: "signal.org", googlechat: "chat.google.com",
    irc: "libera.chat", line: "line.me", mattermost: "developers.mattermost.com", twitch: "twitch.tv",
    nostr: "nostr.com", nextcloud: "nextcloud.com", synology: "synology.com", feishu: "feishu.cn",
  };

  function openChannelEdit(ch: string) {
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
      const body: Record<string, string> = { channel: editingChannel, ...chFields };
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
      const body: Record<string, string> = { channel: editingChannel, ...chFields };
      const res = await postApi("/api/channel-config", body);
      if (res.ok) {
        await postApi("/api/channel-restart", { channel: editingChannel });
        await fetchChannels();
        closeChannelEdit();
        showToast(`${CHANNEL_LABELS[editingChannel] ?? editingChannel} connected`);
      } else {
        showToast(res.error ?? "Save failed");
      }
    } catch {
      showToast("Save failed");
    } finally {
      setChSaving(false);
    }
  }

  async function disconnectChannel(ch: string) {
    try {
      await postApi("/api/channel-disconnect", { channel: ch });
      await fetchChannels();
      showToast(`${CHANNEL_LABELS[ch] ?? ch} disconnected`);
    } catch {
      showToast("Disconnect failed");
    }
  }

  function renderChannelEditCard(ch: string) {
    const meta = CHANNEL_FIELD_META[ch];
    if (!meta) return null;
    const info = channelCfg?.[ch];
    const isEditing = editingChannel === ch;
    const configured = info?.configured ?? false;
    const connected = info?.connected ?? false;
    const label = CHANNEL_LABELS[ch] ?? ch;
    const color = meta.color;
    const hasAnyField = Object.values(chFields).some(v => v && v.trim());
    const iconDomain = CHANNEL_ICON_DOMAINS[ch];

    // Compact card (non-editing) — matches MCP directory style
    if (!isEditing) {
      return (
        <div key={ch} style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "14px 16px", borderRadius: 12,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          transition: "border-color 0.15s, box-shadow 0.15s",
          minWidth: 0, overflow: "hidden",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--text-muted) 40%, transparent)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.1)"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
        >
          {/* Icon — real brand favicon from gstatic */}
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: configured ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--bg-tertiary)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img
              src={`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${iconDomain ?? meta.icon}&size=32`}
              alt="" style={{ width: 20, height: 20, borderRadius: 3 }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>

          {/* Name + status line */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{
                fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{label}</span>
              {configured && (
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: connected ? "var(--green)" : "var(--red)",
                  boxShadow: connected ? "0 0 6px var(--green)" : "none",
                }} />
              )}
            </div>
            <div style={{
              fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4, marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {configured
                ? (connected ? "Connected" : "Offline")
                : "Not configured"}
            </div>
          </div>

          {/* Action button */}
          <button
            onClick={() => configured ? openChannelEdit(ch) : openChannelEdit(ch)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)",
              background: "transparent", color: "var(--text-muted)",
              cursor: "pointer", flexShrink: 0,
              transition: "background 0.12s, color 0.12s, border-color 0.12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = color; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = color; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
            title={configured ? `Edit ${label}` : `Configure ${label}`}
          >
            {configured ? <Settings2 size={14} /> : <Plus size={14} />}
          </button>
        </div>
      );
    }

    // Expanded editing card — full width
    return (
      <div key={ch} style={{
        padding: "16px 18px", borderRadius: 12,
        background: "var(--bg-card)", border: `1px solid ${color}`,
        gridColumn: "1 / -1",
        transition: "border-color 0.15s",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img
              src={`https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${iconDomain ?? meta.icon}&size=32`}
              alt="" style={{ width: 20, height: 20, borderRadius: 3 }}
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
              {configured ? (connected ? "Connected" : "Offline") : "Setup credentials below"}
            </div>
          </div>
          {configured && (
            <button onClick={() => disconnectChannel(ch)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
              border: "1px solid color-mix(in srgb, var(--red) 30%, transparent)",
              background: "color-mix(in srgb, var(--red) 8%, transparent)",
              color: "var(--red)", cursor: "pointer", fontFamily: "inherit",
            }}>
              Disconnect
            </button>
          )}
        </div>

        {/* Edit form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {meta.fields.map(f => (
            <CredentialField
              key={f.key}
              label={f.label}
              placeholder={f.placeholder}
              value={chFields[f.key] ?? ""}
              onChange={(v) => setChFields(prev => ({ ...prev, [f.key]: v }))}
              isSecret={f.secret}
            />
          ))}
          {meta.note && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "0 4px" }}>
              {meta.note}
            </div>
          )}
          {chTestResult && (
            <div style={{
              padding: "8px 12px", borderRadius: 8, fontSize: 12,
              background: chTestResult.ok ? "color-mix(in srgb, var(--green) 8%, transparent)" : "color-mix(in srgb, var(--red) 8%, transparent)",
              color: chTestResult.ok ? "var(--green)" : "var(--red)",
              border: `1px solid ${chTestResult.ok ? "color-mix(in srgb, var(--green) 20%, transparent)" : "color-mix(in srgb, var(--red) 20%, transparent)"}`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              {chTestResult.ok ? <Check size={14} /> : <X size={14} />}
              {chTestResult.msg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={testChannel} disabled={chTesting || !hasAnyField} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500,
              border: "1px solid var(--border)", background: "var(--bg-hover)",
              color: "var(--text-primary)", cursor: chTesting ? "wait" : "pointer",
              fontFamily: "inherit", opacity: chTesting || !hasAnyField ? 0.5 : 1,
            }}>
              {chTesting ? "Testing..." : "Test Connection"}
            </button>
            <button onClick={saveChannel} disabled={chSaving || !hasAnyField} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              border: "none", background: color, color: "#fff",
              cursor: chSaving ? "wait" : "pointer", fontFamily: "inherit",
              opacity: chSaving || !hasAnyField ? 0.5 : 1,
            }}>
              {chSaving ? "Saving..." : "Save & Connect"}
            </button>
            <button onClick={closeChannelEdit} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 500,
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit",
            }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderChannels() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Stats — matching MCP-style 4-column */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { val: channelCount, label: "Configured", color: "var(--blue)" },
            { val: Object.values(channelCfg ?? {}).filter((c: any) => c?.connected).length, label: "Connected", color: "var(--green)" },
            { val: TOTAL_CHANNELS - channelCount, label: "Available", color: "var(--purple, var(--text-muted))" },
            { val: TOTAL_CHANNELS, label: "Total Channels", color: "var(--text-muted)" },
          ].map(s => (
            <div key={s.label} style={{
              flex: "1 1 100px", padding: "14px 16px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {s.val}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Channel cards — 2-column grid matching MCP directory style */}
        <div>
          <SectionLabel title="Communication Channels" />
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
          }}>
            {CHANNEL_ORDER.map(ch => renderChannelEditCard(ch))}
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
                padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${color}`,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                color, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Configure
            </button>
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
    const gstaticIcon = (domain: string) =>
      `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=32`;

    type IntegItem = { key: string; name: string; logoUrl: string; fallbackIcon: React.ReactNode; configured: boolean; enabled: boolean; detail: string; color: string; subtitle: string };

    const categories: { title: string; color: string; items: IntegItem[] }[] = [
      {
        title: "Search",
        color: "var(--green)",
        items: [
          {
            key: "searxng", name: "SearXNG", logoUrl: gstaticIcon("searx.space"), fallbackIcon: <Search size={16} />,
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
            key: "sonarqube", name: "SonarQube", logoUrl: gstaticIcon("sonarqube.org"), fallbackIcon: <Eye size={16} />,
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
            key: "gitleaks", name: "Gitleaks", logoUrl: gstaticIcon("gitleaks.io"), fallbackIcon: <Shield size={16} />,
            configured: true, enabled: integ?.gitleaks.enabled ?? true,
            detail: `Image: ${integ?.gitleaks.image ?? "zricethezav/gitleaks:latest"}`,
            color: "var(--red)", subtitle: "SECRETS",
          },
          {
            key: "semgrep", name: "Semgrep", logoUrl: gstaticIcon("semgrep.dev"), fallbackIcon: <Shield size={16} />,
            configured: true, enabled: integ?.semgrep.enabled ?? true,
            detail: `Image: ${integ?.semgrep.image ?? "semgrep/semgrep"}`,
            color: "var(--orange)", subtitle: "SAST",
          },
          {
            key: "trivy", name: "Trivy", logoUrl: gstaticIcon("trivy.dev"), fallbackIcon: <Database size={16} />,
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
              flex: "1 1 100px", padding: "16px 18px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
            }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: stat.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Action bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <div style={{ flex: 1 }} />
          <button onClick={() => setCustomMCPTrigger(t => t + 1)} style={btnSecondary} title="Add a custom MCP server">
            <Plus size={12} /> Add Custom MCP
          </button>
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
          showCustomTrigger={customMCPTrigger}
        />
      </div>
    );
  }

  // ── Versioning & Backup ──────────────────────────────────────────────────

  const GIT_PROVIDERS = [
    { id: "github", label: "GitHub", domain: "github.com" },
    { id: "gitlab", label: "GitLab", domain: "gitlab.com" },
    { id: "bitbucket", label: "Bitbucket", domain: "bitbucket.org" },
    { id: "custom", label: "Custom", domain: "" },
  ] as const;

  async function saveGitSettings() {
    setGitSaving(true);
    try {
      const body: Record<string, any> = {
        username: gitForm.username,
        email: gitForm.email,
        provider: gitForm.provider,
        remoteUrl: gitForm.remoteUrl,
        backupEnabled: gitForm.backupEnabled,
        backupIntervalHours: gitForm.backupIntervalHours,
      };
      // Only send token if it changed (not the masked value)
      if (gitForm.token && !gitForm.token.startsWith("••••")) {
        body.token = gitForm.token;
      }
      await postApi("/api/git-config", body);
      await fetchGitConfig();
      setGitEditing(false);
      showToast("Git configuration saved");
    } catch {
      showToast("Failed to save Git configuration");
    } finally {
      setGitSaving(false);
    }
  }

  async function testGitConnection() {
    setGitTesting(true);
    setGitTestResult(null);
    try {
      const res = await postApi("/api/git-test", {});
      setGitTestResult(res);
    } catch {
      setGitTestResult({ ok: false, message: "Connection test failed" });
    } finally {
      setGitTesting(false);
    }
  }

  async function triggerBackup() {
    setGitBacking(true);
    setGitBackupResult(null);
    try {
      const res = await postApi("/api/git-backup", {});
      setGitBackupResult(res);
      await fetchGitConfig();
    } catch {
      setGitBackupResult({ ok: false, message: "Backup failed" });
    } finally {
      setGitBacking(false);
    }
  }

  function renderVersioning() {
    const cfg = gitCfg;
    const providerIcon = (id: string) => {
      const domain = GIT_PROVIDERS.find(p => p.id === id)?.domain;
      return domain
        ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=32`
        : undefined;
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Status cards */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            {
              label: "Git Status",
              value: cfg?.configured ? "Connected" : "Not Configured",
              color: cfg?.configured ? "var(--green)" : "var(--text-muted)",
              icon: cfg?.configured ? <CheckCircle size={14} /> : <AlertCircle size={14} />,
            },
            {
              label: "Provider",
              value: cfg?.provider ? GIT_PROVIDERS.find(p => p.id === cfg.provider)?.label || cfg.provider : "—",
              color: "var(--cyan, #06b6d4)",
              icon: cfg?.provider && providerIcon(cfg.provider)
                ? <img src={providerIcon(cfg.provider)} width={14} height={14} style={{ borderRadius: 3 }} />
                : <GitBranch size={14} />,
            },
            {
              label: "Last Backup",
              value: cfg?.lastBackup ? new Date(cfg.lastBackup).toLocaleDateString() : "Never",
              color: cfg?.lastBackupStatus === "success" ? "var(--green)" : cfg?.lastBackupStatus === "error" ? "var(--red)" : "var(--text-muted)",
              icon: <Clock size={14} />,
            },
            {
              label: "Auto-Backup",
              value: cfg?.backupEnabled ? `Every ${cfg.backupIntervalHours}h` : "Off",
              color: cfg?.backupEnabled ? "var(--blue)" : "var(--text-muted)",
              icon: <RefreshCw size={14} />,
            },
          ].map((stat) => (
            <div key={stat.label} style={{
              flex: "1 1 120px", padding: "14px 16px",
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: stat.color, fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                {stat.icon}
                {stat.value}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Git Credentials */}
        <div>
          <SectionLabel title="Git Credentials" />
          <div className="vec-card" style={{ padding: 16 }}>
            {!gitEditing ? (
              // Read-only view
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Username</div>
                    <div style={{ fontSize: 13, color: cfg?.username ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {cfg?.username || "Not set"}
                    </div>
                  </div>
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Email</div>
                    <div style={{ fontSize: 13, color: cfg?.email ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {cfg?.email || "Not set"}
                    </div>
                  </div>
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Access Token</div>
                    <div style={{ fontSize: 13, color: cfg?.token ? "var(--text-primary)" : "var(--text-muted)" }}>
                      {cfg?.token || "Not set"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>Remote URL</div>
                    <div style={{ fontSize: 13, color: cfg?.remoteUrl ? "var(--text-primary)" : "var(--text-muted)", wordBreak: "break-all" }}>
                      {cfg?.remoteUrl || "Not set"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    onClick={() => {
                      setGitForm({
                        username: cfg?.username || "",
                        email: cfg?.email || "",
                        token: cfg?.token || "",
                        provider: cfg?.provider || "github",
                        remoteUrl: cfg?.remoteUrl || "",
                        backupEnabled: cfg?.backupEnabled || false,
                        backupIntervalHours: cfg?.backupIntervalHours || 24,
                      });
                      setGitEditing(true);
                      setShowGitToken(false);
                      setGitTestResult(null);
                    }}
                    style={{
                      padding: "7px 16px", borderRadius: 6, border: "1px solid var(--border)",
                      background: "var(--bg-hover)", color: "var(--text-primary)",
                      fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <Settings2 size={13} />
                    {cfg?.configured ? "Edit Credentials" : "Set Up Git"}
                  </button>
                  {cfg?.configured && (
                    <button
                      onClick={testGitConnection}
                      disabled={gitTesting}
                      style={{
                        padding: "7px 16px", borderRadius: 6, border: "1px solid var(--border)",
                        background: "transparent", color: "var(--text-secondary)",
                        fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                        opacity: gitTesting ? 0.5 : 1,
                      }}
                    >
                      {gitTesting ? "Testing..." : "Test Connection"}
                    </button>
                  )}
                </div>
                {gitTestResult && (
                  <div style={{
                    padding: "8px 12px", borderRadius: 6, fontSize: 12, marginTop: 4,
                    background: gitTestResult.ok ? "color-mix(in srgb, var(--green) 10%, transparent)" : "color-mix(in srgb, var(--red) 10%, transparent)",
                    color: gitTestResult.ok ? "var(--green)" : "var(--red)",
                    border: `1px solid ${gitTestResult.ok ? "var(--green)" : "var(--red)"}`,
                    borderColor: gitTestResult.ok ? "color-mix(in srgb, var(--green) 25%, transparent)" : "color-mix(in srgb, var(--red) 25%, transparent)",
                  }}>
                    {gitTestResult.ok ? <Check size={12} style={{ marginRight: 6 }} /> : <X size={12} style={{ marginRight: 6 }} />}
                    {gitTestResult.message}
                  </div>
                )}
              </div>
            ) : (
              // Editing form
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Provider selector */}
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Provider</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {GIT_PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setGitForm(f => ({ ...f, provider: p.id }))}
                        style={{
                          padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                          border: `1px solid ${gitForm.provider === p.id ? "var(--accent)" : "var(--border)"}`,
                          background: gitForm.provider === p.id ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                          color: gitForm.provider === p.id ? "var(--accent)" : "var(--text-secondary)",
                          cursor: "pointer", fontFamily: "inherit",
                          display: "flex", alignItems: "center", gap: 6,
                        }}
                      >
                        {p.domain && (
                          <img src={providerIcon(p.id)} width={14} height={14} style={{ borderRadius: 3 }} />
                        )}
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fields */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 200px" }}>
                    <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Username</label>
                    <input
                      value={gitForm.username}
                      onChange={e => setGitForm(f => ({ ...f, username: e.target.value }))}
                      placeholder="e.g. octocat"
                      style={{
                        width: "100%", padding: "8px 10px", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg-primary)",
                        color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
                        outline: "none", boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div style={{ flex: "1 1 200px" }}>
                    <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Email</label>
                    <input
                      value={gitForm.email}
                      onChange={e => setGitForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="you@example.com"
                      style={{
                        width: "100%", padding: "8px 10px", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg-primary)",
                        color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
                        outline: "none", boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Personal Access Token (PAT)
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showGitToken ? "text" : "password"}
                      value={gitForm.token}
                      onChange={e => setGitForm(f => ({ ...f, token: e.target.value }))}
                      placeholder={gitForm.provider === "github" ? "ghp_xxxxxxxxxxxx" : "Personal access token"}
                      style={{
                        width: "100%", padding: "8px 36px 8px 10px", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg-primary)",
                        color: "var(--text-primary)", fontSize: 13, fontFamily: "monospace",
                        outline: "none", boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowGitToken(v => !v)}
                      style={{
                        position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--text-muted)", padding: 2,
                      }}
                    >
                      {showGitToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                    {gitForm.provider === "github" && "Generate at GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens"}
                    {gitForm.provider === "gitlab" && "Generate at GitLab → Preferences → Access Tokens"}
                    {gitForm.provider === "bitbucket" && "Generate at Bitbucket → Personal Settings → App Passwords"}
                    {gitForm.provider === "custom" && "Enter a token with push access to your remote repository"}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Remote Repository URL
                  </label>
                  <input
                    value={gitForm.remoteUrl}
                    onChange={e => setGitForm(f => ({ ...f, remoteUrl: e.target.value }))}
                    placeholder={
                      gitForm.provider === "github" ? "https://github.com/username/octo-vec-backup.git"
                      : gitForm.provider === "gitlab" ? "https://gitlab.com/username/octo-vec-backup.git"
                      : gitForm.provider === "bitbucket" ? "https://bitbucket.org/username/octo-vec-backup.git"
                      : "https://your-git-server.com/repo.git"
                    }
                    style={{
                      width: "100%", padding: "8px 10px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg-primary)",
                      color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit",
                      outline: "none", boxSizing: "border-box",
                    }}
                  />
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                    Agents will use this as the default remote for <code style={{ fontSize: 10 }}>git push</code>. Memory backups also push here.
                  </div>
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button
                    onClick={saveGitSettings}
                    disabled={gitSaving || !gitForm.username || !gitForm.token || !gitForm.remoteUrl}
                    style={{
                      padding: "8px 20px", borderRadius: 6, border: "none",
                      background: "var(--accent)", color: "#fff",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                      opacity: (gitSaving || !gitForm.username || !gitForm.token || !gitForm.remoteUrl) ? 0.5 : 1,
                      display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <Save size={13} />
                    {gitSaving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => { setGitEditing(false); setGitTestResult(null); }}
                    style={{
                      padding: "8px 16px", borderRadius: 6, border: "1px solid var(--border)",
                      background: "transparent", color: "var(--text-secondary)",
                      fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Memory Backup */}
        <div>
          <SectionLabel title="Memory Backup" />
          <div className="vec-card" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 14, lineHeight: 1.5 }}>
              Back up all agent memory (STM, LTM, SLTM), settings, and roster to your Git repository.
              Agents' knowledge, daily journals, and core identity files are preserved and version-controlled.
            </div>

            {/* Auto-backup toggle */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
              borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
              marginBottom: 14,
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", flex: 1 }}>
                <div
                  onClick={() => {
                    const next = !gitForm.backupEnabled;
                    setGitForm(f => ({ ...f, backupEnabled: next }));
                    postApi("/api/git-config", { backupEnabled: next }).then(() => fetchGitConfig());
                  }}
                  style={{
                    width: 36, height: 20, borderRadius: 10,
                    background: (gitCfg?.backupEnabled || gitForm.backupEnabled) ? "var(--accent)" : "var(--bg-tertiary)",
                    position: "relative", cursor: "pointer", transition: "background 0.15s",
                    flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 8, background: "#fff",
                    position: "absolute", top: 2,
                    left: (gitCfg?.backupEnabled || gitForm.backupEnabled) ? 18 : 2,
                    transition: "left 0.15s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }} />
                </div>
                <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Automatic Backup</span>
              </label>
              {(gitCfg?.backupEnabled || gitForm.backupEnabled) && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Every</span>
                  <select
                    value={gitCfg?.backupIntervalHours || gitForm.backupIntervalHours}
                    onChange={(e) => {
                      const h = Number(e.target.value);
                      setGitForm(f => ({ ...f, backupIntervalHours: h }));
                      postApi("/api/git-config", { backupIntervalHours: h }).then(() => fetchGitConfig());
                    }}
                    style={{
                      padding: "4px 8px", borderRadius: 5, border: "1px solid var(--border)",
                      background: "var(--bg-primary)", color: "var(--text-primary)",
                      fontSize: 12, fontFamily: "inherit",
                    }}
                  >
                    {[1, 4, 8, 12, 24, 48, 72].map(h => (
                      <option key={h} value={h}>{h}h</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Manual backup button */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={triggerBackup}
                disabled={gitBacking || !cfg?.configured}
                style={{
                  padding: "8px 20px", borderRadius: 6, border: "none",
                  background: cfg?.configured ? "var(--accent)" : "var(--bg-tertiary)",
                  color: cfg?.configured ? "#fff" : "var(--text-muted)",
                  fontSize: 12, fontWeight: 600, cursor: cfg?.configured ? "pointer" : "not-allowed",
                  fontFamily: "inherit", opacity: gitBacking ? 0.5 : 1,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <Upload size={13} />
                {gitBacking ? "Backing up..." : "Backup Now"}
              </button>
              {cfg?.lastBackup && (
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Last: {new Date(cfg.lastBackup).toLocaleString()}
                  {cfg.lastBackupStatus === "success" && <Check size={11} style={{ marginLeft: 4, color: "var(--green)" }} />}
                  {cfg.lastBackupStatus === "error" && <X size={11} style={{ marginLeft: 4, color: "var(--red)" }} />}
                </span>
              )}
            </div>
            {gitBackupResult && (
              <div style={{
                padding: "8px 12px", borderRadius: 6, fontSize: 12, marginTop: 10,
                background: gitBackupResult.ok ? "color-mix(in srgb, var(--green) 10%, transparent)" : "color-mix(in srgb, var(--red) 10%, transparent)",
                color: gitBackupResult.ok ? "var(--green)" : "var(--red)",
                border: `1px solid ${gitBackupResult.ok ? "color-mix(in srgb, var(--green) 25%, transparent)" : "color-mix(in srgb, var(--red) 25%, transparent)"}`,
              }}>
                {gitBackupResult.ok ? <CheckCircle size={12} style={{ marginRight: 6 }} /> : <AlertCircle size={12} style={{ marginRight: 6 }} />}
                {gitBackupResult.message}
              </div>
            )}
            {cfg?.lastBackupStatus === "error" && cfg.lastBackupMessage && !gitBackupResult && (
              <div style={{
                padding: "8px 12px", borderRadius: 6, fontSize: 12, marginTop: 10,
                background: "color-mix(in srgb, var(--red) 10%, transparent)",
                color: "var(--red)",
                border: "1px solid color-mix(in srgb, var(--red) 25%, transparent)",
              }}>
                <AlertCircle size={12} style={{ marginRight: 6 }} />
                Last error: {cfg.lastBackupMessage}
              </div>
            )}
          </div>
        </div>

        {/* How it works */}
        <div>
          <SectionLabel title="How It Works" />
          <div className="vec-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { icon: <GitBranch size={14} />, title: "Agent Projects", desc: "Agents use your Git credentials to push project code. Each agent commits under their own name (e.g. Maya → maya@octovec.dev)." },
                { icon: <Database size={14} />, title: "Memory Backup", desc: "STM (scratchpad), LTM (daily journals), and SLTM (core identity) for every agent are committed and pushed to your backup repo." },
                { icon: <Shield size={14} />, title: "Credentials", desc: "Your PAT is stored locally in the VEC data directory. It's never sent to any LLM — only used for git push operations." },
                { icon: <RefreshCw size={14} />, title: "Auto-Backup", desc: "When enabled, VEC automatically commits and pushes memory changes on your chosen schedule. Manual backup is always available." },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                    background: "color-mix(in srgb, var(--cyan, #06b6d4) 10%, transparent)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--cyan, #06b6d4)",
                  }}>
                    {item.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2 }}>{item.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Keyboard Shortcuts ──────────────────────────────────────────────────

  function formatKeyCombo(keys: string) {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    return keys.split("+").map(k => {
      if (k === "Ctrl") return isMac ? "\u2318" : "Ctrl";
      if (k === "Shift") return isMac ? "\u21E7" : "Shift";
      if (k === "Alt") return isMac ? "\u2325" : "Alt";
      if (k === "Enter") return "\u21B5";
      if (k === "Escape") return "Esc";
      return k;
    }).join(isMac ? "" : " + ");
  }

  function KeyBadge({ keys }: { keys: string }) {
    const parts = keys.split("+");
    return (
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {parts.map((part, i) => (
          <span key={i} style={{
            padding: "2px 7px", fontSize: 11, fontWeight: 600,
            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
            background: "var(--bg-primary)", border: "1px solid var(--border)",
            borderRadius: 5, color: "var(--text-primary)",
            boxShadow: "0 1px 0 var(--border)",
            lineHeight: "18px", minWidth: 22, textAlign: "center",
          }}>
            {part === "Ctrl" ? (navigator.platform.toUpperCase().includes("MAC") ? "\u2318" : "Ctrl") :
             part === "Shift" ? (navigator.platform.toUpperCase().includes("MAC") ? "\u21E7" : "Shift") :
             part === "Alt" ? (navigator.platform.toUpperCase().includes("MAC") ? "\u2325" : "Alt") :
             part === "Enter" ? "\u21B5" : part === "Escape" ? "Esc" : part}
          </span>
        ))}
      </div>
    );
  }

  function ShortcutRecorder({ shortcutId, onRecord }: { shortcutId: string; onRecord: (keys: string) => void }) {
    const recorderRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      recorderRef.current?.focus();
      const handler = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Ignore lone modifier presses
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        const parts: string[] = [];
        if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
        if (e.shiftKey) parts.push("Shift");
        if (e.altKey) parts.push("Alt");
        // Normalize key
        let key = e.key;
        if (key === " ") key = "Space";
        else if (key.length === 1) key = key.toUpperCase();
        else if (key === "Escape") { setRecordingShortcutId(null); return; }
        parts.push(key);
        onRecord(parts.join("+"));
      };
      window.addEventListener("keydown", handler, true);
      return () => window.removeEventListener("keydown", handler, true);
    }, [shortcutId, onRecord]);

    return (
      <div ref={recorderRef} tabIndex={-1} style={{
        padding: "4px 12px", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
        background: "var(--accent)", color: "#fff", borderRadius: 5,
        animation: "pulse 1.2s infinite",
        outline: "none", cursor: "default",
      }}>
        Press keys... (Esc to cancel)
      </div>
    );
  }

  function renderShortcuts() {
    const categories = Array.from(new Set(shortcuts.map(s => s.category)));
    const customCount = shortcuts.filter((s, i) => s.keys !== DEFAULT_SHORTCUTS[i]?.keys).length;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Keyboard Shortcuts</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
              Click on a shortcut to customize it. Press Escape to cancel.
            </p>
          </div>
          <button
            onClick={resetAllShortcuts}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
              background: "var(--bg-tertiary)", border: "1px solid var(--border)",
              borderRadius: 6, color: "var(--text-secondary)", cursor: "pointer",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            <RotateCcw size={12} /> Reset All
          </button>
        </div>

        {/* Shortcut categories */}
        {categories.map(cat => (
          <div key={cat}>
            <SectionLabel title={cat} count={shortcuts.filter(s => s.category === cat).length} />
            <div style={{
              borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden",
              background: "var(--bg-card)",
            }}>
              {shortcuts.filter(s => s.category === cat).map((shortcut, i, arr) => {
                const isRecording = recordingShortcutId === shortcut.id;
                const isCustom = shortcut.keys !== DEFAULT_SHORTCUTS.find(d => d.id === shortcut.id)?.keys;
                return (
                  <div key={shortcut.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 16px",
                    borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    background: isRecording ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
                    transition: "background 0.1s",
                  }}
                    onMouseEnter={e => { if (!isRecording) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={e => { if (!isRecording) e.currentTarget.style.background = "transparent"; }}
                  >
                    {/* Label + description */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-primary)" }}>
                        {shortcut.label}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>
                        {shortcut.description}
                      </div>
                    </div>

                    {/* Key badge or recorder */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {isCustom && !isRecording && (
                        <button
                          onClick={() => resetShortcut(shortcut.id)}
                          title="Reset to default"
                          style={{
                            background: "transparent", border: "none", cursor: "pointer",
                            color: "var(--text-muted)", display: "flex", padding: 3, borderRadius: 4,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "transparent"; }}
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}

                      {isRecording ? (
                        <ShortcutRecorder
                          shortcutId={shortcut.id}
                          onRecord={(keys) => updateShortcutKeys(shortcut.id, keys)}
                        />
                      ) : (
                        <button
                          onClick={() => setRecordingShortcutId(shortcut.id)}
                          style={{
                            background: "transparent", border: "none", cursor: "pointer",
                            padding: 0, display: "flex",
                          }}
                          title="Click to change shortcut"
                        >
                          <KeyBadge keys={shortcut.keys} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Info footer */}
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "12px 14px", borderRadius: 8,
          background: "color-mix(in srgb, var(--yellow, #e2b93d) 6%, transparent)",
          border: "1px solid color-mix(in srgb, var(--yellow, #e2b93d) 15%, transparent)",
        }}>
          <Command size={14} style={{ color: "var(--yellow, #e2b93d)", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Shortcuts work globally across the dashboard. Navigation shortcuts switch between views instantly.
            Editor shortcuts only work when the editor view is active.
            {customCount > 0 && (
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                {" "}{customCount} custom binding{customCount > 1 ? "s" : ""} active.
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Chat Appearance ──────────────────────────────────────────────────────

  function renderChat() {
    const presets: { label: string; colors: ChatColors }[] = [
      { label: "Default", colors: CHAT_DEFAULTS },
      { label: "Ocean", colors: { userBubble: "#0077b6", userText: "#ffffff", agentBubble: "#1b2838", agentText: "#cad2de", timestampUser: "rgba(255,255,255,0.5)", timestampAgent: "rgba(255,255,255,0.3)" } },
      { label: "Forest", colors: { userBubble: "#2d6a4f", userText: "#ffffff", agentBubble: "#1b2e1b", agentText: "#c5dfc5", timestampUser: "rgba(255,255,255,0.5)", timestampAgent: "rgba(255,255,255,0.3)" } },
      { label: "Sunset", colors: { userBubble: "#e85d04", userText: "#ffffff", agentBubble: "#2a1a0e", agentText: "#f0d5be", timestampUser: "rgba(255,255,255,0.5)", timestampAgent: "rgba(255,255,255,0.3)" } },
      { label: "Lavender", colors: { userBubble: "#7b2cbf", userText: "#ffffff", agentBubble: "#1e1230", agentText: "#d4bfec", timestampUser: "rgba(255,255,255,0.5)", timestampAgent: "rgba(255,255,255,0.3)" } },
      { label: "Rose", colors: { userBubble: "#e63971", userText: "#ffffff", agentBubble: "#2a1018", agentText: "#f0c0d0", timestampUser: "rgba(255,255,255,0.5)", timestampAgent: "rgba(255,255,255,0.3)" } },
      { label: "Slate", colors: { userBubble: "#475569", userText: "#f8fafc", agentBubble: "#1e293b", agentText: "#cbd5e1", timestampUser: "rgba(255,255,255,0.5)", timestampAgent: "rgba(255,255,255,0.3)" } },
    ];

    function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (v: string) => void }) {
      const display = value || fallback;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
          <label style={{
            position: "relative", width: 32, height: 32, borderRadius: 8,
            border: "2px solid var(--border)", cursor: "pointer", overflow: "hidden",
            background: display, flexShrink: 0,
          }}>
            <input type="color" value={display} onChange={e => onChange(e.target.value)}
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
            />
          </label>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{label}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{display}</div>
          </div>
          {value && (
            <button onClick={() => onChange("")} title="Reset to default" style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: 4, display: "flex",
            }}><RotateCcw size={12} /></button>
          )}
        </div>
      );
    }

    // Resolve fallback values for preview
    const cs = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
    const accent = cs?.getPropertyValue("--accent").trim() || "#5b8def";
    const bgTertiary = cs?.getPropertyValue("--bg-tertiary").trim() || "#2a2a2a";
    const textPrimary = cs?.getPropertyValue("--text-primary").trim() || "#e0e0e0";
    const textMuted = cs?.getPropertyValue("--text-muted").trim() || "#666";

    const pUserBubble = chatColors.userBubble || accent;
    const pUserText = chatColors.userText || "#ffffff";
    const pAgentBubble = chatColors.agentBubble || bgTertiary;
    const pAgentText = chatColors.agentText || textPrimary;
    const pTsUser = chatColors.timestampUser || "rgba(255,255,255,0.6)";
    const pTsAgent = chatColors.timestampAgent || textMuted;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Presets */}
        <div style={{
          background: "var(--bg-card)", borderRadius: 10,
          border: "1px solid var(--border)", padding: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Color Presets</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>Quick themes for your chat bubbles</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {presets.map(p => {
              const active = chatColors.userBubble === p.colors.userBubble && chatColors.agentBubble === p.colors.agentBubble;
              return (
                <button key={p.label} onClick={() => setChatColors(p.colors)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                  borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                  border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                  background: active ? "var(--bg-hover)" : "var(--bg-secondary)",
                  color: "var(--text-primary)", fontSize: 12, fontWeight: 500,
                }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: p.colors.userBubble || accent }} />
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: p.colors.agentBubble || bgTertiary }} />
                  </div>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom colors */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* User bubble */}
          <div style={{
            flex: "1 1 240px", background: "var(--bg-card)", borderRadius: 10,
            border: "1px solid var(--border)", padding: 20,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Your Messages</div>
            <ColorField label="Bubble Color" value={chatColors.userBubble} fallback={accent}
              onChange={v => setChatColors(c => ({ ...c, userBubble: v }))} />
            <ColorField label="Text Color" value={chatColors.userText} fallback="#ffffff"
              onChange={v => setChatColors(c => ({ ...c, userText: v }))} />
            <ColorField label="Timestamp Color" value={chatColors.timestampUser} fallback="rgba(255,255,255,0.6)"
              onChange={v => setChatColors(c => ({ ...c, timestampUser: v }))} />
          </div>

          {/* Agent bubble */}
          <div style={{
            flex: "1 1 240px", background: "var(--bg-card)", borderRadius: 10,
            border: "1px solid var(--border)", padding: 20,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 12 }}>Agent Messages</div>
            <ColorField label="Bubble Color" value={chatColors.agentBubble} fallback={bgTertiary}
              onChange={v => setChatColors(c => ({ ...c, agentBubble: v }))} />
            <ColorField label="Text Color" value={chatColors.agentText} fallback={textPrimary}
              onChange={v => setChatColors(c => ({ ...c, agentText: v }))} />
            <ColorField label="Timestamp Color" value={chatColors.timestampAgent} fallback={textMuted}
              onChange={v => setChatColors(c => ({ ...c, timestampAgent: v }))} />
          </div>
        </div>

        {/* Live preview */}
        <div style={{
          background: "var(--bg-card)", borderRadius: 10,
          border: "1px solid var(--border)", padding: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 14 }}>Preview</div>
          <div style={{
            background: "var(--bg-primary)", borderRadius: 10, padding: 16,
            display: "flex", flexDirection: "column", gap: 10, maxWidth: 420,
          }}>
            {/* User message */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{
                padding: "8px 14px 6px", borderRadius: "14px 14px 4px 14px",
                background: pUserBubble, color: pUserText,
                fontSize: 13, lineHeight: 1.55, maxWidth: "75%",
              }}>
                Hey, can you review the PR I just pushed?
                <div style={{ fontSize: 10, textAlign: "right", marginTop: 4, color: pTsUser }}>2:34 PM</div>
              </div>
            </div>
            {/* Agent message */}
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{
                padding: "8px 14px 6px", borderRadius: "14px 14px 14px 4px",
                background: pAgentBubble, color: pAgentText,
                fontSize: 13, lineHeight: 1.55, maxWidth: "75%",
              }}>
                Sure! I'll take a look at the changes and get back to you with feedback.
                <div style={{ fontSize: 10, textAlign: "right", marginTop: 4, color: pTsAgent }}>2:35 PM</div>
              </div>
            </div>
            {/* Another user message */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{
                padding: "8px 14px 6px", borderRadius: "14px 14px 4px 14px",
                background: pUserBubble, color: pUserText,
                fontSize: 13, lineHeight: 1.55, maxWidth: "75%",
              }}>
                Thanks!
                <div style={{ fontSize: 10, textAlign: "right", marginTop: 4, color: pTsUser }}>2:35 PM</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Mobile Connect (QR) ──────────────────────────────────────────────────

  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [mobileQrInfo, setMobileQrInfo] = useState<{ url: string; key: string } | null>(null);
  const [connectedDevices, setConnectedDevices] = useState<{ id: string; platform: string; info: string; name: string; pairedAt: string; lastSeen: string; ip: string; online: boolean }[]>([]);

  useEffect(() => {
    if (activeSection !== "mobile") return;
    // Fetch connection info from server (includes the actual API key)
    fetch(apiUrl("/api/mobile-qr"), { credentials: "include" })
      .then(r => r.json())
      .then((data: { url: string; key: string }) => {
        setMobileQrInfo(data);
        const payload = JSON.stringify(data);
        return import("qrcode").then((QRCode) =>
          QRCode.toDataURL(payload, {
            width: 220, margin: 1,
            color: { dark: "#ffffff", light: "#000000" },
            errorCorrectionLevel: "M",
          })
        );
      })
      .then((url: string) => setQrDataUrl(url))
      .catch(() => {});

    // Poll connected devices
    function loadDevices() {
      fetch(apiUrl("/api/mobile-devices"), { credentials: "include" })
        .then(r => r.json())
        .then(setConnectedDevices)
        .catch(() => {});
    }
    loadDevices();
    const poll = setInterval(loadDevices, 5000);
    return () => clearInterval(poll);
  }, [activeSection]);

  function renderMobile() {
    const dashUrl = mobileQrInfo?.url || "";
    const dashKey = mobileQrInfo?.key || "";

    return (
      <div style={{ padding: "24px 28px", maxWidth: 600, display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Mobile Connect</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Scan this QR code with the OCTO VEC mobile app to connect instantly.
          </p>
        </div>

        {/* QR Code */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
          background: "var(--bg-card)", borderRadius: 16, border: "1px solid var(--border)",
          padding: 32,
        }}>
          <div style={{
            width: 252, height: 252,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "#000", borderRadius: 12, border: "1px solid var(--border)",
          }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code" width={220} height={220} style={{ borderRadius: 8 }} />
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Generating...</div>
            )}
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Same Network</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Phone must be on the same WiFi as this PC
            </div>
          </div>
        </div>

        {/* Connection details */}
        <div style={{
          background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)", padding: 16,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Connection Details
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", width: 60 }}>Server</span>
            <code style={{ fontSize: 12, color: "var(--text-primary)", background: "var(--bg-tertiary)", padding: "4px 8px", borderRadius: 6 }}>
              {dashUrl || "Loading..."}
            </code>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", width: 60 }}>Key</span>
            <code style={{ fontSize: 12, color: "var(--text-primary)", background: "var(--bg-tertiary)", padding: "4px 8px", borderRadius: 6 }}>
              {dashKey ? "••••••••" : "Not found in URL"}
            </code>
          </div>
        </div>

        {/* Connected Devices */}
        <div style={{
          background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)", padding: 16,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Connected Devices
            </div>
            {connectedDevices.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "var(--green)",
                background: "var(--green-bg)", padding: "2px 8px", borderRadius: 8,
              }}>
                {connectedDevices.length} active
              </span>
            )}
          </div>
          {connectedDevices.length === 0 ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 0",
              color: "var(--text-muted)", fontSize: 13,
            }}>
              <Smartphone size={16} />
              <span>No devices paired yet</span>
            </div>
          ) : (
            connectedDevices.map((d, i) => {
              const ago = Math.floor((Date.now() - new Date(d.lastSeen).getTime()) / 1000);
              const lastSeenText = d.online
                ? (ago < 10 ? "just now" : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`)
                : ago < 3600 ? `${Math.floor(ago / 60)}m ago`
                : ago < 86400 ? `${Math.floor(ago / 3600)}h ago`
                : `${Math.floor(ago / 86400)}d ago`;
              const pairedDate = new Date(d.pairedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
              return (
                <div key={d.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: d.online ? "var(--green-bg)" : "var(--bg-tertiary)",
                    border: `1px solid ${d.online ? "rgba(61,214,140,0.15)" : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Smartphone size={18} style={{ color: d.online ? "var(--green)" : "var(--text-muted)" }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                        {d.name}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 6,
                        background: d.online ? "var(--green-bg)" : "var(--bg-tertiary)",
                        color: d.online ? "var(--green)" : "var(--text-muted)",
                      }}>
                        {d.online ? "ONLINE" : "OFFLINE"}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      {d.info} · Paired {pairedDate}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                      Last active {lastSeenText} · {d.ip}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(`Unlink ${d.name}? You'll need to scan the QR code again to reconnect.`)) return;
                      try {
                        await fetch(apiUrl("/api/mobile-devices/unlink"), {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: d.id }),
                        });
                        setConnectedDevices(prev => prev.filter(x => x.id !== d.id));
                      } catch {}
                    }}
                    title="Unlink device"
                    style={{
                      width: 28, height: 28, borderRadius: 7, border: "none", padding: 0,
                      background: "var(--bg-tertiary)", color: "var(--text-muted)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "background 0.1s, color 0.1s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--red-bg)"; e.currentTarget.style.color = "var(--red)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Instructions */}
        <div style={{
          background: "var(--bg-card)", borderRadius: 12, border: "1px solid var(--border)", padding: 16,
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            How to connect
          </div>
          {[
            "Install the OCTO VEC app on your Android phone",
            "Open the app and tap \"Scan QR Code\"",
            "Point your camera at the QR code above",
            "You'll be connected automatically",
          ].map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{
                width: 20, height: 20, borderRadius: 10, background: "var(--bg-tertiary)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0,
              }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: "20px" }}>{step}</span>
            </div>
          ))}
        </div>
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
    versioning: renderVersioning,
    chat: renderChat,
    shortcuts: renderShortcuts,
    mobile: renderMobile,
  };

  const customShortcutCount = shortcuts.filter((s, i) => s.keys !== DEFAULT_SHORTCUTS[i]?.keys).length;
  const sectionBadges: Record<SettingsSection, string | null> = {
    general: null,
    models: configuredProviders > 0 ? String(configuredProviders) : null,
    channels: channelCount > 0 ? String(channelCount) : null,
    integrations: integCount > 0 ? String(integCount) : null,
    mcp: serverNames.length > 0 ? String(serverNames.length) : null,
    versioning: gitCfg?.configured ? "✓" : null,
    chat: chatColors.userBubble ? "✓" : null,
    shortcuts: customShortcutCount > 0 ? String(customShortcutCount) : null,
    mobile: null,
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
          width: 196, flexShrink: 0, padding: "8px 10px 20px",
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
                  padding: "9px 12px", borderRadius: 8,
                  border: "none",
                  background: isActive ? "var(--bg-hover)" : "transparent",
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 13, fontWeight: isActive ? 500 : 400,
                  cursor: "pointer", fontFamily: "inherit",
                  textAlign: "left", width: "100%",
                  transition: "background 0.1s, color 0.1s",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "var(--bg-secondary)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: isActive ? `color-mix(in srgb, ${item.color} 12%, transparent)` : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: isActive ? item.color : "var(--text-muted)",
                  transition: "background 0.1s, color 0.1s",
                }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {badge && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 5,
                    background: isActive ? `color-mix(in srgb, ${item.color} 12%, transparent)` : "var(--bg-secondary)",
                    color: isActive ? item.color : "var(--text-muted)",
                    border: `1px solid ${isActive ? `color-mix(in srgb, ${item.color} 20%, transparent)` : "var(--border)"}`,
                    fontVariantNumeric: "tabular-nums",
                    transition: "background 0.1s, color 0.1s",
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
  const isUrl = provider.inputType === "url";
  const [key, setKey] = useState(isUrl ? "http://localhost:11434" : "");
  const [showKey, setShowKey] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState("");

  async function handleOllamaRefresh() {
    setRefreshing(true);
    setRefreshMsg("");
    try {
      const res = await fetch("/api/ollama-refresh", { method: "POST" });
      const data = await res.json();
      setRefreshMsg(data.ok ? `Found ${data.models.length} model${data.models.length !== 1 ? "s" : ""}` : (data.error ?? "Failed to reach Ollama"));
    } catch {
      setRefreshMsg("Could not connect to Ollama");
    } finally {
      setRefreshing(false);
    }
  }

  const filteredModels = provider.models.filter(m =>
    m.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          animation: "modal-backdrop-in 0.18s ease-out",
          willChange: "opacity",
        }}
      />
      {/* Modal — larger */}
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)", zIndex: 101,
        background: "var(--bg-secondary)", border: "1px solid var(--border)",
        borderRadius: 16, width: 560, maxWidth: "92vw", maxHeight: "85vh",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px var(--border)",
        overflow: "hidden", animation: "modal-in 0.18s cubic-bezier(0.34, 1.2, 0.64, 1)",
        display: "flex", flexDirection: "column",
        willChange: "transform, opacity",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "20px 24px 16px",
          borderBottom: "1px solid var(--border)", flexShrink: 0,
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "var(--bg-tertiary)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img
              src={provider.iconUrl}
              alt={provider.name}
              style={{ width: 28, height: 28, borderRadius: 6 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>
              {provider.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {provider.models.length} model{provider.models.length !== 1 ? "s" : ""} available
              {provider.configured && <span style={{ color: "var(--green)", marginLeft: 8, fontWeight: 600 }}>Active</span>}
              {!provider.configured && <span style={{ color: "var(--text-muted)", marginLeft: 8, opacity: 0.6 }}>Not configured</span>}
            </div>
          </div>
          <button onClick={onClose} style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8,
            background: "var(--bg-tertiary)", color: "var(--text-muted)",
            cursor: "pointer", padding: 0, transition: "all 0.12s",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 18, overflowY: "auto", flex: 1 }}>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { val: String(provider.models.length), label: "Models", color: "var(--purple, var(--accent))" },
              { val: provider.configured ? "Active" : "Not Set", label: "Status", color: provider.configured ? "var(--green)" : "var(--text-muted)" },
              { val: provider.envKey, label: "Env Variable", color: "var(--text-secondary)", mono: true },
            ].map(s => (
              <div key={s.label} style={{
                flex: 1, padding: "12px 14px", borderRadius: 10,
                background: "var(--bg-card)", border: "1px solid var(--border)",
              }}>
                <div style={{
                  fontSize: s.mono ? 11 : 18, fontWeight: s.mono ? 500 : 700,
                  color: s.color, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                  fontFamily: s.mono ? "monospace" : "inherit",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {s.val}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Model list with search */}
          {provider.models.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                  textTransform: "uppercase", letterSpacing: "0.04em",
                }}>Available Models</div>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {filteredModels.length} of {provider.models.length}
                </span>
              </div>

              {/* Search input */}
              <div style={{ position: "relative" }}>
                <Search size={13} style={{
                  position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                  color: "var(--text-muted)", pointerEvents: "none",
                }} />
                <input
                  value={modelSearch}
                  onChange={e => setModelSearch(e.target.value)}
                  placeholder="Search models..."
                  style={{
                    ...inputStyle, width: "100%", fontSize: 12,
                    padding: "8px 12px 8px 30px",
                  }}
                />
              </div>

              {/* Scrollable model list */}
              <div style={{
                maxHeight: 200, overflowY: "auto",
                border: "1px solid var(--border)", borderRadius: 10,
                background: "var(--bg-card)",
              }}>
                {filteredModels.map((m, i) => (
                  <div key={m} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 14px",
                    borderBottom: i < filteredModels.length - 1 ? "1px solid var(--border)" : "none",
                    transition: "background 0.08s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <Box size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={{
                      fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                    }}>{m}</span>
                  </div>
                ))}
                {filteredModels.length === 0 && (
                  <div style={{ padding: "16px 14px", textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
                    No models match "{modelSearch}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Key / URL input */}
          <div>
            <label style={{
              fontSize: 12, fontWeight: 500, color: "var(--text-secondary)",
              marginBottom: 8, display: "block",
            }}>
              {isUrl ? "Base URL" : "API Key"}
            </label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder={isUrl ? "http://localhost:11434" : `Paste your ${provider.name} API key...`}
                type={isUrl ? "text" : (showKey ? "text" : "password")}
                autoFocus
                style={{
                  ...inputStyle, flex: 1, fontSize: 13, fontFamily: "monospace",
                  padding: "10px 12px",
                }}
                onKeyDown={e => e.key === "Enter" && key.trim() && onSave(key)}
              />
              {!isUrl && (
                <button
                  onClick={() => setShowKey(s => !s)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                    border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                    color: showKey ? "var(--accent)" : "var(--text-muted)",
                    cursor: "pointer", padding: 0, transition: "color 0.12s",
                  }}
                  title={showKey ? "Hide key" : "Show key"}
                >
                  <Eye size={14} />
                </button>
              )}
            </div>
            {isUrl && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                For a remote server: <code style={{ fontFamily: "monospace" }}>http://192.168.1.100:11434</code>
              </div>
            )}
          </div>

          {/* Ollama: Refresh Models button */}
          {isUrl && provider.configured && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={handleOllamaRefresh}
                disabled={refreshing}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg-tertiary)",
                  color: "var(--text-secondary)", fontSize: 12, fontWeight: 500,
                  cursor: refreshing ? "default" : "pointer",
                  fontFamily: "inherit", opacity: refreshing ? 0.6 : 1,
                }}
              >
                <RefreshCw size={12} style={refreshing ? { animation: "spin 1s linear infinite" } : {}} />
                {refreshing ? "Refreshing..." : "Refresh Models"}
              </button>
              {refreshMsg && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{refreshMsg}</span>}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button onClick={onClose} style={{
              ...btnSecondary, padding: "9px 18px", fontSize: 12, borderRadius: 8,
            }}>Cancel</button>
            <button
              onClick={() => key.trim() && onSave(key)}
              disabled={!key.trim() || saving}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "9px 22px", borderRadius: 8, border: "none",
                background: key.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                color: key.trim() ? "#fff" : "var(--text-muted)",
                fontSize: 12, fontWeight: 600,
                cursor: key.trim() ? "pointer" : "default",
                fontFamily: "inherit",
                opacity: saving ? 0.6 : 1, transition: "opacity 0.12s, background 0.12s",
              }}
            >
              <Save size={13} /> {saving ? "Saving..." : (isUrl ? "Save URL" : "Save Key")}
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

function MCPDirectoryPanel({ activeServerNames, mcpConfig, mcpStatus, onAdd, onRemove, onAddCustom, onUpdateCustom, onRemoveCustomEnv, onAddCustomEnv, expanded, onToggleExpand, showCustomTrigger }: {
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
  showCustomTrigger?: number; // increment to open custom form
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<MCPCategory | "all">("all");
  const [showDirectory, setShowDirectory] = useState(true);
  const [setupEntry, setSetupEntry] = useState<MCPDirectoryEntry | null>(null);
  const [envInputs, setEnvInputs] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState(false);
  useEffect(() => { if (showCustomTrigger && showCustomTrigger > 0) setShowCustom(true); }, [showCustomTrigger]);
  const customRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (showCustom) customRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [showCustom]);
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
                  <button onClick={() => onRemove(entry.id)} style={{
                    display: "flex", padding: 4, border: "none", borderRadius: 4,
                    background: "transparent", color: "var(--text-muted)", cursor: "pointer", transition: "color 0.08s",
                  }} onMouseEnter={e => { e.currentTarget.style.color = "var(--red)"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }} title="Remove"
                  ><Trash2 size={12} /></button>
                </div>
              );
            })}

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
                  <div onClick={() => onToggleExpand(name)} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", cursor: "pointer",
                    borderBottom: isOpen ? "1px solid var(--border)" : "none",
                  }}>
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
                    <button onClick={(e) => { e.stopPropagation(); onRemove(name); }} title="Remove" style={{
                      display: "flex", padding: 4, border: "none", borderRadius: 4,
                      background: "transparent", color: "var(--text-muted)", cursor: "pointer", transition: "color 0.08s",
                    }} onMouseEnter={e => { e.currentTarget.style.color = "var(--red)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
                    ><Trash2 size={12} /></button>
                  </div>
                  {isOpen && (
                    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                      <Field label="Command" hint="e.g. npx, node, python">
                        <input value={srv.command} onChange={e => onUpdateCustom(name, { command: e.target.value })} placeholder="npx" style={inputStyle} />
                      </Field>
                      <Field label="Arguments" hint="One per line">
                        <textarea value={(srv.args ?? []).join("\n")} onChange={e => onUpdateCustom(name, { args: e.target.value.split("\n") })}
                          placeholder={"-y\n@your/mcp-package\n--flag"} rows={3}
                          style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }} />
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
                                  display: "flex", padding: 4, border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", borderRadius: 4, transition: "color 0.08s",
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
                              <span key={t} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontFamily: "monospace" }}>{t}</span>
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

      {/* ── Search + Category filter ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <div style={{ position: "relative", flex: "0 1 260px", minWidth: 140 }}>
          <Search size={13} style={{
            position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
            color: "var(--text-muted)", pointerEvents: "none",
          }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search servers..." style={{ ...inputStyle, paddingLeft: 30, padding: "6px 10px 6px 30px", fontSize: 12, borderRadius: 8 }} />
        </div>
        <div style={{ width: 160, flexShrink: 0 }}>
          <Dropdown value={catFilter} onChange={v => setCatFilter(v as MCPCategory | "all")}
            options={categoryOptions} placeholder="Category" alignRight />
        </div>
      </div>

      {/* Setup panel (env var input for a directory server being added) */}
      {setupEntry && (
        <div style={{
          background: "var(--bg-card)", border: "1px solid var(--accent)",
          borderRadius: 8, padding: 14, animation: "fade-in 0.12s ease-out",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Package size={14} style={{ color: "var(--accent)" }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{setupEntry.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>Set environment variables</span>
            </div>
            <button onClick={() => { setSetupEntry(null); setEnvInputs({}); }} style={{
              display: "flex", padding: 4, border: "none", borderRadius: 4,
              background: "transparent", color: "var(--text-muted)", cursor: "pointer",
            }}><X size={14} /></button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.entries(setupEntry.envVars).map(([varName, hint]) => (
              <div key={varName} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-secondary)", minWidth: 130, flexShrink: 0 }}>{varName}</span>
                <input value={envInputs[varName] ?? ""} onChange={e => setEnvInputs(p => ({ ...p, [varName]: e.target.value }))}
                  placeholder={hint} type="password"
                  style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }}
                  onKeyDown={e => e.key === "Enter" && confirmSetup()} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
            <button onClick={() => { setSetupEntry(null); setEnvInputs({}); }} style={btnSecondary}>Cancel</button>
            <button onClick={confirmSetup} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 7, border: "none",
              background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
            }}><Plus size={12} /> Add</button>
          </div>
        </div>
      )}

      {/* ── Directory grid — shown directly ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {filtered.map(entry => {
          const catMeta = CATEGORY_META[entry.category];
          return (
            <div key={entry.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 16px", borderRadius: 12,
              background: "var(--bg-card)", border: "1px solid var(--border)",
              transition: "border-color 0.15s, box-shadow 0.15s",
              minWidth: 0, overflow: "hidden",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "color-mix(in srgb, var(--text-muted) 40%, transparent)"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.1)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: "var(--bg-tertiary)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <McpServerIcon id={entry.id} iconDomain={entry.iconDomain} size={22} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block",
                }}>{entry.name}</span>
                <div style={{
                  fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4, marginTop: 2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{entry.description}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleAddClick(entry); }} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)",
                background: "transparent", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--accent)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "var(--accent)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
                title={`Add ${entry.name}`}
              ><Plus size={14} /></button>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 12 }}>
          No servers match your search.
        </div>
      )}

      {/* ── Add Custom MCP Modal ── */}
      {showCustom && createPortal(
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        }} onClick={() => setShowCustom(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 520, maxWidth: "90vw", maxHeight: "80vh", overflowY: "auto",
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 14, padding: 24, boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
            animation: "fade-in 0.15s ease-out",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: "var(--accent-subtle, var(--bg-tertiary))",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Server size={18} style={{ color: "var(--accent)" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>Add Custom MCP Server</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Configure a custom MCP server with command, args, and environment</div>
              </div>
              <button onClick={() => setShowCustom(false)} style={{
                display: "flex", padding: 6, border: "none", borderRadius: 6,
                background: "var(--bg-tertiary)", color: "var(--text-muted)", cursor: "pointer",
              }} onMouseEnter={e => { e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--text-muted)"; }}
              ><X size={16} /></button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <Field label="Server Name" hint="e.g. my-server">
                    <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="my-custom-server" style={inputStyle} autoFocus />
                  </Field>
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Command" hint="e.g. npx, node, python">
                    <input value={customCmd} onChange={e => setCustomCmd(e.target.value)} placeholder="npx" style={inputStyle} />
                  </Field>
                </div>
              </div>
              <Field label="Arguments" hint="One per line">
                <textarea value={customArgs} onChange={e => setCustomArgs(e.target.value)} placeholder={"-y\n@your/mcp-package"}
                  rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }} />
              </Field>
              <div>
                <label style={labelStyle}>Environment Variables</label>
                {Object.keys(customEnv).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8, marginTop: 6 }}>
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
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <input value={customEnvKey} onChange={e => setCustomEnvKey(e.target.value)} placeholder="VAR_NAME" style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 12 }} />
                  <input value={customEnvVal} onChange={e => setCustomEnvVal(e.target.value)} placeholder="value" style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
                  <button onClick={() => {
                    if (customEnvKey.trim()) { setCustomEnv(p => ({ ...p, [customEnvKey.trim()]: customEnvVal })); setCustomEnvKey(""); setCustomEnvVal(""); }
                  }} style={btnSecondary}><Plus size={12} /></button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
              <button onClick={() => setShowCustom(false)} style={btnSecondary}>Cancel</button>
              <button onClick={handleAddCustom} disabled={!customName.trim() || !customCmd.trim()} style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "8px 18px", borderRadius: 8, border: "none",
                background: customName.trim() && customCmd.trim() ? "var(--accent)" : "var(--bg-tertiary)",
                color: customName.trim() && customCmd.trim() ? "#fff" : "var(--text-muted)",
                cursor: customName.trim() && customCmd.trim() ? "pointer" : "default",
                fontSize: 12, fontWeight: 600, fontFamily: "inherit",
              }}><Plus size={13} /> Add Server</button>
            </div>
          </div>
        </div>,
        document.body
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
