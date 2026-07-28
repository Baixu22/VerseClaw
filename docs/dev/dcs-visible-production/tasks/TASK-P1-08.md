# TASK-P1-08: TaskLoop acceptance scenario coverage

| field | value |
|-------|-------|
| **id** | `TASK-P1-08` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P1-08, G-D3 |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal
Marketed task_state/phase/SEKB trajectory features must be accepted on TaskLoop path, not single-turn chat only.

## Acceptance criteria
- [x] acceptance checklist doc — `docs/dev/dcs-visible-production/TASKLOOP-ACCEPTANCE.md`
- [x] harness covers phase producer — `task-loop-controller.dcs-phase-producer.test.ts` + task-state extension tests (**8 passed**)
- [x] product copy notes loop dependency — Settings `taskLoopNote` i18n + panel testid

## Tests
```powershell
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents.config.ts `
  src/agents/task-loop-controller.dcs-phase-producer.test.ts `
  src/agents/embedded-agent-runner/extensions.task-state.test.ts
# 8 passed
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | checklist | done | TASKLOOP-ACCEPTANCE.md |
| 2026-07-22 | automation | pass | 8 tests |
| 2026-07-22 | copy | done | taskLoopNote |
| 2026-07-22 | close | **done** | |

## Residual
Optional Playwright multi-step TaskLoop e2e deferred; unit harness sufficient for this task.
