# Rollback Proof

Status: accepted

Rollback is gate-based and cleanup-free because candidate/replay output must not persist.

| Rollback Gate | Expected Result |
|---|---|
| `runtime.agentMap.promptAssemblyExperiment=false` or omitted | legacy reviewer prompt byte parity |
| `runtime.agentMap.promptCandidateRuntimeShadow=false` or omitted | legacy reviewer prompt byte parity |
| `runtime.agentMap.promptCandidateControlledCutoverPilot=false` or omitted | legacy reviewer prompt byte parity |
| `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot=false` or omitted | legacy reviewer prompt byte parity |
| `explicitInvocation=false` | legacy reviewer prompt byte parity |
| missing/invalid explicit `AgentMapResult` | legacy reviewer prompt byte parity |
| budget exhausted | legacy reviewer prompt byte parity |
| empty candidate | legacy reviewer prompt byte parity |
| prompt-present exclusion leaves no candidate content | legacy reviewer prompt byte parity or named-surface-only insertion without excluded file |

Target:

```text
rollback by any gate = 100%
```

No disk cleanup command is required because replay/candidate output is not persisted.
