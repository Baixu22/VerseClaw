# TASK-P1-07: staleWriteGuard production candidate

| field | value |
|-------|-------|
| **id** | `TASK-P1-07` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `done` |
| **completionClass** | `done (loop)` — opt-in candidate; default remains off |
| **owner** | Claude |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal
Explainable block + override UX before default-on discussion; Settings safe opt-in.

## Acceptance criteria
- [x] false-block metrics path
- [x] explainable block + override UX (`force` / `allowStaleWrite`)
- [x] UI on/off (Settings)
- [x] default remains **off**
- [x] assessment report
- [ ] live multi-session editor-churn corpus — residual before default-on

## Tests
```text
stale-write-guard.test.ts: 6 passed
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | override UX | done | |
| 2026-07-22 | tests | 6 pass | |
| 2026-07-22 | assessment | keep-off | |
| 2026-07-22 | close | **done** | |

## Recommendation
**keep-off** for defaults. Safe opt-in via Settings.
