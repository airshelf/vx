import type { Command } from "commander";
import { vercel } from "../api.ts";
import { getConfig, resolveProjectId } from "../config.ts";
import { table, relativeTime, outputJson, hint } from "../format.ts";

async function resolveProject(opts: any) {
  const config = await getConfig();
  if (opts.project) {
    return await resolveProjectId(config, opts.project);
  }
  if (config.projectId) return config.projectId;
  console.error(
    "No project found. Use --project <name> or run from a linked directory."
  );
  process.exit(1);
}

async function fetchEnvs(projectId: string, decrypt: boolean) {
  let path = `/v10/projects/${projectId}/env`;
  if (decrypt) path += "?decrypt=true";
  const data = await vercel(path);
  return data.envs ?? [];
}

export function registerEnv(program: Command) {
  const env = program
    .command("env")
    .description("Manage environment variables");

  // Default action: list / filter by name
  env
    .argument("[name]", "filter by key name (case-insensitive substring)")
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--decrypt", "show decrypted values")
    .option("--target <env>", "filter by target: production, preview, development")
    .option("--json", "output raw JSON")
    .action(async (name: string | undefined, opts) => {
      const projectId = await resolveProject(opts);
      let envs = await fetchEnvs(projectId, opts.decrypt);

      if (opts.target) {
        envs = envs.filter((e: any) => e.target?.includes(opts.target));
      }

      if (name) {
        const q = name.toLowerCase();
        envs = envs.filter((e: any) => e.key.toLowerCase().includes(q));

        if (!envs.length) {
          const all = await fetchEnvs(projectId, false);
          const similar = all
            .filter((e: any) => e.key.toLowerCase().includes(q.slice(0, 3)))
            .map((e: any) => e.key);
          console.error(`No env var matching "${name}"`);
          if (similar.length) {
            hint(`  similar: ${similar.join(", ")}`);
          }
          process.exit(2);
        }

        if (envs.length === 1) {
          if (opts.json) {
            outputJson(envs[0]);
            return;
          }
          const e = envs[0];
          const val = e.value || "(encrypted)";
          table(
            ["Key", "Value", "Target", "Type"],
            [[e.key, val.length > 60 ? val.slice(0, 60) + "..." : val, (e.target || []).join(", "), e.type]]
          );
          return;
        }
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
          hint("  hint: remove --target to see all environments");
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

  // env set KEY=VALUE
  env
    .command("set <assignment>")
    .description("Set env var (KEY=VALUE)")
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--target <env...>", "target environments", ["production", "preview", "development"])
    .option("--json", "output raw JSON")
    .action(async (assignment: string, opts) => {
      const eq = assignment.indexOf("=");
      if (eq === -1) {
        console.error("Expected KEY=VALUE format");
        process.exit(1);
      }
      const key = assignment.slice(0, eq);
      const value = assignment.slice(eq + 1);
      if (!key) {
        console.error("Key cannot be empty");
        process.exit(1);
      }

      const projectId = await resolveProject(opts);
      const existing = await fetchEnvs(projectId, false);
      const found = existing.find((e: any) => e.key === key);

      let result;
      if (found) {
        result = await vercel(`/v10/projects/${projectId}/env/${found.id}`, {
          method: "PATCH",
          body: { value, target: opts.target },
        });
      } else {
        result = await vercel(`/v10/projects/${projectId}/env`, {
          method: "POST",
          body: { key, value, target: opts.target, type: "encrypted" },
        });
      }

      if (opts.json) {
        outputJson(result);
      } else {
        console.log(`set ${key} (${opts.target.join(", ")})`);
      }
    });

  // env rm KEY
  env
    .command("rm <key>")
    .description("Remove env var")
    .option("--project <name>", "project name or ID (overrides .vercel/project.json)")
    .option("--json", "output raw JSON")
    .action(async (key: string, opts) => {
      const projectId = await resolveProject(opts);
      const existing = await fetchEnvs(projectId, false);
      const found = existing.find((e: any) => e.key === key);

      if (!found) {
        console.error(`No env var "${key}" found`);
        const similar = existing
          .filter((e: any) => e.key.toLowerCase().includes(key.toLowerCase().slice(0, 3)))
          .map((e: any) => e.key);
        if (similar.length) {
          hint(`  similar: ${similar.join(", ")}`);
        }
        process.exit(1);
      }

      await vercel(`/v10/projects/${projectId}/env/${found.id}`, { method: "DELETE" });

      if (opts.json) {
        outputJson({ key, id: found.id, removed: true });
      } else {
        console.log(`removed ${key}`);
      }
    });
}
