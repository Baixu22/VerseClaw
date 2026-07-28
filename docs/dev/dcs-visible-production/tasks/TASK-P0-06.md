# TASK-P0-06: Retire/hide dead surfaces + doc sweep

| field | value |
|-------|-------|
| **id** | `TASK-P0-06` |
| **milestone** | `M0-honesty` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P0-06, G-F1..F3 |
| **estimate** | 1d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
User paths no longer present RETIRED codegraph / deleted provider-registry pilot / stale unregistered claims as live features.

## Acceptance criteria
- [x] CodeGraph marked RETIRED in plugin JSON + README banner (enabledByDefault false)
- [x] Living retired-surfaces table for agents
- [x] Stale memory hooks corrected (context_* unregistered / phase zero producer)
- [x] provider-registry diagnostic label no longer says “pilot” as live product
- [x] enhancement doc pilot wording historical
- [x] main coding path unaffected (defaults unchanged)
- [x] catalog unit still green

## Implementation
| Area | Change |
|------|--------|
| `extensions/codegraph/README.md` | RETIRED-first; replacement = DCS Fact tools |
| `extensions/codegraph/openclaw.plugin.json` | shorter RETIRED description |
| `docs/dev/dcs-visible-production/RETIRED-SURFACES.md` | living list |
| `memory/runtime-convergence-plan.md` + MEMORY.md | STALE banner |
| `provider-registry.ts` | diagnostic label de-pilot |
| `docs/enhancements/05-adaptive-context-budget.md` | historical pilot note |

## Audit notes
- No Settings UI entry for CodeGraph (already absent).
- CodeGraph remains force-enableable for harness; not default-on.
- team/codegraph-role-architecture.md kept as design archaeology (not product enablement).

## Test / evidence
```powershell
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/context-engine/dcs-prod-flags-catalog.test.ts
# 3 passed

pnpm exec playwright test tests/e2e/dcs-prod-p0-settings.spec.ts --workers=1
# expect 3 passed (DCS settings only)
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | audit | done | codegraph already default-off; no UI sell |
| 2026-07-22 | docs/memory | done | RETIRED banner + STALE memory |
| 2026-07-22 | close | **done** | M0-honesty P0-01..06 complete |

## Handoff notes
- **M0-honesty complete.** Next program: OPS-01 (L3 human canary) or P1 backlog.
- STATUS nextTaskId → `TASK-OPS-01` (or product choice).
