# Line B AgentMap Prompt Candidate TaskLoop Explicit Invocation Deep Validation

This handoff deep-validates the accepted TaskLoop explicit invocation pilot.

## Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
```

Run before accepting:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-explicit-invocation-deep-validation.md
```

## Boundary

This phase is validation only. It may add focused tests, replay fixtures/cases, diagnostics assertions, boundary scans, and scorecard documentation. It must not change default runtime behavior, provider ordering, Gateway/model/provider transport, default TaskLoop reviewer prompts, persistence, or automatic AgentMap discovery.

## Decision Rule

`synthesis.md` starts as `Status: needs_revision`. It may be promoted to `Status: accepted` only after required validation passes, the hard gates are recorded, and the quantitative scorecard reaches the readiness threshold without veto failures.
