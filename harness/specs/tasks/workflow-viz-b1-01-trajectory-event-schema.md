---
id: workflow-viz-b1-01-trajectory-event-schema
title: Workflow Viz B1-01 trajectory event schema contract
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the openclaw-trajectory v2 event contract and deterministic replay boundary without wiring ordinary session producers, Gateway RPC/subscriptions, Electron supply, or renderer projections.
ownedPaths:
  - harness/specs/tasks/workflow-viz-b1-01-trajectory-event-schema.md
  - openclaw_runtime/src/trajectory/types.ts
  - openclaw_runtime/src/trajectory/schema.ts
  - openclaw_runtime/src/trajectory/replay.ts
  - openclaw_runtime/src/trajectory/trajectory-schema.test.ts
touchedAreas:
  - harness/specs/tasks/workflow-viz-b1-01-trajectory-event-schema.md
  - openclaw_runtime/src/trajectory/types.ts
  - openclaw_runtime/src/trajectory/schema.ts
  - openclaw_runtime/src/trajectory/replay.ts
  - openclaw_runtime/src/trajectory/trajectory-schema.test.ts
expectedUserBehavior:
  - A v2 trajectory event can be validated, serialized, read back, and replayed deterministically by sequence number.
  - v1 openclaw-trajectory JSONL rows remain readable through an explicit compatibility adapter.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - ordinary session producer wiring or changes under openclaw_runtime/src/agents/**
  - new Gateway RPC, subscription, HTTP, or WebSocket interface
  - Electron Main supply or renderer store/UI changes
  - direct renderer IPC, Gateway HTTP, or Gateway WebSocket calls
  - a second trajectory format or parallel event authority
  - changes to files covered by lint:dcs
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b1-01-trajectory-event-schema.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b1-01-trajectory-event-schema.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b1-01-trajectory-event-schema.md --dry-run
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.unit-src.config.ts src/trajectory/trajectory-schema.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - v2 events cover run/start, run/end, turn/start, turn/end, step/start, step/end, tool/start, tool/update, and tool/end lifecycle roles.
  - Every v2 event carries schemaVersion, a positive integer seq, a lifecycle role, and stable business identifiers required by that role.
  - State-bearing start/update/end events carry the complete post-change state snapshot for their stable id; consumers never infer state by guessing the nearest context.
  - Validation rejects malformed or unknown events, and replay has deterministic behavior for non-monotonic sequences.
  - Replay of start/update/end events is semantically equal to applying the same complete state snapshots with replace semantics.
  - v1 rows are explicitly identified and adapted without inventing missing stable ids.
  - JSON serialization and deserialization preserve the validated event meaning.
  - Tests cover invalid events, non-monotonic seq, missing stable ids, deterministic replay, v1 compatibility, and round-trip serialization.
  - No ordinary session producer, Gateway interface, Electron supply path, renderer boundary, or lint:dcs file changes are introduced.
docs:
  required: false
  note: This contract-only task has no user-facing UI or transport behavior; later producer, Gateway, Electron, and projection tasks must update docs when their behavior changes.
---

# Workflow Viz B1-01 boundary

This task is the sole ready implementation card under the independent Workflow Viz task tree. It establishes the event schema and replay contract only. B1-02 producer wiring, B1-03 Gateway read/subscribe, B1-04 Electron supply, B2 assembly, and B3 presentation remain out of scope.

The schema evolves the existing `openclaw-trajectory` namespace to version 2. The compatibility reader is an explicit migration boundary for existing v1 trajectory files; it must reject missing stable identifiers rather than infer a recent run, turn, step, or tool context.

Because the touched path is a runtime bridge boundary, this spec references `gateway-backend-communication` and inherits the renderer/Main and communication regression rules even though this card must not add a transport or renderer call.
