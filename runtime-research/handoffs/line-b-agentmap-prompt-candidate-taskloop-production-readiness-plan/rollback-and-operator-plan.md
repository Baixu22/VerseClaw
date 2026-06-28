# Rollback and Operator Plan

## Rollback Model

Rollback is gate-based and data-cleanup-free because candidate/replay output must not persist.

| Rollback Action | Expected Result |
|---|---|
| Disable `runtime.agentMap.promptAssemblyExperiment` | legacy reviewer prompt byte parity |
| Disable `runtime.agentMap.promptCandidateRuntimeShadow` | legacy reviewer prompt byte parity |
| Disable `runtime.agentMap.promptCandidateControlledCutoverPilot` | legacy reviewer prompt byte parity |
| Disable `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot` | legacy reviewer prompt byte parity |
| Omit explicit TaskLoop pilot invocation | legacy reviewer prompt byte parity |
| Omit explicit valid AgentMapResult | legacy reviewer prompt byte parity |
| Remove per-session opt-in | legacy reviewer prompt byte parity |
| Remove per-agent opt-in | legacy reviewer prompt byte parity |
| Remove workspace allowlist | legacy reviewer prompt byte parity |

## Operator Commands and Paths

Current phase does not add a command. Future operator actions must use existing configuration/editing mechanisms only and must not introduce a service, daemon, listener, database, WebSocket, HTTP server, renderer direct IPC, or direct Gateway transport.

For the current accepted pilot, the effective rollback path is:

1. remove or set any AgentMap prompt candidate gate to false;
2. omit explicit invocation;
3. omit the explicit AgentMapResult;
4. keep provider registration omitted.

## Diagnostics Required

Operator-safe diagnostics must include:

- gate state;
- explicit invocation state;
- explicit AgentMapResult validity;
- candidate status;
- token budget and estimate;
- prompt-present exclusion count;
- no-persistence assertion;
- default prompt drift result;
- provider ordering drift result;
- rollback parity result.

Diagnostics must not include persisted candidate text.

## Incident Response

If a veto fires:

1. disable an AgentMap gate or remove scoped opt-in;
2. verify legacy reviewer prompt byte parity;
3. verify provider ordering snapshot parity;
4. verify no candidate leakage in default prompt/model/Gateway/provider payloads;
5. verify no candidate/replay output persistence;
6. record the incident in the relevant synthesis before reopening readiness.

## Ownership

The readiness owner must keep the synthesis current with exact validation commands and results. A future implementation owner must create a separate task spec for any runtime, UI, config, or production opt-in code change.
