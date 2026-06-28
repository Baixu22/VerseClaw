# Provider Ordering Proof

Status: accepted

The replay proof must not change context provider ordering, model provider ordering, Gateway transport ordering, or renderer transport policy.

Proof sources:

- `tests/unit/context-provider-registry.test.ts`
- boundary scan for AgentMap flags in runtime/Gateway/Electron/renderer/shared surfaces;
- review of `agent-map-prompt-candidate-taskloop-explicit-invocation-pilot.ts`, which only assembles a caller-owned prompt candidate result and does not register providers.

Expected result:

```text
provider ordering drift = 0
```

No provider registration, provider sort, model selection, Gateway request, WebSocket, HTTP, or renderer direct IPC change is allowed in this phase.
