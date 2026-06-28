# Phase 13 Synthesis: Runtime Memory TaskLoop Shadow Persistence Pilot

## Decision

Phase 13 is accepted only as a default-off TaskLoop Runtime Memory shadow persistence pilot for sanitized terminal episode records.

The accepted pilot requires both `runtime.memory.shadow === true` and `runtime.memory.persist === true` before TaskLoop constructs the Runtime Memory adapter or calls `appendEpisode`. It does not accept TaskLoop memory reads, durable fact writes, Gateway/Electron/renderer/shared host contract routes, provider ordering changes, default provider registration, default-on persistence, raw retention, service/exporter/database-service/listener work, or memory-derived runtime authority.

## Prerequisite Audit

All required Phase 13 lane submissions exist:

| Lane | Submission | Marker count | Marker value |
|---|---|---:|---|
| Lane A | `lane-a-taskloop-callsite-gate-disabled-parity.md` | 1 | accepted |
| Lane B | `lane-b-sanitized-episode-write-mapping.md` | 1 | accepted |
| Lane C | `lane-c-idempotency-error-isolation-rollback.md` | 1 | accepted |
| Lane D | `lane-d-provider-gateway-docs-no-authority-boundary.md` | 1 | accepted |
| Lane E | `lane-e-validation-scans-comms-synthesis-readiness.md` | 1 | needs_revision |

Phase 12, Phase 11, Phase 10, and Phase 9 syntheses were re-read. Their accepted boundaries remain narrower prerequisites only:

| Phase | Rechecked conclusion |
|---|---|
| Phase 12 | Accepted planning/spec/evidence readiness only; rejected TaskLoop/Gateway/runtime call-site cutover, provider-ordering/default-provider cutover, default-on persistence, raw retention, services/listeners/exporters, and runtime authority. |
| Phase 11 | Accepted isolated default-off `memory-runtime-integration` adapter wiring only; rejected TaskLoop/Gateway/provider/default-on/runtime-authority cutover. |
| Phase 10 | Accepted default-off integration boundary/readiness only; rejected implemented runtime read/write wiring. |
| Phase 9 | Accepted default-off local sanitized SQLite persistence foundation only; rejected runtime cutover, raw retention, unverified facts, services/listeners/exporters, and runtime authority. |

## Lane Reclassification

| Lane | Reclassification | Reason |
|---|---|---|
| Lane A | accepted | Current TaskLoop source requires both flags before adapter construction and `appendEpisode`; disabled tests cover omitted flags, `shadow=false`, `persist=false`, and persist-only with zero writes/opens. |
| Lane B | accepted | The enabled TaskLoop path writes one sanitized `task_event` episode with deterministic refs and no raw request/final/subagent/session text; production TaskLoop has no fact/invalidation/read/provider calls. |
| Lane C | accepted | Stable terminal idempotency keys, persistence duplicate handling, bounded retention, and shadow-only write failure isolation are proven in current source/tests. |
| Lane D | accepted | Boundary scans prove no Gateway/Electron/renderer/shared route, provider default registration, or provider ordering cutover. Synthesis owner updated config help/type comments so operator-facing wording names the dual-flag TaskLoop pilot while preserving no-authority/no-default-on boundaries. |
| Lane E | accepted | Lane E's recorded blockers were rechecked. Fresh node typecheck now passes, focused tests pass, and the config wording gap was resolved before this synthesis. |

## Accepted Evidence

TaskLoop gate and write boundary:

- `openclaw_runtime/src/agents/task-loop-controller.ts:1814` resolves runtime memory flags and requires `shadow === true && persist === true`.
- `openclaw_runtime/src/agents/task-loop-controller.ts:1824` returns before writer construction when either flag is not true.
- `openclaw_runtime/src/agents/task-loop-controller.ts:1828` constructs `createRuntimeMemoryRuntimeIntegration` only in the dual-flag branch.
- `openclaw_runtime/src/agents/task-loop-controller.ts:1832` calls only `appendEpisode`.
- `TaskLoopRuntimeMemoryEpisodeWriter` is `Pick<RuntimeMemoryRuntimeIntegrationPort, "appendEpisode">`.

Sanitized episode mapping:

- `buildTaskLoopRuntimeMemoryEpisode()` stores terminal phase/status, runtime status, counts, loop/task-ledger refs, trace refs, and no-authority metadata.
- The enabled TaskLoop test asserts no raw request text, final summary, plan template, subagent run id, or child session id appears in the episode JSON.
- TaskLoop production scan found no `appendFact`, `invalidateFact`, `loadStore`, `queryFacts`, RuntimeMemoryProvider, provider flag, or `proposeFacts` use.

Persistence, idempotency, and rollback:

