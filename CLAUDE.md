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
