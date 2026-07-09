# Role-First Multi-Agent P3 Goal-Mode Start Prompt

Use this prompt to start the Goal run for P3 only.

```text
Goal: Complete Role-First Multi-Agent P3 Typed Blackboard And Bounded A2A only.

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
8. docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md
9. docs/superpowers/specs/2026-07-07-role-first-p3-typed-blackboard-design.md
10. docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md
11. harness/specs/tasks/role-first-p3-typed-blackboard.md
12. harness/specs/tasks/role-first-p2-runbook-complexity-gate.md
13. harness/specs/tasks/role-first-p1-resource-aware-scheduler.md
14. harness/specs/tasks/role-first-p0-verification-loop.md
15. harness/specs/tasks/role-first-team-orchestrate-tool.md
16. harness/specs/rules/backend-communication-boundary.md
17. harness/specs/rules/comms-regression.md
18. harness/specs/rules/workspace-harness-single-source.md

If any listed file is missing, stop before implementation and report the missing file.

Hard scope:
- Implement only P3.
- Use docs/multi-agent-orchestration-development-plan.md as the binding global constraint document.
- Use docs/multi-agent-orchestration/phase-constraints/p3-typed-blackboard.md as the binding phase boundary.
- Use docs/superpowers/plans/2026-07-07-role-first-p3-typed-blackboard.md as the implementation task order.
- Preserve P0 OrchestrationResultBundle, SchemaComplianceGate, VerifierGate, and max-one repair behavior.
- Preserve P1 ResourceAwareWaveScheduler, scheduler metrics, max active roles, and tool contention behavior.
- Preserve P2 ComplexityGate, RunbookTemplate, runbook registry, runbook graph conversion, and runbook selection metadata.

P3 allowed deliverables:
- OrchestrationBlackboard typed entry model.
- Entry validation for fact, claim, question, risk, decision, artifact, conflict, handoff, and memory_proposal.
- Append and versioned update API.
- Structured authorRole, taskId, confidence, evidenceRefs, visibility, status, trustBoundary, version, and timestamp data.
- Conflict detection and conflict entry creation.
- Untrusted content propagation and prompt-injection defense metadata.
- Verifier blackboard evidence read helpers.
- Trace replay reconstruction helpers.
- Tests and fixture scenarios for P3.

P3 forbidden deliverables:
- Synthesizer.
- Role Catalog UI.
- New long-term memory persistence strategy.
- Open mesh A2A or direct worker-to-worker chat.
- Worker direct long-term memory writes.
- Blackboard entries automatically becoming long-term memory.
- Runtime activation of Agency markdown agents.
- Prompt, handoff prose, Agency text, or blackboard prose granting real tools/permissions.
- Bypassing RoleContract, ResourceAwareWaveScheduler, SchemaComplianceGate, VerifierGate, or P2 runbook boundaries.

Preflight commands:
pnpm harness context --spec harness/specs/tasks/role-first-p3-typed-blackboard.md
pnpm harness validate --spec harness/specs/tasks/role-first-p3-typed-blackboard.md --no-diff
git status --short

Implementation discipline:
- Follow TDD for production behavior.
- For each implementation task, write the focused failing test first, run it to confirm RED, implement the smallest change, then rerun to GREEN.
- Do not reset, checkout, or revert unrelated user changes.
- Do not stage unrelated files.
- Do not claim completion without fresh command evidence from this Goal run.

Required final report:
- Active phase: P3 Typed Blackboard And Bounded A2A.
- Files changed and each file's responsibility.
- RED -> GREEN evidence for every implementation task.
- Commands run and exact results.
- Acceptance checklist from docs/multi-agent-orchestration/acceptance-and-test-matrix.md.
- Explicit non-goal checklist showing P4 was not implemented and P3 did not widen into UI/open chat/memory persistence.
- Unrelated dirty files or unrelated failures.
- Whether P3 is ready for review.
```
