---
id: gateway-readiness-policy
title: Gateway Readiness Policy
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredTests:
  - tests/unit/gateway-events.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/gateway-store-status-snapshot.test.ts
---

Gateway status handling must preserve `gatewayReady` semantics.

`gatewayReady: false` means runtime-dependent refreshes should wait. `gatewayReady: true` means the Gateway reported readiness. `gatewayReady: undefined` is backward-compatible with older Gateway versions and must be treated as ready when the Gateway state is running.

Gateway manager fallback may mark readiness true after its timeout, but it must not emit duplicate ready transitions.

Status confirmation and reconciliation consume the complete Main Gateway snapshot, including readiness, port, PID, and connection time even when the lifecycle state stays the same.

A status event received after a snapshot request started remains current when that snapshot replies late.

Confirmation and reconciliation share a request sequence. A superseded response cannot apply or prevent the latest requested snapshot from applying.
