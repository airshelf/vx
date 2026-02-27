import type { Command } from "commander";
import pc from "picocolors";
import { getConfig } from "../config.ts";

const BASE = process.env.VX_API_BASE || "https://api.vercel.com";

async function streamLogs(
  url: string,
  builds: "0" | "1",
  opts: { follow: boolean; timeout: string; json: boolean }
) {
  url = url.replace(/^https?:\/\//, "");

  const config = await getConfig();
  let path = `/v3/deployments/${url}/events?direction=forward&builds=${builds}`;
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
      process.exit(0);
    }
    console.error(err.message);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
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
    await streamLogs(url, "1", opts);
  });

  addStreamOptions(
    logs
      .command("runtime <url>")
      .description("Runtime logs — serverless function invocations")
  ).action(async (url: string, opts) => {
    await streamLogs(url, "0", opts);
  });
}
