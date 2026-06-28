# Controlled Internal Opt-in MVP

Controlled internal opt-in is recommended only for internal, explicitly configured evaluation. It remains default-off and does not approve production traffic, default-on AgentMap, or default cutover.

## Entry Conditions

| Condition | Required |
|---|---|
| Phase A Replay Proof | accepted |
| Deep Validation | accepted |
| Production Readiness Plan | accepted |
| Phase 8/9/10/11/12/13 AgentMap syntheses | accepted |
| Required Phase B validation | passed or clean-overlay passed with live dirty-tree noise recorded |
| Quality score | at least 90/100 |
| Veto gates | none fired |

## Required Gates

All gates remain default-off by omission:

- `runtime.agentMap.promptAssemblyExperiment`
- `runtime.agentMap.promptCandidateRuntimeShadow`
- `runtime.agentMap.promptCandidateControlledCutoverPilot`
- `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot`

Opt-in invocation also requires:

- `explicitInvocation=true`
- explicit valid `AgentMapResult`
- bounded token budget
- prompt-present file exclusion
- no automatic discovery/build/cache/reuse

## Human Invocation Contract

An internal operator must explicitly request the pilot path and supply a valid `AgentMapResult`. No UI, production switch, background process, Gateway path, provider path, or renderer path can auto-enable it.

## Rollback Conditions

Rollback is immediate if any of these occur:

- default reviewer prompt byte drift
- candidate leakage into default prompt/model/Gateway/provider/checkpoint/lifecycle payloads
- provider ordering drift
- candidate/shadow/replay persistence
- AgentMap authority escalation
- any missing/invalid input fails open
- any gate closure fails to restore legacy parity

Rollback action: turn off any AgentMap prompt candidate gate or omit explicit invocation/result. No data cleanup is required because candidate/shadow/replay output is non-persistent.
