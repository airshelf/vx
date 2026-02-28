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

  const total = recent.length;
  const ok = recent.filter(e => e.ok).length;
  const errors = recent.filter(e => !e.ok);
  const avgMs = Math.round(recent.reduce((s, e) => s + e.ms, 0) / total);

  console.log(`Last 30 days: ${total} calls (${ok} ok, ${errors.length} errors)`);
  console.log(`Success rate: ${Math.round(ok * 100 / total)}%`);
  console.log(`Avg latency: ${avgMs}ms`);

  // Command breakdown
  const cmdCounts: Record<string, number> = {};
  for (const e of recent) cmdCounts[e.cmd] = (cmdCounts[e.cmd] || 0) + 1;
  console.log();
  console.log("Commands:");
  for (const [cmd, count] of Object.entries(cmdCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cmd}: ${count} (${Math.round(count * 100 / total)}%)`);
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
}
