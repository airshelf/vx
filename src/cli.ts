#!/usr/bin/env bun
// Exit cleanly when stdout/stderr is closed (e.g. piped to `head`).
// Without this, Bun keeps the process alive at 100% CPU after the consumer exits.
for (const stream of [process.stdout, process.stderr] as const) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

import { Command } from "commander";
import pkg from "../package.json";
import { registerLs } from "./commands/ls.ts";
import { registerLogs } from "./commands/logs.ts";
import { registerEnv } from "./commands/env.ts";
import { registerDomains } from "./commands/domains.ts";
import { registerProjects } from "./commands/projects.ts";
import { registerRedeploy } from "./commands/redeploy.ts";
import { registerStatus } from "./commands/status.ts";
import { startMcpServer } from "./mcp.ts";
import { logUsage, printUsageStats } from "./telemetry.ts";

const program = new Command();

program
  .name("vx")
  .version(pkg.version)
  .description("Fast Vercel CLI (ls, logs, env, domains, projects, redeploy, status, mcp)");

program
  .command("usage")
  .description("Show usage stats (agent telemetry)")
  .action(() => printUsageStats());

program
  .command("mcp")
  .description("Start MCP resource server (stdio)")
  .action(() => startMcpServer());

registerLs(program);
registerLogs(program);
registerEnv(program);
registerDomains(program);
registerProjects(program);
registerRedeploy(program);
registerStatus(program);

// Unknown command handler — AX #9: guide on failure
const unknownHints: Record<string, string> = {
  deploy: "deploy via git push, then: vx status — or: vx redeploy --wait",
  link: "project auto-detected from .vercel/project.json — or use: vx env --project <name>",
  login: "set VERCEL_TOKEN env var — get one at vercel.com/account/tokens",
  dev: "vx doesn't run dev servers — use next dev / framework dev command",
};

program.on("command:*", (operands) => {
  const unknown = operands[0];
  const hint = unknownHints[unknown] || `unknown command '${unknown}' — run \`vx --help\``;
  console.error(hint);
  logUsage({ ts: "", cmd: unknown, args, ok: false, error: hint, ms: Date.now() - start });
  logged = true;
  process.exit(1);
});

// Global error handler — catch unhandled errors from any command
const start = Date.now();
const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith("-")) || "unknown";
let logged = false;

process.on("beforeExit", () => {
  if (!logged) {
    logUsage({ ts: "", cmd, args, ok: true, ms: Date.now() - start });
    logged = true;
  }
});

program.parseAsync().catch((err: any) => {
  console.error(err.message || String(err));
  if (!logged) {
    logUsage({ ts: "", cmd, args, ok: false, error: err.message?.slice(0, 200), ms: Date.now() - start });
    logged = true;
  }
  process.exit(1);
});
