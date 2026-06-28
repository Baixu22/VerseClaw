# Operator Runbook

Current status is `accepted_for_limited_production_opt_in`. The steps below apply only to bounded internal sessions after confirming the synthesis status and all default-off boundaries.

## Start

1. Confirm `synthesis.md` is `Status: accepted_for_limited_production_opt_in`.
2. Confirm the session is internal and allowlisted.
3. Confirm default-on/default cutover remains forbidden.
4. Confirm all prompt candidate gates are explicitly true only for the selected session.
5. Provide an explicit valid `AgentMapResult`.
6. Set `explicitInvocation=true`.
7. Set an explicit bounded token budget.

## During Run

Monitor diagnostics:

- inserted
- blocked
- fail_closed
- budget_exhausted
- prompt_present_excluded
- invalid_result
- gate_disabled
- invocation_not_requested
- leakage_count
- provider_ordering_drift
- rollback_success

## Stop Immediately

Stop and roll back if:

- leakage_count is greater than 0,
- provider_ordering_drift is greater than 0,
- invalid/missing/gated-off cases fail open,
- default reviewer prompt bytes drift,
- candidate text appears in default prompt/model/Gateway/provider/checkpoint/lifecycle,
- candidate/shadow/replay text is persisted,
- a new service/listener/database/server path is introduced,
- AgentMap gains runtime/tool/security/approval/retry/completion/provider/model/Gateway authority.

## Rollback

Close any prompt candidate gate, omit explicit invocation, or omit the explicit result. Verify legacy reviewer prompt byte parity and no cleanup requirement.
