---
id: runtime-event-log-persisted-resume-mvp
title: Runtime event-log persisted resume MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add the first default-off SQLite persistence owner and internal replay report for TaskLoop RuntimeTaskEvent shadows without changing legacy checkpoint/resume authority, TaskLoop decisions, Gateway/provider transport, UI, host-api, or tool side-effect behavior.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/state/openclaw-state-schema.sql
  - openclaw_runtime/src/state/openclaw-state-schema.generated.ts
  - openclaw_runtime/src/state/openclaw-state-db.generated.d.ts
  - openclaw_runtime/src/runtime-core/event-log-persistence.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts
  - tests/unit/runtime-event-log-persistence.test.ts
  - tests/unit/task-loop-event-log-shadow.test.ts
touchedAreas:
  - openclaw_runtime/src/state/**
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/task-loop-controller.ts
  - openclaw_runtime/src/agents/long-task-control/**
  - tests/unit/**
expectedUserBehavior:
  - With event-log persist/resume flags disabled, TaskLoop execution, checkpoints, prompts, provider/Gateway transport, tool behavior, and resume behavior remain unchanged.
  - With TaskLoop runtime shadow and runtime.eventLog.persist explicitly enabled, TaskLoop may persist bounded RuntimeTaskEventLog records into the shared state SQLite DB for diagnostics only.
  - With runtime.resume.replayShadow explicitly enabled, internal diagnostics may replay persisted event records and compare them to the latest legacy long-task checkpoint while keeping legacyAuthoritative true.
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
  - runtime.resume.preferEventLog, event-log-first resume authority, default-on event-log persistence, default-on resume replay, or replacing long_task_checkpoints as authority
  - executing tools, applying patches, sending messages, writing workspace files, or invoking Gateway/Main/renderer transport during resume replay
  - new service, listener, daemon, local HTTP server, WebSocket server, Temporal service, second Gateway instance, external workflow database, JSON/JSONL/TXT sidecar, or non-SQLite OpenClaw-owned runtime state
  - changing TaskLoop final status, lifecycle payload shape, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.eventLog.persist remains default false and is required before the default SQLite writer may persist TaskLoop event-log records.
  - Existing TaskLoop runtimeTaskEventLogShadow or runtimeCoreShadow remains required before TaskLoop emits RuntimeTaskEvent shadows.
  - runtime.eventLog.shadow remains default false and does not by itself open or write SQLite through the default writer.
  - runtime.resume.replayShadow remains default false and is required before the internal persisted resume shadow report reads SQLite or legacy checkpoint state.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Disable runtime.eventLog.persist or the TaskLoop runtime shadow flags to stop writes.
  - Disable runtime.resume.replayShadow to stop persisted replay reports.
  - Keep existing long_task_checkpoints rows and legacy resume/checkpoint behavior authoritative.
  - Remove the default TaskLoop writer call site without deleting already persisted diagnostic rows.
requiredTests:
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
  - node scripts/scan-pattern.mjs --pattern 'runtime\.resume\.preferEventLog|preferEventLog' openclaw_runtime/src tests/unit
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - node scripts/scan-pattern.mjs --pattern 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|@temporalio|Temporal|database-service|listener|daemon|jsonl|sidecar' openclaw_runtime/src/runtime-core/event-log-persistence.ts openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/task-loop-event-log-shadow.test.ts
acceptance:
  - The persisted event-log owner is the shared state SQLite DB, not a sidecar or per-agent store.
  - The SQLite adapter only implements RuntimeTaskEventLogStorage load/append; RuntimeTaskEventLogStore remains responsible for validation, duplicate detection, search, and export.
  - TaskLoop default persistence requires both a TaskLoop runtime shadow flag and runtime.eventLog.persist; shadow-only flags do not open SQLite.
  - Writer failures remain shadow-only and cannot change TaskLoop status or payloads.
  - The internal persisted resume shadow report reads only when runtime.resume.replayShadow is true, compares replay with legacy checkpoint state, and always returns legacyAuthoritative true.
  - Missing or ambiguous mutating tool results produce waiting_verification diagnostics and never execute side effects.
docs:
  required: true
---

# Runtime Event Log Persisted Resume MVP

This task implements the narrow storage-owner and internal report slice after accepted Phase 4. It does not approve default-on event-log persistence, event-log resume authority, UI/API exposure, side-effect replay, or verifier/completion-gate cutover.
