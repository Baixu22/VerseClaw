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
