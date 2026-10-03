---
id: runtime-failure-evidence-replay-governance-readiness
title: Runtime Failure/Evidence/Replay Governance Readiness
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Persist the pre-implementation constraints, staged development plan, contracts, validation gates, and drift guards for Runtime Failure Intelligence, Runtime Evidence Envelope, Deterministic Replay Harness, Task Outcome Scorecard, and Tool Invocation Governance without changing runtime behavior.
ownedPaths:
  - harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - runtime-research/agent-runtime-index.md
touchedAreas:
  - harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
  - runtime-research/handoffs/runtime-failure-evidence-replay-governance-readiness/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/task-loop-context.ts
  - openclaw_runtime/src/gateway/**
  - electron/gateway/**
  - electron/services/**
  - shared/host-api/contract.ts
  - shared/host-events/contract.ts
  - tests/unit/**
  - tests/fixtures/runtime-replay/**
expectedUserBehavior:
  - This readiness task is documentation and planning only; users see no runtime behavior change.
  - Future implementation work starts from this spec through `pnpm harness context --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md`.
  - Failure classification, evidence injection, replay, scorecard, and governance work remains staged, default-off, and reversible until a follow-up implementation spec accepts a narrower slice.
  - Runtime evidence remains non-authoritative unless a later accepted spec explicitly defines a read-only consumer; evidence must not become checkpoint, lifecycle, provider, approval, retry, rollback, tool, or completion authority by accident.
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
forbiddenPatterns:
  - implementing active runtime behavior, provider transport changes, Gateway request changes, prompt assembly changes, TaskLoop decisions, tool policy decisions, or UI behavior in this readiness task
  - evidence becoming runtime authority, checkpoint authority, lifecycle authority, provider transport authority, approval authority, retry authority, rollback authority, tool authority, completion authority, or Gateway authority
  - writing evidence envelopes, failure summaries, replay output, scorecards, or governance decisions into checkpoint/lifecycle authority state without a follow-up accepted implementation spec
  - adding a second runtime service, daemon, listener, HTTP server, WebSocket server, external database, exporter, scheduler, or always-on sidecar for replay/evidence/governance
  - renderer direct `window.electron.ipcRenderer.invoke(...)` calls or renderer direct Gateway HTTP/WebSocket calls
  - destructive tool governance rules that mutate workspace state, roll back files, or block tools by default before replay and scorecard proof exists
  - treating replay fixture results, scorecard values, or evidence confidence as proof of task completion without explicit accepted evaluator gates
  - broad persistent raw tool args/results, provider payloads, prompts, model messages, secrets, environment dumps, or unredacted workspace content
  - merging the five lanes into one large implementation PR without per-slice specs, fixtures, tests, rollback, and acceptance gates
featureFlags:
  - runtime.failureIntelligence.* starts default off or passive-shadow until a follow-up implementation spec accepts active consumers.
  - runtime.evidenceEnvelope.* starts default off and fail-closed; envelope creation alone grants no authority.
  - runtime.replayHarness.* is local/dev/test only until a follow-up implementation spec accepts any runtime-facing capture path.
  - runtime.outcomeScorecard.* consumes replay/evidence reports only; it must not gate user-visible runtime behavior before a separate gate spec.
  - runtime.toolGovernance.* starts advisory or narrow high-risk guard only; active blocking requires replay/scorecard proof and a fresh spec.
rollback:
  - Delete or ignore the readiness handoff package and follow-up specs; no runtime migration or user data cleanup is required because this task is docs-only.
  - Future implementations must each define a flag-disable rollback that restores legacy runtime behavior without checkpoint or data migration.
  - Evidence/replay/scorecard artifacts created by future local/dev commands must be caller-owned or test-owned and safe to remove without changing runtime state.
requiredTests:
  - pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
  - pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-replay-governance-readiness.md
  - rg -n "runtime-failure-evidence-replay-governance-readiness|Failure Intelligence|Evidence Envelope|Replay Harness|Outcome Scorecard|Tool Invocation Governance" harness/specs/tasks docs/dev/runtime-research-boundaries.md
acceptance:
  - The readiness package records the five-lane objective, staged dependency order, parallelizable work streams, non-goals, authority boundaries, and validation gates.
  - `constraint-brief.md` contains the durable constraint wording future agents must preserve when writing implementation specs.
  - `development-plan.md` defines a staged plan with schema spike, Failure Intelligence, Evidence Envelope, Replay Harness, Outcome Scorecard, and Tool Governance slices.
  - `contracts-and-boundaries.md` defines draft `FailureEvent`, `EvidenceEnvelope`, `ReplayCase`, `TaskOutcomeScorecard`, and `ToolGovernanceDecision` contracts plus fail-closed behavior.
  - `validation-plan.md` defines initial replay scenarios, required tests, boundary scans, and promotion criteria.
  - `risk-register.md` lists drift risks, veto gates, mitigations, and owner decisions needed before active implementation.
  - `implementation-spec-template.md` provides a copyable follow-up task spec template and required pre-code questions.
  - `milestone-checklist.md` defines done criteria and promotion statuses for every phase.
  - `parallel-workstreams.md` defines stream ownership and integration cadence for parallel implementation.
  - `schema-decision-log.md` records accepted schema decisions and prevents silent semantic drift.
  - `synthesis.md` remains `Status: preparation_only` and does not claim implementation readiness for active runtime cutover.
  - Runtime index points future agents to this readiness package before any related implementation work.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Failure/Evidence/Replay Governance Readiness

This task persists the planning and constraint package for five related runtime research lanes:

1. Runtime Failure Intelligence
2. Runtime Evidence Envelope
3. Deterministic Replay Harness
4. Task Outcome Scorecard
5. Tool Invocation Governance

It is not an implementation task. It exists so future development starts from a durable harness source of truth instead of a chat-only plan.

## Required Development Shape

Future implementation must proceed by narrow follow-up specs. The preferred order is:

1. Schema spike for `FailureEvent`, `EvidenceEnvelope`, and `ReplayCase`.
2. Passive Failure Intelligence event production and consumer-safe summaries.
3. Evidence Envelope validation and prompt-assembly slot proof, still fail-closed and default-off.
4. Replay Harness core with deterministic provider/tool/workspace fixtures.
5. Outcome Scorecard based on replay reports, not subjective manual scoring.
6. Tool Invocation Governance rules validated by replay and scorecard deltas.

Each follow-up spec must define owned paths, feature flags, fail-closed behavior, tests, scans, rollback, and acceptance criteria.

## Stop Lines

Do not give evidence authority. Do not persist evidence into checkpoint/lifecycle authority state. Do not change provider transport, Gateway payloads, prompt assembly, TaskLoop decisions, retry decisions, approval decisions, rollback behavior, or tool blocking from this readiness package.

Any active runtime behavior requires a separate accepted implementation spec.
