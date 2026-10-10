---
lifecycleStatus: archived
id: role-first-p4-synthesizer-dynamic-dag
title: Role-First Multi-Agent P4 Synthesizer And Local Dynamic DAG
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add read-only synthesis and bounded local dynamic DAG refinement on top of P0/P1/P2/P3 without granting tools, hiding verifier failures, bypassing scheduler/gates, or adding memory persistence.
ownedPaths:
  - harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
  - docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md
  - docs/multi-agent-orchestration/goal-mode-start-prompt-p4.md
  - docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md
  - docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md
touchedAreas:
  - docs/multi-agent-orchestration-development-plan.md
  - docs/role-first-design.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md
  - docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md
  - harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
  - openclaw_runtime/src/agents/orchestration-synthesizer.ts
  - openclaw_runtime/src/agents/orchestration-dynamic-dag.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/orchestration-gates.ts
  - openclaw_runtime/src/agents/orchestration-resource-scheduler.ts
  - openclaw_runtime/src/agents/orchestration-blackboard.ts
  - openclaw_runtime/src/agents/orchestration-blackboard-verifier.ts
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - src/components/agents/RolesOrchestrationPanel.tsx
  - shared/i18n/locales/**
  - tests/unit/orchestration-synthesizer.test.ts
  - tests/unit/orchestration-dynamic-dag.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/e2e/role-orchestration-synthesis.spec.ts
expectedUserBehavior:
  - Multi-role orchestration results include a user-readable synthesis derived from verified structured data.
  - Verifier failures, role failures, permission denials, evidence refs, trace refs, and blackboard summary remain visible.
  - Local dynamic DAG refinements can add scoped nodes without unauthorized roles, tools, capabilities, or scheduler bypass.
  - The Roles Orchestration panel can show synthesis beside evidence and verification detail.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
forbiddenPatterns:
  - synthesizer tool access
  - synthesizer verifier override
  - unauthorized dynamic DAG roles
  - dynamic DAG tool grants
  - scheduler bypass
  - worker direct long-term memory writes
  - blackboard automatic memory persistence
  - direct worker-to-worker chat
  - open mesh A2A
  - Agency markdown runtime activation
  - renderer direct Gateway HTTP or raw IPC calls
requiredTests:
  - corepack pnpm harness context --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
  - corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --no-diff
  - corepack pnpm exec vitest run tests/unit/orchestration-synthesizer.test.ts tests/unit/orchestration-dynamic-dag.test.ts tests/unit/role-orchestration-methods.test.ts
  - corepack pnpm run test:e2e tests/e2e/role-orchestration-synthesis.spec.ts
  - corepack pnpm exec vitest run tests/unit/orchestration-blackboard.test.ts tests/unit/orchestration-blackboard-verifier.test.ts tests/unit/orchestration-blackboard-trace.test.ts tests/unit/complexity-gate.test.ts tests/unit/runbook-template.test.ts tests/unit/runbook-task-graph.test.ts tests/unit/orchestration-resource-scheduler.test.ts tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
  - corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --since e57db91db
  - corepack pnpm run comms:replay
  - corepack pnpm run comms:compare
acceptance:
  - Synthesizer returns deterministic structured output for identical verified bundles.
  - Synthesizer preserves role contributions, evidence refs, artifact refs, verifier report, visible failures, trace ids, and blackboard summary counts.
  - Verifier fail and repair-required decisions remain visible and are not represented as success.
  - Synthesizer policy states no tool access and preserved verifier authority.
  - Dynamic DAG refinement rejects unknown roles, unsafe fields, unknown dependencies, and out-of-scope capabilities.
  - Dynamic DAG refinement records source node, reason, scope, and attempt for new nodes.
  - Dynamic DAG refinement runs through the P1 scheduler and respects max-active-role limits.
  - Gateway and team tool payloads include synthesis without removing existing result bundle, scheduler, complexity, or runbook metadata.
  - UI renders synthesis and evidence detail with full locale coverage and Electron E2E coverage.
  - Existing P0, P1, P2, and P3 tests remain green.
docs:
  required: true
  note: P4 adds runtime synthesis, dynamic DAG refinement, and visible UI projection; keep phase docs, harness spec, and locale files in sync.
  phaseControlPack:
    - docs/multi-agent-orchestration/README.md
    - docs/multi-agent-orchestration/goal-mode-start-prompt-p4.md
    - docs/multi-agent-orchestration/goal-mode-development-protocol.md
    - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
    - docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md
    - docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md
    - docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md
---

# Role-First P4 Synthesizer And Local Dynamic DAG

This task is the harness entry point for P4. It adds read-only synthesis and local dynamic DAG refinement without granting tools, overriding verifier decisions, bypassing scheduler/gates, creating memory persistence, or adding open worker chat.

## Background

P0 hardened result collection and verification. P1 added deterministic resource-aware scheduling. P2 added runbook templates and complexity gating. P3 added typed blackboard state and bounded A2A. P4 consumes those verified structures to produce a user-readable synthesis and scoped graph refinement.

## Goal-Mode Control Pack

Goal-mode workers must read:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md`
- `docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md`
- `docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md`

## Non-Goals

- Do not give synthesizer tools.
- Do not let synthesizer override verifier failure.
- Do not add unauthorized dynamic DAG roles or tools.
- Do not bypass scheduler limits.
- Do not add new long-term memory persistence.
- Do not let worker output write long-term memory.
- Do not add open mesh A2A or direct worker-to-worker chat.
- Do not activate Agency markdown agents as runtime roles.

## Validation

Start with:

```powershell
corepack pnpm harness context --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --no-diff
```

End with the required tests listed in front matter. This cumulative role-first branch uses the P3 commit (`e57db91db`) as the final diff boundary for P4 validation.
