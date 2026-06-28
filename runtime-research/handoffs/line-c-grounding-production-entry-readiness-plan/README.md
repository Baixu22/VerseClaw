# Line C Grounding Production-entry Readiness Plan

Status: accepted.

This handoff packages the production-entry readiness plan for Line C Runtime Grounding. It moves the work from controlled internal opt-in readiness to planning-complete status only.

## Scope

Accepted scope:

- Task spec, handoff documentation, validation plan, risk model, rollout/rollback plan, and runtime index registration.
- Production-entry readiness planning for explicit/default-off, readonly, local, bounded, summary-only, diagnostics/metadata-only, non-authoritative Line C grounding.
- Future phase definitions that require separate task specs before implementation.
- Continued use of `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.

Rejected scope:

- Default-on behavior, production default rollout, UI, settings, Gateway route, Electron IPC, host-api/api-client contract, provider transport, provider default registration/order, prompt/model-message assembly, runtime decisions, memory promotion, fact acceptance, episode write, persistence, database, sidecar, cache, exporter, listener, service, patch apply, workspace edit, or symbol mutation.

## Included Artifacts

- `production-roadmap.md`
- `risk-register.md`
- `validation-strategy.md`
- `rollout-rollback-playbook.md`
- `implementation-synthesis.md`

## Phase Package

The production path is split into separate future specs:

| Phase | Future task spec | Decision boundary |
| --- | --- | --- |
| Phase A: controlled internal opt-in pilot | `line-c-grounding-controlled-internal-opt-in-pilot.md` | Internal explicit diagnostics pilot only. |
| Phase B: diagnostics presentation/operator readiness | `line-c-grounding-diagnostics-presentation-operator-readiness.md` | Operator-facing plan only; no UI unless that spec explicitly accepts it. |
| Phase C: limited production opt-in, diagnostics-only | `line-c-grounding-limited-production-opt-in-diagnostics-only.md` | Limited opt-in remains non-authoritative and diagnostics-only. |
| Phase D: runtime shadow replay proof | `line-c-grounding-runtime-shadow-replay-proof.md` | Replay proof only; no live runtime authority. |
| Phase E: cutover readiness review | `line-c-grounding-cutover-readiness-review.md` | Review gate; no cutover by itself. |
| Phase F: controlled production opt-in | `line-c-grounding-controlled-production-opt-in.md` | Controlled opt-in only if prior specs pass. |
| Phase G: default-on proposal | `line-c-grounding-default-on-proposal.md` | Proposal only unless a future spec accepts default-on. |

## Decision

The desired final decision for this package is production-entry readiness planning complete. That means the pre-production route, risks, validation gates, rollback plan, and next entry conditions are documented. It does not mean Line C is production-ready, default-on, authoritative, persistent, prompt-visible, provider-ordering-visible, memory-promoting, or UI-visible.
