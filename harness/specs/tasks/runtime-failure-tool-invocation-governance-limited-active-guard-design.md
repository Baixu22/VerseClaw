---
lifecycleStatus: archived
id: runtime-failure-tool-invocation-governance-limited-active-guard-design
title: Runtime Failure Tool Invocation Governance Limited Active Guard Design
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Create a design/readiness-only next-stage package for evaluating whether the single Phase 5 advisory candidate `destructive_operation_guard` has enough evidence shape for a future limited active guard, without introducing an active runtime consumer or tool-blocking behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-limited-active-guard-design/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-limited-active-guard-design/**
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-advisory.ts
  - tests/unit/runtime-failure-tool-invocation-governance-advisory-rules.test.ts
expectedUserBehavior:
  - Runtime behavior is unchanged.
  - No active runtime consumer is added for governance reports or future active candidate metadata.
  - TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking remain unchanged.
  - `block` remains Phase 5 future-candidate metadata only; it is not a current runtime decision and is not default behavior.
  - The only candidate rule evaluated by this design package is `destructive_operation_guard`.
  - Replay reports, scorecards, governance reports, and this readiness package remain diagnostics/evaluation metadata, not task completion proof.
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
  - No runtime feature flag is added in this design/readiness phase.
  - A future implementation spec must define an explicit disable flag for `destructive_operation_guard` before any active behavior is proposed.
  - Disabling that future flag must restore legacy tool behavior without migrations, checkpoint cleanup, lifecycle cleanup, workspace cleanup, or provider cleanup.
rollback:
  - Delete this task spec and the limited-active-guard-design handoff package.
  - Remove the limited active guard design entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing rollback is required because this phase writes design docs only.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md
acceptance:
  - The new spec has complete harness metadata, docs references, expected behavior, feature flag notes, rollback, required tests, acceptance, and forbidden patterns.
  - The handoff package records limited active guard design scope, validation plan, and synthesis.
  - The parent schema decision log records that this stage is design/readiness only and does not approve active runtime readiness.
  - The parent synthesis records the design result without claiming active guard runtime integration is ready.
  - Candidate evaluation is limited to `destructive_operation_guard`; no other Phase 5 rule is evaluated for active behavior in this phase.
  - Future active guard prerequisites require Phase 5 advisory report trigger metadata, replay and scorecard provenance, false-block cases, slow test and known dev-server false-positive protection, flag-disable rollback, and a boundary scan plan.
  - The proposed future owner boundary is a mutation-capable tool invocation preflight boundary owned by the tool execution layer, not TaskLoop, provider transport, Gateway, prompt assembly, replay, scorecard, or advisory report generation.
  - No imports, runtime wiring, services, daemons, listeners, servers, databases, exporters, schedulers, checkpoint/lifecycle writes, provider reads, live tool execution, or workspace mutation are added.
  - Governance reports remain `authority: 'none'`, `governanceDecisionAuthority: 'none'`, `activeBlocking: false`, diagnostics-only, evaluation metadata only, and not completion proof.
  - Raw prompt, provider payload, tool args/results, secrets, environment dumps, and unredacted workspace content remain forbidden from persistence and handoff output.
forbiddenPatterns:
  - implementing an active guard, active runtime consumer, TaskLoop consumer, provider consumer, Gateway consumer, prompt/model-message consumer, retry consumer, approval consumer, rollback consumer, completion consumer, or tool-blocking consumer
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, or tool-blocking behavior
  - adding imports or wiring from active runtime paths to `failure-tool-invocation-governance-advisory`
  - evaluating any candidate rule other than `destructive_operation_guard`
  - treating `block` as a current runtime decision, default behavior, completion proof, or active tool block
  - writing replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, or readiness reports into checkpoint or lifecycle authority state
  - reading live providers, executing real tool mutation, modifying the real workspace, scanning unbounded workspace content, or using live provider/tool data as design proof
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, unredacted workspace content, or raw provider/tool evidence
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
  - treating governance reports, replay reports, scorecards, evidence, failure events, or this design package as task completion proof
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Tool Invocation Governance Limited Active Guard Design

This next-stage package is design/readiness only. It evaluates the evidence shape needed before a future limited active guard could be proposed for `destructive_operation_guard`.

It does not implement an active runtime consumer, connect to TaskLoop, change provider transport or Gateway payloads, change prompt/model-message assembly, alter retry/approval/rollback/completion behavior, block tools, or write governance diagnostics into checkpoint/lifecycle authority state.

## Candidate

The only candidate in scope is `destructive_operation_guard`.

Phase 5 already emits a `destructive_operation_guard` advisory finding when sanitized replay metadata includes deleted touched-path summaries or scorecard edit metrics indicate risky/unnecessary mutation. The only `block` shape allowed by Phase 5 is `futureActiveCandidate.action: "block"` with `requiresAcceptedSpec: true`; the advisory report itself remains `activeBlocking: false`.

## Required Future Evidence

A future implementation spec may not propose active behavior until it records:

- Phase 5 advisory report trigger metadata for `destructive_operation_guard`, including finding id, rule id, advisory recommendation, `futureActiveCandidate`, and sanitized touched-path/scorecard refs.
- Replay and scorecard provenance for every trigger, including replay id/scenario/terminal status, scorecard decision, edit metrics, failure refs, evidence refs, and touched-path refs.
- False-block cases proving the guard does not block expected edits, completed test repair, normal fixture mutations, or inconclusive sanitized path metadata.
- Slow test and known dev-server false-positive protection so long-running commands are not treated as destructive operations.
- A flag-disable rollback path that restores legacy behavior without migration or state cleanup.
- A boundary scan plan proving only a future accepted tool invocation preflight owner could import the active guard.

## Future Owner Boundary

The future owner boundary, if accepted by a later implementation spec, must be the mutation-capable tool invocation preflight layer owned by tool execution. TaskLoop may not become the decision authority, and replay, scorecard, advisory report generation, provider transport, Gateway payloads, prompt assembly, retry, approval, rollback, and completion paths may not own the active decision.

This phase adds no import, no function call, no runtime wiring, and no active consumer.

## Stop Line

`block` is not a current runtime decision. The design result can only say which evidence must exist before a later spec is allowed to ask for active behavior.
