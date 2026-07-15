# CODING Round Closeout Plan

**Date**: 2026-07-15  
**Worktree**: `ClawX-context-coding-wt` (`codex/context-coding`)  
**Goal**: Close this coding-optimization round without regressing main C0–C3.

## Ground truth

| Layer | Status on `main` | Status in this dirty worktree |
|---|---|---|
| C0 Fact views / parse-on-touch / WFS | Landed (`context-agent-tools`, WFS, flags, acceptance) | Parallel re-impl (often thinner; **do not overwrite main**) |
| C1 nav + A/B | Landed (on_demand, nav, `coding-c1-ab.mts`) | Extra sim fixtures (`coding-ab-fixtures`) worth keeping |
| C2 write kit | Landed full C2-1..10 | Parallel; **prefer main** |
| C3 writeSet | Landed partial fill + token budget | Parallel; **prefer main** |
| C4 worktree | Missing | **NEW** — port |
| C5 lease / patch-flow | Missing | **NEW** — port |
| C6 context ladder | Missing | **NEW** — port (interface/evidence) |
| C7 shadow memory product | Missing (bridge exists) | **NEW** helpers — port |
| Delivery | main is source of C0–C3 | 0 commits ahead, 8 behind, all dirty |

## Closeout principles

1. **Never regress main C0–C3** by restoring worktree duplicates of write kit / WFS / fact tools.
2. **Port only true deltas**: C4–C7 modules + remaining acceptance + flag/obs extensions.
3. **Safe defaults only**: no production flag flips; C1 remains sim; C6/C7 remain interface/shadow.
4. **Single SoT STATUS** under `openclaw_runtime/CODING-OPTIMIZATION-STATUS.md` (+ mirror under `reports/` only if identical).
5. **Evidence required** before commit: unit suites for new modules + `coding-remaining-acceptance.mts`.

## Execution steps

### A. Backup (done)
`artifacts/context-coding-closeout/wt-backup-20260715/` — full dirty snapshot + MANIFEST.

### B. Reset branch to main
- Discard dirty tracked rewrites of C0–C3 wiring/schema.
- Remove untracked duplicate C0–C3 modules that would shadow main paths incorrectly.

### C. Port incremental code
From backup, restore **only**:

**C4**
- `src/agents/worktree-service.ts` + test
- isolation fields already partly on protocol via main C3; isolation matrix below

**C5**
- `src/context-engine/factstore/symbol-lease.ts` + test
- `src/agents/patch-flow.ts`
- `src/agents/isolation-mode-matrix.ts` + test

**C6**
- `src/context-engine/block-lifecycle.ts` + test
- `src/agents/tool-output-compress.ts`
- `src/context-engine/token-pressure.ts`
- `src/context-engine/coding-long-chat-curve.ts` + test

**C7**
- `src/knowledge/routing-memo-shadow.ts` + test
- `src/knowledge/sekb/experience-shadow-product.ts` + test
- `src/agents/verifier-discipline.ts`

**C1 sim evidence**
- `src/context-engine/coding-ab-fixtures.ts` + test
- `src/context-engine/coding-tool-navigation.test.ts` (adapt to main nav if needed)

**Accept**
- `scripts/coding-remaining-acceptance.mts`

**Do not port**
- `tools/context-fact-tools.ts` (main uses `context-agent-tools.ts`)
- `team-orchestrate-request.ts` (main already has fileHints/writeSet fill)
- Local copies of write-side-effects / stale / journal / WFS / parse-on-touch, etc.
- Huge zod-schema reformat churn

### D. Merge shared surfaces carefully
1. `coding-runtime-flags.ts` — main base + C4-H/C5-H/C7-H resolvers (safe defaults).
2. `coding-observability.ts` — main base + `recordReplayTask` / `recordMergeOutcome` / `recordCompactionLayer` + rates fields needed by C1/C4/C6.
3. `types.openclaw.ts` — add `runtime.coding` leaves for new flags (labels/help if cheap).
4. No default flips for tool_registry / working_memory / patchFlow / experienceShadow / worktree.git / symbolLease.wal.

### E. Docs pack
- `CODING-OPTIMIZATION-STATUS.md` — honest classes vs main
- `CODING-FLAG-GRADUATION.md` — flag matrix
- `CODING-C1-LIVE-AB.md` — live blocked note
- `CODING-HARDENING-BACKLOG.md` — residual only
- C4–C7 COMPLETE under `artifacts/coding-c4..c7/` or `openclaw_runtime/`
- Delete stale partial STATUS under `reports/` that contradicts SoT
- Clean `tmp/**`

### F. Verify
```bash
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts \
  worktree-service isolation-mode-matrix
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts \
  symbol-lease block-lifecycle coding-ab-fixtures coding-long-chat-curve \
  routing-memo-shadow experience-shadow-product coding-tool-navigation
node --import tsx scripts/coding-remaining-acceptance.mts
# smoke main gates still green
node --import tsx scripts/coding-c0-acceptance.mts
node --import tsx scripts/coding-c2-acceptance.mts
```

### G. Commit
Single logical commit (or split C4/C5/C6/C7) on `codex/context-coding` rebased onto main:
`feat(coding): land C4–C7 residual closeout on main C0–C3 base (safe defaults)`

## Explicit non-goals this round
- Live C1 A/B traffic / flag graduation flips
- Assembler production flip
- SEKB cutover
- Default git worktree / WAL lease
- UI Workbench for coding flags
- Free-text writeSet invention

## Success criteria (round closed)
1. Branch based on current main (not 8 commits behind)
2. C0–C3 behavior remains main’s implementation
3. C4–C7 modules + tests + remaining acceptance green
4. STATUS/COMPLETE/flag docs consistent and honest
5. Changes committed (not only dirty worktree)
6. No production default flips
