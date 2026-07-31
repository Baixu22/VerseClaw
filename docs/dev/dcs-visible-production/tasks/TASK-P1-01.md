# TASK-P1-01: Fact view four tools productionizable

| field | value |
|-------|-------|
| **id** | `TASK-P1-01` |
| **milestone** | `M1-productive` |
| **priority** | `P1` |
| **status** | `done` |
| **completionClass** | `accept-with-residuals` (production-usable opt-in; live human A/B residual) |
| **blockedBy** | — |
| **owner** | Claude |
| **gapRefs** | GAP-P1-01, T-04..T-07 |
| **lastUpdated** | 2026-07-22 |
| **completedAt** | 2026-07-22 |

## Goal
After Settings enable, four view tools are stably usable; evidence pack for usefulness without default-on.

## Acceptance criteria
- [x] stable UI enable path (P0-01/03 + E2E 3/3)
- [x] may remain default-off but production-usable (opt-in Settings/env)
- [x] one-step kill (Settings off / env unset + OPS-02)
- [x] synthetic usefulness baseline recorded (C1 canary reduction 5.125×, keep-off; FP-P4-05 now classifies it as reference-only)
- [x] live-ab protocol recorded; no live or synthetic draft report is present (corrected by FP-P4-05)
- [ ] ≥10 human free-form product-chat A/B records — **residual** (calendar)
- [ ] liveReady/productApproved — **forbidden this task**

## Production path (verified)

1. Settings → Developer → enable **context-view-tools** (or env `OPENCLAW_DCS_CONTEXT_VIEW_TOOLS=1`)
2. Restart gateway when required so env inject applies
3. Coding workspace with FactService → tools: understand/impact/reuse/verify register
4. Kill: Settings off or env unset → tools leave catalog

## Tests / evidence
| Check | Result |
|-------|--------|
| `context-agent-tools.test.ts` | **19 passed** |
| Settings E2E enable/discover/kill | **3 passed** |
| `dcs-canary-c1` | ok, **keep-off**, synthetic reference reductionFactor 5.125 |
| C1 authority | `artifacts/first-product-preview/FP-P4-05/decision.json`: real-tool fixtures 4.5x, below 5x, keep-off |
| Live A/B protocol | `docs/dev/dcs-visible-production/P1-01-LIVE-AB-PROTOCOL.md` |
| Live report | **not generated**; future human path remains defined by the protocol |

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | enable path | done | inherited P0 + re-verified E2E |
| 2026-07-22 | unit/canary | pass | 19 tools + c1 keep-off |
| 2026-07-22 | live-ab draft | done | protocol + synthetic draft |
| 2026-07-22 | close | **accept-with-residuals** | no default-on |
| 2026-07-29 | FP-P4-05 correction | done | remove nonexistent draft-report claim; 5.125x is reference-only and 4.5x is the C1 gate authority |

## Handoff
- Human operators may fill live A/B using protocol without code changes.
- Next backlog: **TASK-P1-03** tool_registry (blocked until this done — now unblocked), **TASK-P1-05** SEKB UX, **TASK-P1-07** staleWriteGuard.
- Do not flip defaults based on synthetic reduction alone.
