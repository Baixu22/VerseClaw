---
lifecycleStatus: archived
id: role-first-p0-verification-loop
title: Role-First Multi-Agent P0 Verification Loop Hardening
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Harden the existing role-first multi-agent result path with structured OrchestrationResultBundle data, schema compliance gate, verifier gate, max-one repair/replan accounting, and trace/bundle evidence while preserving RoleContract and existing Gateway communication boundaries.
ownedPaths:
  - harness/specs/tasks/role-first-p0-verification-loop.md

  - docs/role-first-design.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
touchedAreas:
  - docs/multi-agent-orchestration-development-plan.md

  - docs/role-first-design.md
  - docs/multi-agent-orchestration/**
  - docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
  - harness/specs/tasks/role-first-p0-verification-loop.md
  - openclaw_runtime/src/agents/orchestration-protocol.ts
  - openclaw_runtime/src/agents/orchestration-result-bundle.ts
  - openclaw_runtime/src/agents/orchestration-gates.ts
  - openclaw_runtime/src/agents/orchestrator-run.ts
  - openclaw_runtime/src/agents/orchestrator-run-observed.ts
  - openclaw_runtime/src/agents/agent-steering-queue.ts
  - openclaw_runtime/src/agents/subagent-registry.types.ts
  - openclaw_runtime/src/agents/tools/team-orchestrate-tool.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - tests/unit/orchestration-result-bundle.test.ts
  - tests/unit/orchestration-gates.test.ts
  - tests/unit/agent-steering-team-bundle.test.ts
  - tests/unit/role-orchestration-methods.test.ts
  - tests/unit/orchestration-protocol-v3.test.ts
expectedUserBehavior:
  - Existing role-first orchestration entrypoints continue to plan and spawn role-scoped workers through the existing subagent runtime.
  - Team results are represented as structured runtime data before being rendered into lead-agent prompt text.
  - Malformed or evidence-empty successful worker outcomes are not treated as verified success.
  - Verifier results become explicit pass/fail/repair-required decisions.
  - Automatic repair/replan decisions are capped at one attempt and remain visible to the lead/user through bundle or trace evidence.
  - Agency markdown agents are not activated as runtime roles in P0.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - workspace-harness-single-source
  - docs-sync
forbiddenPatterns:
  - ResourceAwareWaveScheduler implementation
  - AgencyRoleImporter implementation
  - Role Catalog UI implementation
  - OrchestrationBlackboard implementation
  - Synthesizer implementation
  - direct worker-to-worker mesh chat
  - worker direct long-term memory writes
  - prompt/persona permission grants
  - renderer direct Gateway HTTP or raw IPC calls
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/role-first-p0-verification-loop.md
  - pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md
  - pnpm exec vitest run tests/unit/orchestration-result-bundle.test.ts tests/unit/orchestration-gates.test.ts tests/unit/agent-steering-team-bundle.test.ts tests/unit/role-orchestration-methods.test.ts tests/unit/orchestration-protocol-v3.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - OrchestrationResultBundle exists as typed runtime data and covers the current spawn/completion result paths.
  - SchemaComplianceGate rejects malformed or evidence-empty successful worker outcomes.
  - VerifierGate returns explicit pass/fail/repair_required decisions and does not rely only on unstructured prompt prose.
  - Repair/replan decision accounting enforces max one automatic attempt per orchestration run.
  - Gate decisions, permission denials, memory proposals, and repair attempts are visible in bundle or trace data.
  - Existing role-first orchestration tests remain green.
  - The implementation does not include P1-P4 deliverables.
docs:
  required: true
  note: Review README.md, README.zh-CN.md, and README.ja-JP.md only if user-visible behavior, commands, or public architecture flows change. Keep P0 docs under docs/multi-agent-orchestration/** in sync with implementation.
  phaseControlPack:
    - docs/multi-agent-orchestration/README.md
    - docs/multi-agent-orchestration/goal-mode-start-prompt.md
    - docs/multi-agent-orchestration/goal-mode-development-protocol.md
    - docs/multi-agent-orchestration/acceptance-and-test-matrix.md
    - docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md
    - docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
---

# Role-First P0 Verification Loop

This task is the harness entry point for P0. It hardens the existing role-first multi-agent path without introducing scheduler, Agency import, blackboard, synthesizer, or UI work.

## Background

The current role-first runtime already has RoleContract, role routing, team templates, task graph waves, observed orchestration runs, `team_orchestrate`, completion steering, and a prompt-rendered Team Result Bundle. P0 keeps those owners and adds a structured result/gate layer around them.

## Goal-Mode Control Pack

Goal-mode workers must read:

- `docs/multi-agent-orchestration-development-plan.md`
- `docs/role-first-design.md`
- `docs/multi-agent-orchestration/README.md`
- `docs/multi-agent-orchestration/goal-mode-development-protocol.md`
- `docs/multi-agent-orchestration/acceptance-and-test-matrix.md`
- `docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md`
- `docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md`

## Non-Goals

- Do not implement scheduler work.
- Do not import Agency Agents into active roles.
- Do not build Role Catalog UI.
- Do not build blackboard.
- Do not build synthesizer.
- Do not add worker mesh chat.
- Do not let worker output write long-term memory.

## Validation

Start with:

```powershell
pnpm harness context --spec harness/specs/tasks/role-first-p0-verification-loop.md
pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md --no-diff
```

End with the required tests listed in front matter. Full validation without `--no-diff` must run in a clean/isolated P0 diff before claiming completion. If communication paths are not touched, explain why `comms:replay` and `comms:compare` are not required. If `team_orchestrate`, gateway handlers, delivery, or renderer projection changes, run both comms commands.
