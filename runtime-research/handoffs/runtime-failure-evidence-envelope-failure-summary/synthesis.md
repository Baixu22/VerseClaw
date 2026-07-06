# Synthesis

Status: phase_2_diagnostics_only.

## Decision

Phase 2 accepts a diagnostics-only Runtime Evidence Envelope adapter for failure summaries. It wraps Phase 1 sanitized `FailureEvent` values in Phase 0 `EvidenceEnvelope` values, validates the input with `validateFailureEvent`, validates the output with `validateEvidenceEnvelope`, and keeps the envelope non-authoritative.

## Accepted Shape

- Input includes a `FailureEvent` plus envelope source, scope, TTL, and provenance metadata.
- Input failure events must pass `validateFailureEvent`.
- Output is always a `failure_summary` `EvidenceEnvelope` with `authority: 'none'`.
- Output uses `rawRetained: false` at the top level and in redaction metadata.
- Payload includes only sanitized summary text, bounded classification metadata, and bounded refs.
- Payload excludes raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.
- The runtime-core export is additive only.

## Stop Line Preserved

This phase does not claim active runtime readiness. It does not wire envelopes into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, tool blocking, checkpoint/lifecycle state, services, daemons, listeners, databases, exporters, or schedulers.

## Next Recommended Spec

A future spec may choose either deterministic replay envelope capture or a prompt-slot design proof, but it must stay read-only/default-off until it proves boundary safety. Active runtime consumption remains out of scope for this phase.
