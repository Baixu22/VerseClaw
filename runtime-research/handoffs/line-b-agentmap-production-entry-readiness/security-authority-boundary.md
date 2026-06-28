# Security / Authority Boundary

## Authority

AgentMap does not receive runtime, tool, security, approval, retry, completion, provider, model, Gateway, provider-ordering, TaskLoop decision, or patch authority.

Evidence:

- TaskLoop explicit invocation pilot metadata sets `noRuntimeAuthority`, `noToolAuthority`, `noGatewayCutover`, `noProviderTransportCutover`, `noModelMessageCutover`, and `noPersistence`.
- Runtime shadow report authority sets `noPromptAuthority`, `noToolAuthority`, `noRuntimeAuthority`, `noGatewayCutover`, `noProviderTransportCutover`, `noModelMessageCutover`, `legacyPromptAuthoritative`, and `taskLoopDecisionUnaffected`.
- Context provider registry tests prove AgentMap provider is not in the default provider list and runs only with explicit provider injection plus `runtime.agentMap.provider`.

## Candidate Boundary

Candidate text can enter only `agent_map.prompt_candidate.taskloop_explicit_invocation_pilot` after all prompt candidate gates, explicit invocation, and explicit valid `AgentMapResult`.

Candidate text must not enter default prompts, default TaskLoop reviewer prompts, model messages, Gateway requests, provider transport, checkpoint payloads, lifecycle payloads, provider ordering, or runtime decisions.

## Persistence Boundary

Candidate, shadow, and replay text is not persisted. No localStorage, indexedDB, electron-store, SQLite, Postgres, MySQL, Redis, sidecar file, queue, stream writer, service, listener, daemon, HTTP server, or WebSocket server is introduced.

## Discovery Boundary

The runtime does not automatically discover, build, cache, or reuse `AgentMapResult`. Missing or invalid input fails closed.
