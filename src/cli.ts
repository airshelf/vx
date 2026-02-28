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
  .description("Fast Vercel CLI");

program
  .command("usage")
  .description("Show usage stats (agent telemetry)")
  .action(() => printUsageStats());

registerLs(program);
registerLogs(program);
registerEnv(program);
registerDomains(program);

// Global error handler — catch unhandled errors from any command
const start = Date.now();
const args = process.argv.slice(2);
const cmd = args.find(a => !a.startsWith("-")) || "unknown";

process.on("beforeExit", () => {
  // Log successful completions
  logUsage({ ts: "", cmd, args, ok: true, ms: Date.now() - start });
});

program.parseAsync().catch((err: any) => {
  console.error(err.message || String(err));
  logUsage({ ts: "", cmd, args, ok: false, error: err.message?.slice(0, 200), ms: Date.now() - start });
  process.exit(1);
});
