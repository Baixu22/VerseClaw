---
id: role-first-p2-runbook-complexity-gate
title: Role-First Multi-Agent P2 RunbookTemplate And Complexity Gate
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a structured complexity entry gate and reusable runbook templates on top of P0/P1 while preserving RoleContract, scheduler, verification gates, and Gateway communication ownership.
ownedPaths:
  - harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
  - docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md
  - docs/multi-agent-orchestration/goal-mode-start-prompt-p2.md
  - docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md
touchedAreas:
  - docs/multi-agent-orchestration-development-plan.md
  - docs/role-first-design.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
  - docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md
  - docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md
  - harness/specs/tasks/role-first-p0-verification-loop.md
  - harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
  - harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/orchestration-gates.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/agency-draft-catalog.ts
  - openclaw_runtime/src/agents/agency-role-importer.ts
  - openclaw_runtime/src/agents/complexity-gate.ts
  - openclaw_runtime/src/agents/runbook-template.ts
  - openclaw_runtime/src/agents/runbook-registry.ts
  - openclaw_runtime/src/agents/runbook-task-graph.ts
  - openclaw_runtime/src/agents/orchestrator.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/orchestrator-run.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - tests/unit/helpers/role-gateway-test-utils.ts
  - tests/unit/agency-role-importer.test.ts
  - tests/unit/complexity-gate.test.ts
  - tests/unit/runbook-template.test.ts
  - tests/unit/runbook-task-graph.test.ts
  - tests/unit/orchestration-task-graph.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/orchestration-result-bundle.test.ts
  - tests/unit/orchestration-gates.test.ts
  - tests/unit/agent-steering-team-bundle.test.ts
  - tests/unit/orchestration-protocol-v3.test.ts
expectedUserBehavior:
  - Simple tasks default away from multi-agent orchestration unless the user explicitly asks for it.
  - Complex, high-risk, multi-file, or repeated-failure tasks can be routed into team or runbook orchestration.
  - Runbook selection is explainable through structured selected and unselected reasons.
  - Runbook-generated task graphs use existing RoleContract names and existing scheduler/gate boundaries.
  - Runbook prose and Agency text never grant tools or runtime permissions.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
forbiddenPatterns:
  - OrchestrationBlackboard implementation
  - Synthesizer implementation
  - Role Catalog UI implementation
  - direct worker-to-worker mesh chat
  - worker direct long-term memory writes
  - prompt/persona permission grants
  - runbook prose permission grants
  - Agency markdown runtime activation
  - renderer direct Gateway HTTP or raw IPC calls
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
  - pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
  - pnpm exec vitest run tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts
  - pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ComplexityGate classifies simple, role-routed, team, and runbook cases with structured reasons.
  - ComplexityGate does not block explicit user team selection.
  - RunbookTemplate validation rejects missing roles, duplicate node ids, missing evidence policy, and unsatisfied skeleton dependencies.
  - Built-in runbook fixtures validate successfully.
  - Runbook-to-task-graph output references existing RoleContract names only.
  - Runbook-to-task-graph output preserves scheduler and verifier boundaries.
  - Runbook selection trace includes selected and unselected reasons.
  - Existing P0 and P1 tests remain green.
  - The implementation does not include P3-P4 deliverables.
docs:
  required: true
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md only if public user behavior, commands, or visible flows change. P2 runtime-only gate/runbook work should keep phase docs and harness spec in sync.
  phaseControlPack:
    - docs/multi-agent-orchestration/README.md
    - docs/multi-agent-orchestration/goal-mode-start-prompt-p2.md
    - docs/multi-agent-orchestration/goal-mode-development-protocol.md
    - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
    - docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md
    - docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md
    - docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md
---

# Role-First P2 RunbookTemplate And Complexity Gate

This task is the harness entry point for P2. It adds an entry complexity decision gate and structured runbook templates without adding blackboard, synthesizer, UI, open A2A, or new memory persistence.

## Background

P0 hardened result collection and verification. P1 added deterministic resource-aware scheduling and draft-only Agency catalog import. P2 decides when those orchestration capabilities should be used and how common complex workflows should map to reusable structured runbooks.

## Goal-Mode Control Pack

Goal-mode workers must read:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md`
- `docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md`

## Non-Goals

- Do not build blackboard.
- Do not build synthesizer.
- Do not build Role Catalog UI.
- Do not add worker mesh chat.
- Do not let worker output write long-term memory.
- Do not activate Agency markdown agents as runtime roles.
- Do not let runbook prose grant tools or permissions.

## Validation

Start with:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md --no-diff
```

End with the required tests listed in front matter. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, run both comms commands.
