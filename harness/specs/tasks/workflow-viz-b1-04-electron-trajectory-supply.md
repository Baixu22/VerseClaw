---
id: workflow-viz-b1-04-electron-trajectory-supply
title: Workflow Viz B1-04 Electron trajectory supply projection
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Move Electron Main observability supply from periodic runtime snapshot pulls and disk synthesis to a Gateway trajectory subscription with deterministic seq-based gap repair, while retaining v1 disk reads as an explicitly deprecated migration fallback.
ownedPaths:
  - harness/specs/tasks/workflow-viz-b1-04-electron-trajectory-supply.md
  - electron/main/ipc-handlers.ts
  - electron/services/observability-api.ts
  - electron/services/observability-trajectory-index.ts
  - tests/unit/observability-trajectory-projection.test.ts
touchedAreas:
  - harness/specs/tasks/workflow-viz-b1-04-electron-trajectory-supply.md
  - electron/main/ipc-handlers.ts
  - electron/services/observability-api.ts
  - electron/services/observability-trajectory-index.ts
  - tests/unit/observability-trajectory-projection.test.ts
expectedUserBehavior:
  - Electron observability receives ordered trajectory updates from the Gateway and projects them into the existing trace/index model.
  - A Gateway reconnect resumes each known session from its last accepted seq; a reported gap is repaired with readFrom and never guessed locally.
  - Existing v1 trajectory files remain readable during migration and are marked as legacy fallback data.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - renderer store/UI changes, direct renderer IPC, Gateway HTTP/WebSocket calls, or new renderer trajectory APIs
  - changes to files covered by lint:dcs
  - changes to B1-01, B1-02, B1-03, B2, B3, TF-0021, or TF-0010 ownership
  - a second trajectory format or a second event authority
  - timer-based runtime snapshot polling as the primary trajectory source
  - silently repairing seq gaps, duplicate events, malformed events, or missing stable identities
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b1-04-electron-trajectory-supply.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b1-04-electron-trajectory-supply.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b1-04-electron-trajectory-supply.md --dry-run
  - pnpm exec vitest run tests/unit/observability-trajectory-projection.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - Main registers a Gateway observability.subscribe for known session keys and resubscribes after a running connection is restored.
  - Accepted trajectory events are strictly increasing by seq per session; duplicates, malformed events, trace mismatches, and missing stable IDs are rejected or explicitly recorded as invalid.
  - A subscription gap causes a bounded observability.readFrom request from the last accepted seq; the projection state equals a full ordered replay of the same events.
  - The projection updates the existing ObservabilityTrace/index and emits the existing observability runtime event shape without adding a renderer transport surface.
  - The v1 trajectory scan remains available only as a deprecated migration fallback and still rehydrates persisted history after Electron restart.
  - Tests cover subscription registration, reconnect, seq merge, gap repair, invalid/duplicate rejection, v1 fallback, and stream/fallback equivalence.
  - No renderer direct IPC, Gateway HTTP/WebSocket, DCS lint-list, or unrelated task ownership files are changed.
docs:
  required: false
  note: This task changes Electron Main supply only. Renderer projection/store work belongs to B2 and display work belongs to B3.
---

# Workflow Viz B1-04 boundary

This task consumes the B1-01 v2 event contract and B1-03 Gateway read/subscribe boundary. The Main process owns the subscription cursor and deterministic gap repair, then projects accepted events into the existing observability trace/index model. Legacy trajectory-file scanning remains a clearly marked v1 fallback during migration and is not a second source of truth.
