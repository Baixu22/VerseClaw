# Line B AgentMap Production Readiness MVP

Status: accepted_for_controlled_internal_opt_in.

This handoff decides whether the accepted AgentMap TaskLoop explicit invocation pilot has enough auditable evidence to enter controlled internal opt-in. It is not production readiness, not default-on approval, and not a default cutover.

## Included Artifacts

- `cutover-readiness-review.md`
- `real-shadow-mvp-plan.md`
- `controlled-internal-opt-in-plan.md`
- `quality-scorecard.md`
- `production-veto-gates.md`
- `security-authority-boundary.md`
- `observability-diagnostics-plan.md`
- `limited-production-opt-in-plan.md`
- `default-on-proposal-template.md`
- `rollback-playbook.md`
- `validation-plan.md`
- `submission-template.md`
- `synthesis.md`

## Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, and automatic discovery/build/cache/reuse.

Candidate text may enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` when all four gates are true, the caller explicitly invokes the pilot, and the caller supplies a valid `AgentMapResult`.
