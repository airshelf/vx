import { describe, test, expect, beforeAll, afterAll } from "bun:test";
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/v6/deployments") {
        return Response.json({
          deployments: [
            {
              url: "test-app-abc123.vercel.app",
              state: "READY",
              readyState: "READY",
              created: Date.now() - 120000,
              creator: { username: "testuser" },
              meta: { githubCommitRef: "main" },
            },
          ],
        });
      }

      if (
        url.pathname.startsWith("/v10/projects/") &&
        url.pathname.endsWith("/env")
      ) {
        return Response.json({
          envs: [
            {
              key: "DATABASE_URL",
              type: "secret",
              target: ["production"],
              updatedAt: Date.now() - 3600000,
              value: "postgres://...",
            },
            {
              key: "PUBLIC_KEY",
              type: "plain",
              target: ["production", "preview"],
              updatedAt: Date.now() - 7200000,
              value: "pk_123",
            },
            {
              key: "DEV_ONLY",
              type: "plain",
              target: ["development"],
              updatedAt: Date.now() - 86400000,
              value: "dev_val",
            },
          ],
        });
      }

      if (url.pathname === "/v9/projects") {
        return Response.json({
          projects: [
            {
              id: "prj_abc123",
              name: "my-app",
              framework: "nextjs",
              updatedAt: Date.now() - 3600000,
            },
            {
              id: "prj_def456",
              name: "api-service",
              framework: null,
              updatedAt: Date.now() - 86400000,
            },
          ],
        });
      }

      if (url.pathname === "/v9/projects/my-app") {
        return Response.json({
          id: "prj_abc123",
          name: "my-app",
          framework: "nextjs",
          updatedAt: Date.now() - 3600000,
          link: { type: "github", org: "testorg", repo: "my-app" },
        });
      }

      if (url.pathname === "/v5/domains") {
        return Response.json({
          domains: [
            {
              name: "example.com",
              verified: true,
              createdAt: Date.now() - 86400000 * 30,
              registrar: "namecheap",
            },
          ],
        });
      }

      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => server.stop());

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: "/home/eo/src/vx",
    env: {
      ...process.env,
      VERCEL_TOKEN: "test-token",
      VX_API_BASE: `http://localhost:${server.port}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

describe("ls command", () => {
  test("ls --json returns deployments array", async () => {
    const { stdout, exitCode } = await runCli("ls", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.deployments).toBeArrayOfSize(1);
    expect(data.deployments[0].url).toBe("test-app-abc123.vercel.app");
  });

  test("ls table mode shows deployment URL and creator", async () => {
    const { stdout, exitCode } = await runCli("ls");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("test-app-abc123.vercel.app");
    expect(stdout).toContain("testuser");
  });
});

describe("env command", () => {
  test("env --json returns all envs", async () => {
    const { stdout, exitCode } = await runCli(
      "env",
      "--json",
      "--project",
      "prj_test"
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.envs).toBeArrayOfSize(3);
  });

  test("env --target production --json filters to production envs", async () => {
    const { stdout, exitCode } = await runCli(
      "env",
      "--target",
      "production",
      "--json",
      "--project",
      "prj_test"
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.envs).toBeArrayOfSize(2);
    const keys = data.envs.map((e: any) => e.key);
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("PUBLIC_KEY");
    expect(keys).not.toContain("DEV_ONLY");
  });

  test("env table mode shows env var keys", async () => {
    const { stdout, exitCode } = await runCli(
      "env",
      "--project",
      "prj_test"
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("DATABASE_URL");
  });
});

describe("projects command", () => {
  test("projects --json returns projects array", async () => {
    const { stdout, exitCode } = await runCli("projects", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.projects).toBeArrayOfSize(2);
    expect(data.projects[0].name).toBe("my-app");
  });

  test("projects table mode shows name and ID", async () => {
    const { stdout, exitCode } = await runCli("projects");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-app");
    expect(stdout).toContain("prj_abc123");
    expect(stdout).toContain("api-service");
  });

  test("projects <name> --json returns single project", async () => {
    const { stdout, exitCode } = await runCli("projects", "my-app", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.id).toBe("prj_abc123");
    expect(data.name).toBe("my-app");
  });

  test("projects <name> shows project details", async () => {
    const { stdout, exitCode } = await runCli("projects", "my-app");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-app");
    expect(stdout).toContain("prj_abc123");
    expect(stdout).toContain("nextjs");
    expect(stdout).toContain("testorg/my-app");
  });
});

describe("domains command", () => {
  test("domains --json returns domains array", async () => {
    const { stdout, exitCode } = await runCli("domains", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.domains).toBeArrayOfSize(1);
    expect(data.domains[0].name).toBe("example.com");
  });

  test("domains table mode shows domain and registrar", async () => {
    const { stdout, exitCode } = await runCli("domains");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("example.com");
    expect(stdout).toContain("namecheap");
  });
});
