---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-lazy-harness-selection.test.ts
  - tests/unit/gateway-native-language-parser-loading.test.ts
  - tests/unit/gateway-lazy-builtin-harness.test.ts
  - tests/unit/gateway-lazy-language-parsers.test.ts
  - tests/unit/gateway-device-token-reuse.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
---

A Gateway whose startup owner still rejects `connect` sets `startupPending: true` on its WebSocket challenge. The desktop readiness probe keeps polling until the owner accepts connections. Authenticated connection and capability checks still own the running transition.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback may mark readiness true after its timeout, but it must not emit duplicate ready transitions.

Main caches a Gateway-issued device token only after the device-token connection authenticates. Reuse requires the same paired device, endpoint and shared credential. A device-token mismatch discards that token and retries once with the existing shared-secret bootstrap. Transport failures and startup unavailability retain the token. Bootstrap completes the device-token connection before publishing readiness.

Startup queries for analyzer metadata keep native parsing dependencies deferred until file analysis. A parser becomes reusable after successful language initialization; analysis preserves the existing parse-fallback warnings and file results.

Built-in harness support metadata leaves the embedded execution graph unloaded until an attempt starts. The lazy runtime boundary preserves parameters, results and errors and writes loaded bytecode before execution can be interrupted. Optional cache controls retain their existing behavior.

Harness selection captures its decision and diagnostic trace before loading context-budget and lifecycle execution wrappers. Support queries leave those wrappers unloaded; execution uses the original budget and policy functions and persists available compilation at its runtime boundary.

Trajectory connection cleanup remains synchronous. The cleanup module loads its session resolver on the first valid read; session and path resolution retain their original owner and error contract.
