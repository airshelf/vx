# Experiment: mcpfs replaces vx CLI documentation in CLAUDE.md

## Hypothesis

A mounted filesystem (`~/mnt/vercel/`) needs zero documentation for read operations.
Agents discover structure via `ls` and read data via `cat`. Only write ops and
Axiom logs need CLI docs — reducing CLAUDE.md from 12 lines to 5.

## Current CLAUDE.md (12 lines)

```
| `vx` | `vercel` CLI | Faster, `--json` output, won't hang or corrupt `.env.local`. NEVER use `vercel` directly. |

`vx` quick reference:
vx ls --json                                          # list deployments
vx ls --wait --json                                   # poll until READY/ERROR
vx logs build <url> --no-follow --timeout 10000       # build logs (Vercel API)
vx logs runtime -p /api/shop -n 20                    # runtime logs (Axiom)
vx logs runtime -g "error" -m 30 --json               # filter by text, JSON out
vx env --json --project <name>                        # env vars
vx domains --json                                     # list domains
vx projects --json                                    # list all projects

Agent gotcha: never `2>&1 | jq` — stderr hints corrupt JSON parsing.
```

## Proposed CLAUDE.md (5 lines)

```
| `~/mnt/vercel/` | `vercel` CLI reads | Vercel data as files. `ls` to discover, `cat` to read. Always JSON. |
| `vx` | `vercel` CLI writes | Mutations and Axiom logs only. NEVER use `vercel` directly. |

`vx` (write ops + Axiom only):
vx logs runtime -p /api/shop -g "error" -m 30 --json  # Axiom runtime logs
vx redeploy                                            # re-trigger deployment
```

## What mcpfs replaces (zero-doc)

| Before (vx CLI)                  | After (mcpfs)                                      |
|----------------------------------|-----------------------------------------------------|
| `vx ls --json`                   | `cat ~/mnt/vercel/deployments.json`                 |
| `vx projects --json`             | `cat ~/mnt/vercel/projects.json`                    |
| `vx domains --json`              | `cat ~/mnt/vercel/domains.json`                     |
| `vx env --json --project NAME`   | `cat ~/mnt/vercel/projects/NAME/env`                |
| `vx logs build URL`              | `cat ~/mnt/vercel/deployments/URL/logs/build`       |

## What still needs vx CLI

| Operation                        | Why                                                 |
|----------------------------------|-----------------------------------------------------|
| `vx logs runtime -p -g -m`       | Axiom API with filters (path, text, time window)    |
| `vx ls --wait`                   | Polling loop — filesystem is point-in-time           |
| `vx redeploy`                    | Write operation                                     |
| `vx env set K=V` / `vx env rm`  | Mutations                                           |

## Test plan

1. Mount mcpfs: `mcpfs ~/mnt/vercel -- vx mcp`
2. Run subagent with ONLY the proposed 5-line docs (no vx quick reference)
3. Task: "Check the latest deployment status and env vars for airshelf"
4. Success criteria: agent uses `ls` + `cat` on mcpfs, never calls `vx ls` or `vx env`

## Measured: filesystem structure

```
~/mnt/vercel/
├── deployments.json          # array of deployments
├── deployments/
│   └── <url>/
│       ├── deployment        # single deployment JSON
│       └── logs/
│           ├── build         # build log text
│           └── runtime       # runtime log text
├── projects.json             # array of projects
├── projects/
│   └── <name>/
│       ├── project           # single project JSON
│       └── env               # env vars JSON
└── domains.json              # array of domains
```

## Outcome

**Experiment successful.** Subagent navigated mcpfs with zero documentation in ~20 tool calls.
Found deployments, env vars, build logs — all without knowing any CLI syntax.

### Fixes applied during experiment

**mcpfs: hide phantom template-tail files** (committed to ~/src/mcpfs)
- Template directories (e.g. `deployments/`, `projects/`) used to show template tail
  children (`logs/`, `env`) at the param level. These were structural artifacts that
  returned empty content because the param value was unresolved.
- Fix: `Readdir` and `Lookup` now skip children whose URIs contain unresolved `{params}`
  in param directories. They only appear inside resolved dynamic children.
- Before: `ls deployments/` → `logs/`. After: `ls deployments/` → empty.

### Decision

Use mcpfs for all read operations. Keep vx CLI only for:
- `vx logs runtime` (Axiom with path/text/time filters)
- `vx redeploy` (write operation)
- `vx env set/rm` (mutations)

This reduces CLAUDE.md vx documentation from 12 lines to 5 lines — a 58% reduction
in context tokens, with better agent ergonomics (filesystem discovery vs memorized CLI syntax).
