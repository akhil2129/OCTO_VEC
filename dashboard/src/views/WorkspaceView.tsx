import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen, File, ChevronRight, ChevronDown, GitBranch,
  RefreshCw, Search, FolderTree, Folder,
  FileText, FileCode, FileJson, Image, Package, Terminal,
  Check, Copy, ExternalLink, ChevronUp, X, Maximize2,
} from "lucide-react";
import { usePolling, postApi } from "../hooks/useApi";

// ── Types ────────────────────────────────────────────────────────────────────

interface TreeEntry {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  modified?: string;
  children?: TreeEntry[];
  gitStatus?: {
    isRepo: boolean;
    branch?: string;
    dirty?: boolean;
    commitCount?: number;
    lastCommit?: string;
  };
}

interface WorkspaceTree {
  workspace: string;
  tree: Record<string, { label: string; absPath: string; entries: TreeEntry[] }>;
}

interface FilePreview {
  path: string;
  content?: string;
  size: number;
  modified?: string;
  truncated?: boolean;
  kind?: "text" | "image" | "pdf" | "binary";
  mime?: string;
  dataUri?: string;
  message?: string;
}

interface EditorInfo {
  id: string;
  name: string;
  cmd: string;
}

// ── Editor brand map (color + abbreviation) ──────────────────────────────────

const EDITOR_BRAND: Record<string, { color: string; bg: string; abbr: string }> = {
  vscode:      { color: "#fff",  bg: "#007ACC", abbr: "VS" },
  cursor:      { color: "#fff",  bg: "#000000", abbr: "Cu" },
  windsurf:    { color: "#fff",  bg: "#09B6A2", abbr: "Wi" },
  antigravity: { color: "#fff",  bg: "#6C5CE7", abbr: "AG" },
  zed:         { color: "#fff",  bg: "#084CCF", abbr: "Z" },
  sublime:     { color: "#fff",  bg: "#FF9800", abbr: "ST" },
  webstorm:    { color: "#fff",  bg: "#07C3F2", abbr: "WS" },
  intellij:    { color: "#fff",  bg: "#FE315D", abbr: "IJ" },
  fleet:       { color: "#fff",  bg: "#7B61FF", abbr: "Fl" },
  atom:        { color: "#fff",  bg: "#40A02B", abbr: "At" },
  notepadpp:   { color: "#fff",  bg: "#90BE6D", abbr: "N+" },
  vim:         { color: "#fff",  bg: "#019833", abbr: "Vi" },
  nvim:        { color: "#fff",  bg: "#57A143", abbr: "Nv" },
  emacs:       { color: "#fff",  bg: "#7F5AB6", abbr: "Em" },
};

function EditorIcon({ id, size = 20 }: { id: string; size?: number }) {
  const brand = EDITOR_BRAND[id] ?? { color: "#fff", bg: "#666", abbr: "?" };
  return (
    <span style={{
      width: size, height: size, borderRadius: size * 0.25,
      background: brand.bg, color: brand.color,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.45, fontWeight: 800, lineHeight: 1,
      fontFamily: "'Inter', 'SF Pro', -apple-system, sans-serif",
      letterSpacing: "-0.02em", flexShrink: 0,
    }}>
      {brand.abbr}
    </span>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string, size = 14): React.ReactNode {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "cpp", "c", "rb", "php", "swift", "kt"].includes(ext))
    return <FileCode size={size} />;
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext))
    return <FileJson size={size} />;
  if (["md", "txt", "rst", "log", "csv"].includes(ext))
    return <FileText size={size} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext))
    return <Image size={size} />;
  if (["Dockerfile", "docker-compose.yml"].includes(name) || ext === "dockerfile")
    return <Package size={size} />;
  if (name === "package.json" || name === "Cargo.toml" || name === "go.mod" || name === "requirements.txt")
    return <Package size={size} />;
  if (ext === "sh" || ext === "bat" || ext === "ps1" || name === "Makefile")
    return <Terminal size={size} />;
  return <File size={size} />;
}

function getLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript (React)", js: "JavaScript", jsx: "JavaScript (React)",
    py: "Python", rs: "Rust", go: "Go", java: "Java", rb: "Ruby", php: "PHP",
    json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML",
    md: "Markdown", txt: "Text", css: "CSS", scss: "SCSS", html: "HTML",
    sql: "SQL", sh: "Shell", bat: "Batch", ps1: "PowerShell",
  };
  return map[ext] ?? ext.toUpperCase();
}

