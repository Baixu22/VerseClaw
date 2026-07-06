# Runtime Failure Evidence Envelope Failure Summary

Status: phase_2_diagnostics_only.

This handoff records the Phase 2 implementation of Runtime Evidence Envelope failure summaries as an inert adapter. The adapter accepts an already-validated Phase 1 `FailureEvent`, wraps only sanitized summary/classification/ref metadata in a Phase 0 `EvidenceEnvelope`, and validates the envelope with `validateEvidenceEnvelope`.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md` | Follow-up task spec, ownership, tests, rollback, and hard stop lines. |
| `openclaw_runtime/src/runtime-core/failure-evidence-envelope-summary.ts` | Diagnostics-only adapter from `FailureEvent` to `EvidenceEnvelope`. |
| `tests/unit/runtime-failure-evidence-envelope-failure-summary.test.ts` | Focused proof for acceptance, fail-closed rejection, sanitization, validation, and no active consumer. |
| `validation-plan.md` | Phase 2 validation commands and boundary scans. |
| `synthesis.md` | Phase 2 outcome and next recommended step. |

## Scope

- Wrap sanitized passive failure summaries in `failure_summary` evidence envelopes.
- Keep `authority: 'none'` and `rawRetained: false`.
- Require source, scope, TTL, confidence, redaction, and provenance metadata.
- Sanitize and bound payload summary, classification metadata, and refs.
- Additive runtime-core export only.

## Stop Lines

- Do not wire envelopes into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking.
- Do not persist raw prompt, provider payload, tool args/results, secret, env dump, or unredacted workspace content.
- Do not write evidence envelopes into checkpoint or lifecycle authority state.
- Do not add services, daemons, listeners, servers, databases, exporters, or schedulers.
- Do not treat classifier, evidence, replay, or scorecard output as task completion proof.
- Do not let envelope authority exceed `none`.

## Status Vocabulary

- `phase_2_diagnostics_only`: adapter exists, validates, and has no active runtime consumer.
- `ready_for_replay_or_prompt_slot_design`: Phase 2 tests and boundary scans pass; future specs may design a read-only consumer.
- `needs_follow_up`: coverage, sanitization, or boundary proof is incomplete.
- `blocked`: a hard stop line fired.
