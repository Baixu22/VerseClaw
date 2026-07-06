# Synthesis

Status: design_readiness_only_not_active_runtime_ready.

## Decision

The next limited active guard design target is restricted to `destructive_operation_guard`. This phase records the evidence conditions and owner boundary that a later implementation spec must satisfy before any active behavior can be proposed.

This phase does not approve active runtime readiness.

## Accepted Design Shape

- Candidate scope is exactly `destructive_operation_guard`.
- Phase 5 advisory reports remain diagnostics-only and advisory-only with `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
- `futureActiveCandidate.action: "block"` remains metadata requiring a future accepted spec; it is not a current runtime decision.
- Future trigger evidence must come from sanitized Phase 5 advisory report metadata, replay provenance, scorecard provenance, failure refs, evidence refs, and touched-path refs.
- Future false-block evidence must include expected edits, normal repair, completed test repair, sanitized/inconclusive path metadata, and legitimate fixture mutation.
- Slow tests and known dev-server-like long-running commands must be explicitly protected from destructive-operation blocking.
- Future rollback must include an explicit disable flag that restores legacy tool behavior without migration or state cleanup.

## Owner Boundary

If a later implementation spec proposes active behavior, the active decision owner must be mutation-capable tool invocation preflight owned by tool execution. TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory report generation, retry, approval, rollback, and completion paths must not become the owner.

No import or wiring is added by this design package.

## Stop Line Preserved

No TaskLoop decision, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking behavior changes in this phase.

No replay report, scorecard, governance report, governance diagnostics, failure event, evidence envelope, or readiness report may be written into checkpoint or lifecycle authority state.

No live provider read, real tool mutation, real workspace mutation, raw prompt/provider/tool/secret/env/workspace persistence, service, daemon, listener, server, database, exporter, or scheduler is introduced.

## Follow-Up

A later implementation spec may request an active guard only after it supplies replay/scorecard proof, false-block analysis, flag-disable rollback proof, and boundary scans. Until then, `destructive_operation_guard` remains advisory diagnostics only.
