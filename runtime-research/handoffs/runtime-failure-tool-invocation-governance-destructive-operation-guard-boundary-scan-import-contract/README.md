# Runtime Failure Tool Invocation Governance Destructive Operation Guard Boundary Scan Import Contract

Status: boundary_import_contract_only_not_active_runtime_ready.

This handoff records Phase C of the `destructive_operation_guard` roadmap. It defines the bounded allow/deny import contract that a later implementation phase must satisfy before any active guard code may be consumed.

It does not implement an active guard, add a runtime consumer, connect to TaskLoop, change provider transport or Gateway payloads, change prompt/model-message assembly, alter retry/approval/rollback/completion behavior, block tools, read live providers, execute real tools, mutate the real workspace, or write governance/proof metadata into checkpoint or lifecycle authority state.

## Artifact Map

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-boundary-scan-import-contract.md` | Phase C task spec, ownership, allow/deny roots, bounded scan contract, validation, rollback, and stop lines. |
| `validation-plan.md` | Required harness commands and bounded manual import scan commands. |
| `synthesis.md` | Phase C outcome and next-step requirements before any default-off pilot implementation. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md` | Parent governance decision record for this boundary-contract phase. |
| `runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md` | Parent synthesis update preserving the no-active-readiness stop line. |

## Scope

- Define the only allowed future active consumer as a later accepted mutation-capable tool invocation preflight owner.
- Define denied roots for active guard imports and active decision ownership.
- Keep replay, scorecard, governance advisory, and evidence proof code as evidence producers only.
- Define bounded scan inputs, candidate names, and denied path groups for future automated tests.
- Preserve the Phase B default-off flag and rollback contract.

## Allowed Future Consumer

Only a later accepted mutation-capable tool invocation preflight owner may consume active guard code. Phase C does not name or create the concrete active module; Phase D must do that in its own accepted spec if it proceeds.

## Denied Roots

Denied roots include:

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

## Evidence Producer Boundary

Replay reports, scorecards, governance reports, advisory findings, evidence envelopes, failure events, and evidence proof reports remain diagnostics/evaluation evidence. They are not active decision owners and cannot be treated as completion proof.

## Status Vocabulary

- `boundary_import_contract_only_not_active_runtime_ready`: allow/deny import contract exists, but runtime integration is not approved.
- `ready_for_default_off_preflight_pilot_spec`: Phase C is complete and a later Phase D spec may request a default-off pilot only if it preserves the contract.
- `blocked`: a hard stop line fired, such as needing TaskLoop/provider/Gateway/prompt ownership or being unable to prove exclusive preflight ownership.
