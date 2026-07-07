---
id: role-first-p1-resource-aware-scheduler
title: Role-First Multi-Agent P1 Resource-Aware Scheduling And Agency Draft Catalog
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add deterministic resource-aware scheduling and draft-only Agency catalog ingestion on top of the P0 verification loop while preserving RoleContract, runtime permission boundaries, and existing Gateway communication ownership.
ownedPaths:
  - harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
  - docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md
  - docs/multi-agent-orchestration/goal-mode-start-prompt-p1.md
  - docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md
touchedAreas:
  - docs/multi-agent-orchestration-development-plan.md
  - docs/role-first-design.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
  - docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md
  - docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md
  - harness/specs/tasks/role-first-p0-verification-loop.md
  - harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/orchestration-gates.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/agency-draft-catalog.ts
  - openclaw_runtime/src/agents/agency-role-importer.ts
  - openclaw_runtime/src/agents/orchestrator-run.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - tests/unit/helpers/role-gateway-test-utils.ts
  - tests/unit/orchestration-resource-scheduler.test.ts
  - tests/unit/agency-role-importer.test.ts
  - tests/unit/agent-steering-team-bundle.test.ts
  - tests/unit/orchestration-gates.test.ts
  - tests/unit/orchestration-result-bundle.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/orchestration-task-graph.test.ts
  - tests/unit/orchestration-protocol-v3.test.ts
expectedUserBehavior:
  - Existing role-first orchestration still selects roles through RoleContract-backed router and team templates.
  - Execution waves become deterministic and resource-aware without granting new role permissions.
  - max active roles are enforced by runtime scheduling.
  - roles with conflicting tool requirements are not scheduled into the same wave.
  - scheduler metrics explain concurrency cap, queued/running/completed/skipped counts, budget estimate, and role cost summary.
  - Agency-like source data imports only as draft catalog entries.
  - Agency draft entries cannot be spawned as active runtime roles.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
forbiddenPatterns:
  - ComplexityGate implementation
  - RunbookTemplate implementation
  - Role Catalog UI implementation
  - OrchestrationBlackboard implementation
  - Synthesizer implementation
  - direct worker-to-worker mesh chat
  - worker direct long-term memory writes
  - prompt/persona permission grants
  - Agency markdown runtime activation
  - renderer direct Gateway HTTP or raw IPC calls
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
  - pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
  - pnpm exec vitest run tests/unit/orchestration-resource-scheduler.test.ts tests/unit/agency-role-importer.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
  - pnpm exec vitest run tests/unit/orchestration-task-graph.test.ts tests/unit/role-spawn.test.ts tests/unit/role-runtime-mvp.test.ts tests/unit/chat-page-execution-graph.test.tsx
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - ResourceAwareWaveScheduler exists as typed runtime planning data and produces deterministic waves.
  - Scheduler enforces max active roles at runtime.
  - Tool contention splits conflicting roles into separate waves.
  - Scheduler metrics include queued/running/completed/skipped counts, concurrency cap, budget estimate, and role cost summary.
  - Scheduler preserves task graph dependency order and verifier-after-worker constraints.
  - AgencyRoleImporter emits draft catalog entries only.
  - Agency draft entries do not enter active RoleContract registry or spawn paths.
  - Draft promotion requires RoleContract validation.
  - Existing P0 verification loop tests remain green.
  - The implementation does not include P2-P4 deliverables.
docs:
  required: true
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md only if public user behavior, commands, or visible flows change. P1 runtime-only scheduling/draft catalog work should keep phase docs and harness spec in sync.
  phaseControlPack:
    - docs/multi-agent-orchestration/README.md
    - docs/multi-agent-orchestration/goal-mode-start-prompt-p1.md
    - docs/multi-agent-orchestration/goal-mode-development-protocol.md
    - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
    - docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md
    - docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md
    - docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md
---

# Role-First P1 Resource-Aware Scheduling And Agency Draft Catalog

This task is the harness entry point for P1. It adds deterministic resource-aware execution planning and draft-only Agency catalog ingestion without adding Complexity Gate, runbooks, blackboard, synthesizer, UI, or open A2A.

## Background

P0 hardened result collection and verification. P1 moves one step earlier in the orchestration flow: it schedules existing task graph nodes more carefully and imports Agency knowledge only as reviewable drafts.

## Goal-Mode Control Pack

Goal-mode workers must read:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md`
- `docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md`
- `docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md`

## Non-Goals

- Do not implement Complexity Gate.
- Do not implement RunbookTemplate.
- Do not build Role Catalog UI.
- Do not build blackboard.
- Do not build synthesizer.
- Do not add worker mesh chat.
- Do not let worker output write long-term memory.
- Do not activate Agency markdown agents as runtime roles.

## Validation

Start with:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md --no-diff
```

End with the required tests listed in front matter. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, run both comms commands.
