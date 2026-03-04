# mcpfs

FUSE daemon that mounts MCP resource servers as local filesystems.

## Quick start

```bash
go build -o mcpfs .
./mcpfs /tmp/mnt/vercel -- vx mcp
cat /tmp/mnt/vercel/deployments.json | jq '.[0].url'
fusermount -u /tmp/mnt/vercel
```

## Project structure

```
main.go          # CLI entry, argument parsing, signal handling
mcp_client.go    # MCP JSON-RPC client over stdio
fs.go            # FUSE filesystem (go-fuse/v2 inode API)
cache.go         # TTL cache (sync.RWMutex + background cleanup)
```

## Conventions

- Read-only filesystem — no Write/Create/Mkdir handlers
- Static resources → `.json` files, templates → directories
- URI template params → dynamic directory lookup (any name is valid)
- One dependency: `github.com/hanwen/go-fuse/v2`
- Errors logged to stderr, never surfaced as file content
