# mcpfs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship mcpfs as a standalone viral open-source project — FUSE daemon + 8 MCP resource servers in a monorepo.

**Architecture:** Single Go module at github.com/airshelf/mcpfs. FUSE daemon in cmd/mcpfs, shared MCP server framework in pkg/mcpserve (eliminates JSON-RPC boilerplate), 8 resource servers in servers/. Each server is a main package that produces a separate binary.

**Tech Stack:** Go 1.24, hanwen/go-fuse/v2 (FUSE), lib/pq (postgres), Docker Engine API (unix socket HTTP), net/http (GitHub, Vercel, NPM, Linear, Slack, K8s)

---

## Prerequisites

- box machine (Linux, Go 1.24, FUSE 3, Docker, PostgreSQL)
- Auth tokens: GITHUB_TOKEN (or gh), VERCEL_TOKEN, DATABASE_URL, SLACK_TOKEN, LINEAR_API_KEY
- For K8s: KUBECONFIG or ~/.kube/config (axis cluster)

---

### Task 1: Create repo and migrate core

Create github.com/airshelf/mcpfs repo. Move existing mcpfs code from vx/mcpfs/ to the new structure. Extract MCP server framework from gh-mcp boilerplate.

**Files:**
- Create: `cmd/mcpfs/main.go` (from vx/mcpfs/main.go)
- Create: `pkg/mcpclient/client.go` (from vx/mcpfs/mcp_client.go)
- Create: `pkg/mcpclient/types.go` (MCPResource, MCPResourceTemplate)
- Create: `pkg/mcpserve/server.go` (extracted MCP JSON-RPC server framework)
- Create: `internal/fuse/fs.go` (from vx/mcpfs/fs.go)
- Create: `internal/fuse/cache.go` (from vx/mcpfs/cache.go)
- Create: `go.mod`
- Create: `.gitignore`

**Step 1: Create repo on GitHub**
```bash
gh repo create airshelf/mcpfs --public --description "Mount MCP servers as a filesystem. Plan 9 for the agent era."
cd ~/src && git clone git@github.com:airshelf/mcpfs.git && cd mcpfs
go mod init github.com/airshelf/mcpfs
```

**Step 2: Extract pkg/mcpserve — reusable MCP server framework**

This eliminates the ~80 lines of JSON-RPC boilerplate from every server. Pattern:

```go
// pkg/mcpserve/server.go
package mcpserve

// Server is a minimal MCP resource server over stdio.
// Handles initialize, resources/list, resources/templates/list, resources/read.
type Server struct {
    Name      string
    Version   string
    resources []Resource
    templates []Template
    handler   ReadFunc
}

type Resource struct {
    URI         string `json:"uri"`
    Name        string `json:"name"`
    Description string `json:"description,omitempty"`
    MimeType    string `json:"mimeType,omitempty"`
}

type Template struct {
    URITemplate string `json:"uriTemplate"`
    Name        string `json:"name"`
    Description string `json:"description,omitempty"`
    MimeType    string `json:"mimeType,omitempty"`
}

type ReadResult struct {
    Text     string
    MimeType string
}

type ReadFunc func(uri string) (ReadResult, error)

func New(name, version string, handler ReadFunc) *Server
func (s *Server) AddResource(r Resource)
func (s *Server) AddTemplate(t Template)
func (s *Server) Serve() error // blocks, reads stdin, writes stdout
```

Every server becomes ~100 lines of actual resource logic. Zero boilerplate.

**Step 3: Move FUSE daemon code**

Copy from vx/mcpfs/ into new structure:
- `main.go` → `cmd/mcpfs/main.go` (update imports)
- `mcp_client.go` → `pkg/mcpclient/client.go` + `pkg/mcpclient/types.go` (change package)
- `fs.go` → `internal/fuse/fs.go` (change package, export Mount)
- `cache.go` → `internal/fuse/cache.go` (change package, export Cache)

**Step 4: Verify build**
```bash
go mod tidy
go build ./cmd/mcpfs/
go vet ./...
```

