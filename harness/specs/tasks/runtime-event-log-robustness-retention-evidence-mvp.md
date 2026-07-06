---
id: runtime-event-log-robustness-retention-evidence-mvp
title: Runtime event-log robustness and retention evidence MVP
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Harden the default-off persisted RuntimeTaskEvent shadow log against append races, retention ambiguity, and partial corrupt-row reads without changing resume authority, TaskLoop decisions, UI/API surfaces, Gateway/provider transport, or tool side effects.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/event-log.ts
  - openclaw_runtime/src/runtime-core/event-log-persistence.ts
  - openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts
  - tests/unit/runtime-event-log-store.test.ts
  - tests/unit/runtime-event-log-persistence.test.ts
  - tests/unit/task-loop-event-log-shadow.test.ts
touchedAreas:
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/src/agents/long-task-control/**
  - tests/unit/**
expectedUserBehavior:
  - Persisted event-log append races that resolve to an existing event/idempotency record are reported as duplicates, not storage failures.
  - Runtime event-log retention reports bounded task-level evidence and selects global prune work by oldest eligible rows instead of task id order.
  - Persisted resume shadow summaries distinguish clean, partial, and unreadable event-log reads while keeping legacyAuthoritative true.
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
  - new schema table/index/migration, new config flag, runtime.resume.preferEventLog, event-log-first resume authority, default-on persistence or replay, or replacing long_task_checkpoints as authority
  - executing tools, applying patches, sending messages, writing workspace files, or invoking Gateway/Main/renderer transport during resume replay
  - new service, listener, daemon, local HTTP server, WebSocket server, Temporal service, JSON/JSONL/TXT sidecar, or non-SQLite OpenClaw-owned runtime state
  - changing TaskLoop final status, lifecycle payload shape, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - renderer direct window.electron.ipcRenderer.invoke calls
  - renderer direct Gateway HTTP or WebSocket calls to 127.0.0.1:18789 or localhost:18789
featureFlags:
  - runtime.eventLog.persist remains default false and required before TaskLoop default writer persistence.
  - TaskLoop runtimeTaskEventLogShadow or runtimeCoreShadow remains required before TaskLoop emits RuntimeTaskEvent shadows.
  - runtime.resume.replayShadow remains default false and required before persisted resume shadow reads SQLite or legacy checkpoint state.
  - runtime.resume.preferEventLog must remain absent/rejected.
rollback:
  - Disable runtime.eventLog.persist or TaskLoop runtime shadow flags to stop writes and retention.
  - Disable runtime.resume.replayShadow to stop persisted replay reports.
  - Existing long_task_checkpoints remain authoritative and unaffected.
requiredTests:
  - rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - rtk pnpm run typecheck
  - rtk pnpm --dir openclaw_runtime db:kysely:check
  - rtk pnpm --dir openclaw_runtime lint:kysely
  - rtk rg -n 'runtime\.resume\.preferEventLog|preferEventLog' openclaw_runtime/src tests/unit
  - rtk rg -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components
  - rtk rg -n 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|@temporalio|Temporal|database-service|listener|daemon|jsonl|sidecar' openclaw_runtime/src/runtime-core/event-log-persistence.ts openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/task-loop-event-log-shadow.test.ts
acceptance:
  - Append reconciliation returns duplicate_event_id or duplicate_idempotency_key after write-time unique conflicts when indexed reread finds an existing record.
  - Non-duplicate write failures remain store_write_failure, and failed post-write rereads add store_read_failure diagnostics.
  - Retention result includes eligible/skipped task counts and taskResults with totalRows, oldRowCount, candidateCount, pruned, anchors, and skip reasons.
  - Global prune selection prioritizes oldest eligible rows and does not starve later task ids behind unprunable earlier task ids.
  - Persisted resume summary reports clean/partial/unreadable read status, replayable event count, corrupt row count, and store failure count.
  - Partial corrupt rows do not force event_log_unreadable when healthy records remain replayable; legacyAuthoritative stays true.
docs:
  required: true
---

# Runtime Event Log Robustness And Retention Evidence MVP

This task hardens the already default-off persisted event-log MVP. It does not approve schema growth, operator surfaces, resume authority cutover, side-effect replay, or any default-on behavior.
