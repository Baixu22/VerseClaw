---
lifecycleStatus: archived
id: workflow-viz-b1-02-ordinary-session-producer
title: Workflow Viz B1-02 ordinary session trajectory producer
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Wire ordinary embedded sessions to the v2 trajectory contract with explicit run, turn, step, and tool lifecycle events while preserving the existing v1 writer and read path.
ownedPaths:
  - harness/specs/tasks/workflow-viz-b1-02-ordinary-session-producer.md
  - openclaw_runtime/src/trajectory/runtime.ts
  - openclaw_runtime/src/trajectory/producer.ts
  - openclaw_runtime/src/trajectory/export.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - openclaw_runtime/src/trajectory/trajectory-producer.test.ts
touchedAreas:
  - harness/specs/tasks/workflow-viz-b1-02-ordinary-session-producer.md
  - openclaw_runtime/src/trajectory/runtime.ts
  - openclaw_runtime/src/trajectory/producer.ts
  - openclaw_runtime/src/trajectory/export.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.model-diagnostic-events.ts
  - openclaw_runtime/src/trajectory/trajectory-producer.test.ts
expectedUserBehavior:
  - A normal embedded session writes v2 run/turn/step/tool lifecycle rows to the same openclaw-trajectory JSONL file.
  - The rows have explicit stable ids and one shared monotonic sequence; tool rows never infer a missing step or run context.
  - Existing v1 diagnostic rows and v1 trajectory files remain readable during migration.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - comms-regression
forbiddenPatterns:
  - changes to files covered by lint:dcs, including task-loop-controller.ts
  - task-loop or orchestration producer wiring; it remains a separately authorized migration
  - new Gateway RPC, subscription, HTTP, or WebSocket interface
  - Electron Main supply, renderer store/UI, or direct renderer backend calls
  - a second trajectory format or parallel event authority
  - guessing the nearest run, turn, step, or tool context when a stable id is absent
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/workflow-viz-b1-02-ordinary-session-producer.md
  - pnpm harness validate --spec harness/specs/tasks/workflow-viz-b1-02-ordinary-session-producer.md
  - pnpm harness run --spec harness/specs/tasks/workflow-viz-b1-02-ordinary-session-producer.md --dry-run
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.unit-src.config.ts src/trajectory/trajectory-producer.test.ts
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run build:runtime
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run lint:bom
acceptance:
  - Ordinary embedded sessions emit v2 run/start and run/end, turn/start and turn/end, step/start and step/end, and tool/start, tool/update, and tool/end rows.
  - Every emitted v2 row has schemaVersion 2, a positive monotonic seq, a lifecycle role, and explicit stable ids required by that role.
  - State-bearing rows contain the complete post-change state snapshot; replaying rows by seq is deterministic and equivalent to replace semantics.
  - Tool lifecycle rows preserve the producer's explicit step id; a missing id suppresses the v2 row and emits an observable diagnostic rather than guessing context.
  - Existing v1 diagnostic rows continue to be written/read during the migration.
  - Tests cover producer lifecycle mapping, stable-id refusal, shared sequence monotonicity, and JSON round trips.
  - No task-loop/DCS, Gateway, Electron, renderer, or new transport interface changes are introduced.
docs:
  required: false
  note: This is a runtime producer migration with no new user-facing transport or UI surface; B1-03 and B1-04 own those changes.
---

# Workflow Viz B1-02 boundary

This task consumes the v2 schema established by B1-01 and wires only the ordinary embedded session producer. The producer records the same persisted trajectory JSONL stream used by the existing v1 recorder. It owns explicit ids for the run, turn, model-call step, and tool call; it must not repair missing identity by searching recent events.

The task-loop phase producer, Gateway read/subscribe and gap repair, Electron supply, client assembly, and presentation remain out of scope. `gateway-backend-communication` is required because this runtime producer is on the backend communication path even though this card must not add a new transport boundary.