function inferProjectLang(entry: TreeEntry): { label: string; color: string } {
  const files = entry.children ?? [];
  const names = files.map(f => f.name.toLowerCase());
  if (names.includes("package.json")) return { label: "Node.js", color: "#68a063" };
  if (names.includes("cargo.toml")) return { label: "Rust", color: "#dea584" };
  if (names.includes("go.mod")) return { label: "Go", color: "#00add8" };
  if (names.includes("requirements.txt") || names.includes("pyproject.toml")) return { label: "Python", color: "#3776ab" };
  if (names.includes("pom.xml") || names.includes("build.gradle")) return { label: "Java", color: "#f89820" };
  if (names.includes("gemfile")) return { label: "Ruby", color: "#cc342d" };
  if (names.includes("composer.json")) return { label: "PHP", color: "#777bb4" };
  if (names.some(n => n.endsWith(".sln") || n.endsWith(".csproj"))) return { label: "C#", color: "#68217a" };
  const exts = files.filter(f => f.type === "file").map(f => f.name.split(".").pop()?.toLowerCase() ?? "");
  if (exts.includes("ts") || exts.includes("tsx")) return { label: "TypeScript", color: "#3178c6" };
  if (exts.includes("js") || exts.includes("jsx")) return { label: "JavaScript", color: "#f7df1e" };
  if (exts.includes("py")) return { label: "Python", color: "#3776ab" };
  return { label: "Project", color: "var(--text-muted)" };
}

function countFiles(entries: TreeEntry[]): number {
  let n = 0;
  for (const e of entries) {
    if (e.type === "file") n++; else if (e.children) n += countFiles(e.children);
  }
  return n;
}
function countFolders(entries: TreeEntry[]): number {
  let n = 0;
  for (const e of entries) {
    if (e.type === "folder") { n++; if (e.children) n += countFolders(e.children); }
  }
  return n;
}

const FOLDER_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#84cc16"];
function folderColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return FOLDER_COLORS[Math.abs(h) % FOLDER_COLORS.length];
}

// ── "Open with" Dropdown ─────────────────────────────────────────────────────

