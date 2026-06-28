# Phase 14 Synthesis: Runtime Memory TaskLoop Shadow Replay Proof

## Decision

Phase 14 is accepted only as a narrow default-off TaskLoop Runtime Memory shadow replay proof.

The accepted scope is the fresh Phase 14 task spec and handoff package plus one focused TaskLoop unit proof that the real adapter/persistence path can persist and replay exactly one bounded sanitized terminal TaskLoop episode through `RuntimeMemoryStore` when both `runtime.memory.shadow` and `runtime.memory.persist` are explicitly true.

This synthesis does not accept TaskLoop memory reads, Gateway/Electron/renderer/shared host contract cutover, provider default registration, provider ordering cutover, provider output from `runtime.memory.persist`, default-on memory, raw retention, automatic fact extraction/promotion, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Prerequisite Audit

| Gate | Result | Evidence |
|---|---|---|
| Phase 13 synthesis exists | pass | `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/synthesis.md` exists. |
| Phase 13 synthesis has one status marker | pass | `rg -n "^Status:|Status:"` returned one match. |
| Phase 13 final decision accepted | pass | Final content line is accepted. |
| Phase 13 is not broad cutover permission | pass | Phase 13 rejected Gateway/provider/default-on memory, TaskLoop reads, automatic facts, raw retention, services, and runtime authority. |

## Lane Classification

| Lane | Classification | Rechecked reason |
|---|---|---|
| Lane A: TaskLoop real adapter replay proof | accepted | The new TaskLoop test uses the real adapter/persistence path, reloads the existing store, and proves one sanitized episode with zero facts/invalidations and no raw replay markers. |
| Lane B: Disabled parity and idempotency boundary | accepted | Existing focused tests still cover omitted/false flags, no-open/no-write disabled parity, adapter disabled parity, persistence disabled parity, and alias idempotency replay. |
| Lane C: Redaction, fact, and authority boundary | accepted | Scans show no renderer/Gateway direct route, no forbidden authority import, no production TaskLoop memory reads/fact/provider path, no service/listener/exporter implementation, and only expected raw-retention prohibition/negative-assertion matches. |
| Lane D: Validation, scans, and comms | accepted | Phase 14 and Phase 13-9 specs validate; focused tests and typecheck pass; scans were reviewed; comms replay/compare passed because the ambient worktree has dirty communication-adjacent files. |
| Lane E: Synthesis and index readiness | accepted | The synthesis owner rechecked lane evidence and updated `runtime-research/agent-runtime-index.md` after acceptance. |

Each Phase 14 lane submission has exactly one final accepted marker.

## Accepted Scope

| Accepted item | Evidence |
|---|---|
| Fresh Phase 14 task spec | `harness/specs/tasks/phase-14-runtime-memory-taskloop-shadow-replay-proof.md` validates. |
| Fresh Phase 14 handoff package | README, parallel lanes, submission template, window prompts, and Lane A-E submissions exist under `runtime-research/handoffs/phase-14-runtime-memory-taskloop-shadow-replay-proof/`. |
| Real adapter replay proof | `tests/unit/task-loop-controller.test.ts` adds a temp-SQLite TaskLoop proof that runs without an injected writer, then reloads through `createRuntimeMemoryRuntimeIntegration().loadStore()`. |
| Sanitized episode-only replay | The new test asserts one episode, zero facts, zero invalidations, empty fact query results, `redactionStatus: "sanitized"`, and no raw task/self-check/template/subagent/stdout/stderr/env/secret/trace-context strings. |
| Disabled parity remains intact | Existing TaskLoop and Runtime Memory tests prove disabled/omitted flags do not open, read, or write Runtime Memory. |
| Index update | `runtime-research/agent-runtime-index.md` records Phase 14 as accepted default-off sanitized episode replay proof and keeps cutovers blocked. |

## Rejected Scope

| Claim | Decision |
|---|---|
| TaskLoop memory reads or prompt/context injection from persisted memory | rejected |
| Gateway, Electron Main, renderer, shared host contract, or provider registry cutover | rejected |
| Default-on memory recording, persistence, provider output, provider injection, or provider ordering | rejected |
| `runtime.memory.persist` alone enabling TaskLoop writes or provider output | rejected |
| Raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage retention | rejected |
| Automatic fact extraction, candidate promotion, LLM-generated durable facts, or unverified durable facts | rejected |
| Service/exporter/database-service/listener/daemon/HTTP/WebSocket/OTLP/Temporal/second Gateway/second runtime work | rejected |
| Memory-derived completion, verifier, security, retry, tool permission, runtime execution, provider ordering, or runtime authority | rejected |

## Validation

| Command / Check | Result |
|---|---|
| Phase 14 `harness context` | pass |
| Phase 14 `harness validate` | pass |
| Phase 13 `harness validate` | pass |
| Phase 12 `harness validate` | pass |
| Phase 11 `harness validate` | pass |
| Phase 10 `harness validate` | pass |
| Phase 9 `harness validate` | pass |
| `node_modules/vitest/vitest.mjs run` focused Runtime Memory/TaskLoop set | pass, 9 files / 111 tests |
| Node typecheck | pass, no diagnostics |
| Renderer direct IPC/Gateway scan | pass/no matches |
| Intended Runtime Memory import scan | pass/reviewed expected TaskLoop pilot and new test matches |
| Forbidden authority import scan | pass/no matches |
| TaskLoop memory read/fact/provider scan | pass/reviewed test-only replay inspection matches |
| Raw-retention scan | pass/reviewed spec/handoff prohibition text and negative assertions only |
| Service/exporter/listener scan | pass/reviewed spec/handoff prohibition text only |
| Broad persistence scan | pass/reviewed existing Runtime Memory owner/tests and unrelated pre-existing transcript/session surfaces |
| `scripts/comms/replay.mjs` | pass |
| `scripts/comms/compare.mjs` | pass |
| README doc-sync review | pass/no README Runtime Memory/TaskLoop mentions; no user-facing docs update required |

## Rollback

Rollback remains disabling either `runtime.memory.shadow` or `runtime.memory.persist`, omitting the Phase 13 TaskLoop shadow episode writer call site if a later rollback removes the pilot, omitting optional RuntimeMemoryProvider registration, and preserving existing Phase 9 persisted rows unless a later explicit migration or doctor policy accepts deletion.

## Next Decision

Any Gateway/provider/default-on memory behavior, provider-ordering cutover, TaskLoop memory read, automatic fact extraction/promotion, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority requires a fresh task spec and synthesis acceptance.

Status: accepted
