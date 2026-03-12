/**
 * Dashboard security middleware — auth, CORS, headers, rate limiting.
 *
 * API Key Auth:
 *   - On first run, generates a random 32-byte hex key → data/dashboard-secret.key
 *   - All /api/* routes require X-API-Key header or ?key= query param
 *   - SSE stream endpoint also requires auth
 *   - Static file serving (React dashboard) is NOT auth-gated
 *
 * The key is printed once at startup so the user can configure the dashboard frontend.
 */

import { randomBytes, existsSync, readFileSync, writeFileSync, mkdirSync } from "./securityHelpers.js";
import { join } from "path";
import { config } from "../config.js";
import type { Request, Response, NextFunction } from "express";

// ── API Key Management ────────────────────────────────────────────────────

const KEY_FILE = join(config.dataDir, "dashboard-secret.key");

function ensureApiKey(): string {
  mkdirSync(config.dataDir);

  if (existsSync(KEY_FILE)) {
    const existing = readFileSync(KEY_FILE).trim();
    if (existing.length >= 32) return existing;
  }

  const key = randomBytes(32);
  writeFileSync(KEY_FILE, key);
  return key;
}

let _apiKey: string | null = null;

/** Get or generate the dashboard API key. */
export function getDashboardApiKey(): string {
  if (!_apiKey) _apiKey = ensureApiKey();
  return _apiKey;
}

/**
 * Express middleware: require valid API key on /api/* routes only.
 * - API routes without key → 401 JSON
 * - Everything else (SPA HTML, static assets) → allowed through
 *   (the SPA uses sessionStorage to persist the key across reloads,
 *    and shows its own error UI if API calls return 401)
 * Checks X-API-Key header first, then ?key= / ?KEY= query param.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Only gate /api/ routes — let SPA and static assets through
  if (!req.path.startsWith("/api/")) {
    next();
    return;
  }

  const key = getDashboardApiKey();
  const provided =
    (req.headers["x-api-key"] as string) ??
    (req.query.key as string) ??
    (req.query.KEY as string) ??
    "";

  if (provided === key) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized — provide X-API-Key header or ?key= query param" });
}

// ── CORS Configuration ───────────────────────────────────────────────────

/**
 * Build CORS options: only allow same-origin by default.
 * Override with VEC_CORS_ORIGIN env var (e.g., "http://localhost:5173" for Vite dev).
 */
export function getCorsOptions() {
  const allowedOrigin = process.env.VEC_CORS_ORIGIN ?? `http://localhost:${config.dashboardPort}`;
  return {
    origin: allowedOrigin,
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    credentials: false,
  };
}

// ── Helmet / Security Headers ────────────────────────────────────────────

export function getHelmetOptions() {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // inline HTML dashboard needs this
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrcElem: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"], // prevent clickjacking
      },
    },
    crossOriginEmbedderPolicy: false, // breaks SSE in some browsers
  };
}

// ── Rate Limiting ────────────────────────────────────────────────────────

/** Rate limit config for mutation endpoints (POST/DELETE). */
export function getMutationRateLimitOptions() {
  return {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — slow down" },
  };
}

// ── Dashboard Host ───────────────────────────────────────────────────────

/** Get the host to bind the dashboard to. Default: 127.0.0.1 (localhost only). */
export function getDashboardHost(): string {
  return process.env.VEC_DASHBOARD_HOST ?? "127.0.0.1";
}

// ── MCP Config Validation ────────────────────────────────────────────────

/** Allowed commands for MCP servers. Rejects anything not in this list. */
const MCP_ALLOWED_COMMANDS = new Set([
  "npx", "node", "python", "python3", "docker", "deno", "bun", "uvx",
]);

/** Dangerous argument patterns that should never appear in MCP args. */
const MCP_BLOCKED_ARG_PATTERNS = [
  /[;&|`$]/, // shell metacharacters
  />\s*\//, // redirect to absolute path
  /\.\.[/\\]/, // directory traversal
];

export interface MCPValidationResult {
  valid: boolean;
  error?: string;
}

/** Validate an MCP config object before writing to disk. */
export function validateMCPConfig(body: any): MCPValidationResult {
  if (!body || typeof body !== "object" || !body.mcpServers) {
    return { valid: false, error: "Missing mcpServers object" };
  }

  if (typeof body.mcpServers !== "object" || Array.isArray(body.mcpServers)) {
    return { valid: false, error: "mcpServers must be an object" };
  }

  for (const [name, serverCfg] of Object.entries(body.mcpServers)) {
    const cfg = serverCfg as any;

    if (!cfg || typeof cfg !== "object") {
      return { valid: false, error: `Server "${name}": config must be an object` };
    }

    if (!cfg.command || typeof cfg.command !== "string") {
      return { valid: false, error: `Server "${name}": command is required (string)` };
    }

    const cmd = cfg.command.trim().toLowerCase();
    // Extract just the binary name (strip path)
    const cmdBase = cmd.split(/[/\\]/).pop() ?? cmd;
    // Strip .exe/.cmd suffix on Windows
    const cmdClean = cmdBase.replace(/\.(exe|cmd|bat)$/i, "");

    if (!MCP_ALLOWED_COMMANDS.has(cmdClean)) {
      return {
        valid: false,
        error: `Server "${name}": command "${cfg.command}" is not allowed. Allowed: ${[...MCP_ALLOWED_COMMANDS].join(", ")}`,
      };
    }

    if (cfg.args !== undefined) {
      if (!Array.isArray(cfg.args)) {
        return { valid: false, error: `Server "${name}": args must be an array of strings` };
      }
      for (const arg of cfg.args) {
        if (typeof arg !== "string") {
          return { valid: false, error: `Server "${name}": all args must be strings` };
        }
        for (const pattern of MCP_BLOCKED_ARG_PATTERNS) {
          if (pattern.test(arg)) {
            return {
              valid: false,
              error: `Server "${name}": blocked argument pattern detected in "${arg}"`,
            };
          }
        }
      }
    }

    if (cfg.env !== undefined) {
      if (typeof cfg.env !== "object" || Array.isArray(cfg.env)) {
        return { valid: false, error: `Server "${name}": env must be an object` };
      }
      for (const [k, v] of Object.entries(cfg.env)) {
        if (typeof v !== "string") {
          return { valid: false, error: `Server "${name}": env value for "${k}" must be a string` };
        }
      }
    }
  }

  return { valid: true };
}
