---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-device-token-reuse.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
---

Gateway status handling must preserve `gatewayReady` semantics.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback may mark readiness true after its timeout, but it must not emit duplicate ready transitions.

Main caches a Gateway-issued device token only after the device-token connection authenticates. Reuse requires the same paired device, endpoint and shared credential. A device-token mismatch discards that token and retries once with the existing shared-secret bootstrap. Transport failures and startup unavailability retain the token. Bootstrap completes the device-token connection before publishing readiness.