function OpenWithDropdown({
  editors, onOpen, triggerLabel, triggerSize,
}: {
  editors: EditorInfo[];
  onOpen: (editorId: string) => void;
  triggerLabel?: string;
  triggerSize?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const sz = triggerSize ?? "md";

  // Position the menu relative to the button using screen coords
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    // Align bottom-right of button → top-right of menu
    setPos({ top: rect.bottom + 4, left: rect.right });
  }, [open]);

  // Close on outside click or scroll
  useEffect(() => {
    if (!open) return;
    function handleClose(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener("mousedown", handleClose);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClose);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  if (editors.length === 0) return null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        style={{
          display: "flex", alignItems: "center", gap: sz === "sm" ? 4 : 6,
          padding: sz === "sm" ? "3px 8px" : "6px 12px",
          borderRadius: 6, border: "1px solid var(--border)",
          background: open ? "var(--bg-hover)" : "var(--bg-card)",
          color: "var(--text-secondary)",
          fontSize: sz === "sm" ? 11 : 12, fontWeight: 500,
          cursor: "pointer", fontFamily: "inherit",
          transition: "background 0.1s, border-color 0.1s",
        }}
      >
        <ExternalLink size={sz === "sm" ? 11 : 13} />
        {triggerLabel ?? "Open with"}
        <ChevronDown size={sz === "sm" ? 10 : 11} style={{ opacity: 0.5 }} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: "translateX(-100%)", // anchor right edge to left
            minWidth: 220, padding: 4,
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)",
            zIndex: 9999,
          }}
        >
          {editors.map(ed => (
            <button
              key={ed.id}
              onClick={(e) => { e.stopPropagation(); onOpen(ed.id); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", border: "none", borderRadius: 7,
                background: "transparent", color: "var(--text-primary)",
                fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                textAlign: "left", transition: "background 0.08s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ flex: 1, fontWeight: 500 }}>{ed.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WorkspaceView() {
  const { data, refresh } = usePolling<WorkspaceTree>("/api/workspace-tree", 10000);
  const { data: editorsData } = usePolling<EditorInfo[]>("/api/workspace-editors", 30000);
  const editors = editorsData ?? [];
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["projects", "shared", "agents"]));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedPath, setCopiedPath] = useState(false);
  const [fileSearch, setFileSearch] = useState("");
  const [fileSearchIdx, setFileSearchIdx] = useState(0);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const loadFile = useCallback(async (path: string) => {
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/workspace-file?path=${encodeURIComponent(path)}`, { credentials: "include" });
      if (res.ok) setFilePreview(await res.json());
    } catch { /* silent */ }
    finally { setLoadingPreview(false); }
  }, []);

  useEffect(() => {
    if (selectedFile) { loadFile(selectedFile); setFileSearch(""); setFileSearchIdx(0); setShowFileSearch(false); }
    else setFilePreview(null);
  }, [selectedFile, loadFile]);

  function toggleExpand(path: string) {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  async function openInEditor(path: string, editorId: string) {
    try {
      const r = await postApi("/api/workspace-open", { path, editor: editorId });
      if (r && r.ok === false) console.warn("[openInEditor]", r.error ?? r.message);
    } catch (e) {
      console.warn("[openInEditor] request failed", e);
    }
  }

  function copyPath(p: string) {
    navigator.clipboard.writeText(p);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  }

  function filterEntries(entries: TreeEntry[], query: string): TreeEntry[] {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.reduce<TreeEntry[]>((acc, entry) => {
      if (entry.name.toLowerCase().includes(q)) acc.push(entry);
      else if (entry.type === "folder" && entry.children) {
        const filtered = filterEntries(entry.children, query);
        if (filtered.length > 0) acc.push({ ...entry, children: filtered });
      }
      return acc;
    }, []);
  }

  const tree = data?.tree;
  const projectEntries = tree?.projects?.entries ?? [];
  const totalFiles = tree ? Object.values(tree).reduce((s, sec) => s + countFiles(sec.entries), 0) : 0;


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div className="page-header" style={{ padding: "24px 28px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 className="page-title" style={{ flex: 1 }}>Workspace</h1>
          {/* Detected editors badges */}
          {editors.length > 0 && (
            <div style={{ display: "flex", gap: 3, alignItems: "center", marginRight: 4 }}>
              {editors.map(ed => (
                <span key={ed.id} title={`${ed.name} installed`}><EditorIcon id={ed.id} size={18} /></span>
              ))}
            </div>
          )}
          <button onClick={() => refresh()} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg-card)", color: "var(--text-secondary)",
            fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <div className="page-subtitle" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{data?.workspace ?? "Loading..."}</span>
          {data?.workspace && (
            <button onClick={() => copyPath(data.workspace)} title="Copy path" style={{
              background: "none", border: "none", cursor: "pointer",
              color: copiedPath ? "var(--green)" : "var(--text-muted)", padding: 2,
            }}>
              {copiedPath ? <Check size={12} /> : <Copy size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: "0 28px 16px", display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "Projects", value: projectEntries.length, color: "var(--accent)" },
          { label: "Git Repos", value: projectEntries.filter(e => e.gitStatus?.isRepo).length, color: "var(--green)" },
          { label: "Editors", value: editors.length, color: "var(--cyan, #06b6d4)" },
          { label: "Total Files", value: totalFiles, color: "var(--purple)" },
        ].map(s => (
          <div key={s.label} style={{
            flex: "1 1 100px", padding: "14px 18px",
            background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5, fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ padding: "0 28px 14px" }}>
        <WorkspaceSearch value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", padding: "0 28px 20px", gap: 16 }}>
        {/* Left: tree */}
        <div style={{
          flex: selectedFile ? "0 0 420px" : 1, overflow: "auto",
          display: "flex", flexDirection: "column", gap: 16,
          transition: "flex 0.2s",
        }}>
          {!tree ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading workspace...</div>
          ) : (
            Object.entries(tree).map(([sectionId, section]) => {
              const filtered = filterEntries(section.entries, searchQuery);
              const isExpanded = expandedPaths.has(sectionId);
              const isProjects = sectionId === "projects";

              return (
                <div key={sectionId}>
                  {/* Section header */}
                  {(() => {
                    const secColor = isProjects ? "var(--accent)" : sectionId === "shared" ? "var(--blue)" : "var(--purple)";
                    return (
                      <button onClick={() => toggleExpand(sectionId)} style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "8px 12px", border: "none",
                        background: "var(--bg-secondary)", borderRadius: 10,
                        color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit",
                        fontSize: 13, fontWeight: 600, textAlign: "left",
                        marginBottom: isExpanded ? 10 : 0,
                        transition: "background 0.1s",
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                        onMouseLeave={e => e.currentTarget.style.background = "var(--bg-secondary)"}
                      >
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: `color-mix(in srgb, ${secColor} 12%, transparent)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: secColor,
                        }}>
                          <FolderTree size={14} />
                        </div>
                        <span style={{ flex: 1 }}>{section.label}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
                          background: "var(--bg-card)", border: "1px solid var(--border)",
                          padding: "1px 8px", borderRadius: 5,
                        }}>
                          {filtered.length}
                        </span>
                        <span style={{ color: "var(--text-muted)", display: "flex" }}>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </span>
                      </button>
                    );
                  })()}

                  {/* Projects: card grid */}
                  {isExpanded && isProjects && (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10, padding: "8px 0" }}>
                      {filtered.length === 0 ? (
                        <div style={{ gridColumn: "1 / -1", padding: 20, color: "var(--text-muted)", fontSize: 12, fontStyle: "italic", textAlign: "center" }}>
                          {searchQuery ? "No matches" : "No projects yet"}
                        </div>
                      ) : filtered.map(entry => (
                        <ProjectCard key={entry.path} entry={entry} editors={editors}
                          onOpenInApp={() => window.dispatchEvent(new CustomEvent("vec:open-editor", { detail: { path: entry.path, name: entry.name } }))}
                          onOpenExternal={(edId) => openInEditor(entry.path, edId)}
                          onExpand={() => toggleExpand(entry.path)}
                          expanded={expandedPaths.has(entry.path)}
                          onSelectFile={setSelectedFile} selectedFile={selectedFile} />
                      ))}
                    </div>
                  )}

                  {/* Shared/Agents: tree */}
                  {isExpanded && !isProjects && (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-card)", overflow: "hidden" }}>
                      {filtered.length === 0 ? (
                        <div style={{ padding: "16px 20px", color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>
                          {searchQuery ? "No matches" : "Empty"}
                        </div>
                      ) : filtered.map(entry => (
                        <TreeNode key={entry.path} entry={entry} depth={0}
                          expandedPaths={expandedPaths} toggleExpand={toggleExpand}
                          selectedFile={selectedFile} onSelectFile={setSelectedFile}
                          editors={editors} onOpenEditor={(p, ed) => openInEditor(p, ed)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right: file preview */}
        {selectedFile && (
          <FilePreviewPanel
            selectedFile={selectedFile}
            filePreview={filePreview}
            loadingPreview={loadingPreview}
            editors={editors}
            openInEditor={openInEditor}
            fileSearch={fileSearch}
            setFileSearch={setFileSearch}
            fileSearchIdx={fileSearchIdx}
            setFileSearchIdx={setFileSearchIdx}
            showFileSearch={showFileSearch}
            setShowFileSearch={setShowFileSearch}
            previewScrollRef={previewScrollRef}
            onClose={() => { setSelectedFile(null); setFilePreview(null); }}
          />
        )}
      </div>
    </div>
  );
}

// ── File Preview Panel ────────────────────────────────────────────────────────

function FilePreviewPanel({
  selectedFile, filePreview, loadingPreview, editors, openInEditor,
  fileSearch, setFileSearch, fileSearchIdx, setFileSearchIdx,
  showFileSearch, setShowFileSearch, previewScrollRef, onClose,
}: {
  selectedFile: string;
  filePreview: FilePreview | null;
  loadingPreview: boolean;
  editors: EditorInfo[];
  openInEditor: (path: string, editorId: string) => void;
  fileSearch: string;
  setFileSearch: (v: string) => void;
  fileSearchIdx: number;
  setFileSearchIdx: (v: number | ((n: number) => number)) => void;
  showFileSearch: boolean;
  setShowFileSearch: (v: boolean) => void;
  previewScrollRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isTextFile = filePreview && (!filePreview.kind || filePreview.kind === "text") && filePreview.content;

  const lines = useMemo(() => {
    if (!isTextFile || !filePreview?.content) return [];
    return filePreview.content.split("\n");
  }, [filePreview?.content, isTextFile]);

  // Find matching line indices
  const matchingLines = useMemo(() => {
    if (!fileSearch || !lines.length) return [];
    const q = fileSearch.toLowerCase();
    const matches: number[] = [];
    lines.forEach((line, i) => { if (line.toLowerCase().includes(q)) matches.push(i); });
    return matches;
  }, [fileSearch, lines]);

  // Scroll to current match
  useEffect(() => {
    if (matchingLines.length === 0 || !previewScrollRef.current) return;
    const lineIdx = matchingLines[fileSearchIdx % matchingLines.length];
    const lineEl = previewScrollRef.current.querySelector(`[data-line="${lineIdx}"]`) as HTMLElement;
    if (lineEl) lineEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [fileSearchIdx, matchingLines, previewScrollRef]);

  // Keyboard shortcut: Ctrl+F to open search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && selectedFile) {
        e.preventDefault();
        setShowFileSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && showFileSearch) {
        setShowFileSearch(false);
        setFileSearch("");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedFile, showFileSearch, setShowFileSearch, setFileSearch]);

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      if (e.shiftKey) setFileSearchIdx((i: number) => Math.max(0, i - 1));
      else setFileSearchIdx((i: number) => i + 1);
    }
    if (e.key === "Escape") { setShowFileSearch(false); setFileSearch(""); }
  }

  // Highlight matching text in a line
  function highlightLine(text: string, lineIdx: number) {
    if (!fileSearch) return text;
    const q = fileSearch.toLowerCase();
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return text;
    const isCurrent = matchingLines.length > 0 && matchingLines[fileSearchIdx % matchingLines.length] === lineIdx;
    const parts: React.ReactNode[] = [];
    let last = 0;
    let pos = lower.indexOf(q, 0);
    let matchIdx = 0;
    while (pos !== -1) {
      if (pos > last) parts.push(text.slice(last, pos));
      parts.push(
        <mark key={matchIdx} style={{
          background: isCurrent ? "var(--orange, #f59e0b)" : "var(--yellow, #fbbf24)",
          color: "#000", borderRadius: 2, padding: "0 1px",
        }}>{text.slice(pos, pos + q.length)}</mark>
      );
      last = pos + q.length;
      pos = lower.indexOf(q, last);
      matchIdx++;
    }
    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
  }

  const lineNumWidth = lines.length > 0 ? String(lines.length).length * 8 + 16 : 32;

  const fileName = selectedFile.split(/[/\\]/).pop() ?? "";
  const langLabel = getLanguage(fileName);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
      border: "1px solid var(--border)", borderRadius: 14,
      background: "var(--bg-primary)",
      boxShadow: "0 2px 16px rgba(0,0,0,0.08)",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10,
        background: "var(--bg-card)", borderRadius: "14px 14px 0 0",
      }}>
        {/* File type icon in tinted circle */}
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--accent)",
        }}>
          {getFileIcon(fileName, 15)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {fileName}
          </div>
          {filePreview && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
              {langLabel}{filePreview.size ? ` · ${formatSize(filePreview.size)}` : ""}
              {isTextFile && lines.length > 0 ? ` · ${lines.length} lines` : ""}
            </div>
          )}
        </div>
        {/* Search toggle */}
        {isTextFile && (
          <button
            title="Search in file (Ctrl+F)"
            onClick={() => { setShowFileSearch(!showFileSearch); if (!showFileSearch) setTimeout(() => searchInputRef.current?.focus(), 50); }}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)",
              background: showFileSearch ? "var(--bg-hover)" : "transparent",
              color: showFileSearch ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: 11, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <Search size={12} /> Find
          </button>
        )}
        <OpenWithDropdown editors={editors} onOpen={(edId) => openInEditor(selectedFile, edId)} triggerSize="sm" />
        <button onClick={onClose} title="Close" style={{
          width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)",
          background: "transparent", color: "var(--text-muted)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", padding: 0, flexShrink: 0,
          transition: "background 0.1s, color 0.1s",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, var(--red) 12%, transparent)"; e.currentTarget.style.color = "var(--red)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
        ><X size={13} /></button>
      </div>

      {/* Search bar */}
      {showFileSearch && isTextFile && (
        <div style={{
          padding: "7px 14px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 8, background: "var(--bg-card)",
        }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 7,
            background: "var(--bg-secondary)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "4px 10px",
          }}>
            <Search size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              ref={searchInputRef}
              value={fileSearch}
              onChange={e => { setFileSearch(e.target.value); setFileSearchIdx(0); }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search in file..."
              style={{
                flex: 1, border: "none", background: "transparent",
                color: "var(--text-primary)", fontSize: 12, fontFamily: "inherit",
                outline: "none", minWidth: 0,
              }}
            />
          </div>
          {fileSearch && (
            <span style={{
              fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap",
              background: "var(--bg-secondary)", padding: "3px 8px", borderRadius: 5,
              border: "1px solid var(--border)",
            }}>
              {matchingLines.length > 0
                ? `${(fileSearchIdx % matchingLines.length) + 1} / ${matchingLines.length}`
                : "No results"}
            </span>
          )}
          <button onClick={() => setFileSearchIdx((i: number) => Math.max(0, i - 1))}
            title="Previous (Shift+Enter)"
            disabled={matchingLines.length === 0}
            style={{
              display: "flex", padding: "4px 5px", border: "1px solid var(--border)", borderRadius: 6,
              background: "var(--bg-secondary)", color: "var(--text-muted)", cursor: "pointer",
              opacity: matchingLines.length === 0 ? 0.3 : 1,
            }}><ChevronUp size={12} /></button>
          <button onClick={() => setFileSearchIdx((i: number) => i + 1)}
            title="Next (Enter)"
            disabled={matchingLines.length === 0}
            style={{
              display: "flex", padding: "4px 5px", border: "1px solid var(--border)", borderRadius: 6,
              background: "var(--bg-secondary)", color: "var(--text-muted)", cursor: "pointer",
              opacity: matchingLines.length === 0 ? 0.3 : 1,
            }}><ChevronDown size={12} /></button>
          <button onClick={() => { setShowFileSearch(false); setFileSearch(""); }}
            style={{
              display: "flex", padding: "4px 5px", border: "none", borderRadius: 6,
              background: "transparent", color: "var(--text-muted)", cursor: "pointer",
            }}><X size={12} /></button>
        </div>
      )}

      {/* Content */}
      <div ref={previewScrollRef as React.RefObject<HTMLDivElement>} style={{ flex: 1, overflow: "auto" }}>
        {loadingPreview ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>
        ) : filePreview ? (
          filePreview.kind === "image" && filePreview.dataUri ? (
            <div style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <img src={filePreview.dataUri} alt={filePreview.path}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }} />
            </div>
          ) : filePreview.kind === "pdf" && filePreview.dataUri ? (
            <iframe src={filePreview.dataUri} title={filePreview.path}
              style={{ width: "100%", height: "100%", border: "none" }} />
          ) : filePreview.kind === "binary" ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              <Package size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Binary file</div>
              <div>{filePreview.message ?? "This file type cannot be previewed."}</div>
              <div style={{ marginTop: 12 }}>
                <OpenWithDropdown editors={editors} onOpen={(edId) => openInEditor(selectedFile, edId)} triggerLabel="Open in editor" />
              </div>
            </div>
          ) : isTextFile ? (
            <div style={{ display: "flex", fontSize: 12.5, lineHeight: "1.65", fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}>
              {/* Line numbers gutter */}
              <div style={{
                width: lineNumWidth + 8, flexShrink: 0, textAlign: "right",
                padding: "16px 10px 40px 16px", userSelect: "none", fontSize: 11,
                color: "var(--text-muted)", opacity: 0.4,
                borderRight: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-card) 60%, transparent)",
                letterSpacing: "0.01em",
              }}>
                {lines.map((_, i) => {
                  const isMatch = matchingLines.includes(i);
                  const isCurrent = isMatch && matchingLines[fileSearchIdx % matchingLines.length] === i;
                  return (
                    <div key={i} data-line={i} style={{
                      height: "1.65em",
                      background: isCurrent
                        ? "color-mix(in srgb, var(--orange, #f59e0b) 18%, transparent)"
                        : isMatch ? "color-mix(in srgb, var(--yellow, #fbbf24) 10%, transparent)" : "transparent",
                      color: isCurrent ? "var(--orange, #f59e0b)" : undefined,
                      fontWeight: isCurrent ? 700 : undefined,
                    }}>
                      {i + 1}
                    </div>
                  );
                })}
              </div>
              {/* Code content */}
              <pre style={{
                margin: 0, padding: "16px 20px 40px 14px", flex: 1, minWidth: 0,
                color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", tabSize: 2,
              }}>
                {lines.map((line, i) => {
                  const isMatch = matchingLines.includes(i);
                  const isCurrent = isMatch && matchingLines[fileSearchIdx % matchingLines.length] === i;
                  return (
                    <div key={i} data-line={i} style={{
                      height: "1.65em",
                      background: isCurrent
                        ? "color-mix(in srgb, var(--orange, #f59e0b) 10%, transparent)"
                        : isMatch ? "color-mix(in srgb, var(--yellow, #fbbf24) 7%, transparent)" : "transparent",
                      borderLeft: isCurrent ? "2px solid var(--orange, #f59e0b)" : "2px solid transparent",
                      paddingLeft: 4,
                    }}>
                      {highlightLine(line, i)}
                    </div>
                  );
                })}
              </pre>
            </div>
          ) : (
            <pre style={{
              margin: 0, padding: 20, fontSize: 12.5, lineHeight: 1.65,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word", tabSize: 2,
            }}>{filePreview.content}</pre>
          )
        ) : (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            <File size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontWeight: 500 }}>Select a file to preview</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Project Card ─────────────────────────────────────────────────────────────

