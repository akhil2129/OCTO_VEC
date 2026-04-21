import { useState, useEffect, useRef } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { EmployeesProvider } from "./context/EmployeesContext";
import Sidebar, { type View } from "./components/Sidebar";
import KanbanView from "./views/KanbanView";
import OverviewView from "./views/OverviewView";
import EventsView from "./views/EventsView";
import SnoopView from "./views/QueueView";
import DirectoryView from "./views/DirectoryView";
import ChatView from "./views/ChatView";

import LiveView from "./views/LiveView";
import FinanceView from "./views/FinanceView";
import RemindersView from "./views/RemindersView";
import SettingsView from "./views/SettingsView";
import WorkspaceView from "./views/WorkspaceView";
import EditorView from "./views/EditorView";
import OnboardingView from "./views/OnboardingView";
import WelcomeTour, { WelcomeSplash, markTourDone } from "./components/WelcomeTour";
import { apiUrl, startTokenRefresh, stopTokenRefresh, usePolling } from "./hooks/useApi";
import { useChatNotifications } from "./hooks/useChatNotifications";
import { useTheme } from "./context/ThemeContext";
import ChatToasts from "./components/ChatToasts";

// Restore chat colors from localStorage on startup
(function restoreChatColors() {
  try {
    const saved = localStorage.getItem("vec-chat-colors");
    if (!saved) return;
    const c = JSON.parse(saved);
    const root = document.documentElement;
    if (c.userBubble) root.style.setProperty("--chat-user-bubble", c.userBubble);
    if (c.userText) root.style.setProperty("--chat-user-text", c.userText);
    if (c.agentBubble) root.style.setProperty("--chat-agent-bubble", c.agentBubble);
    if (c.agentText) root.style.setProperty("--chat-agent-text", c.agentText);
    if (c.timestampUser) root.style.setProperty("--chat-ts-user", c.timestampUser);
    if (c.timestampAgent) root.style.setProperty("--chat-ts-agent", c.timestampAgent);
  } catch { /* ignore */ }
})();

export default function App() {
  const [activeView, setActiveViewRaw] = useState<View>(() => {
    const saved = localStorage.getItem("active-view");
    return saved && ["overview","kanban","events","snoop","directory","chat","live","finance","reminders","workspace","editor","settings"].includes(saved)
      ? (saved as View)
      : "overview";
  });

  // Auth state: null = loading, true = authed, false = needs login
  const [authed, setAuthed] = useState<boolean | null>(null);
  // Onboarding state: null = loading, true = show onboarding, false = done
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  // Tour phases
  const [tourPhase, setTourPhase] = useState<"splash" | "walkthrough" | null>(null);

  // Check auth status on mount — auto-login on localhost
  useEffect(() => {
    (async () => {
      try {
        // 1. Check if already authed (cookie exists). The server silently
        //    refreshes the access token from the refresh cookie when needed,
        //    so this survives overnight sessions up to the 7d refresh expiry.
        const statusRes = await fetch("/api/auth/status", { credentials: "include" });
        const statusData = await statusRes.json();
        if (statusData.authenticated) { setAuthed(true); return; }

        // 2. Check if key is in URL (legacy flow)
        const key = new URLSearchParams(location.search).get("key");
        if (key) {
          const loginRes = await fetch("/api/auth/login", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
          });
          if (loginRes.ok) {
            // Clean key from URL
            window.history.replaceState({}, "", location.pathname + location.hash);
            sessionStorage.setItem("vec-api-key", key);
            setAuthed(true);
            return;
          }
        }

        setAuthed(false);
      } catch { setAuthed(false); }
    })();
  }, []);

  // Listen for session expiry from authFetch
  useEffect(() => {
    const handler = () => { setAuthed(false); stopTokenRefresh(); };
    window.addEventListener("vec:auth-expired", handler);
    return () => window.removeEventListener("vec:auth-expired", handler);
  }, []);

  // Once authed, check onboarding + start token refresh
  useEffect(() => {
    if (!authed) return;
    startTokenRefresh();
    fetch("/api/onboarding", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) { setShowOnboarding(false); return; }
        const needsOnboarding = !data.done;
        setShowOnboarding(needsOnboarding);
        if (!needsOnboarding && !data.tourDone) setTourPhase("splash");
      })
      .catch(() => setShowOnboarding(false));
  }, [authed]);

  function setActiveView(v: View) {
    localStorage.setItem("active-view", v);
    setActiveViewRaw(v);
  }

  function handleAuthSuccess() {
    setAuthed(true);
    startTokenRefresh();
  }

  // Loading
  if (authed === null) {
    return (
      <ThemeProvider>
        <div style={{
          height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-primary)",
        }} />
      </ThemeProvider>
    );
  }

  // Not authed OR needs onboarding — both go through OnboardingView
  // OnboardingView handles the auth step internally when needsAuth=true
  if (!authed || showOnboarding) {
    return (
      <ThemeProvider>
        <OnboardingView
          needsAuth={!authed}
          onAuthSuccess={handleAuthSuccess}
          onComplete={() => { setShowOnboarding(false); setTourPhase("splash"); }}
        />
      </ThemeProvider>
    );
  }

  // Still loading onboarding check
  if (showOnboarding === null) {
    return (
      <ThemeProvider>
        <div style={{
          height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg-primary)",
        }} />
      </ThemeProvider>
    );
  }

  // Welcome splash
  if (tourPhase === "splash") {
    return (
      <ThemeProvider>
        <WelcomeSplash
          onStart={() => setTourPhase("walkthrough")}
          onSkip={() => { markTourDone(); setTourPhase(null); }}
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
    <EmployeesProvider>
      <DashboardShell activeView={activeView} setActiveView={setActiveView} tourPhase={tourPhase} setTourPhase={setTourPhase} />
    </EmployeesProvider>
    </ThemeProvider>
  );
}

