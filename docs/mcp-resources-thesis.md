# MCP Resources > MCP Tools: The Filesystem Argument

## The Problem

MCP tools are the dominant pattern for connecting AI agents to services. But they have two critical flaws:

1. **Context bloat**: A GitHub MCP server ships 93 tool definitions (~55k tokens). A typical enterprise agent stacking GitHub + database + Graph + Jira burns 150k+ tokens on schemas alone — before asking a single question. (Source: Jannik Reinhard benchmarks, Feb 2026)

2. **Unsafe mutation surface**: Tools accept arbitrary parameters. An Opus 4.6 agent hallucinated a GitHub repo ID and deployed someone else's code to a user's Vercel account via the deployment API. The agent fabricated the number — never looked it up. (Source: Guillermo Rauch, Mar 2026)

CLI tools fix both problems (zero schema tokens, constrained surface), but the MCP spec actually has three primitives — tools, resources, and prompts — and the ecosystem uses 99% tools. The underused primitive, **resources**, turns out to be the natural fit for reads.

## The Three Primitives

MCP defines three primitives. The ecosystem treats it as one:

| Primitive | What it is | Ecosystem usage |
|---|---|---|
| **Tools** | Function calls with JSON schemas | ~99% of all MCP servers |
| **Resources** | Read-only URIs (like files) | Almost zero |
| **Prompts** | Reusable templates | Rare |

This is a mistake. Tools are correct for writes. Resources are correct for reads. Most agent interactions (80%+) are reads. The 55k-token tool schema is paying for 80% read access with a 100% write-capable interface.

## The Spectrum

```
raw API  →  MCP tools  →  CLI      →  MCP resources / filesystem
(unsafe)    (bloated)     (good)      (natural)
```

| Interface | Token cost | Hallucination risk | Agent familiarity |
|---|---|---|---|
| Raw API | Low (no schema) | High (arbitrary params) | Medium |
| MCP tools | High (55k+ for schemas) | Medium (validated params) | Low (novel schemas) |
| CLI | Zero (pre-trained) | Low (constrained flags) | High (billions of training examples) |
| MCP resources | Zero (URI-based) | Lowest (read-only, no params to hallucinate) | Highest (file read is universal) |

The spectrum isn't linear — it's not "pick one." The right answer is **all three for different access patterns**:

- **Resources** for context (reads, discovery, state inspection)
- **Tools** for actions (mutations, constrained parameters)
- **CLI** for composition (pipes, jq, ad-hoc workflows, scripting)

## MCP Resources = Plan 9 for Agents

MCP resources are structurally identical to a Plan 9 filesystem:

| Concept | Plan 9 | MCP Resources |
|---|---|---|
| Address | File path (`/vercel/deployments/latest`) | URI (`vercel://deployments/latest`) |
| Read | `cat`, `read()` | `resources/read` |
| Discovery | `ls` | `resources/list` |
| Parameterized | Directory structure | URI templates (RFC 6570) |
| Transport | 9P protocol | JSON-RPC over stdio |
| Mutation | Write to control files | Separate (tools, if needed) |

The key insight: **every agent framework already has file read as a primitive tool**. It's the one operation agents never get wrong. MCP resources map directly to this — no new concepts, no schemas to learn, no parameters to hallucinate.

## Vercel Example

### Current: MCP Tools (how it works today)

```json
{
  "tools": [{
    "name": "list_deployments",
    "inputSchema": {
      "properties": {
        "projectId": { "type": "string" },
        "limit": { "type": "integer" },
        "state": { "enum": ["BUILDING", "READY", "ERROR"] },
        "target": { "enum": ["production", "preview"] }
      }
    }
  }]
}
```

Multiply by 15 tools. Agent sees ~20k tokens of schemas. Then fabricates parameters it doesn't know (like repo IDs).

### Proposed: MCP Resources

```
resources/list → [
  { uri: "vercel://deployments",       name: "Deployments" },
  { uri: "vercel://projects",          name: "Projects" },
  { uri: "vercel://domains",           name: "Domains" }
]

resources/read { uri: "vercel://deployments" }
→ [{ url: "my-app-abc123.vercel.app", state: "READY", created: "..." }]

resources/read { uri: "vercel://projects/my-app/env" }
→ [{ key: "DATABASE_URL", target: ["production"] }]
```

No schemas. No parameters to hallucinate. Just URIs you read. Discovery via listing. ~200 tokens for the resource list vs ~20k for tool schemas.

### Even better: as a filesystem (Plan 9 style)

