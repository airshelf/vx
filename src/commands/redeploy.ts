import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig, resolveProjectId } from "../config.ts";
import { outputJson, stateColor, hint } from "../format.ts";

const TERMINAL_STATES = new Set(["READY", "ERROR", "CANCELED"]);

export function registerRedeploy(program: Command) {
  program
    .command("redeploy [deployment-url]")
    .description("Redeploy a deployment (defaults to latest)")
    .option("--json", "output raw JSON")
    .option("--target <target>", "deployment target (production, preview)", "production")
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--wait", "block until deployment reaches READY or ERROR")
    .option("--interval <ms>", "poll interval for --wait (ms)", "5000")
    .option("--timeout <ms>", "timeout for --wait (ms)", "120000")
    .action(async (deploymentUrl, opts) => {
      const config = await getConfig();
      if (opts.project) {
        config.projectId = await resolveProjectId(config, opts.project);
      }

      let deploymentId: string;
      let name: string;

      if (deploymentUrl) {
        const data = await vercel(`/v13/deployments/get?url=${encodeURIComponent(deploymentUrl)}`);
        deploymentId = data.id;
        name = data.name;
      } else {
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

      if (!opts.wait) {
        if (opts.json) {
          outputJson(result);
        } else {
          const state = result.readyState || result.status || "QUEUED";
          console.log(`${state} ${result.url}`);
          hint("hint: use --wait to block until READY");
        }
        return;
      }

      // --wait: poll until terminal state
      const deployUrl = result.url;
      const timeout = parseInt(opts.timeout);
      const interval = parseInt(opts.interval);
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        const check = await vercel(`/v13/deployments/get?url=${encodeURIComponent(deployUrl)}`);
        const state = check.readyState || check.state;

        if (TERMINAL_STATES.has(state)) {
          if (opts.json) {
            outputJson(check);
          } else {
            console.log(`${stateColor(state)} ${deployUrl}`);
          }
          process.exit(state === "ERROR" ? 1 : 0);
        }

        if (!opts.json) {
          console.error(`${state} ${deployUrl} — polling every ${interval / 1000}s`);
        }
        await Bun.sleep(interval);
      }

      console.error(`timeout after ${timeout / 1000}s — deployment not terminal`);
      process.exit(1);
    });
}
