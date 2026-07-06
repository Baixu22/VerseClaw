# Synthesis

Status: phase_3_diagnostics_only.

## Decision

Phase 3 accepts a local/dev/test-only deterministic replay harness core backed by explicit fixtures. The core validates `ReplayCase` input, rejects live-provider/default fixture paths, generates or validates `FailureEvent` values, records evidence envelope decisions with authority fixed to `none`, and returns a bounded diagnostics-only report.

## Accepted Shape

- Input is a `ReplayCase` plus explicit provider, tool, and workspace fixtures.
- The first fixture corpus covers `success`, `tool_error`, `test_failure`, `provider_timeout`, and `dirty_workspace`.
- Reports include sanitized replay metadata, fixture refs, terminal status, failure events, evidence decisions, and touched path summaries.
- Reports exclude raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.
- Repeated fixture runs are deterministic.
- The runtime-core export is additive only.

## Stop Line Preserved

This phase does not claim active runtime readiness. It does not wire replay into TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, tool blocking, checkpoint/lifecycle state, services, daemons, listeners, databases, exporters, or schedulers.

## Next Recommended Spec

A future task outcome scorecard spec may consume replay reports as evaluation metadata only. Active runtime behavior, task completion proof, prompt injection, or governance blocking still require separate accepted specs and replay-backed validation.
