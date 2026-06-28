# Phase 16 Synthesis: Runtime Memory Readonly Episode Inspection

## Decision

Phase 16 is accepted only as a narrow default-off Runtime Memory read-only sanitized episode inspection / no-mutation proof.

The accepted scope is the fresh Phase 16 task spec and handoff package plus `inspectRuntimeMemorySanitizedEpisodes(options)` in the Runtime Memory persistence owner. The helper exists only inside Runtime Memory, requires `runtime.memory.persist === true` plus an explicit existing database path before SQLite open/read, opens the database read-only, reads only sanitized episode summary columns from `runtime_memory_episodes`, and returns episode summaries plus bounded episode-only statistics.

This synthesis does not accept TaskLoop memory reads, prompt/context injection, Gateway/Electron/renderer/shared host contract cutover, provider default registration, provider ordering cutover, provider output from `runtime.memory.persist`, default-on memory, raw retention, automatic fact extraction/promotion, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Prerequisite Audit

| Gate | Result | Evidence |
|---|---|---|
| Phase 15 synthesis exists | pass | `runtime-research/handoffs/phase-15-runtime-memory-sanitized-episode-inspection/synthesis.md` exists. |
| Phase 15 synthesis has one status marker | pass | Status audit found exactly one `Status:` line. |
| Phase 15 final decision accepted | pass | Final content line is exactly `Status: accepted`. |
| Phase 15 is not strict read-only proof | pass | Phase 15 accepted sanitized inspection through `loadStore().listEpisodes()`, but current `loadStore()` uses a write transaction/schema/meta path. |

## Lane Classification

| Lane | Classification | Rechecked reason |
|---|---|---|
| Lane A: Readonly inspection contract | accepted | New helper is default-off, explicit-path gated, read-only opener based, and outside the persistence class write/migrate methods. Disabled tests prove no SQLite open. |
| Lane B: No-mutation schema boundary | accepted | Missing DB/table tests prove no file/table creation. Enabled no-mutation test proves meta/count/idempotency/fact/invalidation state unchanged and no retention trim. |
| Lane C: Redaction episode-only output | accepted | Helper selects no `record_json` and no fact/candidate/invalidation rows. Tests prove raw marker redaction and absence of facts/candidates/provider/authority markers from output. |
| Lane D: Disabled no-open provider/Gateway boundary | accepted | Scans show no TaskLoop read/fact/provider path and no Gateway/Electron/shared/renderer/host-api/api-client import or route. |
| Lane E: Validation, scans, and comms | accepted | Phase 16 full diff-aware harness validation passed in an isolated Phase-16-only validation repository; Phase 15-9 specs validate structurally with `--no-diff`; focused tests, typecheck, scans, and comms replay/compare passed. |

Each Phase 16 lane submission has exactly one final accepted marker.

## Accepted Scope

| Accepted item | Evidence |
|---|---|
| Fresh Phase 16 task spec | `harness/specs/tasks/phase-16-runtime-memory-readonly-episode-inspection.md` validates. |
| Fresh Phase 16 handoff package | README, parallel lanes, submission template, window prompts, Lane A-E submissions, and this synthesis exist under `runtime-research/handoffs/phase-16-runtime-memory-readonly-episode-inspection/`. |
| Runtime Memory internal readonly helper | `inspectRuntimeMemorySanitizedEpisodes(options)` exists in `openclaw_runtime/src/runtime-core/memory-persistence.ts`. |
| Disabled no-open/no-read/no-write | Focused tests inject a throwing read-only opener and prove false/omitted `runtime.memory.persist` never opens SQLite. |
| Missing DB/table no-create diagnostics | Focused tests prove missing database path returns skipped diagnostics without creating a file, and missing `runtime_memory_episodes` table does not create Runtime Memory tables or meta. |
| Enabled read-only no-mutation | Focused test records meta/count/idempotency/fact/invalidation state before and after inspection and proves unchanged state with `limit: 1` over two episodes. |
| Episode-only sanitized output | Output includes episode id, task id, kind, reference_time, boundedSummary, source/evidence refs, redaction status, safe metadata, and count/limit/truncated stats only. |
| Raw and authority exclusion | Tests prove no raw task/self-check/subagent/template/stdout/stderr/env/secret/trace/transcript/jsonl/tool markers, `record_json`, fact ids, candidate ids, provider markers, or authority markers appear. |
| Index update | `runtime-research/agent-runtime-index.md` records Phase 16 as accepted read-only sanitized episode inspection/no-mutation proof and keeps cutovers blocked. |

