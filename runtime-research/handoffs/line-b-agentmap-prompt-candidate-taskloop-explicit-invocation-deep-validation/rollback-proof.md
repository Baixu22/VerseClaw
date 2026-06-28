# Rollback Proof

Rollback is gate-based and data-cleanup-free.

| Rollback Action | Result | Evidence |
|---|---|---|
| Disable `runtime.agentMap.promptAssemblyExperiment` | pass | Legacy reviewer prompt byte parity with `gate_disabled`. |
| Disable `runtime.agentMap.promptCandidateRuntimeShadow` | pass | Legacy reviewer prompt byte parity with `gate_disabled`. |
| Disable `runtime.agentMap.promptCandidateControlledCutoverPilot` | pass | Legacy reviewer prompt byte parity with `gate_disabled`. |
| Disable `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot` | pass | Legacy reviewer prompt byte parity with `gate_disabled`. |
| Omit explicit invocation | pass | Legacy reviewer prompt byte parity with `invocation_not_requested`. |
| Omit explicit valid AgentMapResult | pass | Legacy reviewer prompt byte parity with `invalid_agent_map_result`. |
| Keep AgentMap provider omitted | pass | Provider ordering tests pass; no default AgentMap provider registration is added. |
| Roll back after inserted pilot output | pass | Candidate/replay output is not persisted; no disk cleanup required. |
