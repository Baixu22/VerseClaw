---
lifecycleStatus: active
id: network-io-governance
title: P4 network pooling and disk I/O shaping for TF-0401
scenario: gateway-backend-communication
type: task
taskType: runtime-bridge
intent: Route direct Main requests through one keep-alive pool with TTL DNS caching and actual connection metrics, coalesce production ACP SQLite updates, and phase-align WAL checkpoints without weakening proxy or durability semantics.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Repeated direct Main HTTPS requests reuse keep-alive connections and cached DNS answers without changing request or response behavior.
  - A configured fixed proxy still uses Electron net.fetch so proxy bypass rules and certificate handling remain Chromium-owned.
  - Bursts of ACP ledger updates are committed in bounded SQLite transactions, and every caller resolves only after its batch commits.
  - WAL checkpoints share the resource-fabric scheduler and unregister when their database closes.
touchedAreas:
  - electron/utils/network-pool.ts
  - electron/utils/proxy-fetch.ts
  - electron/main/proxy.ts
  - electron/services/mcp-api.ts
  - electron/services/remote-control-api.ts
  - electron/services/work-providers-api.ts
  - electron/utils/channel-config.ts
  - electron/utils/telemetry.ts
  - electron/utils/wechat-login.ts
  - openclaw_runtime/src/acp/event-ledger.ts
  - openclaw_runtime/src/infra/sqlite-wal.ts
  - openclaw_runtime/src/resources/resource-envelope.ts
  - shared/resources/write-coalescer.ts
  - shared/resources/index.ts
  - shared/types/resources.ts
  - tests/unit/electron-network-fetch-boundary.test.ts
  - tests/unit/electron-main-proxy-routing.test.ts
  - tests/unit/resource-network-pool.test.ts
  - tests/unit/resource-network-pool-https.test.ts
  - tests/unit/resource-write-coalescer.test.ts
  - tests/unit/resource-sqlite-write-coalescing.test.ts
  - tests/unit/resource-sqlite-wal.test.ts
  - harness/specs/tasks/network-io-governance.md
  - harness/specs/fixtures/tf0413-network-io/**
requiredTests:
  - tests/unit/electron-network-fetch-boundary.test.ts
  - tests/unit/electron-main-proxy-routing.test.ts
  - tests/unit/resource-network-pool.test.ts
  - tests/unit/resource-network-pool-https.test.ts
  - tests/unit/resource-write-coalescer.test.ts
  - tests/unit/resource-sqlite-write-coalescing.test.ts
  - tests/unit/resource-sqlite-wal.test.ts
  - tests/unit/mcp-api.test.ts
  - tests/unit/channel-config.test.ts
  - tests/unit/provider-validation.test.ts
  - tests/unit/wechat-login.test.ts
  - tests/unit/work-providers-api.test.ts
  - tests/unit/remote-control-api.test.ts
  - tests/unit/telemetry-consent.test.ts
acceptance:
  - The Electron source audit reports zero direct fetch calls outside the two transport-owner files.
  - Direct Electron requests use NetworkPool; fixed-proxy requests still use Electron net.fetch.
  - A controlled local HTTPS workload lowers repeated-request P50 by at least 30% and records actual opened connections, not a DNS-derived approximation.
  - A 20-update production ACP ledger burst commits in at most 12 transactions while preserving all 20 rows.
  - WAL maintenance registers one background checkpoint task and removes it on close.
  - Focused tests, typechecks, contract, harness, artifact retention, build, Electron smoke and comms replay/compare are recorded with agent-driven evidence.
docs:
  required: false
---

# TF-0413 P4 Network and I/O Governance

## Objective

Implement the P4 resource-fabric controls: a shared keep-alive HTTP pool with
TTL DNS caching and truthful connection metrics, production adoption at Main
fetch sites, bounded SQLite write coalescing for ACP replay updates, and WAL
checkpoint scheduling through the shared timer aligner.

## Transport Boundary

- Direct Electron requests use `NetworkPool` from `proxyAwareFetch`.
- When `applyProxySettings` selects `fixed_servers`, requests stay on Electron
  `net.fetch` so fixed proxy routing remains correct.
- `tests/unit/electron-network-fetch-boundary.test.ts` prevents new direct
  `fetch()` sites from bypassing the transport owner.

## Write Boundary

`createSqliteAcpEventLedger` queues write closures through `WriteCoalescer`.
Each batch executes inside one existing `runOpenClawStateWriteTransaction`.
Every `recordUpdate` promise resolves after its batch commits; a failed batch
rejects every caller in that batch and does not poison later batches.

## Acceptance

- The fixture records a controlled HTTPS A/B, the actual kept-open connection
  count, a real SQLite production-burst measurement, and the WAL scheduler
  registration/unregistration.
- The acceptance report labels the local benchmark scope and does not claim a
  cross-platform or production-traffic throughput result.