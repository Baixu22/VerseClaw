# CODING-C2-COMPLETE

**Date**: 2026-07-15
**Scope**: CODING-OPTIMIZATION-EDD §5 C2 write kit (C2-1..C2-10) ported onto ClawX main
**Branch**: `codex/dcs-c2-write-kit`
**Base**: `c065ef56b` (C1)

## Summary

Write-side closed loop on production callers via `applyWriteKit` in `agent-tools.ts`:
parse-on-write → syntax check → type diag → stale guard (flag default off) → verify consume →
journal/undo → soft gates → destructive tiers.

Composition modules live under `openclaw_runtime/src/agents/*.ts` (not a parallel Fact system).
C0/C1 assets on main were reused; worktree C0/C1 re-implementations were discarded.

## DEV delivered

| Card | Status | Deliverable |
|---|---|---|
| C2-1 parse-on-write | **done** | `write-side-effects.ts` → `materializer.onFileTouched` |
| C2-2 stale write guard | **done** | `stale-write-guard.ts`, flag default **false** (shadow) |
| C2-3 verify consume | **done** | `reviewDiff` relatedTests attach on success |
| C2-4 impact precheck | **done** | `write-soft-gates.ts` soft warning |
| C2-5 incremental diag | **done** | `post-write-diag.ts` (2s fuse, type-level) |
| C2-6 WM joint | **done** | acceptance + `working-memory-envelope.test.ts` |
| C2-7 edit-readiness | **done** | soft warning when `not_enough_context` |
| C2-8 write journal | **done** | `tools/write-journal.ts` + `undo_write` |
| C2-9 post-write parse | **done** | `post-write-parse-check.ts` (500ms) |
| C2-10 destructive tiers | **done** | `write-destructive-tier.ts` |

## Flags (defaults unchanged / red-line safe)

| flag | default | how to enable |
|---|---|---|
| `runtime.coding.staleWriteGuard.enabled` | **false** | config or `staleWriteGuardEnabled: true` override |
| `runtime.coding.writeJournal.enabled` | **true** | set false to disable snapshots / undo_write |
| `runtime.coding.parseOnTouch.enabled` | **true** | shared with parse-on-write touch path |

## TEST results

| Suite | Result |
|---|---|
| C2 agents-tools unit (8 files / 25 tests) | **PASS** |
| `pnpm run test:dcs` | **EXIT 0** |
| `pnpm run typecheck` | **EXIT 0** |
| `pnpm --dir openclaw_runtime build` | **EXIT 0** |
| `pnpm run lint:check` | see gate table at commit time |
| directed vitest C2 suite | **25/25** |
| e2e `dcs-production-wiring-w5` | see gate table at commit time |

Commands:

```
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts \
  src/agents/tools/parse-on-write.test.ts \
  src/agents/tools/post-write-parse-check.test.ts \
  src/agents/tools/post-write-diag.test.ts \
  src/agents/tools/write-destructive-tier.test.ts \
  src/agents/tools/working-memory-envelope.test.ts \
  src/agents/tools/write-journal.test.ts \
  src/agents/tools/stale-write-guard.test.ts \
  src/agents/tools/write-soft-gates.test.ts

pnpm --dir openclaw_runtime exec node --import tsx scripts/coding-c2-acceptance.mts
pnpm --dir openclaw_runtime exec node --import tsx scripts/coding-c2-full-acceptance.mts
```

## ACCEPT evidence (machine JSON)

See:

- `artifacts/coding-c2/acceptance.json`
- `artifacts/coding-c2/full-acceptance.json`

Key fields observed on GREEN run (do not hand-edit; re-run scripts to refresh):

- `ok: true`
- `parseOnWriteHits`, `syntaxCheckHits`, `staleBlocks`, `journalSnapshots`, `undoCount`
- `c2_5_diag`, `c2_6_wm`, `c2_10_delete_approval`, `c2_10_edit_skip`

## Wiring (production callers)

`createOpenClawCodingTools` in `agent-tools.ts`:

- `read` → `applyParseOnTouch` (touch + session read hashes for C2-2)
- `edit` / `write` / `apply_patch` → `applyWriteKit` (journal → stale(write only) → side effects → soft gates → destructive)
- `undo_write` registered when journal enabled

## Honest statement

**Did**:
- Port C2 write kit modules + tests + acceptance from context-coding-wt
- Wire production edit/write/apply_patch via single `applyWriteKit` composition
- Keep staleWriteGuard default **off**; journal default **on**
- Extend coding observability counters for write metrics
- Write machine-readable artifacts under `artifacts/coding-c2/`

**Did not**:
- Flip any DCS/coding flag default to on for stale guard
- Port worktree C0/C1 parallel Fact tool stack (`context-fact-tools.ts` discarded; main uses `context-agent-tools.ts`)
- Touch C3–C7
- Change context-engine core block/assembler/handler semantics

## Landed SHA

5dbbf165b
