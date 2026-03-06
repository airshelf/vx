import pc from "picocolors";

export function table(headers: string[], rows: string[][]) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length + 2);

  console.log(pc.bold(headers.map((h, i) => pad(h, widths[i])).join("")));
  for (const row of rows) {
    console.log(row.map((c, i) => pad(c, widths[i])).join(""));
  }
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function stateColor(state: string): string {
  switch (state) {
    case "READY":
      return pc.green(state);
    case "ERROR":
    case "CANCELED":
      return pc.red(state);
    case "BUILDING":
    case "INITIALIZING":
      return pc.yellow(state);
    case "QUEUED":
      return pc.dim(state);
    default:
      return state;
  }
}

export function outputJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Print a hint to stderr — suppressed when stdout is piped.
 * Prevents `vx ls --json 2>&1 | jq` from breaking when stderr
 * hints get mixed into stdout by the 2>&1.
 */
export function hint(msg: string) {
  if (process.stdout.isTTY) {
    console.error(msg);
  }
}
