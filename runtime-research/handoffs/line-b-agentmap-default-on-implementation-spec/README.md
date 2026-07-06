# Line B AgentMap Default-On Implementation Spec

Status: accepted_line_b_agentmap_default_on_implementation_spec_gap_closure_default_on_still_forbidden

Default-on allowed: no.
Default cutover allowed: no.
Production-ready declaration allowed: no.
Recommend entering default-on implementation execution: yes, through a fresh accepted execution task only.

## Scope

This package converts the prior `ready_for_default_on_implementation_spec` handoff into a complete implementation-spec and gap-closure package. It does not enable default-on, approve cutover, declare production readiness, change runtime behavior, change provider ordering, register AgentMap as a default provider, persist candidate output, add services, or add renderer transport bypasses.

## Contents

| File | Purpose |
|---|---|
| `implementation-spec.md` | Future implementation steps, gates, rollback, telemetry, and acceptance. |
| `telemetry-implementation-plan.md` | Future-only diagnostics counter design. |
| `telemetry-privacy-boundary.md` | Raw text and sensitive payload exclusion proof. |
| `rollback-drill-plan.md` | Rollback cases to run before any execution task. |
| `rollback-drill-results.md` | Recorded pass criteria inherited from readiness plus this spec package. |
| `default-path-parity-proof.md` | Default-off and legacy reviewer prompt byte parity proof. |
| `leakage-proof.md` | Candidate leakage proof and sentinel boundary. |
| `provider-ordering-proof.md` | Provider ordering and default registration proof. |
| `persistence-proof.md` | Candidate/shadow/replay non-persistence proof. |
| `authority-boundary-proof.md` | Runtime/tool/security/provider/Gateway/checkpoint/lifecycle authority boundary. |
| `comms-regression-decision.md` | Comms replay/compare decision. |
| `ui-docs-i18n-decision.md` | README and locale decision. |
| `rollout-gates.md` | Future rollout entry gates. |
| `production-veto-gates.md` | Hard vetoes that block execution, cutover, or production readiness. |
| `operator-runbook.md` | Operator checks, rollback, and incident response. |
| `implementation-risk-register.md` | Risks and mitigations. |
| `validation-results.md` | Exact validation record. |
| `synthesis.md` | Final accepted synthesis and scorecard. |

## Final Boundary

AgentMap remains default-off, explicit-invocation only, explicit valid `AgentMapResult` only, readonly, non-authoritative, non-persistent, and outside default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, provider ordering, runtime decisions, tool/security/approval/retry/completion authority, checkpoint authority, lifecycle authority, and automatic discovery/build/cache/reuse.
