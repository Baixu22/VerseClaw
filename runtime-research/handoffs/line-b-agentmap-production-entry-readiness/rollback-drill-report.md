# Rollback Drill Report

Rollback requires legacy reviewer prompt byte parity and no data cleanup.

| Drill | Expected outcome | Result |
|---|---|---|
| `promptAssemblyExperiment=false` | Legacy reviewer prompt bytes restored | pass |
| `promptCandidateRuntimeShadow=false` | Legacy reviewer prompt bytes restored | pass |
| `promptCandidateControlledCutoverPilot=false` | Legacy reviewer prompt bytes restored | pass |
| `promptCandidateTaskLoopExplicitInvocationPilot=false` | Legacy reviewer prompt bytes restored | pass |
| `explicitInvocation=false` | Legacy reviewer prompt bytes restored | pass |
| Missing `AgentMapResult` | Invalid-result diagnostic, legacy reviewer prompt bytes | pass |
| Invalid `AgentMapResult` | Invalid-result diagnostic, legacy reviewer prompt bytes | pass |
| Budget exhausted | Budget diagnostic, no silent partial insertion, legacy reviewer prompt bytes | pass |

Rollback success: 8/8.

No cleanup is required because candidate, shadow, and replay text is not persisted. If a future task introduces persistence, that task must create a separate rollback and deletion plan before approval.
