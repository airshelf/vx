import { homedir } from "os";
import { join } from "path";
import { appendFileSync, readFileSync, mkdirSync } from "fs";

interface UsageEvent {
  ts: string;
  cmd: string;
  args: string[];
  ok: boolean;
  error?: string;
  ms: number;
}

function usageLogPath(): string {
  const dir = join(homedir(), ".vx");
  mkdirSync(dir, { recursive: true });
  return join(dir, "usage.jsonl");
}

export function logUsage(ev: UsageEvent): void {
  try {
    ev.ts = new Date().toISOString();
    appendFileSync(usageLogPath(), JSON.stringify(ev) + "\n");
  } catch {
    // telemetry must never break the tool
  }
}

export function printUsageStats(): void {
  let lines: string[];
  try {
    lines = readFileSync(usageLogPath(), "utf-8").trim().split("\n").filter(Boolean);
  } catch {
    console.log("no usage data yet");
    return;
  }

  const events: UsageEvent[] = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (!events.length) {
    console.log("no usage data yet");
    return;
  }

  // Filter to last 30 days
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const recent = events.filter(e => e.ts >= cutoff);
  if (!recent.length) {
    console.log(`no searches in last 30 days (${events.length} total all-time)`);
    return;
  }

  // Known commands (exclude mcp from latency, unknown cmds from error rate)
  const KNOWN_CMDS = new Set(["ls", "logs", "env", "domains", "projects", "redeploy", "status", "usage", "mcp"]);

  // Separate mcp (long-running server) and unknown commands from real usage
  const cmds = recent.filter(e => KNOWN_CMDS.has(e.cmd) && e.cmd !== "mcp");
  const unknowns = recent.filter(e => !KNOWN_CMDS.has(e.cmd));

  const total = cmds.length;
  const ok = cmds.filter(e => e.ok).length;
  const errors = cmds.filter(e => !e.ok);
  const avgMs = total ? Math.round(cmds.reduce((s, e) => s + e.ms, 0) / total) : 0;

  console.log(`Last 30 days: ${total} calls (${ok} ok, ${errors.length} errors)`);
  console.log(`Success rate: ${total ? Math.round(ok * 100 / total) : 0}%`);
  console.log(`Avg latency: ${avgMs}ms`);

  const mcpSessions = recent.filter(e => e.cmd === "mcp");
  if (mcpSessions.length) {
    console.log(`MCP sessions: ${mcpSessions.length} (excluded from latency)`);
  }
  if (unknowns.length) {
    console.log(`Unknown commands: ${unknowns.length} (guidance messages, not errors)`);
  }

  // Command breakdown (real commands only)
  const cmdCounts: Record<string, number> = {};
  for (const e of cmds) cmdCounts[e.cmd] = (cmdCounts[e.cmd] || 0) + 1;
  console.log();
  console.log("Commands:");
  for (const [cmd, count] of Object.entries(cmdCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cmd}: ${count} (${Math.round(count * 100 / total)}%)`);
  }

  // Flag frequency
  const flagCounts: Record<string, number> = {};
  for (const e of cmds) {
    for (const a of e.args) {
      if (a.startsWith("-")) flagCounts[a] = (flagCounts[a] || 0) + 1;
    }
  }
  const topFlags = Object.entries(flagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (topFlags.length) {
    console.log();
    console.log("Flags:");
    for (const [f, count] of topFlags) {
      console.log(`  ${f}: ${count} (${Math.round(count * 100 / total)}%)`);
    }
  }

  // Errors
  if (errors.length) {
    console.log();
    console.log("Errors:");
    const errCounts: Record<string, number> = {};
    for (const e of errors) {
      const key = e.error?.slice(0, 80) || "unknown";
      errCounts[key] = (errCounts[key] || 0) + 1;
    }
    for (const [err, count] of Object.entries(errCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  ${err}${count > 1 ? ` (${count}x)` : ""}`);
    }
  }

  // Retry chains: error → same command succeeds within 2 min
  let chains = 0;
  for (let i = 1; i < cmds.length; i++) {
    if (!cmds[i - 1].ok && cmds[i].ok && cmds[i].cmd === cmds[i - 1].cmd) {
      const t1 = new Date(cmds[i - 1].ts).getTime();
      const t2 = new Date(cmds[i].ts).getTime();
      if (t2 - t1 < 120_000) chains++;
    }
  }
  if (chains) {
    console.log();
    console.log(`Retry chains: ${chains} (error → retry same command within 2 min)`);
  }
}
