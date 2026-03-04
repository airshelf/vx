# mcpfs — Mount MCP resources as a filesystem

Plan 9 for the agent era. Mount any MCP resource server as a local directory. `cat`, `grep`, `jq`, pipes — all work.

```bash
mcpfs /mnt/vercel -- vx mcp
cat /mnt/vercel/deployments.json | jq '.[0].url'
ls /mnt/vercel/projects/my-app/
diff <(cat /mnt/vercel/projects/A/env | jq -r '.[].key' | sort) \
     <(cat /mnt/vercel/projects/B/env | jq -r '.[].key' | sort)
```

## Why?

MCP resources are protocol-bound — you need an MCP client. You can't `cat vercel://deployments | jq`. Nobody has bridged MCP resources to the filesystem.

`mcpfs` does: FUSE daemon that translates file operations into MCP `resources/read` calls. Any tool that reads files works with any MCP server. Zero agent-specific tooling.

## Install

```bash
cd mcpfs && go build -o mcpfs .
```

Requires: Go 1.22+, FUSE 3 (`libfuse3-dev` on Ubuntu, `macfuse` on macOS).

## Usage

```bash
# Mount
mcpfs <mountpoint> -- <command> [args...]
mcpfs /mnt/vercel -- vx mcp
mcpfs /mnt/github -- npx @modelcontextprotocol/server-github

# Unmount
mcpfs -u /mnt/vercel
# or: fusermount -u /mnt/vercel

# Debug FUSE operations
mcpfs --debug /mnt/vercel -- vx mcp
```

## How it works

```
cat /mnt/vercel/deployments.json
        ↓
    FUSE layer (kernel)
        ↓
    mcpfs daemon → resources/read { uri: "vercel://deployments" }
        ↓
    MCP server (vx mcp) → Vercel API
        ↓
    JSON response → file content
```

1. `mcpfs` launches the MCP server as a subprocess
2. Connects as an MCP client over stdio (JSON-RPC 2.0)
3. Calls `resources/list` + `resources/templates/list` to discover resources
4. Maps URIs to filesystem paths
5. On file read → calls `resources/read` with the mapped URI
6. Caches responses with TTL (30s lists, 60s single resources, 5s runtime logs)

## Filesystem layout

Static resources become files. URI templates become directories.

```
/mnt/vercel/
├── deployments.json              # vercel://deployments
├── deployments/                  # drill-down by URL
│   └── <url>/
│       ├── deployment            # vercel://deployments/{url}
│       └── logs/
│           ├── build             # vercel://deployments/{url}/logs/build
│           └── runtime           # vercel://deployments/{url}/logs/runtime
├── projects.json                 # vercel://projects
├── projects/                     # drill-down by name
│   └── <name>/
│       ├── project               # vercel://projects/{name}
│       └── env                   # vercel://projects/{name}/env
└── domains.json                  # vercel://domains
```

The `.json` suffix disambiguates: `deployments.json` is the list file, `deployments/` is the drill-down directory.

## Caching

| Resource type | TTL | Rationale |
|---|---|---|
| List endpoints (.json) | 30s | Changes infrequently |
| Single resources | 60s | Stable data |
| Build logs | 5min | Mostly immutable |
| Runtime logs | 5s | Near-real-time |

Cache is in-memory. No cold start after first read.

## Generic

Works with any MCP server that implements resources — not just Vercel:

```bash
mcpfs /mnt/github -- npx @modelcontextprotocol/server-github
mcpfs /mnt/postgres -- npx @modelcontextprotocol/server-postgres
```

The URI scheme is auto-detected from the first resource URI.

## Context cost comparison

| Interface | Discovery tokens | Per-read overhead |
|---|---|---|
| MCP tools (schemas) | ~20,000 | Tool call framing |
| MCP resources (URIs) | ~300 | resources/read call |
| CLI (`vx --help`) | ~500 | Bash + parse |
| **Filesystem** (`ls`) | **~100** | **`cat` (zero framing)** |

## Design decisions

- **Read-only** — no writes, no mutations, no `echo > ctl`. Mutations stay in CLI.
- **Go + hanwen/go-fuse/v2** — self-contained binary, native FUSE 3, one dependency.
- **TTL cache** — can't hit the API on every `cat`. Tuned per resource type.
- **Subprocess MCP** — launches the server, speaks JSON-RPC over stdio. No network setup.
- **~500 lines** — small enough to audit, big enough to be useful.

## License

MIT
