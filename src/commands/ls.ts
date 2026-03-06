import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig, resolveProjectId } from "../config.ts";
import { table, relativeTime, stateColor, outputJson, hint } from "../format.ts";

const TERMINAL_STATES = new Set(["READY", "ERROR", "CANCELED"]);

async function fetchDeployments(config: any, opts: any) {
  let query = `/v6/deployments?limit=${opts.limit}`;
  if (config.projectId) query += `&projectId=${config.projectId}`;
  if (opts.prod) {
    query += `&state=READY&target=production`;
  } else if (opts.state) {
    query += `&state=${opts.state}`;
  }
  return await vercel(query);
}

function printTable(data: any) {
  const rows = data.deployments.map((d: any) => [
    d.url?.length > 50 ? d.url.slice(0, 47) + "..." : d.url ?? "-",
    stateColor(d.readyState || d.state),
    d.meta?.githubCommitRef || "-",
    relativeTime(d.created),
    d.creator?.username || "-",
  ]);
  table(["URL", "State", "Branch", "Age", "Creator"], rows);
}

export function registerLs(program: Command) {
  program
    .command("ls")
    .description("List deployments")
    .option("--limit <n>", "number of deployments", "10")
    .option("--state <state>", "filter by state (READY, ERROR, BUILDING, CANCELED, QUEUED)")
    .option("--prod", "only show production READY deployments")
    .option("--wait", "poll until latest deployment reaches READY or ERROR")
    .option("--interval <ms>", "poll interval for --wait (ms)", "5000")
    .option("--timeout <ms>", "timeout for --wait (ms)", "120000")
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--latest", "return only the latest deployment")
    .option("--json", "output raw JSON")
    .action(async (opts) => {
      const config = await getConfig();
      if (opts.project) {
        config.projectId = await resolveProjectId(config, opts.project);
      }

      if (opts.wait) {
        const timeout = parseInt(opts.timeout);
        const interval = parseInt(opts.interval);
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
          const data = await fetchDeployments(config, opts);
          const latest = data.deployments?.[0];

          if (!latest) {
            console.error("no deployments found");
            process.exit(1);
          }

          const state = latest.readyState || latest.state;

          if (TERMINAL_STATES.has(state)) {
            if (opts.latest) {
              if (opts.json) {
                outputJson(latest);
              } else {
                printTable({ deployments: [latest] });
              }
            } else if (opts.json) {
              outputJson(data.deployments);
            } else {
              printTable(data);
            }
            process.exit(state === "ERROR" ? 1 : 0);
          }

          if (!opts.json) {
            console.error(`${state} ${latest.url} — polling every ${interval / 1000}s`);
          }
          await Bun.sleep(interval);
        }

        console.error(`timeout after ${timeout / 1000}s — last state was not terminal`);
        process.exit(1);
      }

      const data = await fetchDeployments(config, opts);

      if (!data.deployments?.length) {
        const scope = [
          `limit=${opts.limit}`,
          config.projectId ? `project=${config.projectId}` : "all projects",
          opts.state ? `state=${opts.state}` : null,
          opts.prod ? "prod only" : null,
        ].filter(Boolean).join(", ");
        console.error(`No deployments found (${scope})`);
        if (config.projectId) {
          hint("  hint: try --limit 50 or check project with vx ls --json");
        }
        process.exit(1);
      }

      if (opts.latest) {
        const latest = data.deployments[0];
        if (opts.json) {
          outputJson(latest);
        } else {
          printTable({ deployments: [latest] });
        }
        return;
      }

      if (opts.json) {
        outputJson(data.deployments);
        return;
      }

      // AX #9: guide agents toward --wait when they see BUILDING
      const latestDeploy = data.deployments?.[0];
      const state = latestDeploy?.readyState || latestDeploy?.state;
      if (state && !TERMINAL_STATES.has(state)) {
        hint("  hint: use --wait to poll until READY: vx ls --wait --json");
      }

      printTable(data);
    });
}
