# Controlled Internal Opt-in Execution Plan

Controlled internal opt-in remains the entry mode. Production-entry review uses this evidence to decide whether a limited production opt-in can be recommended, not whether default-on can be enabled.

## Operators

| Role | Responsibility |
|---|---|
| Readiness owner | Confirms prerequisites, validation evidence, scorecard, and final synthesis. |
| Internal operator | Selects allowlisted sessions and supplies explicit `AgentMapResult`. |
| Runtime reviewer | Confirms no default prompt, provider, Gateway, model, checkpoint, lifecycle, or authority drift. |
| Release approver | Approves or rejects limited production opt-in scope. |

## Required Gates

All gates remain default-off by omission:

- `runtime.agentMap.promptAssemblyExperiment`
- `runtime.agentMap.promptCandidateRuntimeShadow`
- `runtime.agentMap.promptCandidateControlledCutoverPilot`
- `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot`
- `runtime.agentMap.provider` remains separate and default-off.

Invocation also requires:

- `explicitInvocation=true`
- explicit valid `AgentMapResult`
- bounded token budget
- prompt-present file exclusion
- no automatic discovery/build/cache/reuse
- no persistence

## Execution Flow

1. Confirm prerequisites in `prerequisite-check.md`.
2. Select an allowlisted internal task and session.
3. Build or provide an `AgentMapResult` outside the default runtime path.
4. Invoke the TaskLoop explicit pilot only for that sample.
5. Capture diagnostics and sample metrics.
6. Confirm fail-closed behavior on gated-off, invalid, missing, and budget-exhausted cases.
7. Confirm no candidate text enters default prompts, model messages, Gateway/provider transport, lifecycle, or checkpoint payloads.
8. Roll back by closing any gate or omitting explicit invocation/result.

## Exit Conditions

Exit controlled internal opt-in immediately if any veto fires, including candidate leakage, default reviewer prompt drift, provider ordering drift, persistence, runtime authority escalation, fail-open invalid/missing/gated-off cases, rollback failure, renderer direct IPC/Gateway, or a new service/listener/database/server path.
