# Submission Template

Use this template for any limited production opt-in evidence submission.

```text
Sample ID:
Operator:
Session:
Date:

Prerequisites:
- Phase B accepted_for_controlled_internal_opt_in:
- AgentMap default-off:
- explicitInvocation=true:
- valid AgentMapResult:
- bounded token budget:

Results:
- inserted:
- blocked:
- fail_closed:
- budget_exhausted:
- prompt_present_excluded:
- invalid_result:
- gate_disabled:
- invocation_not_requested:
- leakage_count:
- provider_ordering_drift:
- rollback_success:

Boundary Checks:
- default reviewer prompt drift:
- candidate in default prompt/model/Gateway/provider/checkpoint/lifecycle:
- candidate/shadow/replay persistence:
- renderer direct IPC/Gateway:
- service/listener/database/server:
- runtime/tool/security/approval/retry/completion/provider/model/Gateway authority:

Decision:
- pass/fail:
- rollback needed:
- notes:
```
