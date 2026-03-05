import type { Command } from "commander";
import pc from "picocolors";
import { getConfig } from "../config.ts";

const BASE = process.env.VX_API_BASE || "https://api.vercel.com";

async function streamBuildLogs(
  url: string,
  opts: { follow: boolean; timeout: string; json: boolean }
) {
  url = url.replace(/^https?:\/\//, "");

  const config = await getConfig();
  let path = `/v3/deployments/${url}/events?direction=forward&builds=1`;
  if (opts.follow) path += "&follow=1";

  const fullUrl = `${BASE}${path}${
    config.teamId
      ? (path.includes("?") ? "&" : "?") + `teamId=${config.teamId}`
      : ""
  }`;

  const controller = new AbortController();
  const timeoutMs = parseInt(opts.timeout);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(fullUrl, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of res.body!) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (opts.json) {
            console.log(JSON.stringify(event));
          } else {
            const timestamp = new Date(
              event.created || event.date
            ).toLocaleTimeString();
            const text =
              event.text ||
              event.payload?.text ||
              JSON.stringify(event.payload || event);
            const colored =
              /error/i.test(text) ? pc.red(text) :
              /warn/i.test(text) ? pc.yellow(text) :
              text;
            console.log(`${pc.dim(timestamp)}  ${colored}`);
          }
        } catch {
          console.log(line);
        }
      }
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error(
        `\nTimed out after ${timeoutMs / 1000}s (use --timeout to extend)`
      );
      process.exit(1);
    }
    console.error(err.message);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

async function queryAxiomLogs(opts: {
  minutes: string;
  filter: string | undefined;
  path: string | undefined;
  limit: string;
  json: boolean;
}) {
  const token = process.env.AXIOM_TOKEN;
  if (!token) {
    console.error("AXIOM_TOKEN not set");
    console.error("  hint: export AXIOM_TOKEN=xaat-...");
    process.exit(1);
  }

  const minutes = parseInt(opts.minutes);
  const limit = parseInt(opts.limit);
  const now = new Date();
  const start = new Date(now.getTime() - minutes * 60 * 1000);

  // Build APL query — use _apl endpoint with ['field.name'] syntax
  let apl = "['vercel']";
  const filters: string[] = [];
  if (opts.path) {
    filters.push(`['request.path'] startswith '${opts.path}'`);
  }
  if (opts.filter) {
    filters.push(`message contains '${opts.filter}'`);
  }
  if (filters.length) apl += ` | where ${filters.join(" and ")}`;
  apl += ` | sort by _time desc | limit ${limit}`;

  const res = await fetch("https://api.axiom.co/v1/datasets/_apl?format=legacy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startTime: start.toISOString(),
      endTime: now.toISOString(),
      apl,
    }),
  });

  if (!res.ok) {
    throw new Error(`Axiom API ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as any;
  const matches = data.matches || [];

  if (!matches.length) {
    console.error(`No logs found (last ${minutes}m)`);
    if (opts.path) console.error(`  path filter: ${opts.path}`);
    if (opts.filter) console.error(`  text filter: ${opts.filter}`);
    process.exit(0);
  }

  // Reverse to show oldest first
  matches.reverse();

  for (const m of matches) {
    const d = m.data || {};
    if (opts.json) {
      console.log(JSON.stringify({
        time: m._time,
        level: d.level,
        message: d.message,
        path: d.request?.path,
        status: d.request?.statusCode,
        method: d.request?.method,
        duration: d.proxy?.duration,
      }));
    } else {
      const ts = new Date(m._time).toLocaleTimeString();
      const path = d.request?.path || "";
      const status = d.request?.statusCode;
      const msg = d.message || "";
      const level = d.level || "info";

      // Skip noise: empty messages without a path
      if (!msg && !path) continue;

      const statusStr = status
        ? (status >= 400 ? pc.red(String(status)) : pc.green(String(status)))
        : "";
      const line = [statusStr, path, msg].filter(Boolean).join("  ");

      const colored =
        level === "error" ? pc.red(line) :
        level === "warn" ? pc.yellow(line) :
        line;
      console.log(`${pc.dim(ts)}  ${colored}`);
    }
  }

  console.error(pc.dim(`\n${matches.length} log entries (last ${minutes}m)`));
}

function addStreamOptions(cmd: Command) {
  return cmd
    .option("-f, --follow", "stream live", true)
    .option("--no-follow", "fetch once and exit")
    .option("--timeout <ms>", "timeout in ms", "30000")
    .option("--json", "output raw JSON events");
}

export function registerLogs(program: Command) {
  const logs = program
    .command("logs")
    .description("Stream deployment logs");

  addStreamOptions(
    logs
      .command("build <url>")
      .description("Build logs — output from deployment build process")
  ).action(async (url: string, opts) => {
    await streamBuildLogs(url, opts);
  });

  logs
    .command("runtime [url]")
    .description("Runtime logs via Axiom (serverless function invocations)")
    .option("-m, --minutes <n>", "look back N minutes", "15")
    .option("-p, --path <path>", "filter by request path prefix (e.g. /api/shop)")
    .option("-g, --filter <text>", "filter by log message text")
    .option("-n, --limit <n>", "max log entries", "50")
    .option("--json", "output JSON lines")
    .action(async (_url: string | undefined, opts) => {
      await queryAxiomLogs(opts);
    });
}
