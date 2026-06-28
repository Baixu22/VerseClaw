# Security / Authority Boundary MVP

## AgentMap Authority

AgentMap does not receive runtime, tool, security, approval, retry, completion, provider, model, Gateway, provider-ordering, or TaskLoop decision authority.

Evidence:

- TaskLoop explicit invocation pilot metadata sets `noRuntimeAuthority`, `noToolAuthority`, `noGatewayCutover`, `noProviderTransportCutover`, `noModelMessageCutover`, and `noPersistence`.
- Runtime shadow report authority sets `noPromptAuthority`, `noToolAuthority`, `noRuntimeAuthority`, `noGatewayCutover`, `noProviderTransportCutover`, `noModelMessageCutover`, `legacyPromptAuthoritative`, and `taskLoopDecisionUnaffected`.
- Context provider registry tests keep default providers ordered and require explicit AgentMap provider injection plus a separate default-off provider gate.

## Candidate Boundary

Candidate text can enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` under all gates, explicit invocation, and explicit valid `AgentMapResult`.

Candidate text does not enter:

- default prompts
- default TaskLoop reviewer prompts
- model messages
- Gateway requests
- provider transport
- checkpoint default payloads
- lifecycle default payloads

## Persistence Boundary

No candidate, shadow, or replay text is persisted by this phase. No localStorage, indexedDB, electron-store, SQLite, Postgres, MySQL, Redis, sidecar, or stream writer is introduced for AgentMap candidate/shadow/replay output.

## Discovery Boundary

The runtime does not automatically discover, build, cache, or reuse `AgentMapResult`. Callers must supply an explicit valid result. Missing or invalid input fails closed.

## Provider Boundary

AgentMap is not registered as a default provider. `runtime.agentMap.provider` remains separate from prompt candidate pilots and default-off.
