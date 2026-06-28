# Production Rollback Runbook

Default-on is not enabled by this task, so production rollback is a gate-closure runbook for future specs.

## Immediate Closure Gates

1. Set `runtime.agentMap.promptAssemblyExperiment` to omitted or false.
2. Set `runtime.agentMap.promptCandidateRuntimeShadow` to omitted or false.
3. Set `runtime.agentMap.promptCandidateControlledCutoverPilot` to omitted or false.
4. Set `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot` to omitted or false.
5. Omit explicit invocation.
6. Omit AgentMapResult.
7. Reject invalid or malformed AgentMapResult.
8. Set token budget to zero.
9. Treat prompt-present files as exclusions.

Each closure must restore legacy TaskLoop reviewer prompt bytes and keep candidate text out of default prompts, model messages, Gateway/provider transport, checkpoint payloads, lifecycle payloads, and persistence.

## Operator Rule

If leakage, persistence, provider-ordering drift, default reviewer prompt byte drift, renderer direct IPC/Gateway drift, service/listener/database drift, or authority escalation is detected, status cannot exceed `needs_follow_up`; hard vetoes force `blocked`.
