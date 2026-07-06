# Default Path Parity Proof

Status: pass.

## Claim

When AgentMap prompt-candidate gates are omitted or disabled, the default TaskLoop reviewer prompt remains byte-identical to the legacy reviewer prompt.

## Evidence

- The existing readiness test replays 225 cases and records default reviewer prompt byte drift as 0.
- The TaskLoop controller test confirms runtime shadow diagnostics do not change reviewer context.
- The implementation-spec focused test confirms default-on-shaped keys alone resolve to disabled and legacy behavior.

## Boundary

The only accepted prompt-candidate insertion surface remains `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot`, and it requires all gates enabled, explicit invocation, a valid explicit `AgentMapResult`, available budget, and no prompt-present exclusion.

Default prompt assembly remains unchanged by this task.
