---
id: runtime-failure-task-outcome-scorecard-replay-reports
title: Runtime Failure Task Outcome Scorecard Replay Reports
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement a local/dev/test-only task outcome scorecard core that consumes Phase 3 diagnostics-only RuntimeFailureReplayReport values as evaluation metadata, without active runtime consumers or task completion authority.
ownedPaths:
  - harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md
  - runtime-research/handoffs/runtime-failure-task-outcome-scorecard-replay-reports/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/schema-decision-log.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/synthesis.md
  - openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/runtime-failure-task-outcome-scorecard-replay-reports.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md
  - runtime-research/handoffs/runtime-failure-task-outcome-scorecard-replay-reports/**
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
expectedUserBehavior:
  - Runtime behavior is unchanged when this slice is present.
  - The scorecard core is inert unless a test or future accepted spec explicitly imports and invokes it.
  - Scorecards consume only Phase 3 diagnostics-only replay reports as evaluation metadata.
  - Scorecards are not task completion proof and do not gate retry, approval, rollback, completion, prompt, provider, Gateway, or tool-blocking behavior.
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
  - `runtime.outcomeScorecard.replayReports` is a contract statement only in this slice; no active runtime path reads it.
  - Omitted or disabled flags leave legacy runtime behavior unchanged because no runtime consumer is wired.
rollback:
  - Delete the scorecard core, additive barrel export, focused unit test, task spec, and Phase 4 handoff package.
  - Remove the Phase 4 entries from the parent schema decision log and synthesis.
  - No migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, workspace cleanup, or user-facing rollback is required because scorecards do not write runtime state.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-task-outcome-scorecard-replay-reports.md
  - pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-task-outcome-scorecard-replay-reports.test.ts
acceptance:
  - The scorecard input is a Phase 3 `RuntimeFailureReplayReport`.
  - Input reports must have `diagnosticsOnly: true`, `completionProof: false`, replay metadata, failure/evidence/touched-path provenance, JSON-serializable payloads, and bounded size.
  - Scorecard output is deterministic, JSON-serializable, bounded, diagnostics-only, evaluation metadata only, and has `authority: 'none'`.
  - The first metric set covers task completed, wrong-file edit, unnecessary edit, retry correctness, ask-user appropriateness, and test recovery success.
  - Every nontrivial metric and aggregate decision preserves replay, failure, evidence, or touched-path provenance refs.
  - Aggregate decisions are stable and limited to `improved`, `regressed`, `neutral`, and `inconclusive`.
  - Scorecards exclude raw prompts, provider payloads, tool args/results, secrets, env dumps, and unredacted workspace content.
  - Missing replay metadata, missing provenance, oversized report/scorecard, non-JSON payload, `completionProof: true`, and `diagnosticsOnly: false` fail closed.
  - No TaskLoop, provider transport, Gateway payload, prompt/model-message assembly, retry, approval, rollback, completion, tool-blocking, checkpoint, lifecycle, service, daemon, listener, server, database, exporter, or scheduler consumer is introduced.
forbiddenPatterns:
  - changing TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, or tool blocking behavior
  - importing the scorecard core from active runtime paths
  - reading live providers, executing real tools, or mutating the real workspace
  - adding services, daemons, listeners, HTTP servers, WebSocket servers, databases, exporters, schedulers, or always-on sidecars
  - persisting raw prompts, provider payloads, tool args/results, secrets, environment dumps, or unredacted workspace content
  - writing replay reports, scorecards, failure events, or evidence envelopes into checkpoint or lifecycle authority state
  - treating replay reports, scorecards, evidence, or failure events as task completion proof
  - allowing scorecard authority above `none`
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure Task Outcome Scorecard Replay Reports

This Phase 4 slice implements a deterministic task outcome scorecard core for local/dev/test use only.

The scorecard accepts a Phase 3 `RuntimeFailureReplayReport` and returns bounded diagnostics-only evaluation metadata. It does not read live providers, execute tools, mutate workspaces, persist artifacts, gate runtime decisions, or prove task completion.

## Pre-Code Answers

1. This slice is diagnostics-only and inert unless explicitly imported by tests or a future accepted spec.
2. TaskLoop decisions, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, and tool blocking are unchanged.
3. The only input is a sanitized Phase 3 replay report with `diagnosticsOnly: true` and `completionProof: false`.
4. Scorecards are evaluation metadata only and keep `authority: 'none'`.
5. Validation fails closed on missing replay metadata, missing provenance, oversized input/output, non-JSON payloads, `completionProof: true`, and `diagnosticsOnly: false`.
6. Metrics cite replay/failure/evidence/touched-path provenance and do not retain raw prompt/provider/tool/secret/env/workspace data.
7. Rollback is proven by deleting the scorecard core, additive export, test, spec, and handoff docs with no migration.
8. Promotion stops if the scorecard is wired into active runtime behavior, task completion proof, checkpoint/lifecycle state, or authority above `none`.

## Scope

- Add `openclaw_runtime/src/runtime-core/failure-task-outcome-scorecard.ts`.
- Add an additive runtime-core barrel export.
- Add focused unit tests for five replay fixture reports, determinism, bounded JSON output, provenance, aggregate decisions, fail-closed behavior, sanitization, and no active consumer.
- Add this spec and Phase 4 handoff docs.
- Update the parent governance decision log and synthesis.

## Non-Goals

- No active runtime behavior change.
- No prompt, provider, Gateway, TaskLoop, retry, approval, rollback, completion, or tool-blocking changes.
- No raw evidence persistence or checkpoint/lifecycle authority state writes.
- No services, daemons, listeners, servers, databases, exporters, or schedulers.
