# Role-First Multi-Agent P2 Goal-Mode Start Prompt

Use this prompt to start the Goal run for P2 only.

```text
Goal: Complete Role-First Multi-Agent P2 RunbookTemplate And Complexity Gate only.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX-p0-main

Before doing any implementation, read these files in full:
1. AGENTS.md
2. openclaw_runtime/AGENTS.md
3. docs/role-first-design.md
4. docs/multi-agent-orchestration-development-plan.md
5. docs/multi-agent-orchestration/README.md
6. docs/multi-agent-orchestration/goal-mode-development-protocol.md
7. docs/multi-agent-orchestration/acceptance-and-test-matrix.md
8. docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md
9. docs/superpowers/specs/2026-07-07-role-first-p2-runbook-complexity-gate-design.md
10. docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md
11. harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
12. harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
13. harness/specs/tasks/role-first-p0-verification-loop.md
14. harness/specs/tasks/role-first-team-orchestrate-tool.md
15. harness/specs/rules/backend-communication-boundary.md
16. harness/specs/rules/comms-regression.md
17. harness/specs/rules/workspace-harness-single-source.md

If any listed file is missing, stop before implementation and report the missing file.

Hard scope:
- Implement only P2.
- Use docs/multi-agent-orchestration-development-plan.md as the binding global constraint document.
- Use docs/multi-agent-orchestration/phase-constraints/p2-runbook-complexity-gate.md as the binding phase boundary.
- Use docs/superpowers/plans/2026-07-07-role-first-p2-runbook-complexity-gate.md as the implementation task order.
- Preserve P0 OrchestrationResultBundle, SchemaComplianceGate, VerifierGate, and max-one repair behavior.
- Preserve P1 ResourceAwareWaveScheduler, scheduler metrics, max active roles, and tool contention behavior.

P2 allowed deliverables:
- ComplexityGate.
- Complexity classification decisions and structured reason codes.
- RunbookTemplate schema and validation.
- Built-in runbook fixtures.
- Runbook selection trace with selected/unselected reasons.
- Runbook-to-task-graph conversion using existing RoleContract names.
- Tests and fixture scenarios for P2.

P2 forbidden deliverables:
- Typed Blackboard.
- Synthesizer.
- Role Catalog UI.
- New long-term memory strategy.
- Open mesh A2A or direct worker-to-worker chat.
- Runtime activation of Agency markdown agents.
- Prompt, Agency text, or runbook prose granting real tools/permissions.
- Bypassing P0/P1 gates, scheduler, or RoleContract validation.

Preflight commands:
pnpm harness context --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
pnpm harness validate --spec harness/specs/tasks/role-first-p2-runbook-complexity-gate.md --no-diff
git status --short

Implementation discipline:
- Follow TDD for production behavior.
- For each implementation task, write the focused failing test first, run it to confirm RED, implement the smallest change, then rerun to GREEN.
- Do not reset, checkout, or revert unrelated user changes.
- Do not stage unrelated files.
- Do not claim completion without fresh command evidence from this Goal run.

Required final report:
- Active phase: P2 RunbookTemplate And Complexity Gate.
- Files changed and each file's responsibility.
- RED -> GREEN evidence for every implementation task.
- Commands run and exact results.
- Acceptance checklist from docs/multi-agent-orchestration/acceptance-and-test-matrix.md.
- Explicit non-goal checklist showing P3-P4 were not implemented.
- Unrelated dirty files or unrelated failures.
- Whether P2 is ready for review.
```
