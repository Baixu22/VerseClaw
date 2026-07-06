# Synthesis

Status: boundary_import_contract_only_not_active_runtime_ready.

## Decision

Phase C creates the boundary/import contract for the `destructive_operation_guard` line. The result is design/proof-contract only. It records the allowed future owner, denied roots, bounded scan inputs, future automated scan requirements, and the evidence-producer boundary.

This phase does not approve active runtime readiness.

## Accepted Contract Shape

- Candidate scope is exactly `destructive_operation_guard`.
- The only future active consumer is a later accepted mutation-capable tool invocation preflight owner.
- The future concrete owner path must be named by Phase D before active code can be introduced.
- Replay, scorecard, governance advisory, and evidence proof code remain evidence producers, not active decision owners.
- `block` remains Phase 5 future candidate metadata only until a later accepted implementation spec.
- Deleted touched-path metadata alone is not an active trigger.
- Broad shell command pattern blocking is not allowed.

## Denied Roots

The import contract denies active guard consumption from:

- TaskLoop and agents orchestration
- provider transport and provider ordering
- Gateway payloads and Gateway server methods
- prompt/model-message assembly
- replay harness
- task outcome scorecard
- governance advisory generation
- evidence proof helpers
- retry, approval, rollback, and completion
- checkpoint and lifecycle authority state
- Electron main, services, IPC handlers, and preload
- renderer pages, components, stores, and lib surfaces
- scripts, exporters, daemons, services, listeners, databases, schedulers, and always-on sidecars

## Future Phase D Requirements

A later default-off preflight pilot implementation spec must:

- preserve `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` as explicit default-off
- name the concrete mutation-capable tool invocation preflight owner path
- add focused automated boundary scan tests
- prove no denied-root import or active consumer exists
- rerun the false-block corpus
- prove flag-off legacy behavior and rollback without migration or state cleanup
- keep replay, scorecard, governance, advisory, and evidence proof outputs as evidence metadata, not completion proof

## Current Bounded Scan Result

The Phase C bounded scan command was run over the explicit denied path groups from `validation-plan.md`.

Current matches are limited to the existing `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-advisory.ts` and `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.ts` diagnostics/evidence producer helpers from earlier accepted phases.

No TaskLoop, provider, Gateway, prompt/model-message, retry, approval, rollback, completion, checkpoint, lifecycle, Electron service, renderer, or script path matched as an active `destructive_operation_guard` consumer in this bounded scan.

## Stop Line Preserved

No active guard, active runtime consumer, active import, TaskLoop decision, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, tool-blocking behavior, checkpoint/lifecycle authority write, live provider read, real tool mutation, real workspace mutation, raw payload persistence, service, daemon, listener, server, database, exporter, or scheduler is introduced.
