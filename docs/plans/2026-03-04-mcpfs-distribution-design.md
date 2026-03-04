# mcpfs Distribution Design

**Date:** 2026-03-04
**Goal:** Viral open-source project — get stars, HN front page, shift how devs think about MCP.

## The Opportunity

18,000+ MCP servers exist. Almost zero use resources. The ecosystem is drowning in tool schema bloat (30k-125k tokens per session). Microsoft Research, Anthropic, and developers all document this pain. Nobody questions whether tools are the right primitive for reads. That's the opening.

## Project Identity

- **Name:** mcpfs
- **Tagline:** "Mount any MCP server as a filesystem. Plan 9 for the agent era."
- **Repo:** github.com/airshelf/mcpfs (own repo, separate from vx)
- **Language:** Go (self-contained binaries, go-fuse/v2)

## Approach: The Registry

Monorepo with mcpfs (the FUSE daemon) + 8 curated MCP resource servers. Each server is a thin Go binary (~150-300 lines) that speaks MCP JSON-RPC over stdio.

## Repo Structure

```
mcpfs/
├── cmd/mcpfs/              # FUSE daemon
├── servers/
│   ├── github/             # mcpfs-github
│   ├── vercel/             # mcpfs-vercel
│   ├── docker/             # mcpfs-docker
│   ├── k8s/                # mcpfs-k8s
│   ├── postgres/           # mcpfs-postgres
│   ├── npm/                # mcpfs-npm
│   ├── slack/              # mcpfs-slack
│   └── linear/             # mcpfs-linear
├── pkg/mcp/                # shared MCP client code
├── examples/               # cross-service demo scripts
├── bench/                  # benchmarks (tools vs resources vs fs)
├── README.md
├── CLAUDE.md
└── go.mod
```

## Resource Servers

### Tier 1: Ship first

**mcpfs-github** — repos, issues, PRs, readme, actions, releases
Auth: GITHUB_TOKEN or `gh auth token`

**mcpfs-vercel** — deployments, projects, env, domains, logs
Auth: VERCEL_TOKEN

**mcpfs-docker** — containers, images, volumes, networks, logs, stats
Auth: Docker socket (no token)

### Tier 2: Strong demos

**mcpfs-k8s** — namespaces, pods, services, deployments, logs
Auth: ~/.kube/config

**mcpfs-postgres** — databases, tables, schema, sample data
Auth: DATABASE_URL

**mcpfs-npm** — packages, versions, downloads, dependencies
Auth: none (public API)

### Tier 3: Workflow demos

**mcpfs-slack** — channels, messages, pinned, search
Auth: SLACK_TOKEN

**mcpfs-linear** — issues, projects, cycles, teams
Auth: LINEAR_API_KEY

## Killer Demo Scripts

1. "What's broken?" — cross-query GitHub issues + Vercel errors
2. "Environment audit" — diff env vars across all Vercel projects
3. "Which containers run code with open PRs?"
4. "Find Slack discussions about failing deployments"
5. `grep -r "ERROR" /mnt/vercel/ /mnt/docker/ /mnt/k8s/`

## README Strategy

Hero GIF → one-paragraph "why" → 5-line quickstart → comparison table → servers → examples → benchmarks → "write your own"

The comparison table is the shareable artifact:

| | MCP Tools | MCP Resources | CLI | mcpfs |
|---|---|---|---|---|
| Context tokens | ~20,000 | ~300 | ~500 | ~100 |
| Composability | None | None | Pipes | Pipes + cross-service |
| Discovery | Schema dump | URI list | --help | ls |

## Launch Sequence

1. GitHub repo launch — polished README, all servers, demo GIF
2. Hacker News — "Show HN: mcpfs — Mount MCP servers as a filesystem"
3. Twitter/X thread — GIF + contrarian take on MCP tool bloat
4. r/programming, r/devops, r/golang
5. Dev.to blog post — the thesis piece
6. awesome-mcp-servers submission via mcpservers.org

## What Makes It Shareable

- The GIF: three mounts, one grep, instant understanding
- The numbers: "100 tokens vs 20,000" travels
- The Plan 9 hook: identity signal for Unix nerds
- The contrarian take: "tools are the problem" drives debate
- The `grep -r /mnt/` moment: searching across 3 services in one command

## Outcome

TBD — to be filled after implementation.
