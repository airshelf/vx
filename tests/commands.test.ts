import { describe, test, expect, beforeAll, afterAll } from "bun:test";

// Resolve the checkout under test from this file's location — hardcoding
// /home/eo/src/vx silently tests the main checkout when run from a worktree.
const REPO_ROOT = new URL("..", import.meta.url).pathname;
const CLI = `${REPO_ROOT}src/cli.ts`;

let server: ReturnType<typeof Bun.serve>;
let deploymentCallCount = 0;
const requestLog: string[] = [];
let lastEnvWrite: any = null;

beforeAll(() => {
  server = Bun.serve({
    // Pin to 127.0.0.1 on both sides (see VX_API_BASE below): "localhost" can
    // resolve to ::1 first and intermittently stall spawned CLI fetches for
    // seconds, which showed up as random exactly-5000ms test timeouts.
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      requestLog.push(`${req.method} ${url.pathname}`);

      if (url.pathname === "/v6/deployments") {
        deploymentCallCount++;
        // If "wait-test" marker is in query, simulate BUILDING → READY
        if (url.searchParams.get("state") === "BUILDING_THEN_READY") {
          const state = deploymentCallCount <= 1 ? "BUILDING" : "READY";
          return Response.json({
            deployments: [{
              url: "wait-test.vercel.app",
              state, readyState: state,
              created: Date.now() - 10000,
              creator: { username: "testuser" },
              meta: { githubCommitRef: "main" },
            }],
          });
        }
        // Simulate a BUILDING deployment for hint test
        if (url.searchParams.get("projectId") === "prj_building") {
          return Response.json({
            deployments: [{
              url: "building-app.vercel.app",
              state: "BUILDING", readyState: "BUILDING",
              created: Date.now() - 5000,
              creator: { username: "testuser" },
              meta: { githubCommitRef: "main" },
            }],
          });
        }
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
        if (req.method === "POST") {
          return req.json().then((body: any) => {
            lastEnvWrite = body;
            return Response.json({ ...body, id: "env_created" });
          });
        }
        return Response.json({
          envs: [
            {
              id: "env_db",
              key: "DATABASE_URL",
              type: "secret",
              target: ["production"],
              updatedAt: Date.now() - 3600000,
              value: "postgres://...",
            },
            {
              id: "env_pk",
              key: "PUBLIC_KEY",
              type: "plain",
              target: ["production", "preview"],
              updatedAt: Date.now() - 7200000,
              value: "pk_123",
            },
            {
              id: "env_dev",
              key: "DEV_ONLY",
              type: "plain",
              target: ["development"],
              updatedAt: Date.now() - 86400000,
              value: "dev_val",
            },
          ],
        });
      }

      // PATCH/DELETE on a single env var: /v10/projects/:id/env/:envId
      if (/^\/v10\/projects\/[^/]+\/env\/[^/]+$/.test(url.pathname)) {
        if (req.method === "PATCH") {
          return req.json().then((body: any) => {
            lastEnvWrite = body;
            return Response.json({ ...body, id: url.pathname.split("/").pop() });
          });
        }
        if (req.method === "DELETE") {
          return Response.json({});
        }
      }

      if (url.pathname === "/v9/projects") {
        // Project-name search used by resolveProjectId()
        if (url.searchParams.get("search") === "bime-telegram") {
          return Response.json({
            projects: [{ id: "prj_bime123", name: "bime-telegram" }],
          });
        }
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

      if (url.pathname === "/v13/deployments" && req.method === "POST") {
        return req.json().then((body: any) =>
          Response.json({
            id: "dpl_redeploy123",
            url: "redeployed-app.vercel.app",
            name: body.name || "test-app",
            readyState: "QUEUED",
            status: "QUEUED",
            target: body.target || "production",
          })
        );
      }

      if (url.pathname === "/v13/deployments/get") {
        return Response.json({
          id: "dpl_original123",
          name: "test-app",
          url: "test-app-abc123.vercel.app",
          readyState: "ERROR",
        });
      }

      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => server.stop());

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VERCEL_TOKEN: "test-token",
      VX_API_BASE: `http://127.0.0.1:${server.port}`,
      VX_HINTS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("ls command", () => {
  test("ls --json returns bare array", async () => {
    const { stdout, exitCode } = await runCli("ls", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toBeArrayOfSize(1);
    expect(data[0].url).toBe("test-app-abc123.vercel.app");
  });

  test("ls table mode shows deployment URL and state", async () => {
    const { stdout, exitCode } = await runCli("ls");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("test-app-abc123.vercel.app");
    expect(stdout).toContain("READY");
  });

  test("ls --wait exits 0 when deployment is READY", async () => {
    const { stdout, exitCode } = await runCli("ls", "--wait", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data[0].readyState).toBe("READY");
  });

  test("ls --wait --json suppresses progress on stderr", async () => {
    const { stderr, exitCode } = await runCli("ls", "--wait", "--json");
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("polling every");
  });

  test("ls hints --wait when deployment is BUILDING (table mode)", async () => {
    // Create temp dir with .vercel/project.json pointing to prj_building
    const tmpDir = `/tmp/vx-test-building-${Date.now()}`;
    await Bun.write(`${tmpDir}/.vercel/project.json`, JSON.stringify({ projectId: "prj_building" }));
    const proc = Bun.spawn(["bun", "run", CLI, "ls"], {
      cwd: tmpDir,
      env: {
        ...process.env,
        VERCEL_TOKEN: "test-token",
        VX_API_BASE: `http://127.0.0.1:${server.port}`,
        VX_HINTS: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    expect(stderr).toContain("use --wait to poll until READY");
    // cleanup
    const { unlinkSync, rmdirSync } = await import("fs");
    unlinkSync(`${tmpDir}/.vercel/project.json`);
    rmdirSync(`${tmpDir}/.vercel`);
    rmdirSync(tmpDir);
  });

  test("ls --json does NOT hint about --wait (hint is table-mode only)", async () => {
    const tmpDir = `/tmp/vx-test-building-json-${Date.now()}`;
    await Bun.write(`${tmpDir}/.vercel/project.json`, JSON.stringify({ projectId: "prj_building" }));
    const proc = Bun.spawn(["bun", "run", CLI, "ls", "--json"], {
      cwd: tmpDir,
      env: {
        ...process.env,
        VERCEL_TOKEN: "test-token",
        VX_API_BASE: `http://127.0.0.1:${server.port}`,
        VX_HINTS: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    expect(stderr).not.toContain("use --wait");
    // cleanup
    const { unlinkSync, rmdirSync } = await import("fs");
    unlinkSync(`${tmpDir}/.vercel/project.json`);
    rmdirSync(`${tmpDir}/.vercel`);
    rmdirSync(tmpDir);
  });
});

describe("env command", () => {
  test("env --json returns bare array", async () => {
    const { stdout, exitCode } = await runCli(
      "env",
      "--json",
      "--project",
      "prj_test"
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toBeArrayOfSize(3);
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
    expect(data).toBeArrayOfSize(2);
    const keys = data.map((e: any) => e.key);
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

// Regression: `vx env set K=V --project X` silently wrote to the DEFAULT
// project (2026-07-25, NDA_TOKEN_SECRET landed on airshelf instead of
// bime-telegram). Root cause: the parent `env` command also declares
// --project/--target/--json, and commander's default non-positional parsing
// lets the parent consume those options even when they appear after the
// subcommand — so `set`/`rm` never saw them and fell back to
// .vercel/project.json. These tests run from a directory linked to
// prj_default999 so any fallback is detectable as a write to the wrong path.
describe("env set/rm project scoping", () => {
  const linkedDir = `/tmp/vx-test-linked-${Date.now()}`;

  beforeAll(async () => {
    await Bun.write(
      `${linkedDir}/.vercel/project.json`,
      JSON.stringify({ projectId: "prj_default999" })
    );
  });

  afterAll(async () => {
    const { rmSync } = await import("fs");
    rmSync(linkedDir, { recursive: true, force: true });
  });

  async function runLinked(
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", CLI, ...args], {
      cwd: linkedDir,
      env: {
        ...process.env,
        VERCEL_TOKEN: "test-token",
        VX_API_BASE: `http://127.0.0.1:${server.port}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  test("set --project <name> creates the var on the named project", async () => {
    requestLog.length = 0;
    const { stdout, exitCode } = await runLinked(
      "env", "set", "NEW_KEY=hello", "--project", "bime-telegram"
    );
    expect(exitCode).toBe(0);
    const writes = requestLog.filter((r) => /^(POST|PATCH|DELETE) /.test(r));
    expect(writes).toEqual(["POST /v10/projects/prj_bime123/env"]);
    expect(requestLog.join("\n")).not.toContain("prj_default999");
    // AX: success line must echo the resolved project so a mismatch is visible
    expect(stdout).toContain("set NEW_KEY on bime-telegram");
  });

  test("set --project <name> updates an existing var on the named project", async () => {
    requestLog.length = 0;
    const { stdout, exitCode } = await runLinked(
      "env", "set", "DATABASE_URL=postgres://new", "--project", "bime-telegram"
    );
    expect(exitCode).toBe(0);
    const writes = requestLog.filter((r) => /^(POST|PATCH|DELETE) /.test(r));
    expect(writes).toEqual(["PATCH /v10/projects/prj_bime123/env/env_db"]);
    expect(requestLog.join("\n")).not.toContain("prj_default999");
    expect(stdout).toContain("on bime-telegram");
  });

  test("set --target after the subcommand reaches set, not the parent", async () => {
    lastEnvWrite = null;
    const { stdout, exitCode } = await runLinked(
      "env", "set", "NEW_KEY=hello", "--project", "prj_bime123",
      "--target", "production"
    );
    expect(exitCode).toBe(0);
    expect(lastEnvWrite.target).toEqual(["production"]);
    expect(stdout).toContain("(production)");
  });

  test("set --json outputs JSON, not the table line", async () => {
    const { stdout, exitCode } = await runLinked(
      "env", "set", "NEW_KEY=hello", "--project", "prj_bime123", "--json"
    );
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.key).toBe("NEW_KEY");
  });

  test("rm --project <name> deletes from the named project", async () => {
    requestLog.length = 0;
    const { stdout, exitCode } = await runLinked(
      "env", "rm", "DATABASE_URL", "--project", "bime-telegram"
    );
    expect(exitCode).toBe(0);
    const writes = requestLog.filter((r) => /^(POST|PATCH|DELETE) /.test(r));
    expect(writes).toEqual(["DELETE /v10/projects/prj_bime123/env/env_db"]);
    expect(requestLog.join("\n")).not.toContain("prj_default999");
    expect(stdout).toContain("removed DATABASE_URL on bime-telegram");
  });

  test("set without --project echoes the default project id", async () => {
    const { stdout, exitCode } = await runLinked("env", "set", "NEW_KEY=hello");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("set NEW_KEY on prj_default999");
  });
});

describe("projects command", () => {
  test("projects --json returns bare array", async () => {
    const { stdout, exitCode } = await runCli("projects", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toBeArrayOfSize(2);
    expect(data[0].name).toBe("my-app");
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
  test("domains --json returns bare array", async () => {
    const { stdout, exitCode } = await runCli("domains", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data).toBeArrayOfSize(1);
    expect(data[0].name).toBe("example.com");
  });

  test("domains table mode shows domain and registrar", async () => {
    const { stdout, exitCode } = await runCli("domains");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("example.com");
    expect(stdout).toContain("namecheap");
  });
});

describe("redeploy command", () => {
  test("redeploy --json triggers redeployment", async () => {
    const { stdout, exitCode } = await runCli("redeploy", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.url).toBe("redeployed-app.vercel.app");
    expect(data.readyState).toBe("QUEUED");
  });

  test("redeploy table mode shows status and URL", async () => {
    const { stdout, stderr, exitCode } = await runCli("redeploy");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("redeployed-app.vercel.app");
    expect(stderr).toContain("use --wait to block until READY");
  });

  test("redeploy with URL resolves deployment", async () => {
    const { stdout, exitCode } = await runCli("redeploy", "test-app-abc123.vercel.app", "--json");
    expect(exitCode).toBe(0);
    const data = JSON.parse(stdout);
    expect(data.url).toBe("redeployed-app.vercel.app");
  });
});
