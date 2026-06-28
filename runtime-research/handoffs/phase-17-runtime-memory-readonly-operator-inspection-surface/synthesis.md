# Phase 17 Runtime Memory Readonly Operator Inspection Surface Synthesis

## Decision

Accepted scope is narrow: Phase 17 adds an explicit operator/developer readonly inspection surface through `inspectRuntimeMemoryForOperator(options)` and the local script `openclaw_runtime/scripts/inspect-runtime-memory-episodes.mjs`. The surface delegates to the Phase 16 helper `inspectRuntimeMemorySanitizedEpisodes(options)` and does not create a Gateway, Electron IPC, renderer UI, shared host contract, provider, TaskLoop, prompt, fact, service, or runtime-authority path.

## Rechecked Lanes

- Lane A accepted: `openclaw_runtime/src/runtime-core/memory-operator-inspection.ts` is a thin adapter over `inspectRuntimeMemorySanitizedEpisodes(options)`. The script is explicit invocation only and requires `--persist --database <path>` for a loaded inspection.
- Lane B accepted: tests prove persist false/omitted, missing database path, missing database file, and missing table produce skipped diagnostics without opening or creating SQLite state.
- Lane C accepted: tests prove enabled output is sanitized episode summaries/statistics only, excludes `record_json`, raw task/tool/env/secret/trace/provider/runtime-authority markers, and leaves persistence table counts unchanged.
- Lane D accepted: no Phase 17 Gateway, Electron, renderer, host-api/api-client/shared, provider registry, TaskLoop, prompt, or runtime authority route was added.
- Lane E accepted with caveats: focused tests and structural harness checks passed. Main worktree full diff-aware validate is blocked by unrelated pre-existing dirty files; isolated Phase-17-only full diff-aware validate passed.

## Validation

- Phase 16 prerequisite: `runtime-research/handoffs/phase-16-runtime-memory-readonly-episode-inspection/synthesis.md` has exactly one accepted status marker on its final line.
- `cmd /d /s /c ""C:\Users\27933\.cherrystudio\bin\rtk.exe" "C:\Program Files\nodejs\node.exe" harness/src/cli.mjs context --spec harness/specs/tasks/phase-17-runtime-memory-readonly-operator-inspection-surface.md"`: passed.
- Main worktree `validate --spec phase-17`: blocked by unrelated dirty/untracked files outside Phase 17 touched areas.
- Main worktree `validate --spec phase-17 --no-diff`: passed.
- Isolated Phase-17-only validation worktree full diff-aware `validate --spec phase-17`: passed.
- Phase 16/15/14/13/12/11/10/9 `--no-diff` structural validates: passed.
- Focused tests: `runtime-memory-persistence`, `runtime-memory-runtime-integration`, `task-loop-controller`, `runtime-feature-config-schema`, `context-provider-registry`, and `runtime-memory-operator-inspection`: passed, 94 tests.
- Root Node typecheck command was run and remains blocked by unrelated existing OpenClaw runtime module-resolution/ES2023 errors, including missing `@openclaw/normalization-core/*`, missing `@openclaw/acp-core/runtime/types`, and existing `toSorted`/`findLast` target-library diagnostics.
- Boundary scans: renderer fixed-string direct IPC/Gateway scans returned no matches; provider/TaskLoop/write-path scans for Phase 17 returned no matches; raw-retention scans found policy text and negative test fixtures/assertions only; helper scan confirmed `memory-operator-inspection.ts` calls `inspectRuntimeMemorySanitizedEpisodes`.

## Rejected Scope

Still rejected: Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contract changes, provider ordering or default provider registration, TaskLoop memory reads, prompt/context injection, automatic fact extraction/promotion, raw retention, services/exporters/listeners, database-service/daemon/server work, and any memory-derived runtime authority.

## Index

`runtime-research/agent-runtime-index.md` was updated with a Phase 17 addendum because the existing file contains invalid UTF-8 bytes and could not be safely rewritten through the normal patch tool.

Status: accepted