**Step 5: Commit**
```bash
git add -A
git commit -m "feat: initial structure — FUSE daemon + mcpserve framework"
git push
```

---

### Task 2: mcpfs-github server

Port gh-mcp to the new framework. Add actions + releases resources.

**Files:**
- Create: `servers/github/main.go`

**Step 1: Write server using mcpserve**

Resources:
- `github://repos` — user's repos (slim: full_name, description, language, stars, updated_at, private, fork)
- `github://repos/{owner}/{repo}` — repo details (full API response)
- `github://repos/{owner}/{repo}/issues` — open issues
- `github://repos/{owner}/{repo}/pulls` — open PRs
- `github://repos/{owner}/{repo}/readme` — README content (text/plain)
- `github://repos/{owner}/{repo}/actions` — recent workflow runs
- `github://repos/{owner}/{repo}/releases` — releases
- `github://notifications` — unread notifications
- `github://gists` — user's gists

Auth: GITHUB_TOKEN env var → `gh auth token` fallback. Print one-line error to stderr if neither works.

API helper: `ghAPI(path) (json.RawMessage, error)` — GET to api.github.com with Bearer token.

Slim down list responses (repos, issues, pulls) to essential fields to reduce file sizes.

**Step 2: Build and test**
```bash
go build ./servers/github/
# Test standalone:
echo '..initialize..' | ./github 2>/dev/null | jq .
# Test with mcpfs:
./mcpfs /tmp/mnt/github -- ./github
cat /tmp/mnt/github/repos.json | jq '.[0].full_name'
cat /tmp/mnt/github/repos/airshelf/vx/issues | jq length
fusermount -u /tmp/mnt/github
```

**Step 3: Commit**
```bash
git add servers/github/
git commit -m "feat: add mcpfs-github — repos, issues, PRs, readme, actions"
```

---

### Task 3: mcpfs-vercel server

Extract from vx/src/mcp.ts logic into a Go server. Pure REST API calls, no vx dependency.

**Files:**
- Create: `servers/vercel/main.go`

**Step 1: Write server**

Resources (matching existing vx mcp URIs):
- `vercel://deployments` — latest 10 deployments
- `vercel://deployments/{url}` — single deployment
- `vercel://deployments/{url}/logs/build` — build logs
- `vercel://deployments/{url}/logs/runtime` — runtime logs
- `vercel://projects` — all projects
- `vercel://projects/{name}` — single project
- `vercel://projects/{name}/env` — env vars
- `vercel://domains` — all domains

Auth: VERCEL_TOKEN env var. Team from VERCEL_TEAM_ID env var (optional). Project from VERCEL_PROJECT_ID env var (optional for deployment filtering).

API helper: `vercelAPI(path) (json.RawMessage, error)` — GET/POST to api.vercel.com with Bearer token + teamId query param.

Reference vx/src/api.ts and vx/src/mcp.ts for exact API paths and response handling.

**Step 2: Build and test**
```bash
go build ./servers/vercel/
./mcpfs /tmp/mnt/vercel -- ./vercel
cat /tmp/mnt/vercel/deployments.json | jq '.[0].url'
cat /tmp/mnt/vercel/projects/airshelf/env | jq '.[0].key'
fusermount -u /tmp/mnt/vercel
```

**Step 3: Commit**
```bash
git add servers/vercel/
git commit -m "feat: add mcpfs-vercel — deployments, projects, env, domains, logs"
```

---

### Task 4: mcpfs-docker server

Talks to Docker Engine API over unix socket. No external deps.

**Files:**
- Create: `servers/docker/main.go`

**Step 1: Write server**

Docker Engine API is HTTP over a unix socket at /var/run/docker.sock. Use Go's net/http with a custom transport:
```go
client := &http.Client{
    Transport: &http.Transport{
        DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
            return net.Dial("unix", "/var/run/docker.sock")
        },
    },
}
// Then: client.Get("http://localhost/v1.47/containers/json")
```

