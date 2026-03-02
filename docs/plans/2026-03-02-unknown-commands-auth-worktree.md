# Fix VX: unknown commands, auth hints, worktree support

## Context

Ralph loop (12 iterations, 63 min) hit VX issues:
1. `vx deploy --prod` → generic `error: unknown command 'deploy'` → no guidance (AX #9)
2. `vx ls --json` → 403 with `invalidToken: true` → hint said "token may lack scope" (wrong)
3. `.vercel/project.json` not found in git worktrees (only `vx env` needs it)

## Why no `vx link` or `VX_PROJECT`

Only `vx env` requires a project ID. It already has `--project <name-or-id>`. The only thing
`.vercel/project.json` provides is avoiding `--project` on `vx env`.

Worktree fix: walk up parent dirs in `config.ts` to find `.vercel/project.json` at repo root.
One change, VX stays 100% read-only, no AX violations.

## Changes

### 1. `src/config.ts` — Walk up for `.vercel/project.json`

Current: only checks `cwd/.vercel/project.json`.

New: walk up from cwd to filesystem root. Solves worktrees (`.claude/worktrees/` is inside
repo root) and monorepo subdirectories.

```typescript
import { dirname } from "path";

// Walk up to find .vercel/project.json
let dir = process.cwd();
while (true) {
  try {
    const p = await Bun.file(join(dir, ".vercel/project.json")).json();
    projectId = p.projectId;
    break;
  } catch {}
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
```

### 2. `src/cli.ts` — Unknown command handler + telemetry fix

One-line messages (AX #1 + #9), stderr, exit 1:

```
deploy:  "vx is read-only — deploy via git push, then: vx ls --json"
link:    "project auto-detected from .vercel/project.json — or use: vx env --project <name>"
login:   "set VERCEL_TOKEN env var — get one at vercel.com/account/tokens"
dev:     "vx doesn't run dev servers — use next dev / framework dev command"
other:   "unknown command '<cmd>' — run `vx --help`"
```

Update description: `"Fast Vercel CLI — read-only (ls, logs, env, domains)"`

Fix telemetry double-log: `let logged = false`, check in `beforeExit`.

### 3. `src/api.ts` — Detect `invalidToken` in 403 body

Add `body` param to `apiErrorHint(status, body?)`. When 403 body contains `"invalidToken"`:
→ `"token is invalid or expired — set VERCEL_TOKEN or get a new one at vercel.com/account/tokens"`

Update 401 hint: `"check VERCEL_TOKEN — get one at vercel.com/account/tokens"`

### 4. `README.md`

- Agent instructions: "deployment operations" → "Vercel read operations"
- Add: `Deploy: git push (Vercel auto-deploys), then vx ls --json`
- Note walk-up behavior: "vx walks up from cwd to find `.vercel/project.json`"

### 5. `~/.claude/CLAUDE.md` — Fix agent instructions

Remove "NEVER use `vercel` directly". Replace with:

```
vx ls --json                                          # list deployments
vx logs build <url> --no-follow --timeout 10000       # build logs
vx logs runtime <url> --no-follow --timeout 10000     # runtime logs
vx env --json --project <name>                        # env vars (--project or auto from .vercel/)
vx domains --json                                     # list domains
# Deploy: git push, then vx ls --json to check status
# Auth: set VERCEL_TOKEN env var (get at vercel.com/account/tokens)
```

## AX compliance

| # | Principle | ✅/❌ |
|---|---|---|
| 1 | Minimize output | ✅ All messages one line |
| 2 | `--json` everywhere | ✅ No change to existing commands |
| 3 | stdout=data, stderr=noise | ✅ Unknown command msgs → stderr |
| 4 | No interactive prompts | ✅ Walk-up is automatic, no prompts |
| 5 | Fail fast and loud | ✅ Unknown commands exit 1 immediately |
| 6 | Never mutate implicitly | ✅ VX stays 100% read-only |
| 7 | Read existing state | ✅ Walk-up reads existing `.vercel/project.json` |
| 8 | Instant startup | ✅ Walk-up adds ~1ms |
| 9 | Guide on failure | ✅ Specific one-line guidance per command |
| 10 | Log usage | ✅ Telemetry fix, unknown commands logged as errors |

### 6. `CLAUDE.md` (project) — Add design principles

Add a "Design principles" section to `/home/eo/src/vx/CLAUDE.md`:

```markdown
## Design principles

- 100% read-only — vx never writes to local files
- Only `vx env` needs project ID; everything else works without it
- Project ID: auto-detected by walking up from cwd to find `.vercel/project.json`
- Auth: VERCEL_TOKEN env var or existing Vercel CLI auth file — no login command
- Deploy: not vx's job — deploy via git push, check status with `vx ls`
- Error messages: one line, stderr, actionable next step (AX #1 + #9)
- No references to `vercel` CLI in user-facing output — vx is self-sufficient
- All 10 AX principles must pass (see README.md) — any change that breaks one gets rejected
```

## Files

| File | Change |
|---|---|
| `src/config.ts` | Walk-up `.vercel/project.json` resolution |
| `src/cli.ts` | Unknown command handler, description, telemetry fix |
| `src/api.ts` | `apiErrorHint(status, body?)` — invalidToken detection |
| `README.md` | Agent instructions, deploy guidance, walk-up docs |
| `CLAUDE.md` | Add design principles section |
| `~/.claude/CLAUDE.md` | Fix vx section — self-sufficient, no vercel fallbacks |

## Verification

```bash
bun run src/cli.ts deploy --prod 2>&1   # one-line hint, exit 1
bun run src/cli.ts --help               # shows "read-only"
bun test                                # all pass
```

## Outcome

All changes implemented and verified:
- 35 tests pass, build clean
- Unknown commands: one-line AX-compliant messages, stderr, exit 1
- Walk-up: config.ts finds .vercel/project.json from subdirectories
- invalidToken: 403 with invalidToken body gets correct hint
- Telemetry: no double-logging, unknown commands logged as errors
- Docs: design principles in CLAUDE.md, agent instructions updated
