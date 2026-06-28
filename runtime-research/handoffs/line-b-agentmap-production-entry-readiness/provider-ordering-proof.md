# Provider Ordering Proof

## Default Ordering

Default provider order remains:

1. `legacy_context_engine`
2. `loop_context_pack`

AgentMap provider is not registered by default.

## Explicit Provider Boundary

AgentMap provider can run only when:

- it is explicitly injected into the pilot registry, and
- `runtime.agentMap.provider` is explicitly true.

Even then, default provider order is not rewritten. Explicit provider results are diagnostics/shadow evidence and remain legacy-authoritative false/no-prompt-authority.

## Evidence

`tests/unit/context-provider-registry.test.ts` covers:

- default providers only,
- explicit AgentMap provider injection,
- AgentMap provider flag off,
- explicit AgentMap and Symbol providers after default providers,
- provider failure isolation without changing legacy provider results.

Provider ordering drift: 0.
