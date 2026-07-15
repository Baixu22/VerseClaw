# D2 Design Stub (not implemented)

**Status:** design reserve only — **no code**, **no ranking mutation**, **no pilot**  
**Date:** 2026-07-15  
**Precondition:** Pass-D1 (satisfied) + **separate written approval** (missing)

## Surface (if ever approved)

**Operator review ranking / candidate priority only.**

- Changes sort order of operator suggestions / review candidates when pilot flag on.
- Flag default-off; flag-off restores previous order.
- Live path uses in-process shadow score / metadata only — **never** offline artifacts as authority.
- **No** silent drop of trajectories from store.
- **No** auto principle write; `confirm_and_save` remains sole durable L2 write.
- **No** capture filtering in this surface (filter is a later Phase D decision).

## Metrics draft (for a future pilot)

| Metric | Intent |
| --- | --- |
| Rank of consensus-valuable items | Should improve (appear earlier) vs control |
| False prioritization of not_valuable | Bounded by product-agreed threshold |
| Accidental durable writes | Must not increase |
| Latency p50/p95 | Within budget |
| Flag-off parity | Previous order restored |

## Entry requirements (all)

1. Pass-D1 (mutation-free would_trigger) — **done**
2. Separate product/tech written approval naming surface = ranking
3. Explicit pilot scope (users/env/timebox)
4. V1 holdout policy still frozen at 50 (no retune)
5. Under Pass-Proxy: pilot docs must restate residual risks; no live-human claim

## Non-goals

- Task success / permission / retry authority
- Store content deletion or capture filter
- Default-on SEKB / ambient batch
- SEKB ops GUI
- Shadow V1 holdout retune
- Treating offline dual-review labels as live ranking authority

## Stop conditions (auto No-Go)

- Trajectory drop / filter without Phase D approval
- confirm_and_save bypass
- Rollback fail
- Scope creep into filtering

## Implementation

**Not started.** Do not implement from this stub without written D2 approval.
