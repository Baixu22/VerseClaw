---
lifecycleStatus: archived
id: workflow-viz-b2-02-store-convergence
title: Workflow Viz B2-02 store convergence onto assembler snapshots
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 3047483395c103472fe754d2c2d922287d7de039
intent: Make src/stores/session-activity.ts and src/stores/observability.ts consume deterministic B2-01 assembler node snapshots for the v2-covered run/turn/step/tool lifecycle, removing the handwritten lifecycle reducers, wall-clock last-wins, and Date.now fallbacks on those paths, while every non-v2 domain keeps its existing explicit owner.
ownedPaths:
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/**
  - harness/specs/tasks/workflow-viz-b2-02-store-convergence.md
  - src/lib/trajectory-view/**
  - src/stores/session-activity.ts
  - src/stores/observability.ts
  - tests/unit/trajectory-view-feed.test.ts
  - tests/unit/session-activity.test.ts
  - tests/unit/observability-store-lifecycle.test.ts
touchedAreas:
  - .agent-workbench/task-forest/**
  - docs/dev/handoffs/**
  - harness/specs/tasks/workflow-viz-b2-02-store-convergence.md
  - src/lib/trajectory-view/**
  - src/stores/session-activity.ts
  - src/stores/observability.ts
  - tests/unit/trajectory-view-feed.test.ts
  - tests/unit/session-activity.test.ts
  - tests/unit/observability-store-lifecycle.test.ts
expectedUserBehavior:
  - The session activity panel derives its run lifecycle state (runId, running/completed/failed/aborted, startedAt/endedAt, error) exclusively from B2-01 assembler node data fed by the B2-02A raw v2 supply; history plus realtime joins at asOfSeq and equals a full replace.
  - Chat runtime events and observability runtime events no longer write lifecycle state; they only act as refresh signals that trigger an idempotent incremental history pull from the last accepted seq, so sessions without the single live Gateway subscription still update promptly.
  - The Observability page no longer replays lifecycle through a 150 ms debounce-and-refetch loop; dashboard and selected-graph refreshes are triggered by v2-driven lifecycle transitions.
  - Existing ?mock=1 scenarios keep their current UX, with the v2-covered session lifecycle produced by fixed-seq/fixed-timestamp fixture events run through the assembler.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - keeping a parallel handwritten reducer, wall-clock last-wins, or Date.now fallback for any v2-covered run/turn/step/tool lifecycle state
  - reconstructing trajectory events from ObservabilityTrace/spans/graph rows, or synthesizing missing stable IDs from the most recent context
  - renderer direct IPC, Gateway HTTP/WebSocket calls, JSONL scanning, or a second trajectory event format/authority
  - modifying src/lib/trajectory-assembler/** (B2-01 core), B1 schema/producers/Gateway protocol, B2-02A Main supply, or B3 display surfaces
  - converting Git, terminal, queue, approval, subagent, task-loop, mission, or clawGraph domains into synthetic trajectory data, or letting them overwrite v2-driven lifecycle state
  - changes to files covered by lint:dcs, TF-0021, or Runtime Authority
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b2-02-store-convergence.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b2-02-store-convergence.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b2-02-store-convergence.md --dry-run
  - pnpm exec vitest run tests/unit/trajectory-view-feed.test.ts tests/unit/session-activity.test.ts tests/unit/observability-store-lifecycle.test.ts tests/unit/trajectory-assembler.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - Both stores consume only B2-01 assembler node snapshots for run/turn/step/tool lifecycle state; the handwritten run.started/run.ended reducer branches and the observability 150 ms pull-refresh lifecycle replay are removed.
  - A trajectory-view feed binds sessions strictly by sessionKey equality, pages cold history through hostApi.observability.trajectoryHistory, joins realtime observability:trajectory-event batches at the reported asOfSeq, deterministically drops seq <= lastSeq, and repairs detected gaps by an incremental history pull; it never guesses IDs and never creates a second event authority.
  - History plus realtime produces store lifecycle state identical to a full replace of the same events; replace/prepend/append paths are covered at store level.
  - Sessions with no v2 supply (legacyFallback or empty) show an explicit idle/no-data lifecycle rather than a reconstructed one; mock mode injects fixture events instead.
  - Existing mock scenarios remain functional and deterministic, with v2-covered lifecycle driven by fixture events with fixed seq and timestamps.
  - Non-v2 domains (git, terminals, queue, approval decoration, subagents, task loops, missions, clawGraph) keep their existing reducers and cannot overwrite v2-driven lifecycle fields.
  - No renderer code adds direct IPC, Gateway HTTP, or WebSocket use; all supply flows through src/lib/host-api.ts and src/lib/host-events.ts.
docs:
  required: false
  note: This task converges existing stores onto assembler output. Display upgrades (ledger, timeline, phase panel) belong to B3; Main supply changes belong to B2-02A and are frozen here.
---

# Workflow Viz B2-02 boundary

B2-02A delivered validated raw `TrajectoryEventV2` history (`observability.trajectoryHistory`, asOfSeq handoff) and realtime batches (`observability:trajectory-event`) through the existing host boundaries. This card makes the two lifecycle-consuming stores read that truth through the B2-01 assembler instead of reconstructing lifecycle from `ChatRuntimeEvent`/`ObservabilityRuntimeEvent` payloads. Because the B1-04 Gateway subscription is connection-scoped to the newest session, runtime events remain useful as refresh *signals only*: they may trigger an idempotent incremental `trajectoryHistory` pull from the last accepted seq, but they must never write lifecycle state themselves.
