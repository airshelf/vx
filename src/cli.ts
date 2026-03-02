#!/usr/bin/env bun
import { Command } from "commander";
import pkg from "../package.json";
import { registerLs } from "./commands/ls.ts";
import { registerLogs } from "./commands/logs.ts";
import { registerEnv } from "./commands/env.ts";
import { registerDomains } from "./commands/domains.ts";
import { logUsage, printUsageStats } from "./telemetry.ts";

const program = new Command();

program
  .name("vx")
  .version(pkg.version)
  .description("Fast Vercel CLI — read-only (ls, logs, env, domains)");

program
  .command("usage")
  .description("Show usage stats (agent telemetry)")
  .action(() => printUsageStats());

registerLs(program);
registerLogs(program);
registerEnv(program);
registerDomains(program);

// Unknown command handler — AX #9: guide on failure
const unknownHints: Record<string, string> = {
  deploy: "vx is read-only — deploy via git push, then: vx ls --json",
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
