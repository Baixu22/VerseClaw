# Runtime Failure Intelligence Passive Shadow

Status: phase_1_passive_shadow.

This handoff records the Phase 1 implementation of Runtime Failure Intelligence as a passive classifier. The classifier converts bounded failure signals into Phase 0 `FailureEvent` objects and validates them with `validateFailureEvent`.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md` | Follow-up task spec, ownership, tests, rollback, and hard stop lines. |
| `openclaw_runtime/src/runtime-core/failure-intelligence-passive-shadow.ts` | Passive classifier input/output types and implementation. |
| `tests/unit/runtime-failure-intelligence-passive-shadow.test.ts` | Focused proof for classification, sanitization, fallback, validation, and no active consumer. |
| `validation-plan.md` | Phase 1 validation commands and boundary scans. |
| `synthesis.md` | Phase 1 outcome and next recommended step. |

## Scope

- Passive failure classification.
- Typed classifier input and `FailureEvent` output.
- Sanitized bounded summaries.
- Stable unknown fallback.
- Advisory-only `suggestedAction`.
- Additive runtime-core export.

## Stop Lines

- Do not wire classifier output into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not persist raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content.
- Do not write failure events into checkpoint or lifecycle authority state.
- Do not add services, daemons, listeners, servers, databases, exporters, or schedulers.
- Do not treat classifier, evidence, replay, or scorecard output as task completion proof.

## Status Vocabulary

- `phase_1_passive_shadow`: classifier exists, validates, and has no active runtime consumer.
- `ready_for_evidence_envelope_failure_summary`: Phase 1 tests and boundary scans pass; a future spec may wrap failure summaries in evidence envelopes.
- `needs_follow_up`: coverage, sanitization, or boundary proof is incomplete.
- `blocked`: a hard stop line fired.

