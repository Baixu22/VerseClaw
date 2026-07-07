# Role-First Multi-Agent P1 Goal-Mode Start Prompt

Use this prompt to start the Goal run for P1 only.

```text
Goal: Complete Role-First Multi-Agent P1 Resource-Aware Scheduling And Agency Draft Catalog only.

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
8. docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md
9. docs/superpowers/specs/2026-07-07-role-first-p1-resource-aware-scheduler-design.md
10. docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md
11. harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
12. harness/specs/tasks/role-first-p0-verification-loop.md
13. harness/specs/tasks/role-first-team-orchestrate-tool.md
14. harness/specs/rules/backend-communication-boundary.md
15. harness/specs/rules/comms-regression.md
16. harness/specs/rules/workspace-harness-single-source.md

If any listed file is missing, stop before implementation and report the missing file.

Hard scope:
- Implement only P1.
- Use docs/multi-agent-orchestration-development-plan.md as the binding global constraint document.
- Use docs/multi-agent-orchestration/phase-constraints/p1-resource-aware-scheduler.md as the binding phase boundary.
- Use docs/superpowers/plans/2026-07-07-role-first-p1-resource-aware-scheduler.md as the implementation task order.
- Preserve P0 OrchestrationResultBundle, SchemaComplianceGate, VerifierGate, and max-one repair behavior.

P1 allowed deliverables:
- ResourceAwareWaveScheduler.
- Scheduler metrics for queued/running/completed/skipped, concurrency cap, budget estimate, and role cost summary.
- Runtime enforcement of max active roles.
- Tool contention separation.
- AgencyRoleImporter draft-only flow.
- Draft catalog entries with draft/reviewed/active state data.
- Tests and fixture scenarios for P1.

P1 forbidden deliverables:
- ComplexityGate.
- RunbookTemplate.
- Role Catalog UI.
- Typed Blackboard.
- Synthesizer.
- New long-term memory strategy.
- Open mesh A2A or direct worker-to-worker chat.
- Runtime activation of Agency markdown agents.
- Prompt or Agency text granting real tools/permissions.

Preflight commands:
pnpm harness context --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
pnpm harness validate --spec harness/specs/tasks/role-first-p1-resource-aware-scheduler.md --no-diff
git status --short

Implementation discipline:
- Follow TDD for production behavior.
- For each implementation task, write the focused failing test first, run it to confirm RED, implement the smallest change, then rerun to GREEN.
- Do not reset, checkout, or revert unrelated user changes.
- Do not stage unrelated files.
- Do not claim completion without fresh command evidence from this Goal run.

Required final report:
- Active phase: P1 Resource-Aware Scheduling And Agency Draft Catalog.
- Files changed and each file's responsibility.
- RED -> GREEN evidence for every implementation task.
- Commands run and exact results.
- Acceptance checklist from docs/multi-agent-orchestration/acceptance-and-test-matrix.md.
- Explicit non-goal checklist showing P2-P4 were not implemented.
- Unrelated dirty files or unrelated failures.
- Whether P1 is ready for review.
```
