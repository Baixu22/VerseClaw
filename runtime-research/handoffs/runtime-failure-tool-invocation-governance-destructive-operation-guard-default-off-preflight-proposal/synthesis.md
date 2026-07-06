# Synthesis

Status: default_off_preflight_proposal_only_not_active_runtime_ready.

## Decision

Phase B creates a default-off preflight proposal for the `destructive_operation_guard` line. The result is design-only. It records the future flag, owner boundary, rollback semantics, false-block corpus, future active trigger gate, and Phase C boundary scan plan.

This phase does not approve active runtime readiness.

## Accepted Proposal Shape

- Candidate scope is exactly `destructive_operation_guard`.
- The only future active owner is mutation-capable tool invocation preflight owned by tool execution.
- The future flag is `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
- The future flag is disabled unless explicitly set to boolean `true`.
- Flag-off rollback must restore legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, workspace cleanup, or user-facing state cleanup.
- `block` remains Phase 5 future candidate metadata only until a later accepted implementation spec.
- Deleted touched-path metadata alone is not an active trigger.
- Broad shell command pattern blocking is not allowed.

## Future Trigger Gate

A later active implementation spec may propose a candidate block only if all of these signals are present at the same time:

- explicit default-off flag enabled
- mutation-capable tool invocation preflight owner
- deleted touched-path metadata
- failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata
- Phase 5 finding with `futureActiveCandidate.action = "block"`
- `requiresAcceptedSpec = true`
- false-block corpus still passing

## False-Block Corpus

The future active line must preserve non-blocking behavior for:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched path
- legitimate fixture mutation
- slow test command
- known dev-server-like long-running metadata

## Phase C Follow-Up

The next legal phase is Phase C: Boundary Scan And Import Contract. Phase C must prove that only a future accepted mutation-capable tool invocation preflight owner can consume active guard code.

The denied roots must include TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services, and renderer code.

## Stop Line Preserved

No active guard, active runtime consumer, active import, TaskLoop decision, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, tool-blocking behavior, checkpoint/lifecycle authority write, live provider read, real tool mutation, real workspace mutation, raw payload persistence, service, daemon, listener, server, database, exporter, or scheduler is introduced.
