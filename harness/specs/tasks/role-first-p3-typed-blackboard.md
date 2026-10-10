---
lifecycleStatus: archived
id: role-first-p3-typed-blackboard
title: Role-First Multi-Agent P3 Typed Blackboard And Bounded A2A
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a typed orchestration blackboard and bounded blackboard-mediated A2A coordination on top of P0/P1/P2 while preserving RoleContract, scheduler, runbook, verification gates, memory, and Gateway communication ownership.
ownedPaths:
  - harness/specs/tasks/role-first-p3-typed-blackboard.md
  - plans/system-maturity/orchestration-gap-closure/ORCH-002.delivery.md
  - plans/system-maturity/orchestration-gap-closure/ORCHESTRATION_STATUS.json
  - artifacts/system-maturity/orchestration-gap-closure/ORCH-002/**
  - docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md
  - docs/multi-agent-orchestration/goal-mode-start-prompt-p3.md
  - docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md
touchedAreas:
  - artifacts/system-maturity/orchestration-gap-closure/ORCH-002/**
  - artifacts/system-maturity/orchestration-gap-closure/status-gate.json
  - plans/system-maturity/orchestration-gap-closure/ORCH-002.delivery.md
  - plans/system-maturity/orchestration-gap-closure/ORCHESTRATION_STATUS.json
  - docs/multi-agent-orchestration-development-plan.md
  - docs/role-first-design.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
  - docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md
  - docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md
  - docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md
  - harness/specs/tasks/role-first-p0-verification-loop.md
  - harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
  - harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
  - harness/specs/tasks/role-first-p3-typed-blackboard.md
  - openclaw_runtime/src/agents/orchestration-blackboard.ts
  - openclaw_runtime/src/agents/orchestration-blackboard-verifier.ts
  - openclaw_runtime/src/agents/orchestration-blackboard-trace.ts
  - openclaw_runtime/src/agents/handoff-artifacts.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/agency-draft-catalog.ts
  - openclaw_runtime/src/agents/agency-role-importer.ts
  - openclaw_runtime/src/agents/complexity-gate.ts
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/agents/orchestrator-run.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/orchestration-runtime-blackboard.ts
  - openclaw_runtime/src/agents/orchestration-gates.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/runbook-registry.ts
  - openclaw_runtime/src/agents/runbook-template.ts
  - openclaw_runtime/src/agents/runbook-task-graph.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/types.openclaw.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - tests/unit/orchestration-blackboard.test.ts
  - tests/unit/orchestration-blackboard-verifier.test.ts
  - tests/unit/orchestration-blackboard-trace.test.ts
  - tests/unit/helpers/role-gateway-test-utils.ts
  - tests/unit/agency-role-importer.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/orchestration-gates.test.ts
  - tests/unit/orchestration-task-graph.test.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/complexity-gate.test.ts
  - tests/unit/runbook-template.test.ts
  - tests/unit/runbook-task-graph.test.ts
  - tests/unit/orchestration-result-bundle.test.ts
  - tests/unit/agent-steering-team-bundle.test.ts
  - tests/unit/orchestration-protocol-v3.test.ts
  - tests/unit/handoff-artifacts.test.ts
  - tests/unit/orchestration-runtime-blackboard.test.ts
  - tests/integration/loop-stability-check.test.ts
expectedUserBehavior:
  - Multi-role orchestration can share structured facts, claims, risks, questions, artifacts, handoffs, conflicts, and memory proposals.
  - Conflicting claims remain visible as conflict entries instead of being silently overwritten.
  - Verifier reports can cite blackboard evidence while existing P0 gates remain authoritative.
  - Prompt-injection-like content stored in the blackboard is marked untrusted and remains data only.
  - Blackboard-mediated handoffs do not become direct worker-to-worker chat or permission grants.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
  - system-maturity-status-gate
forbiddenPatterns:
  - Synthesizer implementation
  - Role Catalog UI implementation
  - direct worker-to-worker chat
  - open mesh A2A
  - worker direct long-term memory writes
  - blackboard automatic memory persistence
  - prompt/persona permission grants
  - blackboard prose permission grants
  - Agency markdown runtime activation
  - renderer direct Gateway HTTP or raw IPC calls
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
  - pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
  - pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-blackboard-trace.test.ts
  - pnpm exec vitest run tests/unit/handoff-artifacts.test.ts tests/unit/orchestration-runtime-blackboard.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-protocol-v3.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/integration/loop-stability-check.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node scripts/validate-system-maturity-plan.mjs
  - node scripts/validate-orchestration-gap-status.mjs
acceptance:
  - Blackboard entry validation covers fact, claim, question, risk, decision, artifact, conflict, handoff, and memory_proposal.
  - Validation rejects unknown roles, invalid confidence, missing required evidence, invalid visibility/status, unsafe permission fields, and direct memory writes.
  - Append operations preserve stable ids, version 1, timestamps, author role, task id, and trust boundary.
  - Versioned updates preserve reconstructable history and do not silently overwrite conflicts.
  - Conflict detection creates conflict entries referencing both incompatible claims.
  - Untrusted content is stored as data and marked with trust-boundary metadata.
  - Verifier evidence helpers read blackboard evidence without bypassing P0 gates.
  - Trace replay reconstructs blackboard history from append/update/conflict events.
  - ORCH-002 handoffs use only successful terminal registry-backed worker output; output-schema-only injection is not accepted as success.
  - Handoff artifacts are redacted, bounded, hashed, and bound to orchestration run, task graph, owner session, task, attempt, role, child run, and child session provenance.
  - Missing, malformed, cross-run, cross-session, or identity-mismatched handoff output blocks dependent spawn instead of falling back to another session or synthetic content.
  - Spawn and completion result bundles expose handoff artifacts, runtime blackboard projection records ready handoffs and rejected risks, and trace replay remains reconstructable without long-term memory writes.
  - ORCH-002 can move to done only after fresh tests, validation evidence, two traceable commits, and status-gate success.
  - Existing P0, P1, and P2 tests remain green.
  - The implementation does not include P4/UI/open-chat/memory-persistence deliverables.
docs:
  required: true
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md only if public user behavior, commands, or visible flows change. P3 runtime-only blackboard work should keep phase docs and harness spec in sync.
  phaseControlPack:
    - docs/multi-agent-orchestration/README.md
    - docs/multi-agent-orchestration/goal-mode-start-prompt-p3.md
    - docs/multi-agent-orchestration/goal-mode-development-protocol.md
    - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
    - docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md
    - docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md
    - docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md
---

# Role-First P3 Typed Blackboard And Bounded A2A

This task is the harness entry point for P3. It adds a typed orchestration blackboard and blackboard-mediated bounded A2A without adding synthesizer, UI, open worker chat, new memory persistence, or runtime Agency activation.

## Background

P0 hardened result collection and verification. P1 added deterministic resource-aware scheduling and draft-only Agency catalog import. P2 added complexity gating and structured runbook templates. P3 provides controlled shared orchestration state for multi-role collaboration.

## Goal-Mode Control Pack

Goal-mode workers must read:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md`
- `docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md`

## Non-Goals

- Do not build synthesizer.
- Do not build Role Catalog UI.
- Do not add open mesh A2A.
- Do not add direct worker-to-worker chat.
- Do not add new long-term memory persistence.
- Do not let worker output write long-term memory.
- Do not let blackboard entries automatically become memory.
- Do not activate Agency markdown agents as runtime roles.
- Do not let blackboard prose grant tools or permissions.

## Validation

Start with:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md --no-diff
```

End with the required tests listed in front matter. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, run both comms commands.
