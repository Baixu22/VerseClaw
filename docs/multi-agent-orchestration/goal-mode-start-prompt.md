# Role-First Multi-Agent P0 Goal-Mode Start Prompt

Use this prompt to start the Goal run for P0 only.

```text
Goal: Complete Role-First Multi-Agent P0 Verification Loop Hardening only.

Workspace:
C:\Users\27933\Desktop\clawx\ClawX

Before doing any implementation, read these files in full:
1. AGENTS.md
2. openclaw_runtime/AGENTS.md
3. docs/role-first-design.md
4. docs/multi-agent-orchestration-development-plan.md
5. docs/multi-agent-orchestration/README.md
6. docs/multi-agent-orchestration/goal-mode-development-protocol.md
7. docs/multi-agent-orchestration/acceptance-and-test-matrix.md
8. docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md
9. docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md
10. harness/specs/tasks/role-first-p0-verification-loop.md
11. harness/specs/tasks/role-first-team-orchestrate-tool.md
12. harness/specs/rules/backend-communication-boundary.md
13. harness/specs/rules/comms-regression.md
14. harness/specs/rules/workspace-harness-single-source.md

If any listed file is missing, stop before implementation and report the missing file.

Hard scope:
- Implement only P0.
- Use docs/multi-agent-orchestration-development-plan.md as the binding global constraint document.
- Use docs/multi-agent-orchestration/phase-constraints/p0-verification-loop.md as the binding phase boundary.
- Use docs/superpowers/plans/2026-07-07-role-first-p0-verification-loop.md as the implementation task order.

P0 allowed deliverables:
- OrchestrationResultBundle.
- SchemaComplianceGate.
- VerifierGate.
- max-one Replan/Repair decision and attempt record.
- P0 eval/test scenarios.
- Gate decisions, permission denials, memory proposals, and repair attempts represented in trace or bundle.

P0 forbidden deliverables:
- ResourceAwareWaveScheduler.
- AgencyRoleImporter.
- Role Catalog UI.
- Typed Blackboard.
- Synthesizer.
- New long-term memory strategy.
- Open mesh A2A or direct worker-to-worker chat.
- Runtime activation of Agency markdown agents.

Preflight commands:
pnpm harness context --spec harness/specs/tasks/role-first-p0-verification-loop.md
pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md --no-diff
git status --short

Full harness validation:
- At the end of P0, run `pnpm harness validate --spec harness/specs/tasks/role-first-p0-verification-loop.md` in an isolated worktree or when the diff contains only P0-owned files.
- If full validation fails because unrelated dirty files already exist, report those files and keep the `--no-diff` structural validation evidence.

Implementation discipline:
- Follow TDD for production behavior.
- For each implementation task, write the focused failing test first, run it to confirm RED, implement the smallest change, then rerun to GREEN.
- Do not reset, checkout, or revert unrelated user changes.
- Do not stage unrelated files.
- Do not claim completion without fresh command evidence from this Goal run.

Required final report:
- Active phase: P0 Verification Loop Hardening.
- Files changed and each file's responsibility.
- RED -> GREEN evidence for every implementation task.
- Commands run and exact results.
- Acceptance checklist from docs/multi-agent-orchestration/acceptance-and-test-matrix.md.
- Explicit non-goal checklist showing P1-P4 were not implemented.
- Unrelated dirty files or unrelated failures.
- Whether P0 is ready for review.
```
