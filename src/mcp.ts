import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { vercel } from "./api.ts";
import { getConfig } from "./config.ts";
import pkg from "../package.json";

function json(data: unknown) {
  return JSON.stringify(data, null, 2);
}

async function resolveDeploymentId(url: string): Promise<string> {
  const data = await vercel(`/v13/deployments/get?url=${encodeURIComponent(url)}`);
  return data.id;
}

export async function startMcpServer() {
  const server = new McpServer({ name: "vx", version: pkg.version });

  // --- Static resources ---

  server.registerResource(
    "deployments",
    "vercel://deployments",
    { description: "Latest deployments (array)", mimeType: "application/json" },
    async (uri) => {
      const config = await getConfig();
      let query = "/v6/deployments?limit=10";
      if (config.projectId) query += `&projectId=${config.projectId}`;
      const data = await vercel(query);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(data.deployments) }] };
    },
  );

  server.registerResource(
    "projects",
    "vercel://projects",
    { description: "All projects (array)", mimeType: "application/json" },
    async (uri) => {
      const data = await vercel("/v9/projects");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(data.projects) }] };
    },
  );

  server.registerResource(
    "domains",
    "vercel://domains",
    { description: "All domains (array)", mimeType: "application/json" },
    async (uri) => {
      const data = await vercel("/v5/domains");
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(data.domains) }] };
    },
  );

  // --- Templated resources ---

  server.registerResource(
    "deployment",
    new ResourceTemplate("vercel://deployments/{url}", { list: undefined }),
    { description: "Single deployment by URL", mimeType: "application/json" },
    async (uri, vars) => {
      const data = await vercel(`/v13/deployments/get?url=${encodeURIComponent(vars.url as string)}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(data) }] };
    },
  );

  server.registerResource(
    "build-logs",
    new ResourceTemplate("vercel://deployments/{url}/logs/build", { list: undefined }),
    { description: "Build logs for a deployment", mimeType: "text/plain" },
    async (uri, vars) => {
      const id = await resolveDeploymentId(vars.url as string);
      const data = await vercel(`/v7/deployments/${id}/events?builds=1&direction=backward&limit=100`);
      const lines = (data || [])
        .filter((e: any) => e.type === "stdout" || e.type === "stderr")
        .map((e: any) => e.payload?.text || "")
        .join("");
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: lines || "(no build logs)" }] };
    },
  );

  server.registerResource(
    "runtime-logs",
    new ResourceTemplate("vercel://deployments/{url}/logs/runtime", { list: undefined }),
    { description: "Runtime logs for a deployment", mimeType: "text/plain" },
    async (uri, vars) => {
      const id = await resolveDeploymentId(vars.url as string);
      const data = await vercel(`/v3/deployments/${id}/events?limit=100&direction=backward`);
      const lines = (data || [])
        .map((e: any) => `${e.date || ""} ${e.message || ""}`)
        .join("\n");
      return { contents: [{ uri: uri.href, mimeType: "text/plain", text: lines || "(no runtime logs)" }] };
    },
  );

  server.registerResource(
    "project",
    new ResourceTemplate("vercel://projects/{name}", { list: undefined }),
    { description: "Single project by name or ID", mimeType: "application/json" },
    async (uri, vars) => {
      const data = await vercel(`/v9/projects/${encodeURIComponent(vars.name as string)}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(data) }] };
    },
  );

  server.registerResource(
    "env",
    new ResourceTemplate("vercel://projects/{name}/env", { list: undefined }),
    { description: "Environment variables for a project", mimeType: "application/json" },
    async (uri, vars) => {
      const data = await vercel(`/v10/projects/${encodeURIComponent(vars.name as string)}/env`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: json(data.envs) }] };
    },
  );

  // --- Tool (mutation) ---

  server.registerTool(
    "redeploy",
    {
      title: "Redeploy",
      description: "Re-trigger a deployment. Defaults to latest deployment, targets production.",
      inputSchema: {
        deploymentUrl: z.string().optional().describe("Deployment URL to redeploy (defaults to latest)"),
        target: z.enum(["production", "preview"]).optional().describe("Deployment target (default: production)"),
      },
    },
    async (args) => {
      const config = await getConfig();
      const target = args.target || "production";
      let deploymentId: string;
      let name: string;

      if (args.deploymentUrl) {
        const data = await vercel(`/v13/deployments/get?url=${encodeURIComponent(args.deploymentUrl)}`);
        deploymentId = data.id;
        name = data.name;
      } else {
        let query = "/v6/deployments?limit=1";
        if (config.projectId) query += `&projectId=${config.projectId}`;
        const data = await vercel(query);
        const latest = data.deployments?.[0];
        if (!latest) return { content: [{ type: "text" as const, text: "error: no deployments found" }] };
        deploymentId = latest.uid;
        name = latest.name;
      }

      const result = await vercel("/v13/deployments", {
        method: "POST",
        body: { name, deploymentId, target },
      });

      return {
        content: [{
          type: "text" as const,
          text: json({ url: result.url, state: result.readyState || "QUEUED", target }),
        }],
      };
    },
  );

  const transport = new StdioServerTransport();

  // Exit when the parent Claude session dies. Without this, stdin EOF
  // spin-loops under bun (100% CPU until manually killed) — the third
  // runaway class after EPIPE and stuck Axiom bodies (see 9901b93).
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
  const parentPid = process.ppid;
  setInterval(() => {
    if (process.ppid !== parentPid) process.exit(0); // orphaned: reparented
  }, 30_000).unref();

  await server.connect(transport);
}