```
/vercel/
  deployments/
    latest/
      status    → "READY"
      url       → "my-app-abc123.vercel.app"
      logs/
        build   → (build log contents)
        runtime → (runtime log contents)
  projects/
    my-app/
      id        → "prj_abc123"
      framework → "nextjs"
      env/
        DATABASE_URL → "postgres://..."
  domains/
    example.com/
      verified  → "true"
```

Agent reads a file. That's it. No protocol, no client library, no schema. `cat /vercel/deployments/latest/status` returns `READY`.

## Why Nobody Builds This Way

The MCP spec supports resources. The ecosystem doesn't use them because:

1. **Mental model**: Developers think in APIs (request → response). Resources require thinking in filesystems (path → data). Most developers don't have the Plan 9 mindset.

2. **SDK examples**: Every MCP tutorial shows tools. Resource examples are scarce.

3. **Mutation bias**: Developers want to expose actions, not just data. Resources are read-only — you need tools for writes. But most agent interactions are reads.

4. **Discovery isn't obvious**: With tools, the agent sees "I can call `deploy`". With resources, the agent sees "I can read `vercel://deployments`". The resource model requires agents to compose reads into workflows rather than calling pre-built functions.

## The Right Split

Different agent contexts have different primitives available:

| Agent context | Has Bash? | Has MCP? | Best interface |
|---|---|---|---|
| Claude Desktop | No | Yes | MCP resources + tools |
| Claude Code | Yes | Yes | CLI for composition, MCP resources for context |
| Custom agents (SDK) | Maybe | Yes | MCP resources + tools |
| Shell scripts | Yes | No | CLI only |

No single primitive wins everywhere. The answer is complementary layers:

1. **Resources for context** — agent reads `vercel://deployments` like reading a file. Zero parameters, zero hallucination surface, ~300 tokens for the full catalog. Works in any MCP-capable environment.

2. **Tools for mutations** — agent calls `redeploy` with constrained params (enum targets, existing deployment URLs). Small surface, validated inputs. One tool is 2 params, not 55k tokens of schemas.

3. **CLI for composition** — `vx ls --json | jq '.[0].url'`. Pipes, filters, ad-hoc workflows. Agents with Bash access compose reads and writes freely. Pre-trained on billions of examples.

4. **Detection layer** — monitor agent outputs for hallucinated identifiers and claims. Resources prevent hallucinated inputs (nothing to hallucinate). Detection catches hallucinated outputs. (AirShelf brand protect: what AI engines say about your products)

Agents will hallucinate identifiers. That's not a bug to fix — it's a property to design around.

## Applicability

| Domain | Resources (reads) | Tools (writes) | CLI (composition) |
|---|---|---|---|
| **Vercel** | Deployments, projects, env, domains, logs | Redeploy | `vx ls --json \| jq`, `vx ls --wait` |
| **AirShelf** | Products, prices, specs, brand claims | Place order, update inventory | Bulk export, cross-reference |
| **GitHub** | Repos, issues, PRs, files, actions | Create issue, merge PR | `gh pr list \| jq`, `gh api` |
| **Databases** | Schema, query results, table stats | Execute migration | `psql -c "..." \| jq` |

The pattern: **resources for context, tools for actions, CLI for composition**.

## Implementation: vx mcp

Proof of concept: `vx mcp` — an MCP server for Vercel, built into the vx CLI. Shipped and live-tested in Claude Code.

### What shipped

- **8 resources** (read-only, URI-based): deployments, projects, domains, deployment/{url}, build-logs/{url}, runtime-logs/{url}, project/{name}, env/{name}
- **1 tool** (mutation, constrained): redeploy with 2 optional params (deploymentUrl, target enum)
- **~160 lines** in `src/mcp.ts`, reusing vx's existing API client, auth, and config
- **~300 tokens** for the full resource catalog vs ~20k for equivalent MCP tool schemas — **65x reduction** verified

### Results

Installed in Claude Code via `claude mcp add -s user vx-resources -- vx mcp`. Live-tested:
- `vercel://domains` — returned all domains as JSON
- `vercel://deployments` — returned latest 10 deployments
- Redeploy tool — available alongside resources, 2 params only

The split works. Resources handle all reads. One tool handles the one mutation. No schema bloat, no hallucination surface for reads, constrained surface for writes.

## Sources

- Guillermo Rauch, "Agent hallucinated a repo ID" (LinkedIn, Mar 2026)
- Jannik Reinhard, "Why CLI Tools Are Beating MCP for AI Agents" (Feb 2026)
- MCP Specification: resources primitive (modelcontextprotocol.io)
- Plan 9 from Bell Labs: "everything is a file" (1992)
- AX Principles: agent experience design (github.com/AirShelf/vx)