function ProjectCard({
  entry, editors, onOpenInApp, onOpenExternal, onExpand, expanded, onSelectFile, selectedFile,
}: {
  entry: TreeEntry;
  editors: EditorInfo[];
  onOpenInApp: () => void;
  onOpenExternal: (editorId: string) => void;
  onExpand: () => void;
  expanded: boolean;
  onSelectFile: (p: string | null) => void;
  selectedFile: string | null;
}) {
  const [hovered, setHovered] = useState(false);
  const color = folderColor(entry.name);
  const lang = inferProjectLang(entry);
  const fileCount = countFiles(entry.children ?? []);
  const folderCount = countFolders(entry.children ?? []);
  const git = entry.gitStatus;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered ? color + "55" : "var(--border)"}`,
        borderRadius: 14,
        background: "var(--bg-card)", overflow: "hidden",
        transition: "border-color 0.18s, box-shadow 0.18s",
        boxShadow: hovered ? `0 4px 20px ${color}18` : "0 1px 4px rgba(0,0,0,0.04)",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Card body */}
      <div style={{ padding: "18px 18px 14px", cursor: "default", position: "relative" }}>

        {/* Top row: icon + name */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14,
            background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Folder size={26} style={{ color }} fill={`${color}30`} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: "var(--text-primary)",
              wordBreak: "break-word",
            }}>
              {entry.name}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4,
                background: `${lang.color}18`, color: lang.color, border: `1px solid ${lang.color}30`,
              }}>
                {lang.label}
              </span>
              {git?.isRepo && (
                <span style={{
                  display: "flex", alignItems: "center", gap: 3,
                  fontSize: 10, fontWeight: 500,
                  color: git.dirty ? "var(--orange)" : "var(--green)",
                }}>
                  <GitBranch size={10} /> {git.branch ?? "main"}
                  {git.dirty && <span style={{ fontSize: 12 }}>•</span>}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text-muted)" }}>
          <span>{fileCount} files</span>
          <span>·</span>
          <span>{folderCount} dirs</span>
          {git?.commitCount !== undefined && git.commitCount > 0 && (
            <>
              <span>·</span>
              <span>{git.commitCount} commits</span>
            </>
          )}
        </div>

        {/* Last commit */}
        {git?.lastCommit && (
          <div style={{
            fontSize: 10, color: "var(--text-muted)", marginTop: 6,
            wordBreak: "break-word", fontStyle: "italic",
          }}>
            {git.lastCommit}
          </div>
        )}

        {/* Action bar */}
        <div style={{ display: "flex", gap: 6, marginTop: 14 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={onOpenInApp}
            title="Open in the built-in Monaco editor"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "7px 0", borderRadius: 8, border: "none",
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              color, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              transition: "opacity 0.1s",
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <FileCode size={13} />
            Open in Editor
          </button>
          <button
            onClick={onExpand}
            title="Browse files"
            style={{
              width: 34, display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-secondary)", color: "var(--text-muted)",
              cursor: "pointer", padding: 0, flexShrink: 0,
              transition: "background 0.1s, color 0.1s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "var(--bg-secondary)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <FolderOpen size={13} />
          </button>
          {editors.length > 0 && (
            <div onClick={e => e.stopPropagation()}>
              <OpenWithDropdown editors={editors} onOpen={onOpenExternal} triggerSize="sm" />
            </div>
          )}
        </div>
      </div>

      {/* Expanded file list */}
      {expanded && entry.children && entry.children.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border)", maxHeight: 200, overflow: "auto" }}>
          {entry.children.map(child => (
            <div key={child.path}
              onClick={(e) => {
                e.stopPropagation();
                if (child.type === "file") onSelectFile(selectedFile === child.path ? null : child.path);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 14px", fontSize: 12,
                cursor: child.type === "file" ? "pointer" : "default",
                color: selectedFile === child.path ? "var(--text-primary)" : "var(--text-secondary)",
                background: selectedFile === child.path ? "var(--bg-hover)" : "transparent",
                transition: "background 0.08s",
              }}
              onMouseEnter={e => { if (child.type === "file") e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (selectedFile !== child.path) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ display: "flex", flexShrink: 0, color: child.type === "folder" ? color : "var(--text-muted)" }}>
                {child.type === "folder" ? <FolderOpen size={12} /> : getFileIcon(child.name, 12)}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {child.name}
              </span>
              {child.type === "file" && child.size !== undefined && (
                <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(child.size)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tree Node (shared/agents sections) ───────────────────────────────────────

function TreeNode({
  entry, depth, expandedPaths, toggleExpand, selectedFile, onSelectFile, editors, onOpenEditor,
}: {
  entry: TreeEntry; depth: number;
  expandedPaths: Set<string>; toggleExpand: (p: string) => void;
  selectedFile: string | null; onSelectFile: (p: string | null) => void;
  editors: EditorInfo[]; onOpenEditor: (p: string, editorId: string) => void;
}) {
  const isFolder = entry.type === "folder";
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = selectedFile === entry.path;
  const [hovered, setHovered] = useState(false);
  const paddingLeft = 14 + depth * 18;

  return (
    <>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          if (isFolder) toggleExpand(entry.path);
          else onSelectFile(isSelected ? null : entry.path);
        }}
        style={{
          display: "flex", alignItems: "center", gap: 7,
          paddingLeft, paddingRight: 12, height: 32, cursor: "pointer",
          background: isSelected ? "var(--bg-hover)" : hovered ? "color-mix(in srgb, var(--bg-hover) 50%, transparent)" : "transparent",
          color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
          fontSize: 13, whiteSpace: "nowrap", transition: "background 0.08s",
          borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        }}
      >
        {isFolder ? (
          <span style={{ display: "flex", width: 14, justifyContent: "center", flexShrink: 0, color: "var(--text-muted)" }}>
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : <span style={{ width: 14, flexShrink: 0 }} />}

        <span style={{ display: "flex", flexShrink: 0, color: isFolder ? "var(--accent)" : "var(--text-muted)" }}>
          {isFolder ? <FolderOpen size={14} /> : getFileIcon(entry.name)}
        </span>

        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", fontWeight: isFolder && depth === 0 ? 600 : 400 }}>
          {entry.name}
        </span>

        {!isFolder && entry.size !== undefined && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{formatSize(entry.size)}</span>
        )}

        {/* Open with on hover */}
        {hovered && (
          <span onClick={(e) => e.stopPropagation()}>
            <OpenWithDropdown editors={editors} onOpen={(edId) => onOpenEditor(entry.path, edId)} triggerSize="sm" triggerLabel="Open" />
          </span>
        )}
      </div>

      {isFolder && isExpanded && entry.children?.map(child => (
        <TreeNode key={child.path} entry={child} depth={depth + 1}
          expandedPaths={expandedPaths} toggleExpand={toggleExpand}
          selectedFile={selectedFile} onSelectFile={onSelectFile}
          editors={editors} onOpenEditor={onOpenEditor} />
      ))}
    </>
  );
}
