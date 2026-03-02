import { describe, test, expect } from "bun:test";

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: "/home/eo/src/vx",
    env: {
      ...process.env,
      VERCEL_TOKEN: "test-token",
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

describe("unknown command handler", () => {
  test("deploy gives git-push guidance", async () => {
    const { stderr, exitCode } = await runCli("deploy", "--prod");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("git push");
    expect(stderr).toContain("vx ls --json");
  });

  test("link gives project.json guidance", async () => {
    const { stderr, exitCode } = await runCli("link");
    expect(exitCode).toBe(1);
    expect(stderr).toContain(".vercel/project.json");
  });

  test("login gives VERCEL_TOKEN guidance", async () => {
    const { stderr, exitCode } = await runCli("login");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("VERCEL_TOKEN");
    expect(stderr).toContain("vercel.com/account/tokens");
  });

  test("dev gives framework guidance", async () => {
    const { stderr, exitCode } = await runCli("dev");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("next dev");
  });

  test("unknown command gives --help guidance", async () => {
    const { stderr, exitCode } = await runCli("foobar");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown command 'foobar'");
    expect(stderr).toContain("vx --help");
  });

  test("all unknown command messages are single line", async () => {
    for (const cmd of ["deploy", "link", "login", "dev", "foobar"]) {
      const { stderr } = await runCli(cmd);
      const lines = stderr.trim().split("\n");
      expect(lines.length).toBe(1);
    }
  });
});

describe("--help", () => {
  test("description lists commands", async () => {
    const { stdout } = await runCli("--help");
    expect(stdout).toContain("Fast Vercel CLI");
    expect(stdout).toContain("redeploy");
  });
});