- `memory-runtime-integration.ts` checks `runtime.memory.persist` before `migrate`, `appendEpisode`, `appendFact`, `invalidateFact`, or `loadStore`.
- `memory-persistence.ts` checks `persist` before SQLite migration/write/load paths, dedupes episodes by idempotency key or canonical episode id, and trims bounded tables through the existing Phase 9 owner.
- Disabled TaskLoop, adapter, and persistence tests prove no SQLite open/read/write when flags are off.
- Rollback is disabling either required flag or omitting the TaskLoop import/call site; existing Phase 9 rows are preserved.

Provider, Gateway, and authority boundary:

- Default provider registry remains legacy context provider, loop context pack provider, then explicit extras.
- Runtime Memory provider remains explicit-injection only, `enabledByDefault: false`, `shadowOnly: true`, readonly, and non-authoritative.
- `runtime.memory.persist` does not enable provider output, provider registration, or provider ordering.
- No memory-derived completion gate, verifier authority, security policy, retry policy, tool permission authority, runtime execution authority, or runtime authority was found.

Raw-retention and service boundary:

- Raw-retention matches are sanitizer denylist code, negative tests, rejection assertions, TaskLoop trace-context sanitizer fixtures, or unrelated preexisting config help.
- No TaskLoop episode path stores raw prompts, transcripts, full payloads, full checkpoints, tool args/output, env, secrets, raw traceparent/tracestate/baggage, stdout, or stderr.
- Service/exporter/database-service/listener scan found no Phase 13 memory service, exporter, listener, HTTP/WebSocket server, OTLP collector/exporter, Temporal service, second Gateway, or second runtime work.

Docs/config sync:

- `schema.help.ts` now states that the TaskLoop sanitized episode pilot requires both `runtime.memory.shadow` and `runtime.memory.persist`, that `persist` alone does not enable TaskLoop writes, and that no Gateway/provider/default-on/fact/runtime-authority cutover is accepted.
- `types.openclaw.ts` comments now describe memory persistence flags and the dual-flag TaskLoop write requirement.
- README translation scan over `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md` found no Runtime Memory/Phase 13 text requiring translation updates.

## Validation

| Command or scan | Result |
|---|---|
| Phase 13 harness context | pass |
| Phase 13 harness validate | pass |
| Phase 12 harness validate | pass |
| Phase 11 harness validate | pass |
| Phase 10 harness validate | pass |
| Phase 9 harness validate | pass |
| Focused Runtime Memory and TaskLoop Vitest | pass, 9 files / 110 tests |
| Node typecheck, `tsconfig.node.json` | pass |
| Renderer boundary scan over `src/pages src/components` | pass, no matches |
| Intended TaskLoop import scan | pass, adapter import/use confined to `task-loop-controller.ts` |
| Forbidden authority import scan over Gateway/Electron/shared/src-lib/provider registry/runtime-core barrel | pass, no matches |
| TaskLoop memory read/fact/provider scan | pass, no matches |
| Raw-retention scan | pass with reviewed sanitizer/help/negative-test matches only |
| Service/exporter/database-service/listener scan | pass with unrelated preexisting config help matches only |
| Persistence scan | pass with intended Runtime Memory persistence/adapter/tests and unrelated existing transcript/session surfaces reviewed |
| Comms replay | pass |
| Comms compare | pass |

Comms replay/compare were required because the ambient worktree contains dirty communication-adjacent paths, including `electron/**`, `openclaw_runtime/src/gateway/**`, `shared/host-api/contract.ts`, `shared/host-events/contract.ts`, and `src/lib/host-api.ts`.

## Rejected Claims

| Claim | Decision |
|---|---|
| TaskLoop memory reads or provider hydration | rejected |
| Gateway/Electron/renderer/shared host contract memory routes | rejected |
| Provider ordering cutover or default Runtime Memory provider registration | rejected |
| `runtime.memory.persist` alone enabling TaskLoop writes or provider output | rejected |
| Default-on memory recording, persistence, provider output, extraction, promotion, or prompt dumps | rejected |
| Raw chat-log/transcript/jsonl/trace/prompt/payload/checkpoint/tool/env/secret retention | rejected |
| Candidate, LLM-derived, rejected, invalidated, expired, or unpromoted facts becoming durable facts | rejected |
| Service/exporter/database-service/listener/daemon/HTTP/WebSocket/OTLP/Temporal/second-runtime work | rejected |
| Memory-derived completion, verifier, security, retry, tool, runtime execution, provider ordering, or runtime authority | rejected |

## Next Decision

The next phase must use a fresh task spec and synthesis before accepting any Gateway/provider/default-on/operator-facing persistence flow, TaskLoop memory read, durable automatic fact promotion, provider ordering change, raw retention, service/listener/exporter work, or memory-derived runtime authority.

Status: accepted
