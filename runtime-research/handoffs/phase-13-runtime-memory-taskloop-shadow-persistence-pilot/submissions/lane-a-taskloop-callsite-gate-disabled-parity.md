# Lane A: TaskLoop Call-Site Gate And Disabled Parity

## Scope

Implemented the narrow TaskLoop Runtime Memory call-site pilot for sanitized terminal episode writes only. The write path is default-off and requires both `runtime.memory.shadow === true` and `runtime.memory.persist === true` before the Runtime Memory adapter is constructed or `appendEpisode` is called.

No memory reads, facts, candidates, invalidations, provider hydration, Gateway/Electron/renderer/shared host routes, provider registration/order changes, services, listeners, exporters, raw retention, or runtime authority were added.

## Files Reviewed

- `AGENTS.md`
- `C:\Users\27933\.codex\RTK.md`
- `openclaw_runtime/AGENTS.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/README.md`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/parallel-lanes.md`
- `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md`
- `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md`
- `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md`
- `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md`
- `runtime-research/agent-runtime-index.md`
- `harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md`
- `harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md`
- `harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md`
- `harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md`
- `harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md`
- Harness context scenario/rules/layers returned for Phase 13.
- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`
- `openclaw_runtime/src/runtime-core/memory-persistence.ts`
- `openclaw_runtime/src/runtime-core/memory-context.ts`
- `openclaw_runtime/src/runtime-core/memory-store.ts`
- `openclaw_runtime/src/context-engine/memory-context-provider.ts`
- `openclaw_runtime/src/context-engine/provider-registry.ts`
- Focused Runtime Memory and TaskLoop tests.

## Files Changed

- `openclaw_runtime/src/agents/task-loop-controller.ts`
- `tests/unit/task-loop-controller.test.ts`
- `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-a-taskloop-callsite-gate-disabled-parity.md`

## Prerequisite Proof

- Phase 12 synthesis exists and its final status line is accepted at `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md:87`.
- Phase 12 accepted planning/spec/evidence only and explicitly rejected TaskLoop/Gateway/runtime call-site cutover, provider-ordering cutover, default-on persistence, raw retention, services/listeners/exporters, and runtime authority.
- Phase 11 synthesis final status is accepted at `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md:116`; it accepted only isolated default-off adapter wiring.
- Phase 10 synthesis final status is accepted at `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md:105`; it accepted only default-off integration boundary/readiness.
- Phase 9 synthesis final status is accepted at `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md:139`; it accepted only the default-off local sanitized SQLite persistence foundation.

## Implementation Evidence

- `task-loop-controller.ts:1814` resolves Runtime Memory flags through the existing strict resolver; omitted or non-boolean flags remain false.
- `task-loop-controller.ts:1819` returns before adapter construction unless both `shadow` and `persist` are true.
- `task-loop-controller.ts:1828` constructs the Phase 11 adapter only inside the dual-flag branch.
- `task-loop-controller.ts:1832` calls only `appendEpisode`.
- `task-loop-controller.ts:1838` builds a sanitized `RuntimeMemoryEpisodeRecord` from terminal TaskLoop status, phase, counts, IDs, source refs, and evidence refs.
- `task-loop-controller.ts:2906` and `task-loop-controller.ts:2922` invoke the shadow episode writer after normal/error trace completion; writer errors are caught and cannot change the returned TaskLoop record.

## Disabled Parity

- `tests/unit/task-loop-controller.test.ts:666` table-covers omitted flags, `shadow=false`, `persist=false`, and `persist=true` with shadow omitted.
- The disabled test injects a throwing `appendEpisode` and a throwing SQLite opener; `appendEpisode` is not called and `openCalls` remains `0` at `tests/unit/task-loop-controller.test.ts:720`.
- The same disabled test asserts preserved terminal status, phase, final summary, next action, evidence gate, and checkpoint metadata.
- Existing focused TaskLoop tests in the same file continue to cover verifier shadow, worker failure/timeout/permission behavior, event-log/checkpoint shadow behavior, runtime trace shadow behavior, tool-policy behavior, error mapping, and status reads. The focused TaskLoop test run passed all 55 tests after the change.

