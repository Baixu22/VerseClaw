# Authority Boundary Review

## AgentMap Must Not Gain

- runtime decision authority,
- tool authority,
- security/approval/retry/completion authority,
- provider/model/Gateway authority,
- checkpoint or lifecycle authority,
- provider-ordering authority,
- mutation/apply/edit authority.

## Current Boundary

The prompt-candidate helpers return structured diagnostics and prompt candidates only. The default path remains legacy. Runtime shadow reports are diagnostic and mark all authority fields as false/no-cutover. The TaskLoop explicit pilot can append candidate text only when all gates are explicitly enabled and explicit invocation is true.

## Evidence

Focused tests assert the candidate fields stay false for default prompt, default TaskLoop reviewer prompt, Gateway, model messages, provider transport, and persistence. Runtime shadow authority fields remain non-authoritative. Mutation/apply/edit scans are required before final status.
