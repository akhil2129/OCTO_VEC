/**
 * Generates a neural-network-style GIF of the 9-agent OCTO VEC system.
 * PM at center, 8 specialists in a ring, with animated data pulses flowing between them.
 *
 * Usage: npx tsx scripts/generate-neural-gif.ts
 * Output: landing/neural-network.gif
 */

import { createCanvas } from "@napi-rs/canvas";
import GIFEncoder from "gif-encoder-2";
import { createWriteStream } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "landing", "neural-network.gif");

// ── Config ────────────────────────────────────────────────────────────────────

const WIDTH = 800;
const HEIGHT = 800;
const TOTAL_FRAMES = 60;
const FRAME_DELAY = 80; // ms per frame
const BG_COLOR = "#0a0a0f";
const ACCENT = "#e63230";

interface AgentNode {
  id: string;
  label: string;
  role: string;
  color: string;
  x: number;
  y: number;
  radius: number;
}

const AGENTS: Omit<AgentNode, "x" | "y" | "radius">[] = [
  { id: "pm", label: "PM", role: "Arjun", color: "#1158c7" },
  { id: "architect", label: "ARCH", role: "Priya", color: "#e36209" },
  { id: "ba", label: "BA", role: "Kavya", color: "#7928ca" },
  { id: "researcher", label: "RES", role: "Shreya", color: "#0891b2" },
  { id: "dev", label: "DEV", role: "Rohan", color: "#3fb950" },
  { id: "qa", label: "QA", role: "Preethi", color: "#f59e0b" },
  { id: "security", label: "SEC", role: "Vikram", color: "#ef4444" },
  { id: "devops", label: "OPS", role: "Aditya", color: "#8b5cf6" },
  { id: "techwriter", label: "DOC", role: "Anjali", color: "#ec4899" },
];

// ── Layout: PM at center, 8 agents in a ring ─────────────────────────────────

const CX = WIDTH / 2;
const CY = HEIGHT / 2;
const RING_RADIUS = 260;
const PM_RADIUS = 38;
const AGENT_RADIUS = 30;

function buildNodes(): AgentNode[] {
  const nodes: AgentNode[] = [
    { ...AGENTS[0], x: CX, y: CY, radius: PM_RADIUS }, // PM at center
  ];
  const specialists = AGENTS.slice(1);
  for (let i = 0; i < specialists.length; i++) {
    const angle = (i / specialists.length) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      ...specialists[i],
      x: CX + Math.cos(angle) * RING_RADIUS,
      y: CY + Math.sin(angle) * RING_RADIUS,
      radius: AGENT_RADIUS,
    });
  }
  return nodes;
}

// ── Pulse animation data ──────────────────────────────────────────────────────

interface Pulse {
  fromIdx: number;
  toIdx: number;
  startFrame: number;
  duration: number;
  color: string;
}

function buildPulses(): Pulse[] {
  const pulses: Pulse[] = [];
  // PM sends to each specialist in sequence
  for (let i = 1; i <= 8; i++) {
    pulses.push({
      fromIdx: 0,
      toIdx: i,
      startFrame: (i - 1) * 5,
      duration: 15,
      color: AGENTS[i].color,
    });
  }
  // Specialists reply to PM (staggered)
  for (let i = 1; i <= 8; i++) {
    pulses.push({
      fromIdx: i,
      toIdx: 0,
      startFrame: 20 + (i - 1) * 4,
      duration: 15,
      color: AGENTS[i].color,
    });
  }
  // Cross-agent communication
  const crossLinks: [number, number][] = [
    [4, 6], // Dev → Security
    [6, 5], // Security → QA
    [5, 4], // QA → Dev
    [1, 4], // Architect → Dev
    [7, 4], // DevOps → Dev
    [2, 3], // BA → Researcher
  ];
  for (let i = 0; i < crossLinks.length; i++) {
    const [from, to] = crossLinks[i];
    pulses.push({
      fromIdx: from,
      toIdx: to,
      startFrame: 10 + i * 7,
      duration: 12,
      color: AGENTS[from].color,
    });
  }
  return pulses;
}

