# Provider Ordering Proof

## Required Order

The default context provider registry must remain:

1. `legacy-context-engine`
2. `loop-context-pack`

Both default manifests must remain `enabledByDefault: false` and `shadowOnly: true`.

## Forbidden Drift

- No AgentMap provider default registration.
- No automatic AgentMap provider enablement.
- No provider/model/Gateway routing changes.
- No provider ordering authority for AgentMap.

## Current Test Evidence

The implementation-readiness test creates `createContextProviderRegistryPilot()` and asserts the default manifest order and default-off shadow-only state. The final synthesis records focused test and scan results.
