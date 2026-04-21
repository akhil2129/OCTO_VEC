import { useRef, useEffect, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { useAgentStream } from "../hooks/useSSE";
import { usePolling } from "../hooks/useApi";
import { useEmployees } from "../context/EmployeesContext";
import type { Employee, MessageFlowEntry } from "../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface NodeData { key: string; name: string; initials: string; x: number; y: number; isHub?: boolean }
interface EdgeData { from: string; to: string; lastActivity: number; count: number }

function getInitials(name: string): string {
  const parts = name.split(" ");
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function buildNodes(emps: Employee[], cx: number, cy: number, radius: number): NodeData[] {
  const centerIdx = emps.findIndex(e => e.role?.toLowerCase() === "pm" || e.role?.toLowerCase().includes("manager"));
  const hub = centerIdx >= 0 ? emps[centerIdx] : null;
  const ring = hub ? emps.filter((_, i) => i !== centerIdx) : emps;

  const nodes: NodeData[] = ring.map((emp, i) => {
    const angle = (2 * Math.PI * i) / ring.length - Math.PI / 2;
    return {
      key: emp.agent_key,
      name: emp.name.split(" ")[0],
      initials: getInitials(emp.name),
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  if (hub) {
    nodes.push({ key: hub.agent_key, name: hub.name.split(" ")[0], initials: getInitials(hub.name), x: cx, y: cy, isHub: true });
  }

  return nodes;
}

function buildEdges(flow: MessageFlowEntry[]): EdgeData[] {
  const map = new Map<string, EdgeData>();
  for (const f of flow) {
    const k = `${f.from}->${f.to}`;
    const ts = new Date(f.ts).getTime();
    const e = map.get(k);
    if (e) { e.lastActivity = Math.max(e.lastActivity, ts); e.count++; }
    else map.set(k, { from: f.from, to: f.to, lastActivity: ts, count: 1 });
  }
  return Array.from(map.values());
}

function easeOut(t: number): number { const t1 = 1 - t; return 1 - t1 * t1 * t1; }

/** Read a CSS variable's computed value from :root */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Parse a CSS color string to [r, g, b] or null */
function parseColor(c: string): [number, number, number] | null {
  // Handle hex
  const hexMatch = c.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const h = hexMatch[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  // Handle rgb/rgba
  const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
  return null;
}

function rgba(rgb: [number, number, number], a: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// ── Theme palette read at draw time ─────────────────────────────────────────

interface ThemePalette {
  bg: [number, number, number];
  text: [number, number, number];
  muted: [number, number, number];
  accent: [number, number, number]; // blue accent for firing
  border: [number, number, number];
}

function readTheme(): ThemePalette {
  const bg = parseColor(cssVar("--bg-tertiary")) ?? [30, 30, 30];
  const text = parseColor(cssVar("--text-primary")) ?? [220, 220, 220];
  const muted = parseColor(cssVar("--text-muted")) ?? [140, 140, 140];
  const accent = parseColor(cssVar("--blue")) ?? parseColor(cssVar("--accent")) ?? [100, 160, 220];
  const border = parseColor(cssVar("--border")) ?? [60, 60, 60];
  return { bg, text, muted, accent, border };
}

const ZOOM_BTN: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, border: "1px solid var(--border)",
  background: "var(--bg-card)", color: "var(--text-muted)",
  cursor: "pointer", padding: 0, fontFamily: "inherit",
  transition: "background 0.15s, color 0.15s",
};

export default function NetworkPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<NodeData[]>([]);
  const edgesRef = useRef<EdgeData[]>([]);
  const activeRef = useRef<Set<string>>(new Set());
  const zoomRef = useRef(1);
  const themeRef = useRef<ThemePalette>(readTheme());
  const somaRRef = useRef(22);

  const { activeAgents: activeMap } = useAgentStream();
  const { employees } = useEmployees();
  const { data: flowData } = usePolling<MessageFlowEntry[]>("/api/message-flow", 3000);

  const emps = employees ?? [];
  const flow = flowData ?? [];

  useEffect(() => {
    activeRef.current = new Set(Object.keys(activeMap).filter((k) => activeMap[k]));
  }, [activeMap]);

  useEffect(() => { edgesRef.current = buildEdges(flow); }, [flow]);

  // Re-read theme periodically (theme changes)
  useEffect(() => {
    const id = setInterval(() => { themeRef.current = readTheme(); }, 2000);
    return () => clearInterval(id);
  }, []);

  const updateLayout = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const n = emps.length;
    const somaR = n === 0 ? 22 : Math.max(12, Math.min(22, Math.floor(200 / Math.max(n, 1))));
    // Shift center up slightly to account for name labels rendered below each node
    const cx = rect.width / 2;
    const cy = rect.height / 2 - (somaR + 14) / 2;
    const pad = somaR + 32;
    const maxR = Math.min(cx - pad, cy - pad);
    // Radius = 1.2× minimum packing, capped at 50% of available space
    const circumR = n > 1 ? (n * (somaR * 2 + somaR * 2)) / (2 * Math.PI) : 0;
    const radius = n <= 1 ? 0 : Math.min(maxR * 0.50, Math.max(circumR * 1.2, maxR * 0.25));
    somaRRef.current = somaR;
    nodesRef.current = buildNodes(emps, cx, cy, radius);
  }, [emps]);

  useEffect(() => {
    updateLayout();
    const obs = new ResizeObserver(() => updateLayout());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [updateLayout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      zoomRef.current = Math.max(0.3, Math.min(4, zoomRef.current * factor));
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const zoomIn = useCallback(() => { zoomRef.current = Math.min(4, zoomRef.current * 1.3); }, []);
  const zoomOut = useCallback(() => { zoomRef.current = Math.max(0.3, zoomRef.current / 1.3); }, []);
  const zoomFit = useCallback(() => { zoomRef.current = 1; }, []);

  /* ── Draw loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function draw() {
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.width / dpr;
      const h = canvas!.height / dpr;
      const T = themeRef.current;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const zoom = zoomRef.current;
      ctx.translate(w / 2, h / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-w / 2, -h / 2);

      const now = Date.now();
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.key, n]));
      const active = activeRef.current;
      const SOMA_R = somaRRef.current;
      const IMPULSE_WINDOW = 20_000;

      // ── Dendrites ──
      // With many agents the full O(n²) mesh becomes noise — only draw real edges.
      // With few agents (≤8) also draw faint adjacent-ring connections for aesthetics.
      const connectedPairs = new Set<string>();
      for (const edge of edges) connectedPairs.add(`${edge.from}:${edge.to}`);

      // ── Layer 1: Ghost mesh — all possible connections at near-invisible opacity ──
      // Every agent CAN speak to every other agent; we show all edges as latent potential.
      // Very low opacity keeps it from becoming visual noise.
      const recentPairs = new Set<string>();
      for (const edge of edges) {
        if (now - edge.lastActivity < 20_000) recentPairs.add(`${edge.from}:${edge.to}`);
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const isRecent = recentPairs.has(`${a.key}:${b.key}`) || recentPairs.has(`${b.key}:${a.key}`);
          if (isRecent) continue; // drawn brighter in layer 2
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const nx = -dy / len, ny = dx / len;
          // Hub spokes slightly more visible than ring-to-ring edges
          const isSpoke = a.isHub || b.isHub;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(mx + nx * len * 0.03, my + ny * len * 0.03, b.x, b.y);
          ctx.strokeStyle = rgba(T.border, isSpoke ? 0.10 : 0.04);
          ctx.lineWidth = isSpoke ? 0.8 : 0.4;
          ctx.stroke();
        }
      }

      // ── Layer 2: Active message-flow edges — pop above the ghost mesh ──
      for (const edge of edges) {
        const a = nodeMap.get(edge.from);
        const b = nodeMap.get(edge.to);
        if (!a || !b) continue;
        const age = now - edge.lastActivity;
        const fade = Math.max(0.06, 0.22 * Math.max(0, 1 - age / 60_000));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = -dy / len, ny = dx / len;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx + nx * len * 0.04, my + ny * len * 0.04, b.x, b.y);
        ctx.strokeStyle = rgba(T.accent, fade);
        ctx.lineWidth = age < 20_000 ? 1.2 : 0.8;
        ctx.stroke();
      }

      // ── Impulses ──
      for (const e of edges) {
        const age = now - e.lastActivity;
        if (age >= IMPULSE_WINDOW) continue;

        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) continue;

        const globalFade = Math.max(0, 1 - age / IMPULSE_WINDOW);
        const phase = ((now - e.lastActivity) % 1800) / 1800;
        const pos = easeOut(phase);

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const nx = -dy / len;
        const ny = dx / len;
        const curveAmt = len * 0.04;
        const cmx = (a.x + b.x) / 2 + nx * curveAmt;
        const cmy = (a.y + b.y) / 2 + ny * curveAmt;

        const t = pos;
        const px = (1-t)*(1-t)*a.x + 2*(1-t)*t*cmx + t*t*b.x;
        const py = (1-t)*(1-t)*a.y + 2*(1-t)*t*cmy + t*t*b.y;
        const alpha = globalFade * (1 - phase * 0.3);

        // Glow
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 18);
        grad.addColorStop(0, rgba(T.accent, 0.25 * alpha));
        grad.addColorStop(0.5, rgba(T.accent, 0.06 * alpha));
        grad.addColorStop(1, rgba(T.accent, 0));
        ctx.beginPath();
        ctx.arc(px, py, 18, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = rgba(T.text, 0.8 * alpha);
        ctx.fill();

        // Trail
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cmx, cmy, px, py);
        ctx.strokeStyle = rgba(T.accent, 0.12 * alpha);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      // ── Nodes ──
      for (const node of nodes) {
        const firing = active.has(node.key);
        const r = node.isHub ? SOMA_R + 8 : SOMA_R;
        const pulse = 0.5 + 0.5 * Math.sin(now / 400);

        if (node.isHub) {
          // Hub: always-on accent ring + subtle steady glow
          const glowR = r + 14 + 3 * pulse;
          const grad = ctx.createRadialGradient(node.x, node.y, r * 0.4, node.x, node.y, glowR);
          grad.addColorStop(0, rgba(T.accent, 0.14 + 0.06 * pulse));
          grad.addColorStop(0.5, rgba(T.accent, 0.05));
          grad.addColorStop(1, rgba(T.accent, 0));
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = rgba(T.bg, 0.95);
          ctx.fill();
          ctx.strokeStyle = rgba(T.accent, firing ? 0.7 + 0.2 * pulse : 0.45 + 0.15 * pulse);
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (firing) {
          const glowR = r + 10 + 4 * pulse;
          const grad = ctx.createRadialGradient(node.x, node.y, r * 0.5, node.x, node.y, glowR);
          grad.addColorStop(0, rgba(T.accent, 0.12 + 0.08 * pulse));
          grad.addColorStop(0.6, rgba(T.accent, 0.04 + 0.03 * pulse));
          grad.addColorStop(1, rgba(T.accent, 0));
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = rgba(T.bg, 0.95);
          ctx.fill();
          ctx.strokeStyle = rgba(T.accent, 0.4 + 0.2 * pulse);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = rgba(T.muted, 0.06);
          ctx.fill();
          ctx.strokeStyle = rgba(T.border, 0.3);
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.font = `${node.isHub ? 600 : 500} ${node.isHub ? 12 : 11}px 'Inter', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = node.isHub ? rgba(T.text, 0.9) : (firing ? rgba(T.text, 0.85) : rgba(T.muted, 0.4));
        ctx.fillText(node.initials, node.x, node.y);

        ctx.font = `400 ${node.isHub ? 11 : 10}px 'Inter', sans-serif`;
        ctx.fillStyle = node.isHub ? rgba(T.text, 0.7) : (firing ? rgba(T.text, 0.6) : rgba(T.muted, 0.25));
        ctx.fillText(node.name, node.x, node.y + r + 12);
      }

      ctx.restore();
      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }} />

      <div style={{
        position: "absolute", top: 12, right: 12,
        display: "flex", borderRadius: 9, overflow: "hidden",
        border: "1px solid var(--border)", boxShadow: "var(--shadow)", zIndex: 10,
      }}>
        <button onClick={zoomOut} title="Zoom out"
          style={{ ...ZOOM_BTN, borderRadius: 0, border: "none", borderRight: "1px solid var(--border)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-card)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        ><ZoomOut size={14} /></button>
        <button onClick={zoomFit} title="Fit to view"
          style={{ ...ZOOM_BTN, borderRadius: 0, border: "none", borderRight: "1px solid var(--border)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-card)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        ><Maximize2 size={14} /></button>
        <button onClick={zoomIn} title="Zoom in"
          style={{ ...ZOOM_BTN, borderRadius: 0, border: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-card)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        ><ZoomIn size={14} /></button>
      </div>
    </div>
  );
}
