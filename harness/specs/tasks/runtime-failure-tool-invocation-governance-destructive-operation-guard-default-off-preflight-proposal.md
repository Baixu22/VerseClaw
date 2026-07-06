---
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Default-Off Preflight Proposal
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a proposal/design-only spec and handoff for a future default-off `destructive_operation_guard` mutation-capable tool invocation preflight owner, without implementing an active guard or changing tool-blocking behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
expectedUserBehavior:
  - Runtime behavior is unchanged.
  - No active runtime consumer is added for `destructive_operation_guard`, governance reports, evidence proof reports, or future active candidate metadata.
  - TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking remain unchanged.
  - `block` remains future candidate metadata only; it is not a current runtime decision, not default behavior, and not completion proof.
  - The proposal is design-only and records the exact prerequisites a later accepted implementation spec would need before any pilot.
  - The only future active owner considered by this proposal is mutation-capable tool invocation preflight owned by the tool execution layer.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
  - workspace-harness-single-source
featureFlags:
  - This phase does not add or read a runtime feature flag.
  - A later accepted implementation spec must use an explicit default-off flag named `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` before any active guard can affect tool behavior.
  - The flag is disabled when omitted or set to any value other than explicit boolean `true`.
  - Flag-off behavior must skip the future guard before it can block, ask, retry, roll back, mutate state, emit authority-bearing decisions, or read active runtime state for a guard decision.
rollback:
  - Delete this proposal task spec and the default-off-preflight-proposal handoff package.
  - Remove the default-off preflight proposal entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing rollback is required because this phase writes docs/spec material only.
  - A future implementation rollback must be disabling `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` or deleting the pilot, restoring legacy tool behavior without migration or state cleanup.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md
acceptance:
  - The new spec has complete harness metadata, intent, owned paths, touched areas, expected user behavior, required rules, feature flag notes, rollback, required tests, acceptance, forbidden patterns, and docs references.
  - The handoff package records default-off preflight proposal scope, validation plan, and synthesis.
  - The proposal explicitly states that it is design-only and not active runtime readiness.
  - The future active owner boundary is mutation-capable tool invocation preflight owned by tool execution; TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron services, and renderer code cannot own the active decision.
  - The future flag is explicitly default-off as `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`; omitted or non-true values preserve legacy tool behavior.
  - Flag-off rollback semantics require restoring legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, workspace cleanup, provider cleanup, or Gateway cleanup.
  - The false-block corpus is explicitly preserved for expected edit, expected deletion, normal completed repair, completed test repair, sanitized or inconclusive touched path, legitimate fixture mutation, slow test command, and known dev-server-like long-running metadata.
  - The Phase C boundary/import scan plan is explicit and proves only a future accepted mutation-capable tool invocation preflight owner may consume active guard code.
  - A future active trigger requires all of these signals at the same time: explicit default-off flag enabled, mutation-capable tool invocation preflight owner, deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, Phase 5 finding with `futureActiveCandidate.action = "block"`, `requiresAcceptedSpec = true`, and the false-block corpus still passing.
  - Deleted path metadata alone, broad shell command patterns, replay reports, scorecards, governance reports, evidence proof reports, and `futureActiveCandidate` metadata alone are not active triggers.
  - This phase does not implement an active guard, add imports, wire active runtime paths, read live providers, execute tools, mutate the real workspace, persist raw payloads, or change runtime behavior.
forbiddenPatterns:
  - implementing an active guard, active runtime consumer, TaskLoop consumer, provider consumer, Gateway consumer, prompt/model-message consumer, retry consumer, approval consumer, rollback consumer, completion consumer, or tool-blocking consumer
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, or tool-blocking behavior
  - adding imports or wiring from active runtime paths to advisory, scorecard, replay, or evidence proof helpers
  - treating `block` as a current runtime decision, default behavior, completion proof, or active tool block
  - using deleted touched-path metadata alone, broad shell command patterns, slow command metadata alone, or known dev-server-like long-running metadata as an active trigger
  - writing replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, proposal docs, or evidence proof reports into checkpoint or lifecycle authority state
  - reading live providers, executing real tool mutation, modifying the real workspace, scanning unbounded workspace content, or using live provider/tool data as proposal proof
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, unredacted workspace content, or raw provider/tool evidence
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
  - treating governance reports, replay reports, scorecards, evidence, failure events, evidence proof output, or this proposal package as task completion proof
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Default-Off Preflight Proposal

This Phase B package is proposal/design only. It defines the future owner, flag, rollback semantics, false-block corpus, and Phase C boundary scan plan for a possible later `destructive_operation_guard` pilot.

It does not implement an active guard, add a runtime consumer, connect to TaskLoop, change provider transport or Gateway payloads, change prompt/model-message assembly, alter retry/approval/rollback/completion behavior, block tools, read live providers, execute real tools, mutate the real workspace, or write governance/proof metadata into checkpoint or lifecycle authority state.

## Future Owner Boundary

The only future active owner allowed by this proposal is mutation-capable tool invocation preflight owned by the tool execution layer. The preflight boundary is the last narrow point before a tool invocation can mutate files or runtime state.

TaskLoop may not own the decision. Provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services, and renderer code may not own or directly consume the active decision.

## Future Flag

A later accepted implementation spec must define `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled`.

The flag is default-off:

- omitted means disabled
- `false` means disabled
- any non-boolean-true value means disabled
- only explicit boolean `true` may enable the future preflight pilot

When disabled, legacy tool behavior must be restored without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, workspace cleanup, or user-facing state cleanup. Disabling the flag must skip the future guard before it can block, ask, retry, roll back, mutate state, emit authority-bearing decisions, or read active runtime state for a guard decision.

## Future Trigger Boundary

A future active trigger is not allowed unless all of these signals are true at the same time:

- explicit default-off flag enabled
- mutation-capable tool invocation preflight is the owner
- deleted touched-path metadata exists
- `wrong_file_edit` or `unnecessary_edit` scorecard metadata is failing
- Phase 5 finding includes `futureActiveCandidate.action = "block"`
- the same candidate includes `requiresAcceptedSpec = true`
- the false-block corpus still passes

Deleted touched-path metadata alone is not enough. Phase 5 future candidate metadata alone is not enough. Broad shell command pattern blocking is not allowed.

## False-Block Corpus

Future specs must keep these cases non-blocking:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched path
- legitimate fixture mutation
- slow test command
- known dev-server-like long-running metadata

Expected deletion remains a required false-block case because it can contain deleted touched-path metadata or Phase 5 future candidate metadata while still representing correct task behavior.

## Phase C Boundary Scan Plan

Phase C must prove the import/consumer boundary before any implementation phase can begin.

The scan plan must:

- allow active guard consumption only from a later accepted mutation-capable tool invocation preflight owner
- deny consumption from TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services, and renderer code
- deny checkpoint/lifecycle authority writes for replay reports, scorecards, governance reports, evidence proof reports, failure events, evidence envelopes, proposal reports, and future guard decisions unless a later accepted spec separately creates a narrow non-authority diagnostic surface
- remain synthetic, fixture-owned, local/dev/test-only, and bounded

## Stop Line

This proposal does not approve active runtime readiness. It only defines the minimum design contract a later boundary scan must prove before a separate implementation spec can request a default-off preflight pilot.
