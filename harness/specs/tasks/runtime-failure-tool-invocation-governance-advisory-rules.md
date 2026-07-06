---
id: runtime-failure-tool-invocation-governance-advisory-rules
title: Runtime Failure Tool Invocation Governance Advisory Rules
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a local/dev/test-only tool invocation governance advisory core that consumes Phase 3 replay reports and Phase 4 scorecards as diagnostics/evaluation metadata, without active runtime consumers or tool-blocking authority.
ownedPaths:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-advisory.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-tool-invocation-governance-advisory-rules.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
  - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - Runtime behavior is unchanged when this slice is present.
  - The governance core is inert unless a test or future accepted spec explicitly imports and invokes it.
  - Governance consumes only Phase 3 diagnostics-only `RuntimeFailureReplayReport` values and Phase 4 evaluation-only `RuntimeFailureTaskOutcomeScorecard` values.
  - Governance reports are advisory-only diagnostics metadata and do not gate retry, approval, rollback, completion, prompt, provider, Gateway, or tool-blocking behavior.
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
  - docs-sync
  - workspace-harness-single-source
featureFlags:
  - `runtime.toolGovernance.advisoryRules` is a contract statement only in this slice; no active runtime path reads it.
  - Omitted or disabled flags leave legacy runtime behavior unchanged because no runtime consumer is wired.
rollback:
  - Delete the advisory governance core, additive barrel export, focused unit test, task spec, and Phase 5 handoff package.
  - Remove the Phase 5 entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, workspace cleanup, or user-facing rollback is required because governance reports do not write runtime state.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-advisory-rules.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-tool-invocation-governance-advisory-rules.test.ts
acceptance:
  - The governance input is only a Phase 3 `RuntimeFailureReplayReport` plus a Phase 4 `RuntimeFailureTaskOutcomeScorecard`.
  - Inputs must have `diagnosticsOnly: true`, `completionProof: false`, evaluation metadata only, replay metadata, scorecard metadata, failure/evidence/touched-path provenance, JSON-serializable payloads, bounded size, and no active blocking authority.
  - Governance output is deterministic, JSON-serializable, bounded, diagnostics-only, evaluation metadata only, advisory-only, and has `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
  - First advisory rules cover destructive operation guard, repeated failure backoff, timeout classification, long-running process detection, shell/environment contamination detection, ask-user vs continue policy, and tool result provenance.
  - Every governance finding and aggregate recommendation preserves replay, scorecard, failure, evidence, or touched-path provenance refs.
  - Aggregate recommendations are stable and limited to `advisory_pass`, `advisory_warn`, `advisory_backoff`, `advisory_ask_user`, and `inconclusive`.
  - `block` appears only as a future active-spec candidate for narrow destructive-operation cases; it must not create runtime side effects or active tool blocking.
  - Governance reports exclude raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.
  - Missing replay metadata, missing scorecard metadata, missing provenance, oversized input/output, non-JSON payloads, `completionProof: true`, `diagnosticsOnly: false`, and `activeBlocking: true` fail closed.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, tool-blocking, checkpoint, lifecycle, service, daemon, listener, server, database, exporter, or scheduler consumer is introduced.
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking behavior
  - importing the governance core from active runtime paths
  - treating `block` as an active runtime decision in this phase
  - reading live providers, executing real tools, or mutating the real workspace
  - adding services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - writing replay reports, scorecards, governance reports, failure events, or evidence envelopes into checkpoint or lifecycle authority state
  - treating replay reports, scorecards, governance reports, evidence, or failure events as task completion proof
  - allowing governance authority above `none`
docs:
  required: true
  files:
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/README.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/validation-plan.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/synthesis.md
    - runtime-research/handoffs/runtime-failure-tool-invocation-governance-advisory-rules/limited-active-guard-design-prep.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
    - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
---

# Runtime Failure Tool Invocation Governance Advisory Rules

This Phase 5 slice implements deterministic advisory governance diagnostics for local/dev/test use only.

The governance core accepts a Phase 3 `RuntimeFailureReplayReport` and a Phase 4 `RuntimeFailureTaskOutcomeScorecard`. It returns bounded advisory-only evaluation metadata. It does not read live providers, execute tools, mutate workspaces, persist artifacts, gate runtime decisions, block tools, or prove task completion.

## Pre-Code Answers

1. This slice is diagnostics-only and inert unless explicitly imported by tests or a future accepted spec.
2. TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking are unchanged.
3. Inputs are Phase 3 replay reports and Phase 4 scorecards only; both must be diagnostics/evaluation metadata and not completion proof.
4. Governance reports are advisory-only and keep `authority: 'none'`, `governanceDecisionAuthority: 'none'`, and `activeBlocking: false`.
5. Validation fails closed on missing replay metadata, missing scorecard metadata, missing provenance, oversized input/output, non-JSON payloads, `completionProof: true`, `diagnosticsOnly: false`, and `activeBlocking: true`.
6. Findings cite replay/scorecard/failure/evidence/touched-path provenance and do not retain raw prompt/provider/tool/secret/env/workspace data.
7. Rollback is proven by deleting the governance core, additive export, test, spec, and handoff docs with no migration.
8. Promotion stops if governance diagnostics are wired into active runtime behavior, task completion proof, checkpoint/lifecycle state, or authority above `none`.

## Scope

- Add `openclaw_runtime/src/runtime-core/failure-tool-invocation-governance-advisory.ts`.
- Add an additive runtime-core barrel export.
- Add focused unit tests for five replay fixture reports plus scorecards, determinism, bounded JSON output, provenance, aggregate recommendations, fail-closed behavior, sanitization, and no active consumer.
- Add focused advisory rule cases for destructive operation detection, repeated failure backoff, timeout classification, long-running process detection, shell/environment contamination detection, ask-user policy, and tool result provenance.
- Add this spec and Phase 5 handoff docs.
- Update the parent governance decision log and synthesis.

## Non-Goals

- No active runtime behavior change.
- No prompt, provider, Gateway, TaskLoop, retry, approval, rollback, completion, or tool-blocking changes.
- No raw evidence persistence or checkpoint/lifecycle authority state writes.
- No services, daemons, listeners, servers, databases, exporters, or schedulers.
