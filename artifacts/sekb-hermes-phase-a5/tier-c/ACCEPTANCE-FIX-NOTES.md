# Tier C Acceptance Fix Notes

Date: 2026-07-15
Scope: post dual-review acceptance residuals only

## What was fixed

### F1 — Usefulness metrics regression
After dual-review merge with `--skip-closed-loop`, usefulness metrics regressed to unavailable/`no_confirmed_principle` even though `closed-loop.v1.json` remained `status=confirmed` for principle `92d58571-255e-4c2c-8a58-f65be2206337`.

Restored (no new `confirm_and_save`):
- `usefulness-metrics.v1.json`
- `USEFULNESS-METRICS.md`
- `evaluation-campaign-status.v1.json` → `closedLoop` + `usefulnessMetrics` + inventory counts
- `TIER-C-STATUS.md` / `GO-NO-GO.md` closed-loop lines aligned to **confirmed (prior; metrics restored, no re-confirm)**

### F2 — Residual-risk documentation
Added **Residual risks / acceptance caveats** to:
- `GO-NO-GO.md`
- `TIER-C-STATUS.md`

Covering kappa optimism, holdout discrimination limits (all scores >= 50), pipeline authority vs agent-proxy origin, and promotion ≠ filtering.

## Intentionally unchanged
- Reviewer A/B labels and rationales (no re-label / no kappa manufacturing)
- `reviews.v1.json` / `report.v1.json` hard-gate numbers
- Offline **Go** / `evaluable_for_promotion=true`
- Shadow V1 threshold/weights (frozen at 50)
- Phase C/D off; no runtime mutation
- No new durable principle write

## Usefulness before → after

| metric | before | after |
| --- | --- | --- |
| `deterministic_suggest_human_accept_rate` | unavailable / skipped / null | available / **1** |
| `post_confirm_retrieval_count` | unavailable / no_confirmed_principle | available / **0** |
| `post_confirm_adoption_count` | unavailable / no_confirmed_principle | available / **0** |
| `post_adoption_success` | unavailable / no_confirmed_principle | available / **0** |
| `trajectory_count` | available / 312 | available / **312** |
| `principle_count` | available / 3 | available / **3** |
| `batch_probe_user_visible_status` | available / feature_disabled | available / **feature_disabled** |

## Re-verification
See command results recorded at fix time in the agent final reply; checks require:
- closedLoop confirmed
- accept rate available = 1
- Go + evaluable true
- pairs 200/200
- phaseCDActivated false
- shadowV1Retuned false

## One-liner
Offline Go evidence only; not production filtering; D1/D2 not authorized.
