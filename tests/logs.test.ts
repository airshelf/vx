import { describe, test, expect, afterAll } from "bun:test";

const events = [
  { created: Date.now(), text: "Installing dependencies..." },
  { created: Date.now(), text: "Building project..." },
  { created: Date.now(), text: "Build completed successfully" },
];

let capturedPath = "";

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/v3/deployments/")) {
      capturedPath = url.pathname + url.search;
      const ndjson = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
      return new Response(ndjson, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => server.stop());

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("logs build command", () => {
  test("--json --no-follow outputs valid NDJSON events", async () => {
    const { stdout } = await runCli(
      "logs",
      "build",
      "test.vercel.app",
      "--json",
      "--no-follow",
      "--timeout",
      "5000"
    );

    const parsed = stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    expect(parsed.length).toBeGreaterThanOrEqual(2);
    for (const event of parsed) {
      expect(event).toHaveProperty("text");
    }
  });

  test("--no-follow formatted output contains event text", async () => {
    const { stdout } = await runCli(
      "logs",
      "build",
      "test.vercel.app",
      "--no-follow",
      "--timeout",
      "5000"
    );

    expect(stdout).toContain("Installing dependencies");
    expect(stdout).toContain("Build completed");
  });

  test("sends builds=1 for build subcommand", async () => {
    capturedPath = "";
    await runCli(
      "logs",
      "build",
      "test.vercel.app",
      "--no-follow",
      "--timeout",
      "5000"
    );

    expect(capturedPath).toContain("builds=1");
  });
});

describe("logs runtime command", () => {
  test("sends builds=0 for runtime subcommand", async () => {
    capturedPath = "";
    await runCli(
      "logs",
      "runtime",
      "test.vercel.app",
      "--no-follow",
      "--timeout",
      "5000"
    );

    expect(capturedPath).toContain("builds=0");
  });

  test("strips https:// prefix from URL", async () => {
    capturedPath = "";
    await runCli(
      "logs",
      "runtime",
      "https://test.vercel.app",
      "--no-follow",
      "--timeout",
      "5000"
    );

    expect(capturedPath).toStartWith(
      "/v3/deployments/test.vercel.app/events"
    );
  });
});
