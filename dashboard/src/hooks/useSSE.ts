import { useSyncExternalStore } from "react";
import { apiUrl } from "./useApi";

// ── Activity entry — one event in the live feed ───────────────────────────────

export interface ActivityEntry {
  id: number;
  agentId: string;
  type: "text" | "tool_start" | "tool_end" | "thinking" | "agent_end" | "agent_start";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
  timestamp: number;
}

// ── Global singleton SSE store ────────────────────────────────────────────────
// Connects ONCE when the module loads. Survives view switches.
// All React hooks just read snapshots from this store.

let _seq = 0;
const _thinking: Record<string, boolean> = {};

// Mutable state — updated by the EventSource handler
let _tokens: Record<string, string> = {};
let _activity: ActivityEntry[] = [];
let _connected = false;
let _activeAgents: Record<string, boolean> = {}; // true = between agent_start and agent_end

// Snapshot references — replaced on every mutation so React detects changes
let _tokensSnap: Record<string, string> = {};
let _activitySnap: ActivityEntry[] = [];
let _connectedSnap = false;
let _activeAgentsSnap: Record<string, boolean> = {};

// Listeners for useSyncExternalStore
const _listeners = new Set<() => void>();
function notify() {
  for (const fn of _listeners) fn();
}
function subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Format tool args as a compact summary for the live panel. */
function formatArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${s && s.length > 60 ? s.substring(0, 57) + "..." : s}`;
  });
  return `(${parts.join(", ")})`;
}

function appendToken(agentId: string, text: string) {
  _tokens = { ..._tokens, [agentId]: (_tokens[agentId] ?? "") + text };
  _tokensSnap = _tokens;
}

function pushActivity(entry: Omit<ActivityEntry, "id" | "timestamp">) {
  const full: ActivityEntry = { ...entry, id: _seq++, timestamp: Date.now() } as ActivityEntry;
  _activity = [..._activity.slice(-299), full];
  _activitySnap = _activity;
}

function batchActivity(agentId: string, type: ActivityEntry["type"], content: string) {
  const last = _activity[_activity.length - 1];
  if (last && last.agentId === agentId && last.type === type) {
    const updated = [..._activity];
    updated[updated.length - 1] = { ...last, content: last.content + content };
    _activity = updated;
    _activitySnap = _activity;
  } else {
    pushActivity({ agentId, type, content });
  }
}

function handleToken(data: string) {
  try {
    const token = JSON.parse(data) as {
      agentId: string;
      type: string;
      content: string;
      toolName?: string;
      toolArgs?: Record<string, unknown>;
      toolResult?: string;
      isError?: boolean;
    };
    const { agentId, type, content } = token;

    switch (type) {
      case "text": {
        appendToken(agentId, content);
        batchActivity(agentId, "text", content);
        break;
      }

      case "tool_start": {
        const toolLine = `> ${token.toolName ?? "tool"}${formatArgs(token.toolArgs)}\n`;
        appendToken(agentId, toolLine);
        pushActivity({ agentId, type: "tool_start", content, toolName: token.toolName, toolArgs: token.toolArgs });
        break;
      }

      case "tool_end": {
        const result = token.toolResult
          ? `  ${token.isError ? "x" : "ok"} ${token.toolResult.substring(0, 200)}\n`
          : `  ${token.isError ? "x error" : "ok done"}\n`;
        appendToken(agentId, result);
        pushActivity({ agentId, type: "tool_end", content, toolName: token.toolName, toolResult: token.toolResult, isError: token.isError });
        break;
      }

      case "thinking_start": {
        _thinking[agentId] = true;
        appendToken(agentId, "[thinking] ");
        break;
      }

      case "thinking": {
        if (!_thinking[agentId]) break;
        appendToken(agentId, content);
        batchActivity(agentId, "thinking", content);
        break;
      }

      case "thinking_end": {
        _thinking[agentId] = false;
        appendToken(agentId, "\n");
        break;
      }

      case "agent_start": {
        _tokens = { ..._tokens, [agentId]: "" };
        _tokensSnap = _tokens;
        _activeAgents = { ..._activeAgents, [agentId]: true };
        _activeAgentsSnap = _activeAgents;
        break;
      }

      case "agent_end": {
        _thinking[agentId] = false;
        _activeAgents = { ..._activeAgents, [agentId]: false };
        _activeAgentsSnap = _activeAgents;
        pushActivity({ agentId, type: "agent_end", content: "" });
        break;
      }

      default:
        break;
    }

    notify();
  } catch {
    // ignore malformed tokens
  }
}

// ── Connect the singleton EventSource ─────────────────────────────────────────

function connectSSE() {
  const es = new EventSource(apiUrl("/api/stream"));

  es.onopen = () => {
    _connected = true;
    _connectedSnap = true;
    notify();
  };

  es.onerror = () => {
    _connected = false;
    _connectedSnap = false;
    notify();
    // EventSource auto-reconnects, no manual retry needed
  };

  es.onmessage = (event) => {
    handleToken(event.data);
  };
}

// Connect immediately when module is first imported
connectSSE();

// ── React hook — just reads snapshots from the global store ───────────────────

export function useAgentStream() {
  const tokens = useSyncExternalStore(subscribe, () => _tokensSnap);
  const activity = useSyncExternalStore(subscribe, () => _activitySnap);
  const connected = useSyncExternalStore(subscribe, () => _connectedSnap);
  const activeAgents = useSyncExternalStore(subscribe, () => _activeAgentsSnap);
  return { tokens, activity, connected, activeAgents };
}
