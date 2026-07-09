# Goal Mode Start Prompt: Role-First P4 Synthesizer And Local Dynamic DAG

You are implementing P4 only: Synthesizer And Local Dynamic DAG.

Before writing code, read these files:

1. docs/multi-agent-orchestration-development-plan.md
2. docs/role-first-design.md
3. docs/multi-agent-orchestration/README.md
4. docs/multi-agent-orchestration/goal-mode-development-protocol.md
5. docs/multi-agent-orchestration/acceptance-and-test-matrix.md
6. docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md
7. docs/superpowers/specs/2026-07-08-role-first-p4-synthesizer-dynamic-dag-design.md
8. docs/superpowers/plans/2026-07-08-role-first-p4-synthesizer-dynamic-dag.md
9. harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md

Use `docs/multi-agent-orchestration/phase-constraints/p4-synthesizer-dynamic-dag.md` as the binding phase boundary.

Allowed deliverables:

- `OrchestrationSynthesizer`.
- Local dynamic DAG refinement helper.
- Existing `orchestrator.run` / `team_orchestrate` result metadata that exposes synthesis.
- A narrow UI result view that displays synthesis and evidence details.
- Unit and E2E coverage.

Forbidden deliverables:

- Synthesizer tool access.
- Synthesizer overriding verifier failure.
- Unauthorized roles or tools through dynamic DAG.
- Scheduler bypass.
- New long-term memory persistence.
- Open mesh A2A or direct worker-to-worker chat.
- Agency markdown runtime activation.

Start with:

```powershell
corepack pnpm harness context --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md
corepack pnpm harness validate --spec harness/specs/tasks/role-first-p4-synthesizer-dynamic-dag.md --no-diff
```

End with the required tests in the harness task spec, plus an explicit non-goal checklist.
