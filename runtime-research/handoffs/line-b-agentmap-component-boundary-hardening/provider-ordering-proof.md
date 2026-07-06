# Provider Ordering Proof

Status: pass.

Claim: provider ordering is unchanged and AgentMap is not registered as a default provider.

Expected manifest order:

1. `legacy-context-engine`
2. `loop-context-pack`

Both manifests remain `enabledByDefault: false` and `shadowOnly: true`.

Count: `provider_ordering_drift = 0`.

Decision: AgentMap remains out of default provider registration.
