import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig } from "../config.ts";
import { outputJson } from "../format.ts";

export function registerRedeploy(program: Command) {
  program
    .command("redeploy [deployment-url]")
    .description("Redeploy a deployment (defaults to latest)")
    .option("--json", "output raw JSON")
    .option("--target <target>", "deployment target (production, preview)", "production")
    .action(async (deploymentUrl, opts) => {
      const config = await getConfig();

      let deploymentId: string;
      let name: string;

      if (deploymentUrl) {
        // Resolve deployment URL to ID
        const data = await vercel(`/v13/deployments/get?url=${encodeURIComponent(deploymentUrl)}`);
        deploymentId = data.id;
        name = data.name;
      } else {
        // Use latest deployment
        let query = `/v6/deployments?limit=1`;
        if (config.projectId) query += `&projectId=${config.projectId}`;
        const data = await vercel(query);
        const latest = data.deployments?.[0];
        if (!latest) {
          console.error("no deployments found");
          process.exit(1);
        }
        deploymentId = latest.uid;
        name = latest.name;
      }

      const result = await vercel("/v13/deployments", {
        method: "POST",
        body: {
          name,
          deploymentId,
          target: opts.target,
        },
      });

      if (opts.json) {
        outputJson(result);
      } else {
        const state = result.readyState || result.status || "QUEUED";
        console.log(`${state} ${result.url}`);
        console.error("hint: use vx ls --wait --json to poll until READY");
      }
    });
}
