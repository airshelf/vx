# vx

Fast, agent-friendly Vercel CLI replacement. Wraps the Vercel REST API directly — no SDK, no framework overhead. Designed for both humans and AI agents. Includes an MCP resource server for zero-schema AI integration.

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
Project context is read from `.vercel/project.json` — vx walks up from the current directory to find it (works in subdirectories and git worktrees).

## Commands

### `vx ls` — list deployments

```bash
vx ls                    # last 10 deployments
vx ls --prod             # production only
vx ls --limit 20         # more results
vx ls --state ERROR      # filter by state
vx ls --json             # raw JSON output
vx ls --wait             # poll until latest deployment is READY or ERROR
vx ls --wait --json      # same, with JSON output
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

### `vx projects` — list or find projects

```bash
vx projects                    # list all projects
vx projects --json             # raw JSON
vx projects my-app             # find project by name or ID
vx projects my-app --json      # project details as JSON
```

### `vx redeploy` — redeploy a deployment

```bash
vx redeploy                              # redeploy latest deployment
vx redeploy my-app-abc123.vercel.app     # redeploy specific URL
vx redeploy --target preview             # target preview instead of production
vx redeploy --json                       # raw JSON
```

### `vx mcp` — MCP resource server

Starts an MCP resource server on stdio. Exposes Vercel data as **resources instead of tools** — zero schema bloat, read-only, URI-based.

```
vercel://deployments                     # latest deployments (array)
vercel://deployments/{url}               # single deployment
vercel://deployments/{url}/logs/build    # build logs (text)
vercel://deployments/{url}/logs/runtime  # runtime logs (text)
vercel://projects                        # all projects (array)
vercel://projects/{name}                 # single project
vercel://projects/{name}/env             # env vars (array)
vercel://domains                         # all domains (array)
```

**Why resources instead of tools?** A typical MCP tool server ships dozens of tool definitions with full JSON schemas — ~20,000+ tokens of context consumed before the agent asks a single question. vx's resource catalog is ~300 tokens. That's a **65x reduction** in context cost. And since resources are read-only URIs, there are no parameters for agents to hallucinate.

Configure in Claude Code:

```bash
claude mcp add -s user vx-resources -- vx mcp
```

Or in Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "vercel": { "command": "vx", "args": ["mcp"] } } }
```

## Piping

Every command supports `--json` for machine-readable output:

```bash
vx ls --json | jq '.[0].url'
vx env --json --decrypt | jq '.[] | select(.key == "DATABASE_URL") | .value'
vx projects --json | jq '.[].name'
vx domains --json | jq '.[].name'
```

All `--json` output is bare arrays — no wrapper objects. Pipe directly to `jq '.[0]'`.

## Use with AI agents

**Option 1: MCP resources** (recommended for Claude Code / Claude Desktop)

```bash
claude mcp add -s user vx-resources -- vx mcp
```

The agent reads Vercel data as MCP resources (`vercel://deployments`, `vercel://projects/{name}/env`, etc.) — no tool schemas, no parameters, no jq. ~300 tokens of context vs ~20k for a typical MCP tool server.

**Option 2: CLI** — add this to your project's `CLAUDE.md`:

```markdown
## Vercel

Use `vx` for Vercel operations:
- `vx ls --json` — list deployments
- `vx ls --wait --json` — poll until latest deployment is READY or ERROR
- `vx logs build <url> --no-follow --timeout 10000` — build logs
- `vx logs runtime <url> --no-follow --timeout 10000` — runtime logs
- `vx env --json --project <name>` — env vars (read-only, never writes local files)
- `vx domains --json` — domains
- `vx projects --json` — projects
- `vx redeploy` — redeploy latest deployment (or specify URL)
- Deploy: `git push` (Vercel auto-deploys), then `vx ls --wait --json`
- Auth: set `VERCEL_TOKEN` env var (get one at vercel.com/account/tokens)
- All --json output is bare arrays — use `jq '.[0]'` not `jq '.deployments[0]'`
- Never `2>&1 | jq` — stderr hints corrupt JSON parsing
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

vx never writes to local files. `vercel env pull` overwrites `.env.local` — vx reads env vars and prints them. `vercel link` rewires `.vercel/project.json` — vx only reads it. The only mutation is `vx redeploy`, which re-triggers an existing deployment — no arbitrary code, no repo IDs, no parameters to hallucinate.

**7. Read existing state, don't create new state**

vx reads auth from `~/.local/share/com.vercel.cli/auth.json` and project context from `.vercel/project.json`. It doesn't create its own config files. Zero setup if the Vercel CLI was used before.

**8. Instant startup**

Bun compiles to a single binary. No Node.js framework boot, no plugin loading. In agent workflows where tools are called 40-60 times per session, startup latency compounds.

**9. Guide on failure — empty results are the worst UX**

When a tool returns nothing, the agent has zero signal. It doesn't know if the query was wrong, the scope was too narrow, or there's genuinely nothing. Print a diagnostic to stderr: what was searched, how much was searched, and what to try next. `claude-grep` prints `no matches for "x" (126 files, 7 days, current project) — try: -d 30, -a, -s`. One line turns a dead end into a next step.

**10. Log usage for yourself — close the feedback loop**

You can't improve what you can't observe. Log one JSONL line per invocation — what was called, what flags, how many results, how long it took. Not for analytics dashboards — for YOU to see how agents actually use the tool. `claude-grep --usage` shows hit rate, empty patterns, retry chains, and BRE misuse. Every improvement in this list (BRE normalization, no-match hints) came from reading that log. The tool documents how to improve itself.

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
| Read-only by default | Mutations need explicit commands — constrain the surface |
| Idempotent operations | Safe to retry — agents are iterative |
| `--help` is the API contract | Agents discover capabilities from help text |
| Fast startup | Sub-100ms — dozens of calls per session |
| Guide on empty results | No output = dead end — print scope + suggestions to stderr |
| Log usage locally | You can't improve what you can't observe — JSONL + `--usage` |
| Remove the problem, don't document it | If agents consistently misuse an interface, fix the interface |

The meta-insight: the features developers are proudest of for humans (interactive wizards, spinners, guided flows) become the biggest obstacles for agents. **Good AX means boring: predictable, structured, silent, deterministic.**

## Build from source

```bash
git clone https://github.com/airshelf/vx.git
cd vx
bun install
bun run build   # produces ./vx binary
bun test        # 56 tests
```

## License

MIT
