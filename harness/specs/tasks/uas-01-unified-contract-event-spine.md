---
id: uas-01-unified-contract-event-spine
title: UAS-01 unified contract and persistent event spine
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Define the versioned AgentRunEvent, ExecutionPlan, ProcessHandle, Observation, and ArtifactRef contract family and replay it through the existing RuntimeTaskEventLog SQLite owner without creating a second run journal, changing legacy checkpoint/resume authority, or promoting any default-on runtime path.
ownedPaths:
  - harness/specs/tasks/uas-01-unified-contract-event-spine.md
  - openclaw_runtime/src/runtime-core/agent-run-contracts.ts
  - openclaw_runtime/src/runtime-core/agent-run-event-spine.ts
  - openclaw_runtime/src/runtime-core/index.ts
  - tests/unit/agent-run-contracts.test.ts
  - tests/unit/agent-run-event-spine.test.ts
  - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
touchedAreas:
  - harness/specs/**
  - openclaw_runtime/src/runtime-core/**
  - tests/unit/**
  - docs/dev/unified-agent-system/**
expectedUserBehavior:
  - No user-visible behavior changes while UAS-01 establishes the contract and event backbone.
  - Existing TaskLoop decisions, tool execution, checkpoint writes, resume ordering, Gateway/provider transport, approval behavior, and renderer behavior remain unchanged.
  - long_task_checkpoints remains the default authoritative checkpoint/resume source; AgentRunEvent replay is an additive deterministic state projection and cannot execute tools or side effects.
  - runtime_task_event_log_records remains the only UAS run-event persistence table. Existing trajectory JSONL remains a support-bundle flight recorder, and runtime-spine/event-bus remains diagnostic-only and is not a persistence authority.
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
  - second run journal, second event log, second event bus, new runtime event table, new checkpoint table, JSONL run journal, or sidecar persistence
  - wiring runtime-spine/event-bus as UAS persistence or runtime authority
  - replacing long_task_checkpoints, event-log-first default resume, runtime.resume.preferEventLog, default-on event-log persistence, or default-on replay
  - replay executing tools, applying patches, spawning processes, sending messages, writing workspace files, or invoking Gateway/Main/renderer/provider transport
  - implicit shell-string execution, implicit .cmd/.bat interpreter guessing, or unbounded environment capture
  - persisting unsanitized secrets, credentials, authorization values, cookies, tokens, passwords, raw provider payloads, complete env, or unbounded stdout/stderr
  - changing TaskLoop final status, checkpoint payloads, reviewer prompts, model messages, provider ordering, retry policy, approval policy, verifier authority, tool permission authority, Gateway routes, host-api, api-client, Electron IPC, or renderer UI
  - implementing TF-0013, TF-0014, FP-P4-03, FP-P4-04, VerseShell default cutover, or long-term Memory lifecycle behavior
featureFlags:
  - No new runtime flag is added by UAS-01.
  - Existing runtime.eventLog.persist remains default false and continues to gate SQLite persistence in existing runtime integration paths.
  - Existing runtime.eventLog.shadow and runtime.resume.replayShadow remain default false.
  - UAS-01 pure contract, projection, and injected-store helpers do not self-enable TaskLoop persistence or resume authority.
rollback:
  - Stop importing the UAS contract and event-spine helpers and remove their runtime-core exports.
  - Existing runtime_task_event_log_records, RuntimeTaskEventLogStore, trajectory recorder, long_task_checkpoints, TaskLoop behavior, and resume behavior remain usable without data migration.
  - No table, sidecar, service, listener, daemon, Gateway route, IPC route, or UI cleanup is required because UAS-01 adds none.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/uas-01-unified-contract-event-spine.md
  - pnpm harness validate --spec harness/specs/tasks/uas-01-unified-contract-event-spine.md
  - pnpm exec vitest run tests/unit/agent-run-contracts.test.ts tests/unit/agent-run-event-spine.test.ts tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/task-loop-event-log-shadow.test.ts
  - pnpm run typecheck
  - pnpm --dir openclaw_runtime db:kysely:check
  - pnpm --dir openclaw_runtime lint:kysely
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check -- harness/specs/tasks/uas-01-unified-contract-event-spine.md openclaw_runtime/src/runtime-core/agent-run-contracts.ts openclaw_runtime/src/runtime-core/agent-run-event-spine.ts openclaw_runtime/src/runtime-core/index.ts tests/unit/agent-run-contracts.test.ts tests/unit/agent-run-event-spine.test.ts docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
acceptance:
  - AgentRunEvent/v1, ExecutionPlan/v1, ProcessHandle/v1, Observation/v2, and ArtifactRef/v1 have explicit schema markers, schemaVersion guards, fixtures, and compatibility tests.
  - AgentRunEvent/v1 includes eventId, causationId, idempotencyKey, schemaVersion, redaction, retention, run/task/trace identity, timestamp, event type, and one validated contract payload.
  - ExecutionPlan/v1 uses direct argv by default and requires an explicit Windows batch executable kind and interpreter identity for .cmd/.bat plans.
  - ProcessHandle/v1 carries process/plan/run/trace/session/workspace identity, lifecycle state, capabilities, recoverability, and a retention deadline.
  - Observation/v2 carries lifecycle state, stdout/stderr cursor and truncation/dropped-byte summaries, actionable summary, bounded diagnostics, and ArtifactRef/v1 references without retaining unbounded output.
  - ArtifactRef/v1 carries digest, media type, byte size, producer plan, sensitivity, redaction, and bounded retention; it is evidence only and never becomes Memory automatically.
  - Persistence sanitizes AgentRunEvent payloads using the existing OpenClaw redaction policy before projection into RuntimeTaskEventLog records.
  - The UAS event-spine helper writes only RuntimeTaskEventLogStore envelopes. Reopening the existing SQLite store preserves replayable UAS events without any new table, file, or journal.
  - Repeating the same task-scoped idempotencyKey returns the first event and invokes the injected side effect zero additional times.
  - Deterministic replay from stored records produces the same AgentRunState as the online reducer result and never invokes side effects.
  - Expired events are excluded from active replay, bounded retention metadata is preserved, and existing event-log pruning remains the physical-retention owner.
  - Sensitive-field, retention, schema mismatch, causation, idempotency, SQLite reopen, online/replay parity, and no-second-journal tests pass.
  - long_task_checkpoints remains default authoritative, all three product locks remain false, and no TF-0013/14 or FP-P4-03/04 behavior is implemented.
docs:
  required: true
  files:
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - Review README variants under docs-sync; update them only if user-visible behavior, public interfaces, or product flows change.
    - UAS-01 is an internal additive contract and persistence projection, so no README change is expected unless implementation scope expands.
---

# UAS-01 Unified Contract And Persistent Event Spine

This task implements Task Forest node TF-0012 only. It adds a versioned contract family and a deterministic adapter over the existing RuntimeTaskEventLog owner.

The existing authority split is frozen:

- `long_task_checkpoints` remains the default checkpoint/resume authority;
- `runtime_task_event_log_records` is the only persistent UAS run-event log;
- trajectory JSONL remains a support-bundle flight recorder;
- `runtime-spine/event-bus` remains diagnostic-only and must not become a second journal.

UAS-01 does not authorize TaskLoop cutover, event-log-first resume, replayed side effects, VerseShell default routing, Context/VToken work, Runtime Memory production injection, or any product-lock change.

## Validation Notes

The UAS-01 scoped implementation gates pass: 6 focused files / 59 tests, root typecheck,
targeted ESLint, communication replay/compare, structural Harness validation, and scoped diff
checks. README variants were reviewed and require no update because this task adds no user-visible
behavior or public interface.

Two repository-baseline database commands remain red and are disclosed rather than hidden:

- `pnpm --dir openclaw_runtime db:kysely:check` reports the existing generated Kysely declaration
  and schema files as stale;
- `pnpm --dir openclaw_runtime lint:kysely` reports existing FactStore/raw `node:sqlite`
  guardrail violations.

UAS-01 changes no database schema or those owners, so it does not regenerate or rewrite unrelated
baseline files. Full diff-aware Harness validation also includes the repository's large shared
dirty worktree and therefore reports unrelated touched areas; the task does not broaden
`ownedPaths` to manufacture a pass. These residuals must remain visible in the closeout proposal.
