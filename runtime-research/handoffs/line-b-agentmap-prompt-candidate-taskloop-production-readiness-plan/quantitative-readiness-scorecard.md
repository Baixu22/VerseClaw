# Quantitative Readiness Scorecard

## Categories

| Category | Max | Score | Evidence |
|---|---:|---:|---|
| Replay coverage | 20 | 19 | Plan enumerates all required Replay Proof cases and deterministic proof expectations; actual replay corpus remains next phase. |
| Default behavior parity | 20 | 20 | Existing deep validation proves default-off, closed-gate, invalid input, explicitInvocation=false, and rollback byte parity; plan requires zero drift. |
| Boundary/no authority | 20 | 20 | Plan preserves no default prompt/model/Gateway/provider/provider-ordering/runtime authority and defines vetoes for escalation. |
| Fail-closed and rollback | 15 | 15 | Plan requires every failure path to fail closed and every gate to restore legacy parity. |
| Diagnostics/operator readiness | 10 | 9 | Operator diagnostics, failure reporting, incident criteria, and rollback paths are defined; live operator tooling remains future work. |
| Controlled opt-in safety | 10 | 10 | Internal-only, developer-only, per-agent, per-session, workspace allowlist, explicit invocation, and explicit result gates are required. |
| Maintainability/auditability | 5 | 4 | Spec/handoff artifacts and validation list are auditable; future replay corpus ownership still needs Phase A evidence. |
| Total | 100 | 97 | Can enter Replay Proof; not production-ready and not default-on. |

## Threshold Decision

97/100 reaches the 95-100 threshold: the project can enter Phase A Replay Proof or the next readiness stage.

This score does not mean production-ready. It means the readiness path is sufficiently specified and validated to begin Replay Proof.

## Veto Check

No veto fired in this planning phase. Any future veto immediately overrides the numeric score.
