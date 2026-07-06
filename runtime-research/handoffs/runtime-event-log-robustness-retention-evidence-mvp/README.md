# Runtime Event Log Robustness / Retention Evidence MVP Handoff

Status: implemented_and_focused_validation_green
Date: 2026-07-01

This handoff is the durable development log and constraint document for the Runtime Event Log robustness and retention evidence MVP. It is intended for a fresh Codex window to resume safely without relying on chat history.

## Outcome

The MVP is implemented as a default-off, shadow-only hardening layer for persisted `RuntimeTaskEvent` logs.

Accepted behavior:

- `RuntimeTaskEventLogStore.append()` reconciles append conflicts after `storage.append()` throws by rereading existing append context.
- Duplicate `eventId` or task-scoped duplicate `idempotencyKey` found after a failed write returns the existing duplicate diagnostics without adding `store_write_failure`.
- Non-unique write failures still return `store_write_failure`; reread failures return both write and read diagnostics.
- SQLite retention exposes evidence fields for eligible/skipped tasks and per-task prune decisions.
- Global prune selects eligible tasks by old rows and pressure, not alphabetical `taskId`.
- Persisted resume summary distinguishes `clean`, `partial`, and `unreadable` event-log reads while preserving `legacyAuthoritative: true`.
- Corrupt persisted rows can coexist with healthy replayable rows; partial reads recommend inspection without forcing unreadable when replay is still possible.

## Hard Boundaries

These are not optional. Future work must keep them unless a fresh spec explicitly changes them and adds rollout/rollback evidence.

- No new schema table, index, or migration in the robustness/retention evidence slice.
- No new config flag, especially no `runtime.resume.preferEventLog`.
- No default-on event-log persistence or default-on resume replay.
- No event-log-first resume authority.
- `long_task_checkpoints` remains the only authoritative resume/checkpoint store.
- No UI, CLI, host-api, Gateway route, renderer IPC, service, listener, daemon, sidecar, local HTTP server, WebSocket server, or Temporal service.
- No TaskLoop final-status changes.
- No reviewer prompt, model message, provider ordering, Gateway/provider transport, retry policy, approval policy, verifier authority, tool permission authority, or lifecycle/checkpoint payload cutover.
- Resume/replay must never execute tools, apply patches, send messages, write workspace files, or call Gateway/Main/renderer transport.
- Missing or ambiguous mutating tool results may only report `waiting_verification`; they must not be treated as completed.

## Main Files

- `openclaw_runtime/src/runtime-core/event-log.ts`
- `openclaw_runtime/src/runtime-core/event-log-persistence.ts`
- `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts`
- `tests/unit/runtime-event-log-store.test.ts`
- `tests/unit/runtime-event-log-persistence.test.ts`
- `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`
- `harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md`

## Validation Log

Focused validation is green for this feature line.

Passed:

- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-event-log-store.test.ts tests/unit/runtime-event-log-persistence.test.ts tests/unit/runtime-state-reducer.test.ts tests/unit/runtime-checkpoint-serializer.test.ts tests/unit/runtime-resume-shadow.test.ts tests/unit/task-loop-event-log-shadow.test.ts tests/unit/task-loop-controller.test.ts`
  - Result: 7 files passed, 121 tests passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-core-contracts.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/runtime-verification-auto-sampling.test.ts tests/unit/runtime-provider-tool-registry.test.ts tests/unit/runtime-provider-tool-registry-security-performance-boundary.test.ts tests/unit/runtime-controlled-runtime-use-readiness-boundary.test.ts`
  - Result: 6 files passed, 37 tests passed.
- `pnpm run typecheck`
- `pnpm --dir openclaw_runtime db:kysely:check`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md --no-diff`
- `pnpm harness validate --spec harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md --no-diff`

Real SQLite evidence:

- Partial corrupt-row read preserved healthy replay rows.
- Summary returned `matchStatus: matched`, `eventLogReadStatus: partial`, and `recommendation: inspect_event_log`.
- Retention pruned 4 old candidate rows while preserving the latest checkpoint anchor and all events after it.

Boundary checks:

- `runtime.resume.preferEventLog` / `preferEventLog`: no implementation hit; only the schema rejection test mentions it.
- Renderer direct IPC / Gateway direct HTTP: no hit in touched implementation files.
- Service/listener/daemon/sidecar/server terms: no hit in touched implementation files; spec text mentions them only as forbidden surfaces.

Known non-feature failures:

- `pnpm --dir openclaw_runtime lint:kysely` currently fails only on unrelated memory raw-SQLite files:
  - `src/memory/memory-store.ts`
  - `src/runtime-core/memory-persistence.ts`
  - `src/runtime-core/memory-read-hydration-shadow.ts`
  - No event-log persistence file appears in the violation set.
- `pnpm test` full suite is not green because of unrelated parallel development. The observed run reported 16 failed files, 361 passed files, 2 skipped files; 22 failed tests, 2844 passed tests, 40 skipped tests. Failures were in context compression eval, runtime-memory, chat UI timeouts, gateway ready fallback, agents page, host services, app-api, chat runtime event handlers, local-control-plane, and workspace git panel areas. Focused event-log/checkpoint/resume tests passed.

## Fresh Window Bootstrap

Start here:

1. Read this file.
2. Read `harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md`.
3. Read `harness/specs/tasks/runtime-event-log-persisted-resume-mvp.md`.
4. Read the `Workflow Checkpoint Engine` section in `runtime-research/agent-runtime-index.md`.
5. Inspect the current worktree before editing; many unrelated files may be dirty from parallel development.

Recommended context command:

```powershell
pnpm harness context --spec harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md
```

If the local shell requires RTK and `rtk` is available, prefix commands with `rtk`. In the validation shell used for this handoff, `where.exe rtk` returned no match, so commands were run directly and the result was recorded here.

## Next Allowed Work

Allowed only through a fresh task spec:

- Operator-facing read-only inspection surface.
- Resume cutover readiness research.
- Verifier completion gate research.
- Tool mutability registry formalization.
- Retention policy tuning beyond the current hybrid defaults.
- Schema/index additions or migration work.

Not allowed as a casual continuation:

- Turning event log into resume authority.
- Adding a default-on flag.
- Adding UI/CLI/API/Gateway/renderer surfaces.
- Replaying side effects.
- Treating event-log diagnostics as completion proof.

## Commit Attention

The worktree contains substantial unrelated and parallel-development changes. Do not revert them. When preparing a commit for this MVP, make sure these relevant files are included:

- `openclaw_runtime/src/runtime-core/event-log.ts`
- `openclaw_runtime/src/runtime-core/event-log-persistence.ts`
- `openclaw_runtime/src/agents/long-task-control/persisted-resume-shadow.ts`
- `tests/unit/runtime-event-log-store.test.ts`
- `tests/unit/runtime-event-log-persistence.test.ts`
- `harness/specs/tasks/runtime-event-log-robustness-retention-evidence-mvp.md`
- `runtime-research/handoffs/runtime-event-log-robustness-retention-evidence-mvp/README.md`
- `runtime-research/agent-runtime-index.md`
