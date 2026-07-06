# Runtime Failure Tool Invocation Governance Destructive Operation Guard Default-Off Preflight Proposal

Status: default_off_preflight_proposal_only_not_active_runtime_ready.

This handoff records Phase B of the `destructive_operation_guard` roadmap. It is a proposal/design-only package for a possible future default-off mutation-capable tool invocation preflight owner.

It does not implement an active guard, add a runtime consumer, connect to TaskLoop, change provider transport or Gateway payloads, change prompt/model-message assembly, alter retry/approval/rollback/completion behavior, block tools, read live providers, execute real tools, mutate the real workspace, or write governance/proof metadata into checkpoint or lifecycle authority state.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md` | Proposal task spec, ownership, feature flag semantics, rollback, false-block corpus, boundary plan, validation, and stop lines. |
| `validation-plan.md` | Required harness commands and Phase C boundary/import scan plan. |
| `synthesis.md` | Phase B outcome and next-step requirements before any active implementation can be considered. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md` | Parent governance decision record for this proposal-only phase. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md` | Parent synthesis update preserving the no-active-readiness stop line. |

## Scope

- Define the future owner boundary as mutation-capable tool invocation preflight owned by tool execution.
- Define the future explicit default-off flag as `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.
- Define disabled flag semantics: omitted, `false`, or any non-boolean-true value means disabled.
- Define rollback: flag-off must restore legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, workspace cleanup, or user-facing state cleanup.
- Preserve the false-block corpus from the evidence proof and add it as a required future implementation gate.
- Define the Phase C boundary/import scan plan before any active implementation phase.

## Future Trigger Contract

A future active trigger must require all of these signals at once:

- explicit default-off flag enabled
- mutation-capable tool invocation preflight owner
- deleted touched-path metadata
- failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata
- Phase 5 finding with `futureActiveCandidate.action = "block"`
- `requiresAcceptedSpec = true`
- false-block corpus still passing

Deleted touched-path metadata alone is never enough. Phase 5 future candidate metadata alone is never enough. Broad shell command pattern blocking is not allowed.

## False-Block Corpus

Future active specs must keep these cases non-blocking:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched path
- legitimate fixture mutation
- slow test command
- known dev-server-like long-running metadata

## Out Of Scope

- No active guard implementation.
- No active runtime consumer.
- No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, or tool-blocking behavior change.
- No import or wiring from active runtime paths to advisory, scorecard, replay, or evidence proof helpers.
- No checkpoint/lifecycle authority state writes.
- No live provider reads, real tool mutation, or real workspace mutation.
- No persistence of raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content.
- No services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars.

## Status Vocabulary

- `default_off_preflight_proposal_only_not_active_runtime_ready`: flag, owner, rollback, corpus, and boundary scan semantics are recorded, but runtime integration is not approved.
- `needs_phase_c_boundary_scan`: Phase B is complete and the next legal phase is boundary/import contract proof.
- `blocked`: a hard stop line fired, such as needing active runtime wiring or being unable to preserve preflight-only ownership.
