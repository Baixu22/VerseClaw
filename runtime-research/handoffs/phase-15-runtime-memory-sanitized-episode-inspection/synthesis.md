# Phase 15 Synthesis: Runtime Memory Sanitized Episode Inspection

## Decision

Phase 15 is accepted only as a narrow default-off persisted sanitized episode inspection/operator proof.

The accepted scope is the fresh Phase 15 task spec and handoff package plus one focused runtime integration test proving the existing `loadStore().listEpisodes()` store snapshot can produce episode-only inspection summaries. The proof uses explicit `runtime.memory.persist === true` and an explicit test database path, includes facts and candidates in the loaded store, and still keeps inspection output limited to sanitized episode summaries and episode-only statistics.

This synthesis does not accept TaskLoop memory reads, prompt/context injection, Gateway/Electron/renderer/shared host contract cutover, provider default registration, provider ordering cutover, provider output from `runtime.memory.persist`, default-on memory, raw retention, automatic fact extraction/promotion, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Prerequisite Audit

| Gate | Result | Evidence |
|---|---|---|
| Phase 14 synthesis exists | pass | `runtime-research/handoffs/phase-14-runtime-memory-taskloop-shadow-replay-proof/synthesis.md` exists. |
| Phase 14 synthesis has one status marker | pass | Status audit found exactly one `Status:` line. |
| Phase 14 final decision accepted | pass | Final content line is exactly `Status: accepted`. |
| Phase 14 is not broad cutover permission | pass | Phase 14 rejected TaskLoop memory reads, provider/Gateway/UI/default-on cutover, raw retention, services, and runtime authority. |

## Lane Classification

| Lane | Classification | Rechecked reason |
|---|---|---|
| Lane A: Inspection contract | accepted | The new focused test builds inspection summaries from `loadStore().listEpisodes()` without adding a production helper, and asserts episode id, task id, kind, reference_time, boundedSummary, source/evidence refs, redaction status, safe metadata, and episodeCount. |
| Lane B: Redaction and replay boundary | accepted | The inspection test rejects a raw transcript/jsonl/tool-output episode before load, then asserts the inspection JSON excludes raw markers, raw rows, `record_json`, fact ids, candidate ids, provider markers, and authority markers. Existing Phase 14 TaskLoop replay proof still covers raw TaskLoop markers. |
| Lane C: Disabled no-open parity | accepted | Existing runtime integration and persistence tests inject throwing SQLite openers and prove disabled load/write/migrate paths skip without opening; TaskLoop disabled matrix keeps persist-only from writing. |
| Lane D: No authority, provider, or Gateway boundary | accepted | The inspection proof lives outside TaskLoop, does not call fact/invalidation/provider paths during summary construction, and scans show no renderer/Gateway route, forbidden authority import, or TaskLoop memory read/fact/provider path. |
| Lane E: Validation, scans, and comms | accepted | Phase 15 and Phase 14-9 specs validate; focused tests and typecheck pass; scans were reviewed; comms replay/compare passed because the ambient worktree has dirty communication-adjacent files. |

Each Phase 15 lane submission has exactly one final accepted marker.

## Accepted Scope

| Accepted item | Evidence |
|---|---|
| Fresh Phase 15 task spec | `harness/specs/tasks/phase-15-runtime-memory-sanitized-episode-inspection.md` validates. |
| Fresh Phase 15 handoff package | README, parallel lanes, submission template, window prompts, Lane A-E submissions, and this synthesis exist under `runtime-research/handoffs/phase-15-runtime-memory-sanitized-episode-inspection/`. |
| Episode-only inspection proof | `tests/unit/runtime-memory-runtime-integration.test.ts` adds a proof that uses `loadStore().listEpisodes()` to build sanitized episode summaries. |
| Safe inspection fields | The test asserts episode id, task id, kind, reference_time, boundedSummary, source refs, evidence refs, redaction status, safe metadata, and episodeCount. |
| Raw and authority exclusion | The test asserts inspection JSON excludes raw transcript/jsonl/tool/env/secret/trace/raw-row markers, `record_json`, fact/candidate ids, provider context, and authority markers. |
| Facts/candidates remain outside inspection authority | The same loaded store contains a fact and a verified-looking candidate, but the inspection output remains episode-only and does not present them as durable authority. |
| Index update | `runtime-research/agent-runtime-index.md` records Phase 15 as accepted default-off sanitized episode inspection/operator proof and keeps cutovers blocked. |

## Rejected Scope

| Claim | Decision |
|---|---|
| TaskLoop memory reads or prompt/context injection from persisted memory | rejected |
| Gateway, Electron Main, renderer, shared host contract, host-api, api-client, or provider registry cutover | rejected |
| Default-on memory recording, persistence, provider output, provider injection, or provider ordering | rejected |
| `runtime.memory.persist` alone enabling TaskLoop writes, provider output, or runtime authority | rejected |
| Raw DB rows, `record_json`, chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage retention in inspection output | rejected |
| Automatic fact extraction, candidate promotion, LLM-generated durable facts, or unverified durable facts | rejected |
| Service/exporter/database-service/listener/daemon/HTTP/WebSocket/OTLP/Temporal/second Gateway/second runtime work | rejected |
| Memory-derived completion, verifier, security, retry, tool permission, runtime execution, provider ordering, or runtime authority | rejected |

## Validation

| Command / Check | Result |
|---|---|
| Phase 15 `harness context` | pass |
| Phase 15 `harness validate` | pass |
| Phase 14 `harness validate` | pass |
| Phase 13 `harness validate` | pass |
| Phase 12 `harness validate` | pass |
| Phase 11 `harness validate` | pass |
| Phase 10 `harness validate` | pass |
| Phase 9 `harness validate` | pass |
| Focused Runtime Memory/TaskLoop Vitest set | pass, 9 files / 113 tests |
| Node typecheck | pass, no diagnostics |
| Renderer direct IPC/Gateway scan | pass/no matches |
| Intended Runtime Memory import scan | pass/reviewed expected TaskLoop pilot and focused test matches |
| Forbidden authority import scan | pass/no matches |
| TaskLoop memory read/fact/provider scan | pass/no matches |
| Raw-retention scan | pass/reviewed spec/handoff prohibition text and negative assertions only |
| Service/exporter/listener scan | pass/reviewed spec/handoff prohibition text only |
| Broad persistence scan | pass/reviewed existing Runtime Memory owner/tests and unrelated pre-existing transcript/session surfaces |
| README docs sync scan | pass/no Runtime Memory or Phase 15 user-facing README mentions |
| `scripts/comms/replay.mjs` | pass |
| `scripts/comms/compare.mjs` | pass |

## Rollback

Rollback remains disabling `runtime.memory.persist` for inspection no-open/no-read/no-write behavior, disabling `runtime.memory.shadow` to stop the TaskLoop shadow episode writer, omitting the test/operator inspection proof, and preserving existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.

## Next Decision

Any Gateway/provider/default-on memory behavior, provider-ordering cutover, TaskLoop memory read, automatic fact extraction/promotion, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority requires a fresh task spec and synthesis acceptance.

Status: accepted
