# Rollback Drill Plan

Status: accepted for future execution.

## Drill Cases

Each case must restore legacy TaskLoop reviewer prompt byte parity:

1. `runtime.agentMap.promptAssemblyExperiment=false`
2. `runtime.agentMap.promptCandidateRuntimeShadow=false`
3. `runtime.agentMap.promptCandidateControlledCutoverPilot=false`
4. `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot=false`
5. `explicitInvocation=false`
6. missing `AgentMapResult`
7. invalid `AgentMapResult`
8. malformed `AgentMapResult`
9. exhausted candidate budget
10. prompt-present exclusion
11. default-on-shaped config keys without the accepted gates

## Pass Criteria

- reviewer prompt bytes equal the legacy reviewer prompt;
- candidate text is absent from default prompts, model messages, Gateway requests, provider transport, checkpoint payloads, lifecycle payloads, and runtime decisions;
- candidate `persisted` is false;
- diagnostics are bounded and raw-text-free;
- no cleanup step is required because no candidate/shadow/replay output is persisted.
