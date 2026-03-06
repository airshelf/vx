import { getConfig } from "./config.ts";
import { hint } from "./format.ts";

const BASE = process.env.VX_API_BASE || "https://api.vercel.com";

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
  const res = await fetch(url, init);

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
  const res = await fetch(url, init);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API ${res.status}: ${body}${apiErrorHint(res.status, body)}`);
  }

  return res;
}
