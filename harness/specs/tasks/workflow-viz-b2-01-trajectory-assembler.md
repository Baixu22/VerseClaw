---
lifecycleStatus: archived
id: workflow-viz-b2-01-trajectory-assembler
title: Workflow Viz B2-01 deterministic trajectory assembler
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 99e54d759f91f89517e5529ba0d2a178339a2a4f
intent: Define the fixture-first renderer-side assembly engine that deterministically consumes B1 v2 trajectory events into incremental node snapshots, without migrating stores, changing Electron or Gateway supply, or implementing presentation.
ownedPaths:
  - .agent-workbench/task-forest/**
  - harness/specs/tasks/workflow-viz-b2-01-trajectory-assembler.md
  - src/lib/trajectory-assembler/**
  - tests/unit/trajectory-assembler.test.ts
touchedAreas:
  - .agent-workbench/task-forest/**
  - harness/specs/tasks/workflow-viz-b2-01-trajectory-assembler.md
  - src/lib/trajectory-assembler/**
  - tests/unit/trajectory-assembler.test.ts
expectedUserBehavior:
  - A renderer consumer can construct deterministic, reference-stable node snapshots from the same ordered v2 trajectory event history whether it arrives through replace, prepend, or append.
  - Renderer-facing node consumers receive the business snapshot through node.data only and do not inspect event windows or assembler contexts.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - changes to src/stores/session-activity.ts or src/stores/observability.ts, which belong to WV-B2-02
  - changes to Electron, Gateway, B1 producer/contract files, DCS lint-list files, TF-0021, or Runtime Authority ownership
  - direct renderer IPC, Gateway HTTP, or Gateway WebSocket calls
  - a second trajectory format, event authority, producer, Gateway interface, or third-party graph library
  - context selection by scanning event windows, contexts, or rendered nodes during append
  - renderer view consumers accessing node state outside node.data
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b2-01-trajectory-assembler.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b2-01-trajectory-assembler.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b2-01-trajectory-assembler.md --dry-run
  - pnpm exec vitest run tests/unit/trajectory-assembler.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - NodeDefinition supports match, start, update, optional publication cadence, and a stable kind plus business id identity.
  - Each accepted event executes match at most once per Definition, and append locates the matching context in constant time without scanning event windows, contexts, or rendered nodes.
  - replace, prepend, and append produce deterministic whole-value state replay from B1 v2 events; update-only contexts stay pending until their matching start appears.
  - Prepending historical starts makes pending contexts equivalent to full replacement and preserves references for unchanged keyed nodes.
  - View builders expose replace and apply(upserts), and renderer-facing views consume node.data only.
  - Publication supports immediate, animation-frame, and none; animation-frame publishes no more than once per frame.
  - Unit coverage proves terminal replacement, pending-to-prepend equivalence, historical-prepend-plus-append equivalence, reference preservation, animation-frame coalescing, and node.data-only consumption.
  - No store migration, Electron/Gateway/B1 contract change, direct renderer transport, DCS lint-list change, or B3 presentation is introduced.
docs:
  required: false
  note: This fixture-first projection core has no user-visible behavior until the separately proposed B2-02 store migration and B3 presentation tasks consume it.
---

# Workflow Viz B2-01 boundary

This task is the single ready card in the independent Workflow Viz task tree. It consumes only the B1 v2 event contract and produces renderer-local deterministic node snapshots. The engine must retain a stable `(kind, id)` identity, treat start as the only event that can initialize state, and retain update-only contexts as pending rather than guessing a nearest open context.

`replace` rebuilds from an ordered history. `prepend` accepts earlier history while preserving unchanged keyed node references. `append` is the hot path: it evaluates each Definition exactly once against the new event, then uses the matching Definition-local key for a constant-time context lookup. Publication cadence coalesces view notifications, never state replay.

This card deliberately excludes existing Zustand store migration (`WV-B2-02`) and all user-facing visualization work (`B3`). It references `gateway-backend-communication` because its snapshots will cross the renderer/Main boundary through the existing Main-owned source path, but it must not add any new transport surface.