function DashboardShell({ activeView, setActiveView, tourPhase, setTourPhase }: {
  activeView: View; setActiveView: (v: View) => void;
  tourPhase: "splash" | "walkthrough" | null; setTourPhase: (v: "splash" | "walkthrough" | null) => void;
}) {
  const { unreadCount, perAgentUnread, toasts, markAgentRead, dismissToast } = useChatNotifications(activeView);

  // Editor view state: which project to open in the in-app Monaco editor
  const [editorProject, setEditorProject] = useState<{ path: string; name: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem("vec-editor-project");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  useEffect(() => {
    function onOpenEditor(e: Event) {
      const detail = (e as CustomEvent).detail as { path?: string; name?: string } | undefined;
      if (!detail?.path) return;
      const proj = { path: detail.path, name: detail.name ?? detail.path.split(/[/\\]/).pop() ?? detail.path };
      sessionStorage.setItem("vec-editor-project", JSON.stringify(proj));
      setEditorProject(proj);
      setActiveView("editor");
    }
    window.addEventListener("vec:open-editor", onOpenEditor);
    return () => window.removeEventListener("vec:open-editor", onOpenEditor);
  }, [setActiveView]);

  // Pending reminders count for badge
  const { data: reminders } = usePolling<{ scheduled_for: string; triggered_at: string | null }[]>("/api/reminders?all=false", 10000);
  const pendingReminders = (reminders ?? []).filter(r => !r.triggered_at).length;

  // Pending approvals count for badge
  const { data: pendingApprovals } = usePolling<any[]>("/api/approvals", 3000);
  const approvalCount = (pendingApprovals ?? []).length;

  function handleToastClick(agentId: string) {
    sessionStorage.setItem("chat_selected_agent", agentId);
    setActiveView("chat");
    markAgentRead(agentId);
  }

  function openChat(agentId: string) {
    sessionStorage.setItem("chat_selected_agent", agentId);
    setActiveView("chat");
    markAgentRead(agentId);
  }

  // ── Global keyboard shortcuts ──────────────────────────────────────────
  const { theme, setTheme } = useTheme();

  interface ShortcutDef { id: string; keys: string; }

  const shortcutsRef = useRef<ShortcutDef[]>([]);

  // Load shortcuts from localStorage (set by SettingsView) and listen for changes
  useEffect(() => {
    function loadShortcuts() {
      try {
        const saved = localStorage.getItem("vec-keyboard-shortcuts");
        if (saved) shortcutsRef.current = JSON.parse(saved);
      } catch { /* ignore */ }
    }
    loadShortcuts();
    // Also load from server on mount
    fetch(apiUrl("/api/shortcuts-config")).then(r => r.json()).then((data: ShortcutDef[] | null) => {
      if (data && Array.isArray(data)) {
        shortcutsRef.current = data;
        localStorage.setItem("vec-keyboard-shortcuts", JSON.stringify(data));
      }
    }).catch(() => {});
    function onChanged(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail)) shortcutsRef.current = detail;
    }
    window.addEventListener("vec-shortcuts-changed", onChanged);
    return () => window.removeEventListener("vec-shortcuts-changed", onChanged);
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't fire shortcuts when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      const pressed: string[] = [];
      if (e.ctrlKey || e.metaKey) pressed.push("Ctrl");
      if (e.shiftKey) pressed.push("Shift");
      if (e.altKey) pressed.push("Alt");
      let key = e.key;
      if (key === " ") key = "Space";
      else if (key.length === 1) key = key.toUpperCase();
      if (["Control", "Shift", "Alt", "Meta"].includes(key)) return;
      pressed.push(key);
      const combo = pressed.join("+");

      const match = shortcutsRef.current.find(s => s.keys === combo);
      if (!match) return;

      // Navigation shortcuts
      const navMap: Record<string, View> = {
        "nav-overview": "overview",
        "nav-kanban": "kanban",
        "nav-chat": "chat",
        "nav-live": "live",
        "nav-workspace": "workspace",
        "nav-events": "events",
        "nav-settings": "settings",
      };

      if (navMap[match.id]) {
        e.preventDefault();
        setActiveView(navMap[match.id]);
        return;
      }

      if (match.id === "toggle-theme") {
        e.preventDefault();
        setTheme(theme === "dark" ? "light" : "dark");
        return;
      }

      if (match.id === "global-search") {
        e.preventDefault();
        // Focus any visible search input on the page
        const searchInput = document.querySelector<HTMLInputElement>("[data-search-input]") ??
          document.querySelector<HTMLInputElement>('input[placeholder*="earch"]');
        if (searchInput) searchInput.focus();
        return;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setActiveView, theme, setTheme]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg-primary)" }}>
      <Sidebar activeView={activeView} setActiveView={setActiveView} chatBadge={unreadCount} reminderBadge={pendingReminders} approvalBadge={approvalCount} />
      <main style={{
        flex: 1, overflow: "hidden", display: "flex", flexDirection: "column",
        background: "var(--bg-card)",
        borderRadius: 14,
        margin: 8,
        boxShadow: "var(--shadow-lg)",
        border: "1px solid var(--border)",
      }}>
        {activeView === "overview" && <OverviewView />}
        {activeView === "kanban" && <KanbanView />}
        {activeView === "events" && <EventsView />}
        {activeView === "snoop" && <SnoopView />}
        {activeView === "directory" && <DirectoryView />}
        {activeView === "chat" && <ChatView perAgentUnread={perAgentUnread} onAgentRead={markAgentRead} />}
        {activeView === "live" && <LiveView />}
        {activeView === "finance" && <FinanceView />}
        {activeView === "reminders" && <RemindersView />}
        {activeView === "workspace" && <WorkspaceView />}
        {activeView === "editor" && editorProject && (
          <EditorView
            projectPath={editorProject.path}
            projectName={editorProject.name}
            onBack={() => setActiveView("workspace")}
          />
        )}
        {activeView === "editor" && !editorProject && (
          <div style={{
            height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-muted)", fontSize: 13, gap: 8, flexDirection: "column",
          }}>
            <div>No project selected.</div>
            <button
              onClick={() => setActiveView("workspace")}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)",
                background: "var(--bg-card)", color: "var(--text-secondary)",
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
              }}
            >Go to Workspace</button>
          </div>
        )}
        {activeView === "settings" && <SettingsView />}
      </main>

      {tourPhase === "walkthrough" && (
        <WelcomeTour
          setActiveView={setActiveView}
          onDone={() => { markTourDone(); setTourPhase(null); }}
        />
      )}

      <ChatToasts toasts={toasts} onDismiss={dismissToast} onClickToast={handleToastClick} />
    </div>
  );
}
