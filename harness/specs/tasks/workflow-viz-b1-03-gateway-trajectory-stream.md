---
id: workflow-viz-b1-03-gateway-trajectory-stream
title: Workflow Viz B1-03 Gateway trajectory read subscribe and gap repair
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Expose the persisted openclaw-trajectory stream through bounded Gateway read and subscription methods with deterministic seq gap reporting while preserving observability.traces compatibility.
ownedPaths:
  - harness/specs/tasks/workflow-viz-b1-03-gateway-trajectory-stream.md
  - openclaw_runtime/src/gateway/trajectory-gateway.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods-list.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.test.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.server.test.ts
touchedAreas:
  - harness/specs/tasks/workflow-viz-b1-03-gateway-trajectory-stream.md
  - openclaw_runtime/src/gateway/trajectory-gateway.ts
  - openclaw_runtime/src/gateway/server-methods/role-orchestration-methods.ts
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods-list.ts
  - openclaw_runtime/src/gateway/server.impl.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.test.ts
  - openclaw_runtime/src/gateway/trajectory-gateway.server.test.ts
expectedUserBehavior:
  - A Gateway client can read a bounded trajectory page after a supplied seq and request a deterministic gap repair page.
  - A subscribed connection receives ordered trajectory batches or an explicit gap notification and never receives guessed events.
  - The existing observability.traces response remains unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - Electron Main supply, renderer store/UI, direct renderer IPC, Gateway HTTP, or Gateway WebSocket client calls
  - changes to files covered by lint:dcs
  - changes to B1-04, B2, B3, TF-0021, or TF-0010 ownership
  - a second trajectory format or parallel event authority
  - silently repairing a seq gap, duplicate, malformed range, or missing stable event identity
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b1-03-gateway-trajectory-stream.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b1-03-gateway-trajectory-stream.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b1-03-gateway-trajectory-stream.md --dry-run
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.gateway-server.config.ts src/gateway/trajectory-gateway.server.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - observability.readFrom validates sessionKey, fromSeq, toSeq, and limit; it reads v1/v2 rows from the persisted trajectory source in ascending seq order.
  - observability.subscribe and observability.unsubscribe are connection-scoped; subscription payloads carry ordered events or an explicit gap descriptor.
  - A gap is reported when the next persisted seq is greater than the requested last seq plus one; the Gateway never invents missing context or rows.
  - Re-reading a reported range and replaying the returned rows produces the same deterministic state as the original page.
  - Duplicate/invalid rows are rejected or explicitly reported, and the legacy observability.traces RPC remains behaviorally compatible.
  - Tests cover read bounds, v1/v2 parsing, ordered subscription delivery, disconnect/replacement cleanup, and gap repair behavior.
  - No Electron, renderer, task-loop/DCS, UI-only, or Runtime Authority files are changed.
docs:
  required: false
  note: This card adds a Gateway backend boundary only; Electron supply and client projection are B1-04 and later cards.
---

# Workflow Viz B1-03 boundary

This task consumes the persisted v2 trajectory fact source and the B1-01 parser/replay contract. `observability.readFrom` is the bounded history/gap-repair API. `observability.subscribe` emits connection-targeted `observability.trajectory` frames containing ordered batches or an explicit `gap` descriptor. The old `observability.traces` method remains untouched for migration compatibility.
