import type { Command } from "commander";
import { vercel } from "../api.ts";
import { table, relativeTime, outputJson } from "../format.ts";

export function registerProjects(program: Command) {
  program
    .command("projects [name]")
    .description("List projects or find one by name/ID")
    .option("--limit <n>", "max projects (list mode)", "20")
    .option("--json", "output raw JSON")
    .action(async (name, opts) => {
      if (name) {
        // Find specific project
        const data = await vercel(`/v9/projects/${encodeURIComponent(name)}`);

        if (opts.json) {
          outputJson(data);
          return;
        }

        console.log(`${data.name}  ${data.id}`);
        if (data.framework) console.log(`framework: ${data.framework}`);
        if (data.link?.type === "github") {
          console.log(`repo: ${data.link.org}/${data.link.repo}`);
        }
        return;
      }

      // List all projects
      const data = await vercel(`/v9/projects?limit=${opts.limit}`);

      if (opts.json) {
        outputJson(data);
        return;
      }

      if (!data.projects?.length) {
        console.error(`No projects found (limit=${opts.limit})`);
        return;
      }

      const rows = data.projects.map((p: any) => [
        p.name,
        p.id,
        p.framework || "-",
        relativeTime(p.updatedAt),
      ]);

      table(["Name", "ID", "Framework", "Updated"], rows);
    });
}
