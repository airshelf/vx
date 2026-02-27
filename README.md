# vx

Fast Vercel CLI replacement. Wraps the Vercel REST API directly — no SDK, no framework overhead.

## Why?

| Pain point | `vercel` | `vx` |
|---|---|---|
| `vercel logs` hangs 5 min then times out | Silent hang | Configurable `--timeout`, clean exit |
| `vercel link` silently rewires to wrong project | No confirmation | Reads `.vercel/project.json`, never modifies it |
| `vercel ls` output is noisy and hard to parse | Wall of text | Clean table, `--json` for piping |
| `vercel env pull` overwrites `.env.local` | Overwrites silently | Read-only — never touches local files |
| No JSON output for scripting | Limited | `--json` on every command |
| Slow startup | Node.js overhead | Bun — instant |

## Install

```bash
bun install -g vx-cli
```

Or run directly:

```bash
bunx vx-cli ls
```

## Auth

vx reads your existing Vercel credentials — zero config if you've used `vercel` before:

1. `VERCEL_TOKEN` environment variable (highest priority)
2. `~/.local/share/com.vercel.cli/auth.json` (Vercel CLI token)

Team context is read from `~/.local/share/com.vercel.cli/config.json`.
Project context is read from `.vercel/project.json` in the current directory.

## Commands

### `vx ls` — list deployments

```bash
vx ls                    # last 10 deployments
vx ls --prod             # production only
vx ls --limit 20         # more results
vx ls --state ERROR      # filter by state
vx ls --json             # raw JSON output
```

### `vx logs <url>` — stream deployment logs

```bash
vx logs my-app-abc123.vercel.app        # stream logs (30s timeout)
vx logs my-app-abc123.vercel.app -f     # follow live
vx logs my-app-abc123.vercel.app --no-follow  # fetch once
vx logs my-app-abc123.vercel.app --timeout 60000  # extend timeout
```

### `vx env` — list environment variables

```bash
vx env                        # list env vars for linked project
vx env --decrypt              # show values
vx env --target production    # filter by environment
vx env --project prj_abc123   # specify project
vx env --json                 # raw JSON
```

### `vx domains` — list domains

```bash
vx domains              # list all domains
vx domains --limit 50   # more results
vx domains --json       # raw JSON
```

## Piping

Every command supports `--json` for machine-readable output:

```bash
vx ls --json | jq '.deployments[0].url'
vx env --json --decrypt | jq '.envs[] | select(.key == "DATABASE_URL") | .value'
```

## Build from source

```bash
git clone https://github.com/yourusername/vx.git
cd vx
bun install
bun run build   # produces ./vx binary
```

## License

MIT
