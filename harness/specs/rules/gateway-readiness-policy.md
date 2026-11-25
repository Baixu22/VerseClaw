---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - openclaw_runtime/src/gateway/server/ws-connection.lazy.test.ts
  - openclaw_runtime/src/gateway/server/health-state.lazy.test.ts
  - openclaw_runtime/src/infra/update-available-state.test.ts
  - tests/unit/gateway-lazy-harness-selection.test.ts
  - tests/unit/gateway-native-language-parser-loading.test.ts
  - tests/unit/gateway-lazy-builtin-harness.test.ts
  - tests/unit/gateway-lazy-language-parsers.test.ts
  - tests/unit/gateway-device-token-reuse.test.ts
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-store-status-snapshot.test.ts
---

A Gateway whose startup owner still rejects `connect` sets `startupPending: true` on its WebSocket challenge. The desktop readiness probe keeps polling until the owner accepts connections. Authenticated connection and capability checks still own the running transition.

Challenge-only probes leave the authentication/RPC handler unloaded. Incoming frames trigger one load per connection and retain the bounded, serial startup queue. Closing a socket clears its queued frames and prevents late handler attachment; idle connections retain their handshake timeout.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback may mark readiness true after its timeout, but it must not emit duplicate ready transitions.

Status confirmation and reconciliation consume the complete Main Gateway snapshot, including readiness, port, PID, and connection time even when the lifecycle state stays the same.

A status event received after a snapshot request started remains current when that snapshot replies late.

Confirmation and reconciliation share a request sequence. A superseded response cannot apply or prevent the latest requested snapshot from applying.

A successful managed launch may consume queued configuration reloads only when
their request revision was captured before launch configuration was read and has
not changed. Explicit restarts, later reloads and reconnects without that capture
remain pending. Flush requests queued during a restart after its promise settles;
completion timestamps do not establish which configuration a process loaded.

An explicit stop supersedes pending restart work at each asynchronous boundary.
A superseded restart must not start a new process, re-enable reconnect, or record
a successful restart after the stop.

Source-runtime isolation must initialize startup-gated session methods through
the same runtime startup path in ordinary and E2E windows. It must not inject a
delay that makes a connected source Gateway unusable for session operations.

Main caches a Gateway-issued device token only after the device-token connection authenticates. Reuse requires the same paired device, endpoint and shared credential. A device-token mismatch discards that token and retries once with the existing shared-secret bootstrap. Transport failures and startup unavailability retain the token. Bootstrap completes the device-token connection before publishing readiness.

Startup queries for analyzer metadata keep native parsing dependencies deferred until file analysis. A parser becomes reusable after successful language initialization; analysis preserves the existing parse-fallback warnings and file results.

Built-in harness support metadata leaves the embedded execution graph unloaded until an attempt starts. The lazy runtime boundary preserves parameters, results and errors and writes loaded bytecode before execution can be interrupted. Optional cache controls retain their existing behavior.

Harness selection captures its decision and diagnostic trace before loading context-budget and lifecycle execution wrappers. Support queries leave those wrappers unloaded; execution uses the original budget and policy functions and persists available compilation at its runtime boundary.

Trajectory connection cleanup remains synchronous. The cleanup module loads its session resolver on the first valid read; session and path resolution retain their original owner and error contract.

Handshake snapshots read cached health and update availability synchronously without loading probe or updater execution. Health refreshes retain separate public and sensitive work, publish only public results, and release failed refreshes for retry. Updater notifications and handshake snapshots share the same update state.
