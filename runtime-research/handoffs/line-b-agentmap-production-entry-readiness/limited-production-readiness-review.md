# Limited Production Readiness Review

## Recommendation

Recommend entering limited production opt-in. `synthesis.md` is `Status: accepted_for_limited_production_opt_in` because required tests, scans, live typecheck, clean frozen install, clean typecheck, clean harness validation, rollback drill, leakage proof, provider-ordering proof, and veto gates are green.

This is not default-on, not default cutover, not production-ready status, and not production UI approval.

## Allowed Scope

| Boundary | Limit |
|---|---|
| Population | Internal allowlist only. |
| Sessions | Explicit per-session opt-in. |
| Invocation | `explicitInvocation=true` plus explicit valid `AgentMapResult`. |
| Gates | All prompt candidate gates explicitly true. |
| Max sample count | 50 limited-production opt-in sessions before next review. |
| Max duration | 14 calendar days before renewal review. |
| Human approval | Readiness owner and release approver both approve each wave. |
| Output | Diagnostics and explicit pilot prompt only. |

## Monitoring

Monitor inserted, blocked, fail_closed, budget_exhausted, prompt_present_excluded, invalid_result, gate_disabled, invocation_not_requested, leakage_count, provider_ordering_drift, and rollback_success.

## Rollback Triggers

Rollback immediately on any candidate leakage, default reviewer prompt byte drift, provider ordering drift, candidate persistence, fail-open invalid/missing/gated-off case, rollback failure, renderer direct IPC/Gateway, new service/listener/database/server path, or authority escalation.

## Decision

Limited production opt-in is recommended under the allowed scope above. It remains explicit, default-off, bounded, internal, reversible, and non-authoritative. Default-on/default cutover remains blocked by `default-on-blocker-register.md` and requires a future independent task spec, scorecard, validation run, and approval.
