import { useState, useEffect, useCallback } from "react";

// ── API Key management ────────────────────────────────────────────────────
// The dashboard API key is passed via ?key= in the dashboard URL.
// Once loaded, it's cached in sessionStorage for the tab lifetime.

function getApiKey(): string {
  // 1. Check sessionStorage (persists across SPA navigation)
  const cached = sessionStorage.getItem("vec-api-key");
  if (cached) return cached;

  // 2. Check URL query param (first load) — accept both ?key= and ?KEY=
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("key") ?? params.get("KEY") ?? "";
  if (fromUrl) {
    sessionStorage.setItem("vec-api-key", fromUrl);
    // Clean the key from the URL bar (avoid leaking in bookmarks/history)
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);
    return fromUrl;
  }

  return "";
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  if (!key) return {};
  return { "X-API-Key": key };
}

/** Build a URL with the API key as query param (for non-fetch uses like EventSource). */
export function apiUrl(path: string): string {
  const key = getApiKey();
  if (!key) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}key=${encodeURIComponent(key)}`;
}

/** Check if we have an API key configured. */
export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

// ── Polling hook ──────────────────────────────────────────────────────────

export function usePolling<T>(url: string, interval = 3000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (res.status === 401) {
        setError("Unauthorized — add ?key=YOUR_API_KEY to the dashboard URL");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, interval);
    return () => clearInterval(timer);
  }, [refresh, interval]);

  return { data, loading, error, lastRefresh, refresh };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────

export async function postApi(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteApi(url: string) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
