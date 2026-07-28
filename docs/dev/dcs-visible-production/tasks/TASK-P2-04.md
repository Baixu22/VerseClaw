# TASK-P2-04: Productized observability panel

| field | value |
|-------|-------|
| **id** | `TASK-P2-04` |
| **status** | `done` |
| **owner** | Claude |
| **completedAt** | 2026-07-22 |

## Goal
Settings shows kill state, enabled opt-in flags, and coding/DCS metric key catalog (not only process noise).

## Acceptance
- [x] minimal panel in Settings DCS section
- [x] metric keys align writeSide/falseBlockRate + budgetSide (P2-03)
- [x] kill switch + view-tools env badges
- [x] i18n en/zh (+ja/ru)
- [x] unit + e2e

## Honesty
Gateway in-process `codingObservability`/`dcsObservability` counters are **not** mirrored cross-process; panel is host-visible control state + scrape key catalog. Full live counter streaming is residual.

## Tests
```text
dcs-prod-flags-control: 9 passed
e2e dcs-prod-p0-settings: 3 passed (observability panel testids)
```

## Progress log
| when | slice | result | note |
|------|-------|--------|------|
| 2026-07-22 | API+UI | done | getFlags.observability |
| 2026-07-22 | tests | pass | 9+3 |
| 2026-07-22 | close | **done** | |
