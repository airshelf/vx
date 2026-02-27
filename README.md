# vx

Fast, agent-friendly Vercel CLI replacement. Wraps the Vercel REST API directly — no SDK, no framework overhead. Designed for both humans and AI agents.

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
bun install -g @airshelf/vx
```

Or run directly:

```bash
bunx @airshelf/vx ls
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

### `vx logs build <url>` — build logs

```bash
vx logs build my-app-abc123.vercel.app           # stream build output (30s timeout)
vx logs build my-app-abc123.vercel.app --no-follow  # fetch once
vx logs build my-app-abc123.vercel.app --timeout 60000  # extend timeout
```

### `vx logs runtime <url>` — runtime logs

```bash
vx logs runtime my-app-abc123.vercel.app         # serverless function invocations
vx logs runtime my-app-abc123.vercel.app -f      # follow live
vx logs runtime my-app-abc123.vercel.app --json  # raw JSON events
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

## Use with AI agents

Add this to your project's `CLAUDE.md` (or equivalent agent instructions):

```markdown
## Vercel

Use `vx` instead of `vercel` CLI for deployment operations:
- `vx ls --json` — list deployments (pipe through jq for filtering)
- `vx logs build <url> --no-follow --timeout 10000` — fetch build logs without hanging
- `vx logs runtime <url> --no-follow --timeout 10000` — fetch runtime logs without hanging
- `vx env --json --project <id>` — read env vars (never writes local files)
- `vx domains --json` — list domains

Always use `--json` flag for machine-readable output. Never use `vercel env pull`.
```

## Agent Experience (AX) design principles

vx is built for **Agent Experience** — the idea that AI agents are now users of developer tools. The same properties that make a tool work in shell scripts make it work with AI agents, plus a few extras.

### The principles vx follows

**1. Minimize output — every token costs context**

An agent's context window is its short-term memory. Every unnecessary character — separator lines, padding, decoration, verbose messages — pushes useful information out. Treat output as a budget: the less you spend on formatting, the more the agent can spend on reasoning. vx's table output has no separator lines. `--json` has no pretty-printing overhead. Error messages are one line.

**2. Structured output by default**

Every command supports `--json`. Agents waste tokens parsing ASCII tables and ANSI codes — JSON preserves the structure the code already has internally.

```bash
# Agent-friendly: structured, parseable
vx ls --json | jq '.deployments[] | {url, state}'

# Human-friendly: colored table (default)
vx ls
```

**3. stdout for data, stderr for noise**

Results go to stdout. Warnings (rate limits, timeouts) go to stderr. An agent piping output never gets progress messages mixed into data.

**4. No interactive prompts**

vx never prompts for confirmation, opens a browser, or launches an editor. Auth is token-based (`VERCEL_TOKEN` env var or existing CLI config). Every operation is fully specified by its arguments.

**5. Fail fast and loud**

The original `vercel logs` hangs silently for 5 minutes. vx has a `--timeout` flag (default 30s) and exits with a clear error message. Agents can detect failure and try something else.

**6. Never mutate implicitly**

vx never writes to local files. `vercel env pull` overwrites `.env.local` — vx reads env vars and prints them. `vercel link` rewires `.vercel/project.json` — vx only reads it. An agent using vx can't accidentally corrupt project state.

**7. Read existing state, don't create new state**

vx reads auth from `~/.local/share/com.vercel.cli/auth.json` and project context from `.vercel/project.json`. It doesn't create its own config files. Zero setup if the Vercel CLI was used before.

**8. Instant startup**

Bun compiles to a single binary. No Node.js framework boot, no plugin loading. In agent workflows where tools are called 40-60 times per session, startup latency compounds.

### The AX checklist

Building a CLI tool for AI agents? Check these:

| Principle | Why it matters |
|---|---|
| Minimize output tokens | Context window is finite — decoration is waste |
| `--json` on every command | Structured output eliminates parsing errors |
| stdout = data, stderr = logs | Piping works, agents get clean data |
| No interactive prompts | Agents can't type "Y" at a prompt |
| Deterministic exit codes | 0 = success, non-zero = failure — binary signals |
| `--timeout` on network ops | Silent hangs waste context and money |
| Clear error messages | Agents retry based on error text — make it parseable |
| Read-only by default | Destructive ops need explicit flags |
| Idempotent operations | Safe to retry — agents are iterative |
| `--help` is the API contract | Agents discover capabilities from help text |
| Fast startup | Sub-100ms — dozens of calls per session |

The meta-insight: the features developers are proudest of for humans (interactive wizards, spinners, guided flows) become the biggest obstacles for agents. **Good AX means boring: predictable, structured, silent, deterministic.**

## Build from source

```bash
git clone https://github.com/airshelf/vx.git
cd vx
bun install
bun run build   # produces ./vx binary
bun test        # 33 tests
```

## License

MIT
