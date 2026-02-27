# vx Test Suite

**Date:** 2026-02-27
**Status:** COMPLETE

## Summary

Complete test suite for vx using `bun:test`. Pure unit tests for format.ts, mock HTTP server tests for API client and commands. One production change: extract API base URL to env var (`VX_API_BASE`) for testability. No real Vercel API calls.

## Strategy

- **format.ts**: Pure unit tests — no mocking needed
- **config.ts**: Test via env vars (the primary path); file-based fallback tested with temp files
- **api.ts + commands**: Start a local `Bun.serve()` mock server, set `VX_API_BASE` env var, test against real HTTP. This avoids fragile module mocking and tests the actual fetch path.
- **logs.ts**: Same mock server approach, return streaming NDJSON responses

## Tasks

### Task 1: Add VX_API_BASE env var support
**Files:** `src/api.ts`, `src/commands/logs.ts`
**Steps:**
1. In `src/api.ts` line 3: change `const BASE = "https://api.vercel.com"` to `const BASE = process.env.VX_API_BASE || "https://api.vercel.com"`
2. In `src/commands/logs.ts` line 5: change `const BASE = "https://api.vercel.com"` to `const BASE = process.env.VX_API_BASE || "https://api.vercel.com"`
3. Add `"test": "bun test"` to package.json scripts

**Verify:**
```bash
bun run build && ./vx --version
```
**Done when:** Build passes, existing behavior unchanged
- [x] Task 1 complete

### Task 2: format.ts unit tests
**Files:** `tests/format.test.ts`
**Steps:**
1. Create `tests/format.test.ts` with `describe` blocks:
   - **relativeTime**: test "just now" (30s ago), "1m ago" (60s), "59m ago" (3540s), "1h ago" (3600s), "23h ago", "1d ago" (86400s), "30d ago". Use `Date.now() - N` as input.
   - **stateColor**: test each state returns a string containing the state name (color codes wrap it). READY, ERROR, CANCELED, BUILDING, INITIALIZING, QUEUED, "UNKNOWN" passthrough.
   - **table**: spy `console.log`, call `table(["A","B"], [["x","y"]])`, verify console.log called 3 times (header, separator, row). Verify alignment.
   - **outputJson**: spy `console.log`, call `outputJson({a:1})`, verify logged string matches `JSON.stringify({a:1}, null, 2)`.
2. Use `import { spyOn } from "bun:test"` for console spying. Restore in `afterEach`.

**Verify:**
```bash
bun test tests/format.test.ts
```
**Done when:** All format tests pass
- [x] Task 2 complete

### Task 3: Mock server helper + api.ts tests
**Files:** `tests/helpers.ts`, `tests/api.test.ts`
**Steps:**
1. Create `tests/helpers.ts` with:
   - `startMockServer(handler: (req: Request) => Response | Promise<Response>): { url: string, stop: () => void }` — starts `Bun.serve` on port 0, returns base URL and stop function
   - `setTestEnv(token?: string, base?: string)` — sets `VERCEL_TOKEN` and `VX_API_BASE` env vars
   - `clearTestEnv()` — deletes test env vars
2. Create `tests/api.test.ts` testing:
   - **Basic GET**: start mock server returning `{ok: true}`, call `vercel("/test")`, verify response. Check request had auth header.
   - **teamId appending**: test with and without `?` in path. Mock server captures request URL, verify `?teamId=X` vs `&teamId=X` appended correctly. (Need to also mock config — set env var for token, and for teamId we need the config to have it. Simplest: create a temp `.local/share/com.vercel.cli/config.json` or use mock.module for config.ts just for teamId.)
   - Actually simpler: **refactor tests to not need teamId mocking**. Test teamId appending by examining the URL the mock server receives. For config, just use VERCEL_TOKEN env var (no teamId). Test teamId separately in config tests.
   - **Error response**: mock server returns 404 with body "not found", verify throws `Vercel API 404: not found`
   - **Rate limit**: mock server returns 200 with `X-RateLimit-Remaining: 5` header, spy console.error, verify warning
   - **vercelStream**: mock server returns streaming body, verify raw Response returned
   - **POST with body**: mock server captures request, verify method=POST and body present

**Verify:**
```bash
bun test tests/api.test.ts
```
**Done when:** All API tests pass
- [x] Task 3 complete

### Task 4: Command tests (ls, env, domains)
**Files:** `tests/commands.test.ts`
**Steps:**
1. Create `tests/commands.test.ts` using mock server + subprocess approach:
   - For each command, run `bun run src/cli.ts <command> --json` as subprocess via `Bun.spawn`, set `VERCEL_TOKEN` and `VX_API_BASE` env vars
   - Mock server returns fixture data per endpoint path
2. Fixture data:
   - `/v6/deployments`: `{ deployments: [{ url: "test.vercel.app", state: "READY", readyState: "READY", created: Date.now(), creator: { username: "testuser" }, meta: { githubCommitRef: "main" } }] }`
   - `/v10/projects/prj_test/env`: `{ envs: [{ key: "API_KEY", type: "secret", target: ["production"], updatedAt: Date.now() }] }`
   - `/v5/domains`: `{ domains: [{ name: "example.com", verified: true, createdAt: Date.now(), registrar: "namecheap" }] }`
3. Tests per command:
   - **ls --json**: parse stdout as JSON, verify deployments array present
   - **ls** (table): verify stdout contains "test.vercel.app"
   - **env --json --project prj_test**: verify envs array
   - **env --target production --json --project prj_test**: verify filtered result
   - **domains --json**: verify domains array
   - **domains**: verify stdout contains "example.com"
4. Each test: spawn process, capture stdout, parse/check

**Verify:**
```bash
bun test tests/commands.test.ts
```
**Done when:** All command tests pass
- [x] Task 4 complete

### Task 5: Logs command test
**Files:** `tests/logs.test.ts`
**Steps:**
1. Create `tests/logs.test.ts` using mock server:
   - Mock server returns streaming NDJSON when path matches `/v3/deployments/*/events`
   - Fixture events: `[{created: Date.now(), text: "Building..."}, {created: Date.now(), text: "Error: build failed"}]` — one per line, newline-delimited
2. Tests:
   - **logs --json --no-follow**: run subprocess, verify each line of stdout is valid JSON
   - **logs --no-follow**: run subprocess, verify output contains timestamps and event text
   - **URL stripping**: verify mock server receives URL without `https://` prefix
3. Use `--no-follow --timeout 5000` to prevent tests from hanging
4. Run full test suite

**Verify:**
```bash
bun test
```
**Done when:** Full `bun test` passes — all test files green
- [x] Task 5 complete

## Final Verification
```bash
bun test
bun run build
```
