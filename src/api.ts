import { getConfig } from "./config.ts";

const BASE = "https://api.vercel.com";

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
    throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
  }

  const remaining = res.headers.get("X-RateLimit-Remaining");
  if (remaining !== null && parseInt(remaining) < 10) {
    console.error(`Warning: ${remaining} API calls remaining`);
  }

  return await res.json();
}

export async function vercelStream(path: string): Promise<Response> {
  const { url, init } = await buildRequest(path);
  const res = await fetch(url, init);

  if (!res.ok) {
    throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
  }

  return res;
}