Resources:
- `docker://containers` — running containers (ID, Names, Image, State, Status, Ports)
- `docker://containers/{id}` — container inspect (full details)
- `docker://containers/{id}/logs` — container logs (stdout+stderr, last 100 lines)
- `docker://containers/{id}/stats` — one-shot CPU/memory/network stats
- `docker://images` — local images (ID, RepoTags, Size, Created)
- `docker://volumes` — volumes
- `docker://networks` — networks

Auth: Docker socket access (user must be in docker group or root). DOCKER_HOST env var for remote Docker.

For logs: use `?stdout=1&stderr=1&tail=100` query. Docker logs API returns a multiplexed stream — parse the 8-byte header per frame (type byte + 3 padding + 4-byte size big-endian).

For stats: use `?stream=false` for one-shot (no streaming).

Slim containers list to: id (short), names, image, state, status.

**Step 2: Build and test**
```bash
go build ./servers/docker/
# Start a test container if none running:
docker run -d --name mcpfs-test alpine sleep 3600
./mcpfs /tmp/mnt/docker -- ./docker
cat /tmp/mnt/docker/containers.json | jq '.[].names'
cat /tmp/mnt/docker/containers/<id>/logs | tail -5
cat /tmp/mnt/docker/images.json | jq '.[0].repo_tags'
fusermount -u /tmp/mnt/docker
docker rm -f mcpfs-test
```

**Step 3: Commit**
```bash
git add servers/docker/
git commit -m "feat: add mcpfs-docker — containers, images, volumes, networks, logs"
```

---

### Task 5: mcpfs-k8s server

Talks to Kubernetes API server via REST. Reads kubeconfig for auth.

**Files:**
- Create: `servers/k8s/main.go`

**Step 1: Write server**

K8s API is REST over HTTPS. Auth from kubeconfig: read ~/.kube/config (or KUBECONFIG), extract server URL + token/cert.

Simple approach: shell out to `kubectl` for data (like gh-mcp shells out to `gh`). This avoids parsing kubeconfig ourselves and handling all auth methods (token, cert, exec, oidc).

```go
func kubectl(args ...string) (json.RawMessage, error) {
    cmd := exec.Command("kubectl", append([]string{"-o", "json"}, args...)...)
    out, err := cmd.Output()
    return json.RawMessage(out), err
}
```

Resources:
- `k8s://namespaces` — all namespaces
- `k8s://namespaces/{ns}/pods` — pods in namespace
- `k8s://namespaces/{ns}/pods/{name}` — pod details
- `k8s://namespaces/{ns}/pods/{name}/logs` — pod logs (text/plain)
- `k8s://namespaces/{ns}/services` — services
- `k8s://namespaces/{ns}/deployments` — deployments
- `k8s://namespaces/{ns}/deployments/{name}` — deployment details
- `k8s://nodes` — cluster nodes

Auth: kubectl handles it (kubeconfig, service account, etc.)

Requires: kubectl installed and configured. Print helpful error if not found.

**Step 2: Build and test**
```bash
go build ./servers/k8s/
# Test against axis cluster:
export KUBECONFIG=~/.kube/config
./mcpfs /tmp/mnt/k8s -- ./k8s
cat /tmp/mnt/k8s/namespaces.json | jq '.[].name'
ls /tmp/mnt/k8s/namespaces/default/pods/
fusermount -u /tmp/mnt/k8s
```

**Step 3: Commit**
```bash
git add servers/k8s/
git commit -m "feat: add mcpfs-k8s — namespaces, pods, services, deployments, logs"
```

---

### Task 6: mcpfs-postgres server

Connects to PostgreSQL via DATABASE_URL. Uses lib/pq for the driver.

**Files:**
- Create: `servers/postgres/main.go`

**Step 1: Write server**

```go
import (
    "database/sql"
    _ "github.com/lib/pq"
)
db, _ := sql.Open("postgres", os.Getenv("DATABASE_URL"))
```