## Rejected Scope

| Claim | Decision |
|---|---|
| Treating Phase 15 `loadStore().listEpisodes()` as strict no-mutation operator inspection | rejected |
| TaskLoop memory reads or prompt/context injection from persisted memory | rejected |
| Gateway, Electron Main, renderer, shared host contract, host-api, api-client, or provider registry cutover | rejected |
| Default-on memory recording, persistence, provider output, provider injection, or provider ordering | rejected |
| `runtime.memory.persist` alone enabling TaskLoop writes, provider output, or runtime authority | rejected |
| Read-only inspection running migrate, schema creation, meta writes, idempotency writes, retention trimming, appendEpisode, appendFact, invalidateFact, provider hydration, or TaskLoop | rejected |
| Raw DB rows, `record_json`, chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage retention in inspection output | rejected |
| Automatic fact extraction, candidate promotion, LLM-generated durable facts, or unverified durable facts | rejected |
| Service/exporter/database-service/listener/daemon/HTTP/WebSocket/OTLP/Temporal/second Gateway/second runtime work | rejected |
| Memory-derived completion, verifier, security, retry, tool permission, runtime execution, provider ordering, or runtime authority | rejected |

## Validation

| Command / Check | Result |
|---|---|
| Phase 16 `harness context` | pass |
| Phase 16 full diff-aware `harness validate` | pass in isolated Phase-16-only validation repository |
| Phase 16 `harness validate --no-diff` | pass |
| Phase 15 `harness validate --no-diff` | pass |
| Phase 14 `harness validate --no-diff` | pass |
| Phase 13 `harness validate --no-diff` | pass |
| Phase 12 `harness validate --no-diff` | pass |
| Phase 11 `harness validate --no-diff` | pass |
| Phase 10 `harness validate --no-diff` | pass |
| Phase 9 `harness validate --no-diff` | pass |
| Focused Runtime Memory/TaskLoop Vitest set | pass, 9 files / 118 tests |
| Node typecheck | pass, no diagnostics |
| Renderer direct IPC/Gateway scan | pass/no matches |
| Intended Runtime Memory import scan | pass/reviewed expected TaskLoop pilot/tests and Phase 16 persistence test matches |
| Forbidden authority import scan | pass/no matches |
| TaskLoop memory read/fact/provider scan | pass/no matches |
| Raw-retention scan | pass/reviewed negative assertions/test fixtures and spec/handoff prohibition text only |
| Service/exporter/listener scan | pass/reviewed spec/handoff prohibition text only |
| Broad persistence scan | pass/reviewed intended Runtime Memory owner/tests and unrelated pre-existing transcript/session surfaces |
| Read-only helper mutation scan | pass/reviewed helper line range before write/migrate/trim functions |
| README docs sync scan | pass/no Runtime Memory or Phase 16 user-facing README mentions |
| `scripts/comms/replay.mjs` | pass |
| `scripts/comms/compare.mjs` | pass |

Comms replay/compare were required because the ambient worktree has dirty communication-adjacent files.

## Rollback

Rollback remains disabling `runtime.memory.persist` for inspection no-open/no-read/no-write behavior, omitting the Phase 16 readonly helper/proof, disabling `runtime.memory.shadow` to stop the TaskLoop shadow episode writer, and preserving existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.

## Next Decision

Any Gateway/provider/default-on memory behavior, provider-ordering cutover, TaskLoop memory read, automatic fact extraction/promotion, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority requires a fresh task spec and synthesis acceptance.

Status: accepted
