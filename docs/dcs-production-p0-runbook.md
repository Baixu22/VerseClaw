# DCS Production P0 Runbook (opt-in)

**Mode**: conservative production packaging (`productionMode: opt-in`)
**Default flag graduation**: **false** (do not flip defaults for demos)
**Authority**: Round ACCEPT `accept-with-residuals` on tip including C4 `writeFileSync` fix

## Safe defaults (must remain)

| Surface | Default | Notes |
|---------|---------|-------|
| `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS` | off | C1 shadow; A/B below 5x |
| `runtime.coding.staleWriteGuard.enabled` | false | C2 opt-in |
| `runtime.coding.writeJournal.enabled` | true | baseline undo journal |
| `runtime.coding.worktree.backend` | `inprocess` | git is opt-in (not C4-H) |
| request/plan `isolation` | `shared` | worktree is request-only |
| `runtime.coding.symbolLease.enabled` | false | mode default `memory` |
| `runtime.coding.patchFlow.default` | false | call APIs only |
| C6 `applyContextLadder` | not auto | assembler path unchanged |
| `runtime.coding.routingMemo.shadow` | false | dual-write only when on |
| `runtime.coding.sekb.experienceShadow` | false | no default knowledge inject |

## Enable (explicit only)

1. **View tools (C1)** — set env `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1`, restart gateway/runtime.
2. **Stale write guard (C2)** — `runtime.coding.staleWriteGuard.enabled=true` in OpenClaw config.
3. **Git worktree backend (C4)** — `runtime.coding.worktree.backend=git` **and** request `isolation: "worktree"`.
4. **Symbol lease (C5)** — `runtime.coding.symbolLease.enabled=true` (keep `mode=memory` until C5-H).
5. **Patch-flow (C5)** — call `applyPatchProposalsSerial()` / `recommendIsolationMode()`; do **not** set `patchFlow.default=true`.
6. **Context ladder (C6)** — call `applyContextLadder({ blocks, tokenBudget })` from library code; no assembler flip.
7. **Shadows (C7)** — set `routingMemo.shadow` / `sekb.experienceShadow` true for dual-write sampling only.

Config surface dump: `artifacts/coding-prod-p0/config-surface.json`
In-app: Settings → Developer → DCS Production Flags (read-only catalog)

## Kill-switch / failure close order

When production behaves badly, disable **enhancements first**, keep baseline:

1. Unset `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS`
2. Set `runtime.coding.staleWriteGuard.enabled=false`
3. Set `runtime.coding.symbolLease.enabled=false` (or `mode=memory`)
4. Stop patch-flow / ladder API callers; ensure `patchFlow.default=false`
5. Set `runtime.coding.worktree.backend=inprocess`; omit isolation or set `shared`
6. Set `runtime.coding.routingMemo.shadow=false` and `runtime.coding.sekb.experienceShadow=false`
7. Only if journal I/O is the incident: temporarily set `writeJournal.enabled=false` (loses undo)
8. Restart gateway/runtime after env/config changes

## Windows notes

- Prefer `inprocess` worktree backend until C4-H evidence (path separators, file locks, long paths, concurrent cleanup).
- Avoid flipping isolation default to `worktree` on Windows multi-agent hosts.
- If using `backend=git` experimentally: ensure Git for Windows is on PATH; clean leftover `.openclaw/worktrees/*` only after process exit.
- Concurrent `eslint` and Playwright report generation can race (`playwright-report` ENOENT); re-run lint after E2E.

## Observability export

Process-local counters live in:

- `codingObservability` — write / wave / read scorecard (`CODING_METRIC_NAMES`)
- `dcsObservability` — dual-injection + ladder action hits

Packaged export (empty process snapshot + metric map):

```bash
pnpm run dcs:prod-p0
# → artifacts/coding-prod-p0/observability-export.json
# → artifacts/coding-prod-p0/report.json
```

Watch families:

- **Write**: `coding.write.*` (stale blocks, false-block rate, journal latency)
- **Wave**: `coding.concurrent.*` (conflict rate, writeSet coverage, merge rework)
- **Shadow**: injection suppressions, compaction layers, fact tool calls

## Evidence paths

| Artifact | Path |
|----------|------|
| Round ACCEPT | `artifacts/coding-round-accept/report.json` |
| P0 report | `artifacts/coding-prod-p0/report.json` |
| P0 COMPLETE | `artifacts/coding-prod-p0/COMPLETE.md` |
| Wave COMPLETE | `openclaw_runtime/CODING-C4-COMPLETE.md` … `CODING-C7-COMPLETE.md` |
| Flags source | `openclaw_runtime/src/context-engine/coding-runtime-flags.ts` |
| View tools kill-switch | `openclaw_runtime/src/context-engine/dcs-context-tools-flags.ts` |

## Smoke

```bash
pnpm run dcs:prod-p0:smoke
# or full packaging acceptance:
pnpm run dcs:prod-p0
```

Smoke asserts defaults unchanged and rewrites packaging artifacts. It does **not** enable any enhancement flags.

## Forbidden in P0

- Flipping DCS defaults for demos / pseudo-green
- C7 memory/knowledge production cutover
- Assembler auto ladder default
- Isolation default `worktree`
- Parallel lock/memory systems or production path external MCP deps
