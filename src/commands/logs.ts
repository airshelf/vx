import type { Command } from "commander";
import pc from "picocolors";
import { getConfig, getAxiomToken, resolveProjectId } from "../config.ts";
import { hint } from "../format.ts";

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
            console.log(JSON.stringify({
              time: event.created || event.date,
              level: event.type === "stderr" ? "error" : "info",
              message: event.text || event.payload?.text || "",
            }));
          } else {
            const timestamp = new Date(
              event.created || event.date
            ).toLocaleTimeString();
            const text =
              event.text ||
              event.payload?.text || "";
            if (!text) continue;
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
  timeout: string;
  json: boolean;
  project: string | undefined;
}) {
  const token = await getAxiomToken();
  const config = await getConfig();

  // Resolve project ID: --project flag > .vercel/project.json
  let projectId = config.projectId;
  if (opts.project) {
    projectId = await resolveProjectId(config, opts.project);
  }

  const minutes = parseInt(opts.minutes);
  const limit = parseInt(opts.limit);
  const timeoutMs = parseInt(opts.timeout);
  const now = new Date();
  const start = new Date(now.getTime() - minutes * 60 * 1000);

  // Build APL query — use _apl endpoint with ['field.name'] syntax
  let apl = "['vercel']";
  const filters: string[] = [];
  if (projectId) {
    filters.push(`['vercel.projectId'] == '${projectId}'`);
  }
  if (opts.path) {
    filters.push(`['request.path'] startswith '${opts.path}'`);
  }
  if (opts.filter) {
    filters.push(`message contains '${opts.filter}'`);
  }
  if (filters.length) apl += ` | where ${filters.join(" and ")}`;
  apl += ` | sort by _time desc | limit ${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Keep the abort timer armed across both the fetch and the body read —
  // a stuck Axiom response body would otherwise hang forever at 100% CPU.
  let res: Response;
  let data: any;
  try {
    res = await fetch("https://api.axiom.co/v1/datasets/_apl?format=legacy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        startTime: start.toISOString(),
        endTime: now.toISOString(),
        apl,
      }),
    });

    if (!res.ok) {
      throw new Error(`Axiom API ${res.status}: ${await res.text()}`);
    }

    data = await res.json();
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error(`Axiom query timed out after ${timeoutMs / 1000}s (use --timeout to extend)`);
      process.exit(1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const matches = data.matches || [];

  if (!matches.length) {
    console.error(`No logs found (last ${minutes}m)`);
    if (opts.path) hint(`  path filter: ${opts.path}`);
    if (opts.filter) hint(`  text filter: ${opts.filter}`);
    hint("  hint: try -m 60 for longer window or remove filters");
    process.exit(2);
  }

  // Deduplicate: Axiom logs both a request event (empty message) and a
  // function log (with message) at the same timestamp+path+status.
  // Two-pass: find keys that have a message, then drop empty dupes.
  const keyed = matches.map((m: any) => {
    const d = m.data || {};
    return { m, key: `${m._time}|${d.request?.path}|${d.request?.statusCode}`, hasMsg: !!d.message };
  });
  const hasMsg = new Set(keyed.filter(e => e.hasMsg).map(e => e.key));
  const seen = new Set<string>();
  const deduped = keyed.filter(({ m, key, hasMsg: has }) => {
    if (seen.has(key)) return false;
    // Drop empty-message entry if a same-key entry with message exists
    if (!has && hasMsg.has(key)) return false;
    seen.add(key);
    return true;
  }).map(e => e.m);

  // Reverse to show oldest first
  deduped.reverse();

  let printed = 0;
  for (const m of deduped) {
    const d = m.data || {};
    const msg = d.message || "";
    const path = d.request?.path || "";
    const status = d.request?.statusCode;
    const level = d.level || "info";

    // Skip empty entries
    if (!msg && !path) continue;

    // Skip static assets unless explicitly filtered
    if (!opts.path && !opts.filter && /^\/_next\/|^\/favicon|^\/_vercel\/|\.woff2?$|\.css\?|\.js\?/.test(path)) continue;

    // Truncate long messages (stack traces, huge JSON errors)
    const truncMsg = msg.length > 200 ? msg.slice(0, 200) + "…" : msg;

    if (opts.json) {
      console.log(JSON.stringify({
        time: m._time,
        level: d.level,
        message: msg,
        path: d.request?.path,
        status,
        method: d.request?.method,
      }));
    } else {
      const ts = new Date(m._time).toLocaleTimeString();

      const statusStr = status
        ? (status >= 400 ? pc.red(String(status)) : pc.green(String(status)))
        : "";
      const line = [statusStr, path, truncMsg].filter(Boolean).join("  ");

      const colored =
        level === "error" ? pc.red(line) :
        level === "warn" ? pc.yellow(line) :
        line;
      console.log(`${pc.dim(ts)}  ${colored}`);
    }
    printed++;
  }

  if (!opts.json) {
    hint(pc.dim(`\n${printed} log entries (last ${minutes}m)`));
  }
}

function addStreamOptions(cmd: Command) {
  return cmd
    .option("-f, --follow", "stream live", true)
    .option("--no-follow", "fetch once and exit")
    .option("--timeout <ms>", "timeout in ms", "60000")
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
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--json", "output JSON lines")
    .option("--no-follow", "ignored (runtime logs are always one-shot)")
    .option("--timeout <ms>", "Axiom query timeout in ms", "30000")
    .action(async (_url: string | undefined, opts) => {
      await queryAxiomLogs(opts);
    });
}
