# SEKB Hermes-Inspired Optimization Design

Status: **Tier A merge-ready (default-off)** / **Tier B grayscale canary recorded** / **Tier C labeling kit ready (human dual-review pending)** / **Tier D0 decision pack landed (D1/D2 blocked)** / promotion deferred

## Intent

Optional SEKB experience enhancements inspired by Hermes-style trajectory capture, offline dual-review evaluation, and bounded batch suggestion. This change set is **production mergeable as default-off capability only**. It is **not** production enablement and **not** promotion of shadow filtering or scheduling.

## Delivery status (档 A)

| Item | Status |
|------|--------|
| Library + Host/CLI ops | Landed, default-off |
| Shadow V1 metadata | Default-off; threshold frozen at 50 |
| Offline dual-review kit (A.5) | Non-authoritative artifacts only |
| Batch distillation assistant | Explicit invoke only; deterministic fallback |
| GUI for SEKB ops | Not in scope (CLI + Host API only) |
| Phase C scheduler | **Forbidden / not activated** |
| Phase D capture filtering | **Forbidden / not activated** |
| evaluable_for_promotion | Must remain false without 200 human dual reviews |
| Tier B grayscale observation | **Local canary recorded** (capture+report only; promotion still shadow_only) |
| Tier C human dual-review + usefulness closed loop | **Labeling kit ready; human dual-review pending** (artifacts/sekb-hermes-phase-a5/tier-c/); evaluable_for_promotion remains false until hard gates |
| Tier D0 promotion decision pack | **Landed** (artifacts/sekb-hermes-phase-a5/tier-d/); D1/D2 **blocked** until Tier C hard gates + written approval |

## Default-off invariants

1. Master gate: `runtime.contextBlock.sekb.enabled` / `OPENCLAW_SEKB_ENABLED` (default false).
2. Shadow: nested `shadowEvaluation.enabled` / `OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED`; requires master gate.
3. Batch assistant: nested `batchDistillationAssistant.enabled` / `OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED`; requires master gate; never ambient.
4. `confirm_and_save` is the only durable L2 principle write path; no automatic principle / ContextBlock authority writes.
5. Offline artifacts under `artifacts/sekb-hermes-phase-a5/` are evaluation evidence only; runtime never reads them for decisions.
6. Automated dual-smoke labels use `labelAuthority=automated_smoke_not_human` and **cannot** authorize promotion.
7. Shadow V1 score threshold remains **50**; no retune on holdout.
8. Host state dir aligns with Electron/`OPENCLAW_STATE_DIR` (`%APPDATA%\Electron\openclaw-source-state` under `pnpm dev`).

## Non-goals for 档 A

- Fake human dual-review labels
- Forcing 200 dual-review / evaluable_for_promotion
- Phase C/D activation
- SEKB ops GUI
- Changing Shadow V1 algorithm or threshold
- Ambient automatic LLM batch calls

## Production enablement prerequisites (out of this PR)

See `artifacts/sekb-hermes-phase-a5/PRODUCTION-ENABLEMENT-PRECONDITIONS.md`.

## Authority

- Task validate entry: `harness/specs/tasks/sekb-hermes-gap-closure.md`
- Tier D0 validate entry: `harness/specs/tasks/sekb-hermes-tier-d-promotion-decision.md`
- Boundaries: `harness/specs/rules/sekb-hermes-*-boundary.md`
- Campaign notes: `artifacts/sekb-hermes-phase-a5/CAMPAIGN.md`
- Grayscale runbook: `artifacts/sekb-hermes-phase-a5/GRAYSCALE-RUNBOOK.md`
- Tier B status: `artifacts/sekb-hermes-phase-a5/grayscale-observation-status.v1.json`

## Tier C evidence status

- Campaign script: `scripts/sekb-tier-c-campaign.mjs` (`pnpm sekb:tier-c:campaign`)
- Artifacts: `artifacts/sekb-hermes-phase-a5/tier-c/`
- Decision memo: `artifacts/sekb-hermes-phase-a5/tier-c/GO-NO-GO.md`
- `evaluable_for_promotion` is offline evidence only; still no runtime mutation / Phase C/D / Shadow V1 retune
- Filter / default-on remain **deferred**

## Tier D evidence status

- D0 decision pack: `artifacts/sekb-hermes-phase-a5/tier-d/D0-PROMOTION-DECISION-PACK.md`
- Machine-readable: `artifacts/sekb-hermes-phase-a5/tier-d/promotion-decision.v1.json`
- Task entry: `harness/specs/tasks/sekb-hermes-tier-d-promotion-decision.md`
- Boundary: `harness/specs/rules/sekb-hermes-tier-d-boundary.md`
- D1/D2 task drafts exist but `implementationAuthorized: false`
- First conditional promotion object: **operator review ranking / candidate priority** (not full filter)
- `evaluable_for_promotion` remains offline-only; still no runtime mutation / Phase C/D activation

