# Synthesis

Status: phase_1_passive_shadow.

## Decision

Phase 1 accepts a passive Runtime Failure Intelligence classifier as an inert runtime-core utility. It emits Phase 0 `FailureEvent` objects, validates them with `validateFailureEvent`, bounds and sanitizes summaries, and keeps `suggestedAction` advisory-only.

## Accepted Shape

- Input includes `id`, `source`, `occurredAt`, `signal`, optional `runId`, optional `evidenceRefs`, and optional bounded message/status metadata.
- Output is always a `FailureEvent` with `rawRetained: false` and redaction `sanitized`.
- Classification covers all Phase 0 stages and kinds, including stable `unknown` fallback.
- Summary text is bounded and redacts secret-like values, env-style dumps, absolute workspace paths, and structured payload snippets.
- The runtime-core export is additive only.

## Stop Line Preserved

This phase does not claim active runtime readiness. It does not wire classifier output into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, tool blocking, checkpoint/lifecycle state, services, daemons, listeners, databases, exporters, or schedulers.

## Next Recommended Spec

`runtime-failure-evidence-envelope-failure-summary`

Scope should be limited to wrapping already-sanitized passive failure summaries in `EvidenceEnvelope` values with authority `none`, fail-closed validation, and no prompt or TaskLoop consumer.

