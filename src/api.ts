import { getConfig } from "./config.ts";
import { hint } from "./format.ts";

const BASE = process.env.VX_API_BASE || "https://api.vercel.com";

// Default timeout for Vercel API calls. Without it, a stalled fetch keeps
// bun's event loop alive indefinitely (observed: 99% CPU for hours after
// the consumer of stdout had already exited). Override with VX_API_TIMEOUT_MS.
const API_TIMEOUT_MS = parseInt(process.env.VX_API_TIMEOUT_MS || "30000");

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error(
        `Vercel API timeout after ${timeoutMs / 1000}s — set VX_API_TIMEOUT_MS to extend`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function buildRequest(path: string, opts?: { method?: string; body?: unknown }) {
  const config = await getConfig();
  const url = `${BASE}${path}${
    config.teamId
      ? (path.includes("?") ? "&" : "?") + `teamId=${config.teamId}`
      : ""
  }`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
  const init: RequestInit = { method: opts?.method ?? "GET", headers };
  if (opts?.body) init.body = JSON.stringify(opts.body);
  return { url, init };
}

export async function vercel(
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<any> {
  const { url, init } = await buildRequest(path, opts);
  const res = await fetchWithTimeout(url, init);

  if (!res.ok) {
    const body = await res.text();
    const hint = apiErrorHint(res.status, body);
    throw new Error(`Vercel API ${res.status}: ${body}${hint}`);
  }

  const remaining = res.headers.get("X-RateLimit-Remaining");
  if (remaining !== null && parseInt(remaining) < 10) {
    hint(`Warning: ${remaining} API calls remaining`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") return {};
  return await res.json();
}

function apiErrorHint(status: number, body?: string): string {
  switch (status) {
    case 401: return "\n  hint: check VERCEL_TOKEN — get one at vercel.com/account/tokens";
    case 403:
      if (body?.includes("invalidToken"))
        return "\n  hint: token is invalid or expired — set VERCEL_TOKEN or get a new one at vercel.com/account/tokens";
      return "\n  hint: token may lack scope, or wrong team context";
    case 404: return "\n  hint: resource not found — check project ID or deployment URL";
    case 429: return "\n  hint: rate limited — wait and retry";
    default: return "";
  }
}

export async function vercelStream(path: string): Promise<Response> {
  const { url, init } = await buildRequest(path);
  // Streams use their own AbortController managed by the caller (e.g. logs.ts),
  // so we only timeout the initial fetch handshake here, not the body read.
  const res = await fetchWithTimeout(url, init);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API ${res.status}: ${body}${apiErrorHint(res.status, body)}`);
  }

  return res;
}
