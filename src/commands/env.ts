import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig } from "../config.ts";
import { table, relativeTime, outputJson } from "../format.ts";

export function registerEnv(program: Command) {
  program
    .command("env")
    .description("List environment variables")
    .option("--project <id>", "project ID (overrides auto-detected)")
    .option("--decrypt", "show decrypted values")
    .option("--target <env>", "filter by target: production, preview, development")
    .option("--json", "output raw JSON")
    .action(async (opts) => {
      const projectId = opts.project || (await getConfig()).projectId;

      if (!projectId) {
        console.error(
          "No project found. Use --project or run from a linked directory."
        );
        process.exit(1);
      }

      let path = `/v10/projects/${projectId}/env`;
      if (opts.decrypt) path += "?decrypt=true";

      const data = await vercel(path);
      let envs = data.envs ?? [];

      if (opts.target) {
        envs = envs.filter((e: any) => e.target?.includes(opts.target));
      }

      if (opts.json) {
        outputJson(envs);
        return;
      }

      if (!envs.length) {
        const scope = [
          `project=${projectId}`,
          opts.target ? `target=${opts.target}` : "all targets",
        ].join(", ");
        console.error(`No environment variables found (${scope})`);
        if (opts.target) {
          console.error("  hint: remove --target to see all environments");
        }
        return;
      }

      if (opts.decrypt) {
        const headers = ["Key", "Value", "Target", "Type"];
        const rows = envs.map((e: any) => {
          const val = e.value || "(empty)";
          return [
            e.key,
            val.length > 40 ? val.slice(0, 40) + "..." : val,
            (e.target || []).join(", "),
            e.type,
          ];
        });
        table(headers, rows);
      } else {
        const headers = ["Key", "Target", "Type", "Updated"];
        const rows = envs.map((e: any) => [
          e.key,
          (e.target || []).join(", "),
          e.type,
          relativeTime(e.updatedAt),
        ]);
        table(headers, rows);
      }
    });
}
