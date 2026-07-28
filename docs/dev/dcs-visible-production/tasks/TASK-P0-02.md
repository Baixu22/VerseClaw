# TASK-P0-02: Kill dead factViews config gate

| field | value |
|-------|-------|
| **id** | `TASK-P0-02` |
| **milestone** | `M0-honesty` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P0-02, C-01 |
| **estimate** | 0.5-1d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
Single source of truth for Fact view tool gating. Remove false confidence from runtime.coding.factViews.enabled=true with zero callers.

## ADR (slice 1)
**Decision B — deprecate/remove dead config; env + Settings UI only.**

Reasons:
1. Production gate already is `isDcsContextViewToolsEnabled` (env).
2. `isCodingFactViewsEnabled` had **zero** production callers.
3. Wiring config default-true into resolveViewToolsEnabled would **flip product default on** (violates hard lock).
4. TASK-P0-01 Settings already owns `context-view-tools` via env inject.

## Acceptance criteria
- [x] Choose B: deprecate config, env+UI only
- [x] Dead default-true key removed from DEFAULT_CODING_FEATURE_FLAGS; helper fail-closed deprecated
- [x] catalog riskNote + graduation matrix + dcs-context-tools-flags docs aligned
- [x] unit tests: default-off preserved; helper always false; env gate only

## Implementation slices
1. ADR — **DONE** (B)
2. Code + tests — **DONE**
3. Docs/catalog — **DONE**

## Code changes
- `openclaw_runtime/src/context-engine/coding-runtime-flags.ts` — remove `runtime.coding.factViews.enabled`; `isCodingFactViewsEnabled` → always false + @deprecated
- `openclaw_runtime/src/config/types.openclaw.ts` — factViews leaf @deprecated ignored
- `openclaw_runtime/src/context-engine/dcs-context-tools-flags.ts` — document sole SoT
- `openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts` — P0-02 locks
- `shared/dcs/prod-flags-catalog.ts` — riskNote
- `reports/CODING-FLAG-GRADUATION.md` — matrix corrected

## Test / evidence
```powershell
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/dcs-prod-flags-catalog.test.ts
# 3 passed
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/context-agent-tools.test.ts
# 19 passed
# root:
pnpm exec vitest run tests/unit/dcs-prod-flags-control.test.ts
# 6 passed
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | ADR | B | env+Settings only; no default-true wire |
| 2026-07-22 | code | done | remove key; fail-closed helper |
| 2026-07-22 | tests | pass | catalog 3 + context-agent-tools 19 + control 6 |
| 2026-07-22 | close | **done** | |

## Handoff notes
- Next: `TASK-P0-03` (view tools discoverability) or `TASK-P0-04`.
- Do not reintroduce `runtime.coding.factViews.enabled` as a live gate.

## Hard locks
- No production default flip.
- View tools remain default-off until graduation.
