import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig, resolveProjectId } from "../config.ts";
import { stateColor, relativeTime, outputJson } from "../format.ts";

export function registerStatus(program: Command) {
  program
    .command("status")
    .description("Quick health check — show latest deployment state")
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--json", "output raw JSON")
    .action(async (opts) => {
      const config = await getConfig();
      if (opts.project) {
        config.projectId = await resolveProjectId(config, opts.project);
      }

      let query = `/v6/deployments?limit=1`;
      if (config.projectId) query += `&projectId=${config.projectId}`;
      const data = await vercel(query);
      const latest = data.deployments?.[0];

      if (!latest) {
        console.error("no deployments found");
        process.exit(2);
      }

      const state = latest.readyState || latest.state;
      const age = relativeTime(latest.created);
      const sha = latest.meta?.githubCommitSha?.slice(0, 8) || "";
      const name = latest.name || "unknown";

      if (opts.json) {
        outputJson({
          project: name,
          state,
          url: latest.url,
          sha,
          age,
          created: latest.created,
        });
      } else {
        const shaStr = sha ? ` (${sha})` : "";
        console.log(`${name}: ${stateColor(state)}${shaStr} — ${age}`);
      }

      if (state === "ERROR") {
        process.exit(1);
      }
    });
}
