# DCS Coding Controlled Preview Runbook (opt-in)

**Platform**: Windows x64 controlled preview
**Mode**: internal, single-workspace, explicit opt-in
**Default flag graduation**: **false** (do not flip defaults for demos)
**Evidence boundary**: FP-P1 engineering and real-process gates; human canary and release approval remain pending

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

### Simplest: the one-switch DCS Coding Preview (FP-P1-03)

**Settings → Developer → DCS Coding Preview** is the product path. One switch composes
the first-product combo — `context-view-tools` + `working-memory` + `tool-registry` +
`stale-write-guard` — with a single gateway restart and a single child acknowledgement
covering all of them. Prerequisites are enforced (verified provider, selected workspace
with an explicit permission level); the switch is disabled with the missing items listed
until they are met. `applied` only ever comes from the child's runtime acknowledgement;
an engaged kill switch is displayed as **killed**, never as applied. Excluded components
(VToken, RM inject, SEKB writeback, Browser, shadows, symbol-lease) are NOT part of this
switch and are not flipped by it. Default off; upgrades never auto-enable it.

### Per-flag: advanced Settings control plane (TASK-P0-01)

**Settings → Developer → DCS Controlled Preview Flags** exposes advanced switches for an allowlist (defaults remain off). The one-switch path above remains the normal product path:

| UI id | Effect |
|-------|--------|
| context-view-tools | AppSettings + gateway env `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` |
| stale-write-guard | AppSettings + `runtime.coding.staleWriteGuard.enabled` in openclaw.json |
| symbol-lease | AppSettings + `runtime.coding.symbolLease.enabled` |
| routing-memo-shadow | AppSettings + `runtime.coding.routingMemo.shadow` |
| sekb-experience-shadow | AppSettings + `runtime.coding.sekb.experienceShadow` |

On save, product path restarts a running gateway when possible. Status badges: `applied` / `pending-restart` / `error` / `read-only`.

api-only / request-only / baseline rows stay documentation-only (no switch).

### Advanced: env / hand-edited config

1. **View tools (C1)** — env `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1` (or Settings switch); restart gateway/runtime. Explicit env `0/false/off` still wins over Settings enable (kill).
2. **Stale write guard (C2)** — `runtime.coding.staleWriteGuard.enabled=true` or Settings.
3. **Git worktree backend (C4)** — `runtime.coding.worktree.backend=git` **and** request `isolation: "worktree"`.
4. **Symbol lease (C5)** — `runtime.coding.symbolLease.enabled=true` or Settings (`mode=memory` default).
5. **Patch-flow (C5)** — call `applyPatchProposalsSerial()` / `recommendIsolationMode()`; do **not** set `patchFlow.default=true`.
6. **Context ladder (C6)** — call `applyContextLadder({ blocks, tokenBudget })`; no assembler flip.
7. **Shadows (C7)** — Settings or `routingMemo.shadow` / `sekb.experienceShadow` for dual-write only.

Config surface dump: `artifacts/coding-prod-p0/config-surface.json`

In-app: **Settings → Developer → DCS Controlled Preview Flags (advanced writable control plane + read-only rows)**

## Kill-switch / failure close order

When production behaves badly, disable **enhancements first**, keep baseline:

1. Turn off Settings switches; or unset `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS` / `OPENCLAW_DCS_CONTEXT_TOOLS`
2. Set `runtime.coding.staleWriteGuard.enabled=false` (Settings or config)
3. Set `runtime.coding.symbolLease.enabled=false` (or `mode=memory`)
4. Stop patch-flow / ladder API callers; ensure `patchFlow.default=false`
5. Set `runtime.coding.worktree.backend=inprocess`; omit isolation or set `shared`
6. Set `runtime.coding.routingMemo.shadow=false` and `runtime.coding.sekb.experienceShadow=false`
7. Only if journal I/O is the incident: temporarily set `writeJournal.enabled=false` (loses undo)
8. Restart gateway/runtime after env/config changes (Settings toggles attempt restart on product path)

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
