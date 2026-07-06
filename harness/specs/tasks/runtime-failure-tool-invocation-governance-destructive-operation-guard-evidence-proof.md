---
id: runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof
title: Runtime Failure Tool Invocation Governance Destructive Operation Guard Evidence Proof
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a replay/scorecard/governance evidence proof and false-block corpus for the Phase 5 `destructive_operation_guard` candidate, without adding an active runtime consumer or changing tool-blocking behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.ts
  - tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - Runtime behavior is unchanged.
  - The evidence proof helper is pure in-memory runtime-core metadata and is imported only by focused tests in this phase.
  - TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking remain unchanged.
  - `block` remains Phase 5 future-candidate metadata only; this phase does not make it default behavior.
  - The proof evaluates only `destructive_operation_guard`.
  - Replay reports, scorecards, governance reports, and evidence proof output remain diagnostics/evaluation metadata and are not task completion proof.
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
  - No runtime feature flag is added in this evidence-proof phase.
  - A future active implementation spec must define an explicit disable flag before `destructive_operation_guard` can affect tool behavior.
  - Disabling that future flag must restore legacy tool behavior without migrations, checkpoint cleanup, lifecycle cleanup, workspace cleanup, provider cleanup, or Gateway cleanup.
rollback:
  - Delete this task spec, the evidence-proof handoff package, the runtime-core evidence proof helper, and the focused unit test.
  - Remove the evidence-proof entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, TaskLoop cleanup, workspace cleanup, or user-facing rollback is required because the phase writes no runtime state.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof.test.ts
acceptance:
  - The new spec has complete harness metadata, docs references, expected behavior, feature flag notes, rollback, required tests, acceptance, and forbidden patterns.
  - The handoff package records evidence proof scope, validation plan, and synthesis.
  - The runtime-core helper consumes only synthetic/fixture-owned Phase 3 replay report metadata and Phase 4 scorecard metadata, derives Phase 5 advisory findings in-memory, and emits diagnostics-only evaluation metadata.
  - The evidence-qualified positive trigger requires deleted touched-path metadata, failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata, and a Phase 5 advisory finding with `futureActiveCandidate.action: "block"` plus `requiresAcceptedSpec: true`.
  - The false-block corpus covers expected edits, expected deletions, normal completed repairs, completed test repairs, sanitized or inconclusive touched-path metadata, legitimate fixture mutation, slow test command metadata, and known dev-server-like long-running metadata.
  - Proof output preserves replay id/scenario/terminal status, scorecard aggregate decision, `wrong_file_edit` and `unnecessary_edit` metric refs, failure refs, evidence refs, and touched-path refs.
  - Proof output remains diagnostics-only, evaluation metadata only, `authority: 'none'`, `governanceDecisionAuthority: 'none'`, `activeBlocking: false`, and `completionProof: false`.
  - Proof output excludes raw prompts, provider payloads, tool args/results, secrets, environment dumps, and unredacted workspace content.
  - Readiness metadata records the future flag-disable rollback requirement, future owner boundary as tool invocation preflight, and an active-consumer boundary scan plan.
  - This phase explicitly remains not active runtime readiness.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, tool-blocking, checkpoint/lifecycle, service, daemon, listener, server, database, exporter, scheduler, or active runtime consumer is introduced.
forbiddenPatterns:
  - implementing an active guard, active runtime consumer, TaskLoop consumer, provider consumer, Gateway consumer, prompt/model-message consumer, retry consumer, approval consumer, rollback consumer, completion consumer, or tool-blocking consumer
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry behavior, approval behavior, rollback behavior, completion behavior, or tool-blocking behavior
  - treating `block` as a current runtime decision, default behavior, completion proof, or active tool block
  - writing replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, or evidence proof reports into checkpoint or lifecycle authority state
  - reading live providers, executing real tool mutation, modifying the real workspace, scanning unbounded workspace content, or using live provider/tool data as proof
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, unredacted workspace content, or raw provider/tool evidence
  - adding a service, daemon, listener, HTTP server, WebSocket server, database, exporter, scheduler, always-on sidecar, second Gateway, second runtime, or external transport
  - treating governance reports, replay reports, scorecards, evidence, failure events, evidence proof output, or this handoff package as task completion proof
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-destructive-operation-guard-evidence-proof/synthesis.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Destructive Operation Guard Evidence Proof

This phase implements a proof report and false-block corpus for the single Phase 5 candidate `destructive_operation_guard`.

The proof is intentionally diagnostics-only. It does not implement an active guard, add a runtime consumer, connect to TaskLoop, change provider transport or Gateway payloads, change prompt/model-message assembly, alter retry/approval/rollback/completion behavior, block tools, or write governance diagnostics into checkpoint/lifecycle authority state.

## Evidence-Qualified Trigger

The proof treats a destructive-operation trigger as evidence-qualified only when all of these metadata signals are present:

- deleted touched-path metadata from a fixture-owned replay report
- failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata
- Phase 5 `destructive_operation_guard` advisory finding with `futureActiveCandidate.action: "block"` and `requiresAcceptedSpec: true`

This is stricter than observing a Phase 5 future candidate alone. Expected deletion fixtures can therefore prove false-block protection when edit metrics pass.

## False-Block Corpus

The focused test covers:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched-path metadata
- legitimate fixture mutation
- slow test command metadata
- known dev-server-like long-running metadata

Every case is fixture-owned or synthetic in-memory metadata. No live provider is read and no real tool mutation or real workspace mutation is executed.

## Stop Line

The result can say that evidence conditions are met for a future default-off implementation spec to propose `destructive_operation_guard`. It cannot claim active runtime readiness, current blocking authority, task completion proof, or default tool blocking.
