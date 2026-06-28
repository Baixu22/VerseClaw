# Line C Grounding Rollout/Rollback Playbook

This playbook is a planning artifact. It does not authorize rollout.

## Rollout Principles

| Principle | Requirement |
| --- | --- |
| Fresh spec per phase | No phase may begin implementation without a fresh accepted task spec. |
| Explicit opt-in | Every pre-default phase remains explicit/default-off. |
| Diagnostics-only | Line C output remains summary-only metadata and non-authoritative unless a later spec explicitly accepts a narrower change. |
| Raw data exclusion | Raw prompts, traces, payloads, tool args/output, stdout/stderr, env, secrets, API keys, auth headers, trace-context baggage, transcripts, and untrusted refs remain excluded. |
| Main-owned transport | Renderer/Main/Gateway/host-api/api-client/provider transport changes require the communication checklist and must preserve Main-owned transport policy. |
| No persistence creep | No database, sidecar, cache, exporter, listener, service, or daemon may appear unless a future spec explicitly accepts that surface. |

## Rollout Gates

| Gate | Required proof |
| --- | --- |
| Planning complete | This task spec, roadmap, risk register, validation strategy, playbook, synthesis, and index update accepted. |
| Internal pilot | Phase A accepted with explicit participant list, disabled parity, and rollback proof. |
| Operator readiness | Phase B accepted with aggregate-only redaction and docs/i18n/E2E coverage if UI exists. |
| Limited production diagnostics | Phase C accepted with sampling budget, privacy/security review, and no authority drift. |
| Shadow replay | Phase D accepted with deterministic replay and sanitized corpus proof. |
| Cutover review | Phase E accepted with scorecard, owner approval, and zero open veto gates. |
| Controlled production opt-in | Phase F accepted with production metrics and rollback drill. |
| Default-on proposal | Phase G accepted only as proposal unless a later implementation spec approves default-on. |

## Rollback Procedure

| Phase | Rollback action | No-residue check |
| --- | --- | --- |
| Production-entry planning | Remove spec, handoff directory, and runtime index entry. | No runtime code, state, migration, UI, provider, or transport cleanup exists. |
| Phase A | Close pilot gate and remove participant opt-in. | Disabled output equals baseline; no persisted artifacts. |
| Phase B | Hide or remove presentation surface if accepted by that future spec. | No raw display cache, missing i18n, or stale operator instructions remain. |
| Phase C | Disable production diagnostics opt-in and sampling. | Default behavior parity; no accepted aggregate artifacts remain unsafe. |
| Phase D | Remove replay artifacts and disable replay runner. | No raw replay corpus, sidecar, or persistent replay output remains. |
| Phase E | Mark cutover review as rejected or needs_revision. | No runtime behavior changed. |
| Phase F | Disable controlled production opt-in and verify cohort count zero. | Default behavior parity and rollback time objective met. |
| Phase G | Reject or revise proposal. | No default-on implementation exists. |

## Stop And Escalate Conditions

- Default-on drift or production-default claim.
- Any diagnostics output becomes runtime, prompt, model-message, provider-ordering, memory, or persistence authority.
- Raw or secret-like value appears in diagnostics, presentation, replay, logs, stored artifacts, or public docs.
- Untrusted refs are included.
- Renderer direct IPC/Gateway call or renderer-owned transport switching appears.
- Gateway/Main/host-api/api-client/provider transport changes occur without comms validation.
- Provider ordering or default registration changes.
- Memory promotion, fact acceptance, episode write, or durable fact persistence appears.
- New database, sidecar, cache, exporter, listener, service, daemon, or server appears.
- Rollback fails to restore disabled/default behavior.

## Operator Notes

Production operators should treat Line C as diagnostics evidence only until a later accepted spec says otherwise. Passing tests or replay is not enough to imply default-on approval.
