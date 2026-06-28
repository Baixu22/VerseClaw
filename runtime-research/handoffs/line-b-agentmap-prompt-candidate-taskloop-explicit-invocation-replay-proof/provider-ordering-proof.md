# Provider Ordering Proof

Provider ordering remains unchanged.

## Evidence

- `tests/unit/context-provider-registry.test.ts` asserts default registry manifests remain:
  - `legacy_context_engine`
  - `loop_context_pack`
- The provider registry does not execute AgentMap unless an AgentMap provider is explicitly injected and `runtime.agentMap.provider` is enabled.
- Explicit AgentMap and Symbol providers run only as shadow diagnostics after default providers when injected.
- The TaskLoop explicit invocation pilot does not register an AgentMap provider and does not alter provider ordering.

## Result

Pass. The explicit pilot consumes only caller-supplied `AgentMapResult` input and does not change context provider ordering, Gateway/model/provider transport ordering, or default provider registration.