## Enabled Write Boundary

- `tests/unit/task-loop-controller.test.ts:723` proves the write happens only when both flags are true.
- The enabled test asserts one sanitized `task_event` episode, stable terminal idempotency key, TaskLoop/source/checkpoint refs, no provider hydration metadata, no fact extraction metadata, and no runtime authority metadata.
- The enabled test asserts the raw request text and final summary are absent from the episode JSON.
- `tests/unit/task-loop-controller.test.ts:805` proves a throwing Runtime Memory writer leaves TaskLoop terminal status/result/checkpoint behavior unchanged.

## Forbidden Boundary Scans

- Renderer bypass scan over `src/pages src/components`: no matches for direct IPC, direct Gateway HTTP, localhost Gateway, or direct WebSocket.
- Intended TaskLoop adapter scan found matches only in `openclaw_runtime/src/agents/task-loop-controller.ts` for the new adapter import/type/use and tests for injected writer/options.
- Forbidden authority import scan over `openclaw_runtime/src/gateway electron shared src/lib openclaw_runtime/src/context-engine/provider-registry.ts openclaw_runtime/src/runtime-core/index.ts`: no matches for `memory-runtime-integration`, `createRuntimeMemoryRuntimeIntegration`, `RuntimeMemoryRuntimeIntegration`, `createRuntimeMemoryPersistenceStore`, `memory-persistence`, or `RUNTIME_MEMORY_PERSISTENCE_OWNER`.
- Tight TaskLoop operation scan found no `appendFact`, `invalidateFact`, `loadStore`, `queryFacts`, `createRuntimeMemoryContextProvider`, `RuntimeMemoryProvider`, or `proposeFacts` matches.
- Service/exporter/database-service/listener scan over the touched TaskLoop files: no matches.
- Raw-retention scan over touched TaskLoop files found only preexisting prompt-injection and trace-context sanitizer/test fixtures (`tracestate`, `baggage`, `secret`) unrelated to the Runtime Memory episode write. The new episode mapping does not include raw request text, final summaries, transcripts, payloads, tool args/output, env, secrets, raw traceparent/tracestate/baggage, stdout, or stderr.

## Validation

- `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md`: pass.
- Phase 13 harness validate: pass.
- Phase 12 harness validate: pass.
- Phase 11 harness validate: pass.
- Phase 10 harness validate: pass.
- Phase 9 harness validate: pass.
- Focused TaskLoop Vitest: pass, 1 file / 55 tests.
- Focused Runtime Memory + TaskLoop Vitest: pass, 9 files / 105 tests.
- `git diff --check -- openclaw_runtime/src/agents/task-loop-controller.ts tests/unit/task-loop-controller.test.ts`: pass, with only Git-for-Windows LF/CRLF warnings.
- `scripts/comms/replay.mjs`: pass.
- `scripts/comms/compare.mjs`: pass.
- README Runtime Memory docs sync scan across `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md`: no matches; no README updates needed for this hidden default-off runtime pilot.

Typecheck note: `C:\Users\27933\.cherrystudio\bin\rtk.exe C:\Program Files\nodejs\node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` currently fails only in the preexisting untracked `openclaw_runtime/src/runtime-core/agent-map.ts` file, with unused helper, missing AgentMap constant/helper, readonly tuple JSON, and `SourceFile.parseDiagnostics` diagnostics. No diagnostics point at the Lane A touched files.

## Rollback

Rollback is disabling either `runtime.memory.shadow` or `runtime.memory.persist`, or omitting the TaskLoop adapter import/call site. Existing Phase 9 persisted rows are preserved. TaskLoop, tools.invoke, approvals, retries, verifier/security behavior, event-log/checkpoint/resume, RuntimeMemoryProvider, and provider ordering remain authoritative.

Status: accepted
