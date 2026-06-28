# Line B AgentMap Prompt Candidate TaskLoop Production Readiness Plan

Status: accepted

This handoff defines the pre-production readiness path for the accepted AgentMap TaskLoop explicit invocation pilot.

## Decision

The current pilot is not production-ready, not default-on, and not approved for default cutover. The accepted decision is that the readiness plan is complete enough to enter Phase A Replay Proof.

## Task Spec

Use:

```text
harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
```

Run before accepting:

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-prompt-candidate-taskloop-production-readiness-plan.md
```

## Included Artifacts

- `production-readiness-plan.md`
- `replay-proof-plan.md`
- `cutover-readiness-plan.md`
- `controlled-opt-in-plan.md`
- `production-veto-gates.md`
- `quantitative-readiness-scorecard.md`
- `rollback-and-operator-plan.md`
- `validation-plan.md`
- `submission-template.md`
- `synthesis.md`

## Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

## Readiness Result

Score: 97/100.

Recommendation: enter Phase A Replay Proof. Do not enter production default behavior, default-on AgentMap, or default cutover.
