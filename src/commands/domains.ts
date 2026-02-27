import type { Command } from "commander";
import { vercel } from "../api.ts";
import { table, relativeTime, outputJson } from "../format.ts";

export function registerDomains(program: Command) {
  program
    .command("domains")
    .description("List domains")
    .option("--limit <n>", "max domains", "20")
    .option("--json", "output raw JSON")
    .action(async (opts) => {
      const data = await vercel(`/v5/domains?limit=${opts.limit}`);

      if (opts.json) {
        outputJson(data);
        return;
      }

      if (!data.domains?.length) {
        console.log("No domains found");
        return;
      }

      const rows = data.domains.map((d: any) => [
        d.name,
        d.verified ? "yes" : "no",
        relativeTime(d.createdAt),
        d.registrar || "-",
      ]);

      table(["Domain", "Verified", "Created", "Registrar"], rows);
    });
}
