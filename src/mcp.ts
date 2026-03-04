import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
