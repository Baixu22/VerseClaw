# Synthesis

Status: phase_4_evaluation_metadata_only.

## Decision

Phase 4 accepts a local/dev/test-only task outcome scorecard core that consumes Phase 3 diagnostics-only replay reports. Scorecards are deterministic, bounded, JSON-serializable evaluation metadata and keep `authority: 'none'`.

## Accepted Shape

- Input is a Phase 3 `RuntimeFailureReplayReport`.
- Input must be diagnostics-only and must not be completion proof.
- Metrics cover task completed, wrong-file edit, unnecessary edit, retry correctness, ask-user appropriateness, and test recovery success.
- Metrics and aggregate decisions preserve replay/failure/evidence/touched-path provenance refs.
- Aggregate decisions are limited to `improved`, `regressed`, `neutral`, and `inconclusive`.
- Scorecards exclude raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.
- The runtime-core export is additive only.

## Stop Line Preserved

This phase does not claim active runtime readiness. It does not wire scorecards into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, tool blocking, checkpoint/lifecycle state, services, daemons, listeners, databases, exporters, or schedulers.

## Next Recommended Spec

A future tool invocation governance advisory spec may consume replay reports and scorecards as evaluation metadata only. Active runtime behavior, task completion proof, prompt injection, or tool blocking still require separate accepted specs and replay/scorecard-backed validation.
