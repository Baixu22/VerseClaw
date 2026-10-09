---
id: phase-4-event-log-checkpoint-resume
title: Phase 4 event log, checkpoint, resume shadow pilot
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add an append-only RuntimeTaskEvent event log, state reducer, checkpoint serializer, and resume shadow/dual-write pilot over the accepted Phase-2/Phase-3 shadows without changing legacy behavior by default.
ownedPaths:
  - harness/specs/tasks/phase-4-event-log-checkpoint-resume.md
  - runtime-research/handoffs/phase-4-event-log-checkpoint-resume/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - openclaw_runtime/src/agents/tools/task-loop-tool.ts
  - openclaw_runtime/src/agents/tools/mission-loop-tool.ts
  - tests/unit/**
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - openclaw_runtime/src/agents/tools/task-loop-tool.ts
  - openclaw_runtime/src/agents/tools/mission-loop-tool.ts
  - tests/unit/**
expectedUserBehavior:
  - With Phase-4 event-log/resume flags disabled, existing TaskLoop execution, long-task checkpoints, mission-loop behavior, tool calls, and resume behavior remain unchanged.
  - With shadow flags enabled, ClawX may dual-write RuntimeTaskEvent records, checkpoint snapshots, reducer output, replay diagnostics, and resume comparisons as shadow data only.
  - Resume shadow must rebuild state from stored events/checkpoints without executing tools, applying patches, sending messages, or changing legacy completion/blocking decisions.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - adding a second runtime service, daemon, port, WebSocket server, local HTTP server, Gateway instance, Temporal service, or external workflow server for event logging/resume
  - treating verseshell-runtime as event-log, checkpoint, resume, or task-runtime authority instead of the configured stdio terminal tool exception
  - default-on event-log or resume cutover before flag-off and shadow parity tests pass
  - replaying mutating or side-effect tool calls during resume instead of reusing stored ToolCallResult/evidence by idempotency key
  - rewriting or deleting append-only history except by emitting an explicit compaction/continue-as-new event with schema/version marker
  - unversioned RuntimeTaskEvent, event-log envelope, checkpoint, or reducer schema changes
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
  - UI-visible resume/checkpoint behavior changes without targeted Electron E2E coverage
featureFlags:
  - runtime.eventLog.shadow defaults off and only emits RuntimeTaskEvent diagnostics/evidence.
  - runtime.eventLog.persist defaults off and controls any append-only persisted shadow store.
  - runtime.checkpointSerializer.shadow defaults off and must not alter legacy checkpoint payloads.
  - runtime.resume.replayShadow defaults off and runs reducer/replay comparison without executing side effects.
  - runtime.resume.preferEventLog must remain false/not implemented in this phase unless a later synthesis explicitly accepts cutover gates.
rollback:
  - Disable Phase-4 event-log/checkpoint/resume flags.
  - Keep existing TaskLoop in-memory state, long-task checkpoint store, task ledger, and legacy resume/checkpoint behavior authoritative.
  - Remove shadow writer/reader/reducer wiring without deleting Phase-2 runtime-core contracts or Phase-3 registry pilot contracts.
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/task-loop-controller.test.ts
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log*.test.ts tests/unit/runtime-state-reducer*.test.ts tests/unit/task-loop-event-log*.test.ts
  - node scripts/scan-pattern.mjs --pattern 'window\\.electron\\.ipcRenderer\\.invoke|ipcRenderer\\.invoke\\(|127\\.0\\.0\\.1:18789|localhost:18789|gateway:httpProxy|hostapi:fetch' src electron shared tests --glob '!**/*.md'
  - node scripts/scan-pattern.mjs --pattern 'createServer|listen\\(|new WebSocketServer|WebSocketServer|http\\.createServer|net\\.createServer|127\\.0\\.0\\.1:18789|localhost:18789' openclaw_runtime/src/runtime-core openclaw_runtime/src/agents/long-task-control openclaw_runtime/src/agents/task-loop-controller.ts tests/unit
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-4-event-log-checkpoint-resume.md --no-diff
acceptance:
  - Event-log contracts/envelopes are canonical and do not duplicate RuntimeTaskEvent or Checkpoint types.
  - Append-only writes are idempotent and queryable by task id, kind, timestamp range, and pagination without changing legacy runtime behavior.
  - State reducer restores created/planning/running/waiting/verifying/completed/failed/blocked/cancelled from event fixtures.
  - Resume shadow proves completed side-effect tool calls are reused by idempotency key and never re-executed.
  - Checkpoint serializer preserves open obligations, evidence refs, file hashes, schema markers, and legacy checkpoint parity.
  - No second runtime service or renderer transport bypass is introduced.
  - Every accepted lane has path/function/test/command evidence.
docs:
  required: true
---

