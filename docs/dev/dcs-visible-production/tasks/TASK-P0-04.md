# TASK-P0-04: BlockStore/state DB failure user-visible

| field | value |
|-------|-------|
| **id** | `TASK-P0-04` |
| **milestone** | `M0-honesty` |
| **priority** | `P0` |
| **status** | `done` |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P0-04, T-01 |
| **estimate** | 1d |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal (user-visible outcome)
When state DB/BlockStore cannot open, user/model sees explicit degraded status, not silent missing tools.

## Acceptance criteria
- [x] failure path log + user-visible hint (extraSystemPrompt on attempt)
- [x] failure text says tools **temporarily unavailable** due to storage — not “feature does not exist”
- [x] unit tests: BlockStore open fail + FactService fail + notice builders
- [x] compact logs degradation when storage fails
- [x] callers updated to `DcsDepsResolution` shape

## Implementation
- `dcs-extension-deps.ts` returns `{ deps?, degradationNotice?, failureCode? }`
- Notices: `## Context storage unavailable` / `## Fact store unavailable`
- `attempt.ts` joins notice into `effectiveExtraSystemPrompt`
- `compact.ts` logs warn on degradation
- `coding-v1-sekb-verify.mts` uses `.deps`

## Test / evidence
```powershell
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/embedded-agent-runner/dcs-extension-deps.test.ts
# 6 passed
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | — | created | |
| 2026-07-22 | API+notices | done | DcsDepsResolution |
| 2026-07-22 | attempt/compact | done | inject + log |
| 2026-07-22 | tests | **6 passed** | fail paths covered |
| 2026-07-22 | close | **done** | |

## Handoff notes
- Next: `TASK-P0-05` (shell vs core product copy) or `TASK-P0-06` (retire surfaces).
- Defaults unchanged; no feature enablement flips.
