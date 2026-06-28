# Rollback Drill Report

Rollback drill cases:

| Gate | Expected outcome |
|---|---|
| `promptAssemblyExperiment=false` | Legacy reviewer prompt bytes restored. |
| `promptCandidateRuntimeShadow=false` | Legacy reviewer prompt bytes restored. |
| `promptCandidateControlledCutoverPilot=false` | Legacy reviewer prompt bytes restored. |
| `promptCandidateTaskLoopExplicitInvocationPilot=false` | Legacy reviewer prompt bytes restored. |
| `explicitInvocation=false` | Legacy reviewer prompt bytes restored. |
| Missing `AgentMapResult` | Legacy reviewer prompt bytes restored. |
| Invalid `AgentMapResult` | Legacy reviewer prompt bytes restored. |
| Budget exhausted | Legacy reviewer prompt bytes restored with no partial insertion. |

Rollback target: 100 percent pass.

No cleanup is required because this task must not add candidate/shadow/replay persistence.