// ── Drawing functions ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  nodes: AgentNode[],
  pulses: Pulse[],
  frame: number,
) {
  // ── Background ──────────────────────────────────────────────────────────
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // ── Connection lines (always visible, faint) ────────────────────────────
  for (let i = 1; i < nodes.length; i++) {
    // PM to each specialist
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    ctx.lineTo(nodes[i].x, nodes[i].y);
    ctx.stroke();
  }

  // Cross-agent links (ring neighbors + key cross-links)
  const crossLinks: [number, number][] = [
    [4, 6], [6, 5], [5, 4], [1, 4], [7, 4], [2, 3],
  ];
  for (const [a, b] of crossLinks) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nodes[a].x, nodes[a].y);
    ctx.lineTo(nodes[b].x, nodes[b].y);
    ctx.stroke();
  }

  // Ring connections (neighbors)
  for (let i = 1; i < nodes.length; i++) {
    const next = i === nodes.length - 1 ? 1 : i + 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nodes[i].x, nodes[i].y);
    ctx.lineTo(nodes[next].x, nodes[next].y);
    ctx.stroke();
  }

  // ── Pulses ──────────────────────────────────────────────────────────────
  for (const pulse of pulses) {
    const elapsed = (frame - pulse.startFrame + TOTAL_FRAMES) % TOTAL_FRAMES;
    if (elapsed < 0 || elapsed >= pulse.duration) continue;

    const t = elapsed / pulse.duration;
    const from = nodes[pulse.fromIdx];
    const to = nodes[pulse.toIdx];
    const px = from.x + (to.x - from.x) * t;
    const py = from.y + (to.y - from.y) * t;

    // Glowing line trail
    const [r, g, b] = hexToRgb(pulse.color);
    const trailAlpha = 0.4 * (1 - t);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${trailAlpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(px, py);
    ctx.stroke();

    // Pulse dot
    const dotAlpha = 0.9 * (1 - t * 0.5);
    const dotRadius = 4 + (1 - t) * 3;

    // Glow
    const glow = ctx.createRadialGradient(px, py, 0, px, py, dotRadius * 4);
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${dotAlpha * 0.5})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(px, py, dotRadius * 4, 0, Math.PI * 2);
    ctx.fill();

    // Core dot
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dotAlpha})`;
    ctx.beginPath();
    ctx.arc(px, py, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Nodes ───────────────────────────────────────────────────────────────
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const [r, g, b] = hexToRgb(node.color);

    // Is this node being "activated" this frame? (receiving a pulse)
    let activated = false;
    for (const pulse of pulses) {
      if (pulse.toIdx !== i) continue;
      const elapsed = (frame - pulse.startFrame + TOTAL_FRAMES) % TOTAL_FRAMES;
      if (elapsed >= pulse.duration - 3 && elapsed < pulse.duration + 2) {
        activated = true;
        break;
      }
    }

    const glowSize = activated ? node.radius * 2.5 : node.radius * 1.8;
    const glowAlpha = activated ? 0.4 : 0.15;

    // Outer glow
    const outerGlow = ctx.createRadialGradient(
      node.x, node.y, node.radius * 0.5,
      node.x, node.y, glowSize,
    );
    outerGlow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${glowAlpha})`);
    outerGlow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
    ctx.fill();

    // Node circle (dark fill with colored border)
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
    ctx.strokeStyle = node.color;
    ctx.lineWidth = activated ? 3 : 2;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${i === 0 ? 16 : 13}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(node.label, node.x, node.y - 2);

    // Role name below
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = `${i === 0 ? 11 : 9}px sans-serif`;
    ctx.fillText(node.role, node.x, node.y + (i === 0 ? 16 : 13));
  }

  // ── Title ───────────────────────────────────────────────────────────────
  ctx.fillStyle = ACCENT;
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("OCTO VEC — Neural Agent Network", CX, 25);

  ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
  ctx.font = "12px sans-serif";
  ctx.fillText("9 AI Agents • Real-time Collaboration • Autonomous Task Execution", CX, 52);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Generating neural network GIF...");

  const nodes = buildNodes();
  const pulses = buildPulses();

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;

  const encoder = new GIFEncoder(WIDTH, HEIGHT);
  const stream = createWriteStream(OUTPUT_PATH);
  encoder.createReadStream().pipe(stream);

  encoder.start();
  encoder.setRepeat(0);   // loop forever
  encoder.setDelay(FRAME_DELAY);
  encoder.setQuality(10); // lower = better quality

  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    drawFrame(ctx, nodes, pulses, frame);
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    encoder.addFrame(imageData.data as unknown as CanvasRenderingContext2D);
    if (frame % 10 === 0) {
      console.log(`  Frame ${frame}/${TOTAL_FRAMES}`);
    }
  }

  encoder.finish();

  await new Promise<void>((resolve) => stream.on("finish", resolve));
  console.log(`GIF saved to: ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
