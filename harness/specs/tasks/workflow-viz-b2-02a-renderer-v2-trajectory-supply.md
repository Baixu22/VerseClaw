---
lifecycleStatus: archived
id: workflow-viz-b2-02a-renderer-v2-trajectory-supply
title: Workflow Viz B2-02A renderer v2 trajectory supply bridge
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: bbe926dd6152bf5460730aeed64dd03786a3b25c
intent: Let the renderer receive raw validated TrajectoryEventV2 history and realtime updates through the existing Main-owned host-api/host-events boundary, with a deterministic asOfSeq/dedupe handoff, so B2-02 store convergence can consume B2-01 assembler output without reverse-engineering ObservabilityTrace projections.
ownedPaths:
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/**
  - harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
  - electron/main/ipc-handlers.ts
  - electron/services/observability-api.ts
  - electron/services/observability-trajectory-index.ts
  - shared/types/observability.ts
  - shared/host-events/contract.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - tests/unit/observability-trajectory-supply.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/host-api-facade.test.ts
touchedAreas:
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/**
  - harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
  - electron/main/ipc-handlers.ts
  - electron/services/observability-api.ts
  - electron/services/observability-trajectory-index.ts
  - shared/types/observability.ts
  - shared/host-events/contract.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - src/lib/host-events.ts
  - tests/unit/observability-trajectory-supply.test.ts
  - tests/unit/host-events.test.ts
  - tests/unit/host-api-facade.test.ts
expectedUserBehavior:
  - The renderer can query validated v2 trajectory history for a session through host-api and receive subsequent raw v2 events in seq order through host-events, without any new renderer transport surface.
  - Cold history plus realtime delivery joins at an explicit asOfSeq so no accepted event is lost or double-appended; duplicates and late events are deterministically excluded.
  - Sessions that only have v1 legacy data are explicitly reported as legacy fallback and never appear in the v2 event supply.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - reconstructing TrajectoryEventV2 from ObservabilityTrace, spans, or graph rows
  - adapting v1 rows into v2 or guessing missing stable IDs from recent context
  - renderer JSONL scanning, direct renderer IPC, Gateway HTTP/WebSocket calls, or a parallel trajectory event format
  - new Gateway RPC methods or subscription protocol changes (only B1-03 observability.readFrom/subscribe reuse is allowed)
  - feeding renderer assembly from electron/services/observability-trajectory.ts file scans
  - changes to files covered by lint:dcs
  - changes to B1 schema/producers/Gateway protocol, B2 stores, B3, TF-0021, or Runtime Authority
  - silently repairing seq gaps, duplicate events, malformed events, or missing stable identities
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b2-02a-renderer-v2-trajectory-supply.md --dry-run
  - pnpm exec vitest run tests/unit/observability-trajectory-supply.test.ts tests/unit/observability-trajectory-projection.test.ts
  - pnpm exec vitest run tests/unit/host-events.test.ts tests/unit/host-api-facade.test.ts tests/unit/host-invoke.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - Main exposes validated TrajectoryEventV2 history reads and realtime delivery on the existing Main-owned observability supply chain; the raw v2 rows are re-validated with the B1-01 schema before crossing the host boundary.
  - Main rejects an invalid or v1 row at the raw-v2 renderer boundary; v1 stays explicit legacy state reported per session and never enters the v2 supply.
  - Stable IDs and full state values survive JSON serialization and the host boundary unchanged.
  - History plus realtime events joined at the reported asOfSeq produce the same ordered v2 sequence as a full Main replay; duplicates and late/older events have a defined deterministic dedupe/rejection behavior.
  - History reads reuse only B1-03's Main-owned observability.readFrom or the projector's already-validated v2 state; the renderer never scans trajectory files or builds a second cache authority.
  - No renderer code adds direct IPC, Gateway HTTP, or WebSocket use; renderer access goes only through src/lib/host-api.ts and src/lib/host-events.ts.
  - Tests cover invalid/v1 rejection at the boundary, JSON round-trip identity, history+realtime vs full-replay equivalence, deterministic duplicate/late handling, explicit v1 legacy reporting, and no new renderer transport surface.
docs:
  required: false
  note: This task adds the Main-owned raw v2 supply bridge only. Store migration belongs to WV-B2-02 (TF-0063) and display work belongs to B3.
---

# Workflow Viz B2-02A boundary

The B2-01 assembler accepts only raw `TrajectoryEventV2`. The current renderer only receives `ObservabilityRuntimeEvent` trace projections, which must not be reverse-engineered into v2 events. This task adds the missing Main-owned bridge: validated v2 history through host-api and realtime raw v2 events through host-events, joined by an explicit `asOfSeq` handoff. The Gateway `observability.readFrom`/`subscribe` machinery from B1-03 remains the only remote event source, and the Main projector remains the single validation point; this bridge exposes exactly that validated state, never a second authority.
