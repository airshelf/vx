import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig } from "../config.ts";
import { table, relativeTime, stateColor, outputJson } from "../format.ts";

export function registerLs(program: Command) {
  program
    .command("ls")
    .description("List deployments")
    .option("--limit <n>", "number of deployments", "10")
    .option("--state <state>", "filter by state (READY, ERROR, BUILDING, CANCELED, QUEUED)")
    .option("--prod", "only show production READY deployments")
    .option("--json", "output raw JSON")
    .action(async (opts) => {
      const config = await getConfig();

      let query = `/v6/deployments?limit=${opts.limit}`;
      if (config.projectId) query += `&projectId=${config.projectId}`;
      if (opts.prod) {
        query += `&state=READY&target=production`;
      } else if (opts.state) {
        query += `&state=${opts.state}`;
      }

      const data = await vercel(query);

      if (opts.json) {
        outputJson(data);
        return;
      }

      if (!data.deployments?.length) {
        console.log("No deployments found");
        return;
      }

      const rows = data.deployments.map((d: any) => [
        d.url?.length > 50 ? d.url.slice(0, 47) + "..." : d.url ?? "-",
        stateColor(d.readyState || d.state),
        d.meta?.githubCommitRef || "-",
        relativeTime(d.created),
        d.creator?.username || "-",
      ]);

      table(["URL", "State", "Branch", "Age", "Creator"], rows);
    });
}
