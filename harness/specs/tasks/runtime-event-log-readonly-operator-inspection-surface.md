---
lifecycleStatus: archived
id: runtime-event-log-readonly-operator-inspection-surface
title: Runtime event-log readonly operator inspection surface
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Add a fresh-spec, explicit-call, readonly operator/developer inspection surface for persisted RuntimeTaskEvent logs without changing resume authority, TaskLoop decisions, Gateway/provider transport, UI, host-api, renderer IPC, schema, flags, or tool side-effect behavior.
ownedPaths:
  - harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts
  - openclaw_runtime/scripts/inspect-runtime-event-log.mjs
  - tests/unit/runtime-event-log-operator-inspection.test.ts
touchedAreas:
  - harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/**
  - runtime-research/agent-runtime-index.md
  - openclaw_runtime/src/runtime-core/**
  - openclaw_runtime/scripts/**
  - tests/unit/**
expectedUserBehavior:
  - Operator/developer inspection is available only through explicit local helper or script invocation.
  - Disabled or incomplete input returns bounded diagnostics and does not open, create, migrate, or write SQLite state.
  - Enabled inspection requires the existing `runtime.eventLog.persist` flag to be explicitly true and an explicit existing database path.
  - Missing database files or missing event-log tables return bounded diagnostics and do not create files, tables, meta rows, or sidecars.
  - Readonly inspection returns bounded event-log summaries, retention evidence summaries, and persisted resume comparison summaries only.
  - Output never includes raw `record_json`, full checkpoint payloads, tool args/output, transcripts, prompts, env, secrets, auth headers, raw rows, or completion proof.
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
  - event-log-first resume authority, default-on persistence, default-on replay, runtime.resume.preferEventLog, new config flags, or replacing long_task_checkpoints as authority
  - new schema table/index/migration, ensure-schema side effects, database creation, table creation, JSON/JSONL/TXT sidecar, or non-SQLite OpenClaw-owned runtime state
  - Gateway route, Electron IPC route, renderer UI/page/component, host-api/api-client/shared contract change, direct renderer Gateway HTTP/WebSocket, or public API surface
  - changing TaskLoop final status, lifecycle payloads, persisted checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, or tool permission authority
  - executing tools, applying patches, sending messages, writing workspace files, invoking Gateway/Main/renderer transport, or replaying side effects during inspection
  - treating event-log diagnostics, replay comparison, retention summaries, or verifier sampling as task completion proof
  - service, listener, daemon, local HTTP server, WebSocket server, Temporal service, second Gateway, second runtime, exporter, collector, or database service
featureFlags:
  - `runtime.eventLog.persist` remains default false and must be explicit before the inspection surface may open an explicit existing database.
  - `runtime.eventLog.shadow` remains default false and must not by itself open SQLite or enable inspection.
  - `runtime.resume.replayShadow` remains default false and must not be enabled or implied by inspection unless explicitly requested only for diagnostics.
  - `runtime.resume.preferEventLog` must remain absent/rejected.
rollback:
  - Stop invoking or remove the explicit helper/script surface.
  - Disable or omit `runtime.eventLog.persist` for no-open/no-read/no-write behavior.
  - Keep long_task_checkpoints authoritative and existing persisted event-log rows untouched.
  - TaskLoop, Gateway, Electron, renderer, shared contracts, provider transport, prompt assembly, tool policy, and runtime authority remain unchanged.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff
  - pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff
  - node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - node scripts/scan-pattern.mjs --pattern 'runtime\.resume\.preferEventLog|preferEventLog' openclaw_runtime/src tests/unit
  - node scripts/scan-pattern.mjs --pattern 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components electron shared openclaw_runtime/src/gateway
  - node scripts/scan-pattern.mjs --pattern 'createServer|listen\(|new WebSocketServer|WebSocketServer|http\.createServer|net\.createServer|@temporalio|Temporal|database-service|listener|daemon|jsonl|sidecar|exporter|collector' openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-event-log.mjs tests/unit/runtime-event-log-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - node scripts/scan-pattern.mjs --pattern 'migrate|ensure.*schema|create table|create index|insertInto|updateTable|deleteFrom|append\(|appendMany\(|pruneRuntimeTaskEventLogRecords\(' openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-event-log.mjs
  - node scripts/scan-pattern.mjs --pattern 'record_json|raw row|raw DB|transcript|jsonl|prompt dump|checkpoint payload|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|completion proof' openclaw_runtime/src/runtime-core/event-log-operator-inspection.ts openclaw_runtime/scripts/inspect-runtime-event-log.mjs tests/unit/runtime-event-log-operator-inspection.test.ts docs/dev/runtime-research-boundaries.md harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
  - pnpm run comms:replay and pnpm run comms:compare only if implementation touches Gateway, runtime send/receive, channel delivery, fallback, host-api, api-client, Electron IPC, or provider transport paths.
acceptance:
  - The surface is introduced only by this fresh task spec and does not extend the robustness/retention MVP into product/runtime cutover.
  - Persist false/omitted, missing database path, missing database file, and missing table cases return bounded diagnostics and perform no SQLite open/create/write/migration side effects.
  - Enabled inspection requires explicit persist true plus explicit existing database path and returns only bounded summaries.
  - Tests prove inspected databases remain byte-for-byte or query-count unchanged for event-log rows and metadata before/after inspection.
  - Output includes only bounded metadata such as event counts, task ids, event ids, kinds, timestamps, session/run/trace ids, latest checkpoint id, retention evidence summaries, read status, corrupt row count, and diagnostics.
  - Output excludes raw `record_json`, raw rows, checkpoint payload bodies, tool args/output, prompts, transcripts, env, secrets, auth material, and runtime authority/completion-proof markers.
  - Persisted resume comparison remains legacyAuthoritative true and never becomes resume authority.
  - Boundary scans prove no Gateway/UI/host-api/api-client/renderer/provider/TaskLoop/default-on/schema/service/listener/sidecar cutover.
docs:
  required: true
  files:
    - docs/dev/runtime-research-boundaries.md
---

# Runtime Event Log Readonly Operator Inspection Surface

This task is the fresh-spec entry for the first operator/developer inspection surface over persisted `RuntimeTaskEvent` logs.

It permits only explicit readonly local inspection of an existing SQLite event-log store. It does not permit event-log resume authority, UI/API/Gateway/renderer exposure, schema growth, default-on behavior, side-effect replay, or completion proof.

## Priority Work Arrangement

P0 spec and boundary setup:
- Validate this task spec and the two predecessor event-log specs.
- Confirm `rtk` availability; if missing, run commands directly and record that fact.
- Reconfirm the worktree is dirty and avoid reverting unrelated changes.

P1 readonly helper contract:
- Add a narrow runtime-core helper that accepts explicit config, explicit existing database path, optional task/session/trace filters, and bounded limits.
- Return disabled/missing-input/missing-db/missing-table diagnostics without opening or creating SQLite.
- Return sanitized summaries only when `runtime.eventLog.persist` is explicit true.

P2 explicit local utility:
- Add a local script wrapper only if the helper contract is green.
- Keep it outside Gateway, Electron, renderer, host-api, api-client, provider, and TaskLoop paths.
- Make stdout bounded JSON diagnostics only; no raw rows or payload dumps.

P3 validation and evidence:
- Add focused unit tests for no-open/no-create/no-write disabled and missing-input paths.
- Add real SQLite tests for sanitized summaries and before/after immutability.
- Run boundary scans and classify unrelated failures instead of fixing unrelated modules.

P4 handoff:
- Update this handoff README with exact files changed, validation results, known unrelated failures, and next fresh-spec-only directions.
- Update `runtime-research/agent-runtime-index.md` only after implementation evidence exists.

## Development Acceptance Prompt

Use this prompt for the implementation window:

```text
Continue in the current repository checkout from local persisted docs only.

Read first:
1. harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
2. runtime-research/handoffs/runtime-event-log-readonly-operator-inspection-surface/README.md
3. harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md
4. harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md
5. runtime-research/agent-runtime-index.md Workflow Checkpoint Engine section

Goal:
Implement the explicit readonly operator/developer inspection surface for persisted RuntimeTaskEvent logs.

Hard boundaries:
- No event-log resume authority, no default-on behavior, no new config flag, no runtime.resume.preferEventLog.
- No schema/table/index/migration, no DB/table/file creation, no JSON/JSONL/TXT sidecar.
- No Gateway route, Electron IPC, renderer UI, host-api/api-client/shared contract, provider transport, TaskLoop decision/status, prompt/model-message, retry/approval/tool policy, service/listener/daemon/server.
- No replay side effects and no completion proof from diagnostics.
- Output must be sanitized and bounded; no raw record_json, raw rows, checkpoint payload bodies, tool args/output, transcripts, prompts, env, secrets, or auth material.

Priority:
P1 helper contract, P2 optional explicit local utility, P3 tests/scans, P4 handoff.

Required verification:
- pnpm harness context --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
- pnpm harness validate --spec harness/specs/tasks/runtime-event-log-readonly-operator-inspection-surface.md
- pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff
- pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff
- node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-event-log-operator-inspection.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts
- pnpm run typecheck
- pnpm --dir openclaw_runtime db:kysely:check
- pnpm --dir openclaw_runtime lint:kysely
- boundary scans listed in the task spec

If is unavailable, run commands directly and say so.
If unrelated failures appear, classify them and do not modify unrelated modules.
```
