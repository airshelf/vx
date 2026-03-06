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
  telemetry.ts      # Usage logging (flag frequency, retry chains)
  mcp.ts            # MCP resource server (stdio transport)
  commands/
    ls.ts           # List deployments
    logs.ts         # Stream deployment logs
    env.ts          # List/manage env vars
    domains.ts      # List domains
    projects.ts     # List/find projects
    redeploy.ts     # Redeploy a deployment
```

## Dependencies

- `commander` — CLI subcommands and option parsing
- `picocolors` — terminal colors
- `@modelcontextprotocol/sdk` — MCP server implementation
- `bun-types` (dev) — Bun TypeScript types

## Conventions

- Each command exports `register{Name}(program: Command)` and is wired in `cli.ts`
- `api.ts` handles all Vercel API auth and request logic
- `format.ts` handles all output formatting (table, JSON, colors)
- Every command supports `--json` for machine-readable output
- `env` is a command group: `vx env` (list), `vx env KEY` (filter), `vx env set K=V`, `vx env rm K`
- Only `vx env set` and `vx env rm` mutate (alongside `vx redeploy`)
- `vx usage` — built-in telemetry command, shows flag frequency and retry chains

## JSON output shapes (for jq)

All `--json` output is bare arrays — no wrapper objects:
```bash
vx ls --json           | jq '.[0]'     # {url, state, created, ...}
vx ls --latest --json  | jq '.url'     # single object (not wrapped)
vx env --json          | jq '.[]'      # {key, value, target, ...}
vx env KEY --json      | jq '.key'     # single object (exact/substring match)
vx env set K=V --json  | jq '.id'      # API response object
vx projects --json     | jq '.[]'      # {id, name, framework, ...}
vx domains --json      | jq '.[]'      # {name, verified, ...}
vx projects X --json   | jq '.name'    # single object (not wrapped)
```

Agent gotcha: never `2>&1 | jq` — stderr hints corrupt JSON parsing. Use `vx ls --json | jq ...` (no `2>&1`).

## mcpfs filesystem mount

`vx mcp` serves MCP resources on stdio. `mcpfs auto` discovers it from `~/.claude.json` and mounts it:

```
/mnt/mcpfs/vx-resources/
├── deployments.json          # array of deployments
├── deployments/<url>/        # ls to discover, cat to read
│   ├── deployment            # single deployment JSON
│   └── logs/{build,runtime}  # log text
├── projects.json             # array of projects
├── projects/<name>/          # ls to discover, cat to read
│   ├── project               # single project JSON
│   └── env                   # env vars JSON
└── domains.json              # array of domains
```

Mount: `mcpfs auto` (mounts all MCP servers including vx).
Agents: use `ls` + `cat` on `/mnt/mcpfs/vx-resources/` for reads. Use `vx` CLI for Axiom logs, polling, and mutations.

## MCP resource server (protocol)

`vx mcp` also works as a standalone MCP server for Claude Desktop or other MCP clients:
```json
{ "mcpServers": { "vercel": { "command": "vx", "args": ["mcp"] } } }
```

## Design principles

- Mostly read-only — only `vx redeploy` mutates (idempotent, triggers rebuild)
- Only `vx env` needs project ID; everything else works without it
- Project ID: auto-detected by walking up from cwd to find `.vercel/project.json` (works in worktrees and monorepo subdirs)
- Auth: VERCEL_TOKEN env var or existing Vercel CLI auth file — no login command
- Deploy: not vx's job — deploy via git push, check status with `vx ls`
- Error messages: one line, stderr, actionable next step (AX #1 + #9)
- Unknown commands: mapped to specific one-line guidance (`deploy`, `link`, `login`, `dev`); fallback to `--help`
- No references to `vercel` CLI in user-facing output — vx is self-sufficient
- All 10 AX principles must pass (see README.md) — any change that breaks one gets rejected
