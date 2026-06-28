# Provider Ordering Proof

Default provider order must remain:

1. `legacy-context-engine`
2. `loop-context-pack`

AgentMap must not be registered as a default provider. Explicit context-provider injection remains separate from default provider ordering and must stay diagnostics/shadow-only.

Proof sources:

- `tests/unit/runtime-agent-map-default-on-deep-validation.test.ts`
- `tests/unit/context-provider-registry.test.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`

Provider ordering drift target: 0.