Resources:
- `pg://databases` — list databases (SELECT datname FROM pg_database WHERE datistemplate = false)
- `pg://tables` — tables in current database (SELECT table_name, table_schema FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema'))
- `pg://tables/{schema}.{table}` — table details
- `pg://tables/{schema}.{table}/schema` — column definitions (name, type, nullable, default)
- `pg://tables/{schema}.{table}/count` — row count (text/plain, just the number)
- `pg://tables/{schema}.{table}/sample` — first 100 rows as JSON array
- `pg://extensions` — installed extensions
- `pg://connections` — active connections (pg_stat_activity)

Auth: DATABASE_URL env var. Standard PostgreSQL connection string.

Security: read-only queries only. Use SET TRANSACTION READ ONLY for safety. Parameterize table/schema names via pg_catalog lookups, not string interpolation (prevent SQL injection).

For schema.table parsing: split on first `.` — default to `public` if no schema prefix.

**Step 2: Build and test**
```bash
go build ./servers/postgres/
export DATABASE_URL="postgresql://..."
./mcpfs /tmp/mnt/pg -- ./postgres
cat /tmp/mnt/pg/tables.json | jq '.[].table_name'
cat /tmp/mnt/pg/tables/public.users/schema | jq '.[].column_name'
cat /tmp/mnt/pg/tables/public.users/count
fusermount -u /tmp/mnt/pg
```

**Step 3: Commit**
```bash
git add servers/postgres/
git commit -m "feat: add mcpfs-postgres — tables, schema, sample, connections"
```

---

### Task 7: mcpfs-npm server

Public NPM registry API. No auth required for public packages.

**Files:**
- Create: `servers/npm/main.go`

**Step 1: Write server**

NPM registry API: https://registry.npmjs.org/{package} (GET, returns full package metadata).
NPM downloads API: https://api.npmjs.org/downloads/point/last-month/{package}

Resources:
- `npm://packages/{name}` — package info (latest version, description, homepage, license, maintainers). Handle scoped packages: `npm://packages/@scope/name`
- `npm://packages/{name}/versions` — all versions with dates
- `npm://packages/{name}/downloads` — download stats (last day/week/month)
- `npm://packages/{name}/dependencies` — dependencies of latest version
- `npm://search/{query}` — search results (https://registry.npmjs.org/-/v1/search?text={query}&size=20)

Auth: none for public. NPM_TOKEN env var for private packages (optional).

Handle scoped packages: URL-encode `@scope/name` → `%40scope%2Fname` for registry API.

Slim responses: package info should be small (name, version, description, homepage, license), not the full 500KB registry response.

**Step 2: Build and test**
```bash
go build ./servers/npm/
./mcpfs /tmp/mnt/npm -- ./npm
cat /tmp/mnt/npm/packages/react/package | jq '{name, version: .latest_version, description}'
cat /tmp/mnt/npm/packages/react/downloads | jq '.downloads'
cat /tmp/mnt/npm/search/fuse%20filesystem | jq '.[0].name'
fusermount -u /tmp/mnt/npm
```

**Step 3: Commit**
```bash
git add servers/npm/
git commit -m "feat: add mcpfs-npm — packages, versions, downloads, search"
```

---

### Task 8: mcpfs-slack server

Slack Web API. Requires Bot User OAuth Token with appropriate scopes.

**Files:**
- Create: `servers/slack/main.go`

**Step 1: Write server**

Slack API: https://slack.com/api/{method} — POST with token in Authorization header.

Resources:
- `slack://channels` — conversations.list (id, name, topic, num_members, is_private)
- `slack://channels/{name}/messages` — conversations.history (last 50 messages, text + user + ts)
- `slack://channels/{name}/pinned` — pins.list
- `slack://channels/{name}/members` — conversations.members → users.info for names
- `slack://users` — users.list (id, name, real_name, status)
- `slack://search/{query}` — search.messages (requires search:read scope)

Auth: SLACK_TOKEN env var (Bot User OAuth Token). Required scopes: channels:read, channels:history, users:read, pins:read, search:read.

Channel name → ID resolution: call conversations.list, cache the mapping, look up by name. Fall back to treating input as channel ID if not found in cache.

Slim messages: text, user (resolved to name), timestamp. Skip blocks/attachments for now.

**Step 2: Build and test**
```bash
go build ./servers/slack/
export SLACK_TOKEN="xoxb-..."
./mcpfs /tmp/mnt/slack -- ./slack
cat /tmp/mnt/slack/channels.json | jq '.[].name'
cat /tmp/mnt/slack/channels/general/messages | jq '.[0].text'
fusermount -u /tmp/mnt/slack
```

**Step 3: Commit**
```bash
git add servers/slack/
git commit -m "feat: add mcpfs-slack — channels, messages, pinned, users, search"
```

---

### Task 9: mcpfs-linear server

Linear GraphQL API. Single endpoint, query-based.

**Files:**
- Create: `servers/linear/main.go`

**Step 1: Write server**

Linear API: POST https://api.linear.app/graphql with Bearer token.

```go
func linearQuery(query string) (json.RawMessage, error) {
    body, _ := json.Marshal(map[string]string{"query": query})
    req, _ := http.NewRequest("POST", "https://api.linear.app/graphql", bytes.NewReader(body))
    req.Header.Set("Authorization", token)
    req.Header.Set("Content-Type", "application/json")
    // ...
}
```

Resources:
- `linear://issues` — assigned issues (id, title, state, priority, assignee, team)
- `linear://issues/{id}` — issue details + description
- `linear://issues/{id}/comments` — issue comments
- `linear://projects` — active projects (id, name, state, progress)
- `linear://projects/{id}/issues` — project's issues
- `linear://cycles` — current + upcoming cycles
- `linear://teams` — teams (id, name, key)

Auth: LINEAR_API_KEY env var. Personal API key from linear.app/settings/api.

GraphQL queries should request only needed fields (no `*`). Keep queries concise.

**Step 2: Build and test**
```bash
go build ./servers/linear/
export LINEAR_API_KEY="lin_api_..."
./mcpfs /tmp/mnt/linear -- ./linear
cat /tmp/mnt/linear/issues.json | jq '.[0:3] | .[].title'
cat /tmp/mnt/linear/teams.json | jq '.[].name'
fusermount -u /tmp/mnt/linear
```

**Step 3: Commit**
```bash
git add servers/linear/
git commit -m "feat: add mcpfs-linear — issues, projects, cycles, teams"
```

---

### Task 10: Cross-service example scripts

Write the demo scripts that showcase composability.

**Files:**
- Create: `examples/whats-broken.sh` — GitHub issues + Vercel errors
- Create: `examples/env-audit.sh` — diff env vars across Vercel projects
- Create: `examples/containers-with-prs.sh` — Docker containers + GitHub PRs
- Create: `examples/slack-deploys.sh` — Slack messages about failed deployments
- Create: `examples/grep-everything.sh` — grep -r across all mounts
- Create: `examples/project-health.sh` — combined health dashboard

**Step 1: Write scripts**

Each script:
- Shebang + set -euo pipefail
- Check that required mounts exist (exit with usage if not)
- Run the cross-service query
- Output clean, readable results to stdout

**Step 2: Test with real mounts**
```bash
# Mount everything
mcpfs /tmp/mnt/github -- mcpfs-github &
mcpfs /tmp/mnt/vercel -- mcpfs-vercel &
mcpfs /tmp/mnt/docker -- mcpfs-docker &
sleep 3
# Run scripts
./examples/whats-broken.sh /tmp/mnt
./examples/env-audit.sh /tmp/mnt/vercel
```

**Step 3: Commit**
```bash
git add examples/
git commit -m "feat: add cross-service demo scripts"
```

---

### Task 11: Benchmarks

Port bench/ scripts from vx/mcpfs and add new cross-service benchmarks.

**Files:**
- Create: `bench/bench_tokens.sh` — context cost comparison
- Create: `bench/bench_latency.sh` — read latency (cold/warm)
- Create: `bench/bench_compose.sh` — composability tests
- Create: `bench/README.md` — how to run, expected results

**Step 1: Write benchmarks**

Token benchmark: measure actual character/word counts for:
- `ls /mnt/` output (filesystem discovery)
- `vx --help` (CLI discovery)
- `resources/list` response (MCP discovery)
- GitHub MCP tools/list response (tool schema cost) — use official GitHub MCP server

Latency benchmark: 10 runs each, report median:
- Filesystem cold read (first cat after mount)
- Filesystem warm read (cached)
- CLI equivalent (vx ls --json)
- Raw MCP JSON-RPC

Composability benchmark: same 5 questions answered via all interfaces, measure success + command length.

**Step 2: Run and capture results**
```bash
./bench/bench_tokens.sh /tmp/mnt > bench/results/tokens.txt
./bench/bench_latency.sh /tmp/mnt > bench/results/latency.txt
```

**Step 3: Commit**
```bash
git add bench/
git commit -m "feat: add benchmarks — tokens, latency, composability"
```

---

### Task 12: README — the hero

This is the most important file. It determines whether the project goes viral.

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`
- Create: `LICENSE` (MIT)

**Step 1: Write README**

Structure:
1. **Title + tagline** — `# mcpfs` + "Mount any MCP server as a filesystem. Plan 9 for the agent era."
2. **Demo GIF placeholder** — `<!-- TODO: record asciinema -->` (record after everything works)
3. **The problem** — one paragraph: "The MCP ecosystem has 18,000+ servers. They inject 30,000-125,000 tokens of tool schemas before your agent asks a single question. mcpfs takes the opposite approach."
4. **Quick start** — 4 lines: install, mount, cat, jq
5. **The comparison table** — MCP Tools vs Resources vs CLI vs Filesystem
6. **Available servers** — grid of 8 with mount commands and filesystem trees
7. **Cross-service examples** — 3 best examples from examples/
8. **Benchmarks** — summary table with link to bench/
9. **Write your own server** — 15-line example using mcpserve
10. **How it works** — architecture diagram (ASCII)
11. **Requirements** — Go 1.22+, FUSE 3, auth tokens
12. **License** — MIT

**Step 2: Write CLAUDE.md**

Project conventions for AI agents working on the codebase.

**Step 3: Commit**
```bash
git add README.md CLAUDE.md LICENSE
git commit -m "docs: README, CLAUDE.md, LICENSE"
```

---

### Task 13: Record demo GIF and final polish

**Step 1: Record asciinema**
```bash
# Install if needed
pip install asciinema
# Record
asciinema rec demo.cast
# In recording: mount 3 servers, run cross-service query, unmount
# Convert to GIF with agg or svg with svg-term
```

**Step 2: Update README with GIF**

**Step 3: Final verification**
```bash
go build ./...
go vet ./...
# Mount all servers, run example scripts, run benchmarks
```

**Step 4: Tag and release**
```bash
git tag v0.1.0
git push --tags
# Create GitHub release with binaries (goreleaser or manual)
```

**Step 5: Commit and push**
```bash
git push origin main
```

---

## Execution Order

Tasks are partially parallelizable:

- **Task 1** (repo setup): must be first
- **Tasks 2-9** (servers): independent, can be parallelized in groups
  - Tier 1 (Tasks 2, 3, 4): do first — GitHub, Vercel, Docker
  - Tier 2 (Tasks 5, 6, 7): next — K8s, Postgres, NPM
  - Tier 3 (Tasks 8, 9): last — Slack, Linear
- **Task 10** (examples): after Tier 1 servers are done
- **Task 11** (benchmarks): after Tier 1 servers are done
- **Task 12** (README): after all servers + examples + benchmarks
- **Task 13** (GIF + release): last

## Outcome

TBD — to be filled after launch.
