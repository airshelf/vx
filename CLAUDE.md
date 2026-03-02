# vx — Fast Vercel CLI

## Quick start

```bash
bun install          # install deps
bun run src/cli.ts   # run in dev
bun run build        # compile to ./vx binary
```

## Project structure

```
src/
  cli.ts            # Entry point, commander program setup
  config.ts         # Auth token + team + project resolution
  api.ts            # Vercel REST API client (fetch-based)
  format.ts         # Table/color output helpers
  commands/
    ls.ts           # List deployments
    logs.ts         # Stream deployment logs
    env.ts          # List/manage env vars
    domains.ts      # List domains
```

## Dependencies

- `commander` — CLI subcommands and option parsing
- `picocolors` — terminal colors
- `bun-types` (dev) — Bun TypeScript types

## Conventions

- Each command exports `register{Name}(program: Command)` and is wired in `cli.ts`
- `api.ts` handles all Vercel API auth and request logic
- `format.ts` handles all output formatting (table, JSON, colors)
- Every command supports `--json` for machine-readable output
- Never write to local files — read-only CLI

## Design principles

- 100% read-only — vx never writes to local files
- Only `vx env` needs project ID; everything else works without it
- Project ID: auto-detected by walking up from cwd to find `.vercel/project.json`
- Auth: VERCEL_TOKEN env var or existing Vercel CLI auth file — no login command
- Deploy: not vx's job — deploy via git push, check status with `vx ls`
- Error messages: one line, stderr, actionable next step (AX #1 + #9)
- No references to `vercel` CLI in user-facing output — vx is self-sufficient
- All 10 AX principles must pass (see README.md) — any change that breaks one gets rejected
