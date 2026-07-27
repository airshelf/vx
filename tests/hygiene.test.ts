import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "fs";

// Two bug classes that each bit twice — keep them dead:
// 1. Hardcoded checkout cwd: spawning the CLI with cwd "/home/eo/src/vx"
//    silently tests the MAIN checkout when the suite runs from a worktree.
//    Derive paths from import.meta.url instead (see REPO_ROOT in any test).
// 2. "localhost" mock servers: can resolve to ::1 first and intermittently
//    stall spawned CLI fetches for seconds. Pin 127.0.0.1 on both sides.
describe("test-suite hygiene", () => {
  const testDir = new URL(".", import.meta.url).pathname;
  const files = readdirSync(testDir).filter((f) => f.endsWith(".ts"));

  // Needles are split so this file's own source doesn't match them.
  const hardcodedCwd = 'cwd: "' + "/home";
  const localhostUrl = "http://" + "localhost";

  test("no test hardcodes an absolute checkout path as cwd", () => {
    for (const f of files) {
      const src = readFileSync(testDir + f, "utf-8");
      expect(src, `${f}: derive cwd from import.meta.url, not /home/...`).not.toContain(hardcodedCwd);
    }
  });

  test("no test uses a localhost URL for mock servers", () => {
    for (const f of files) {
      const src = readFileSync(testDir + f, "utf-8");
      expect(src, `${f}: pin mock servers to 127.0.0.1, not localhost`).not.toContain(localhostUrl);
    }
  });
});
