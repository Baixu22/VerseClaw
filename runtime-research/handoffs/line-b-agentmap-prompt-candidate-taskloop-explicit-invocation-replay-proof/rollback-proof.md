# Rollback Proof

Rollback requires no data cleanup because candidate/replay output is not persisted.

| Rollback action | Result |
|---|---|
| Disable `runtime.agentMap.promptAssemblyExperiment` | legacy reviewer prompt byte parity restored |
| Disable `runtime.agentMap.promptCandidateRuntimeShadow` | legacy reviewer prompt byte parity restored |
| Disable `runtime.agentMap.promptCandidateControlledCutoverPilot` | legacy reviewer prompt byte parity restored |
| Disable `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot` | legacy reviewer prompt byte parity restored |
| Omit explicit TaskLoop pilot invocation | legacy reviewer prompt byte parity restored |
| Omit explicit AgentMapResult | legacy reviewer prompt byte parity restored |
| Supply invalid AgentMapResult | legacy reviewer prompt byte parity restored |
| Exhaust budget | legacy reviewer prompt byte parity restored, no partial insertion |

## Result

Pass. Any closed gate or missing explicit input immediately restores legacy reviewer prompt bytes. AgentMap remains default-off and non-authoritative.
