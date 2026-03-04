# MCP Resources > MCP Tools: The Filesystem Argument

## The Problem

MCP tools are the dominant pattern for connecting AI agents to services. But they have two critical flaws:

1. **Context bloat**: A GitHub MCP server ships 93 tool definitions (~55k tokens). A typical enterprise agent stacking GitHub + database + Graph + Jira burns 150k+ tokens on schemas alone — before asking a single question. (Source: Jannik Reinhard benchmarks, Feb 2026)

2. **Unsafe mutation surface**: Tools accept arbitrary parameters. An Opus 4.6 agent hallucinated a GitHub repo ID and deployed someone else's code to a user's Vercel account via the deployment API. The agent fabricated the number — never looked it up. (Source: Guillermo Rauch, Mar 2026)

CLI tools fix both problems (zero schema tokens, constrained surface), but there's an even better primitive hiding in the MCP spec that almost nobody uses: **resources**.

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

## The Three-Layer Fix

For any domain where agents interact with external data:

1. **Constrained interfaces** — don't give agents raw APIs. Reduce the mutation surface. (vx: no deploy command, only redeploy of existing deployments)

2. **Authoritative data via resources** — give agents verified data to reference instead of generating from training weights. (Vercel: deployment status as resources. AirShelf: product specs, prices, brand claims as resources)

3. **Detection** — monitor agent outputs for hallucinated identifiers and claims. (AirShelf brand protect: what AI engines say about your products)

Agents will hallucinate identifiers. That's not a bug to fix — it's a property to design around. Resources make hallucinated inputs structurally impossible (there's nothing to hallucinate — you just read a URI). Detection catches hallucinated outputs.

## Applicability

| Domain | Resources (reads) | Tools (writes) |
|---|---|---|
| **Vercel** | Deployments, projects, env, domains, logs | Redeploy |
| **AirShelf** | Products, prices, specs, brand claims, availability | Place order, update inventory |
| **GitHub** | Repos, issues, PRs, files, actions | Create issue, merge PR |
| **Databases** | Schema, query results, table stats | Execute migration |

The pattern: **resources for context, tools for mutation**. Most agent interactions (80%+) are reads. The 55k-token tool schema is paying for 80% read access with a 100% write-capable interface.

## Implementation

Proof of concept: `vx mcp` — an MCP resource server for Vercel, built into the vx CLI. Reuses vx's API client, auth, and config. Zero new dependencies beyond `@modelcontextprotocol/sdk`.

See `docs/plans/` for implementation plan.

## Sources

- Guillermo Rauch, "Agent hallucinated a repo ID" (LinkedIn, Mar 2026)
- Jannik Reinhard, "Why CLI Tools Are Beating MCP for AI Agents" (Feb 2026)
- MCP Specification: resources primitive (modelcontextprotocol.io)
- Plan 9 from Bell Labs: "everything is a file" (1992)
- AX Principles: agent experience design (github.com/AirShelf/vx)
