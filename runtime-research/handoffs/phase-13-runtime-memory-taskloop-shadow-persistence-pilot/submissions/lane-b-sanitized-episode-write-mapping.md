# Phase 13 Lane B: Sanitized TaskLoop Episode Write Mapping

## Scope Confirmation

- Lane: `lane-b-sanitized-episode-write-mapping`
- Output file: `runtime-research/handoffs/phase-13-runtime-memory-taskloop-shadow-persistence-pilot/submissions/lane-b-sanitized-episode-write-mapping.md`
- Files reviewed: `AGENTS.md`; `C:\Users\27933\.codex\RTK.md`; `openclaw_runtime/AGENTS.md`; Phase 13 task spec, README, parallel lanes, and submission template; Phase 12/11/10/9 syntheses; `runtime-research/agent-runtime-index.md`; `openclaw_runtime/src/agents/task-loop-controller.ts`; `openclaw_runtime/src/runtime-core/memory-context.ts`; `openclaw_runtime/src/runtime-core/memory-store.ts`; `openclaw_runtime/src/runtime-core/memory-persistence.ts`; `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`; `openclaw_runtime/src/context-engine/memory-context-provider.ts`; `openclaw_runtime/src/context-engine/provider-registry.ts`; focused Runtime Memory and TaskLoop tests.
- Files changed: `openclaw_runtime/src/agents/task-loop-controller.ts`; `tests/unit/task-loop-controller.test.ts`; this submission.
- Runtime behavior changed: yes, only when both `runtime.memory.shadow` and `runtime.memory.persist` are explicitly true.
- TaskLoop Runtime Memory call-site changed: yes, the existing TaskLoop episode mapper was narrowed to deterministic run/trace/task-ledger evidence refs only.
- Gateway/Electron/renderer/shared host contract changed: no.
- Provider registration/order changed: no.
- Main/Gateway/host-api/api-client paths changed: no.

## Executive Summary

Lane B is accepted. The TaskLoop pilot writes exactly one Runtime Memory episode record at terminal TaskLoop exit when both required flags are true. The mapping is bounded to lifecycle metadata: loop id, terminal phase/status, runtime status, iteration counts, evidence/test/file counts, trace id, task-ledger root id, and explicit no-authority metadata.

I tightened the existing mapper so it no longer copies broad `record.evidenceRefs` into the Runtime Memory episode. That avoids retaining subagent/result summaries, plan summaries, child run/session ids, prompts, transcript-like text, tool output, or other non-lifecycle evidence text in the persisted episode. The TaskLoop dependency remains `Pick<RuntimeMemoryRuntimeIntegrationPort, "appendEpisode">`; no TaskLoop path calls `appendFact`, `invalidateFact`, or `loadStore`.

## Phase Entry Confirmation

| Required Entry Fact | Evidence | Result |
|---|---|---|
| Phase 12 synthesis exists | `runtime-research/handoffs/phase-12-runtime-memory-cutover-readiness/synthesis.md` | pass |
| Phase 12 synthesis ends exactly `Status: accepted` | Final line reviewed as `Status: accepted`. | pass |
| Phase 12 accepted only planning/spec/evidence readiness | Phase 12 decision says accepted as planning/spec/evidence only and rejects runtime behavior acceptance. | pass |
| Phase 12 rejected broad cutover | Phase 12 rejected TaskLoop/Gateway/provider-ordering/default-on/raw-retention/runtime-authority cutover. | pass |
| Phase 11 accepted only isolated default-off adapter wiring | `runtime-research/handoffs/phase-11-runtime-memory-default-off-wiring/synthesis.md` decision and final accepted line. | pass |
| Phase 10 accepted only default-off integration boundary/readiness | `runtime-research/handoffs/phase-10-runtime-memory-persistence-integration/synthesis.md` decision and final accepted line. | pass |
| Phase 9 accepted only default-off local sanitized persistence foundation | `runtime-research/handoffs/phase-9-runtime-memory-persistence-foundation/synthesis.md` decision and final accepted line. | pass |

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Dual-flag TaskLoop gate | file/test | `openclaw_runtime/src/agents/task-loop-controller.ts`; `tests/unit/task-loop-controller.test.ts` | `runtimeMemoryShadowPersistenceEnabled` lines 1814-1817; disabled test lines 668-720 | Requires both `shadow` and `persist`; disabled test proves no write/open and unchanged terminal result. |
| Episode-only TaskLoop port | file/test | `task-loop-controller.ts`; `task-loop-controller.test.ts` | `TaskLoopRuntimeMemoryEpisodeWriter` lines 123-126; deps lines 322-326; enabled test lines 723-824 | Port type exposes only `appendEpisode`; test adds `appendFact`, `invalidateFact`, and `loadStore` spies and proves they are not called. |
| Bounded sanitized episode mapping | file/test | `task-loop-controller.ts`; `task-loop-controller.test.ts` | mapper lines 1838-1936; enabled test lines 767-824 | Episode contains terminal status, ids, counts, no-authority metadata, deterministic source/evidence refs, and sanitized redaction status. |
| Broad evidence summaries no longer retained | file/test | `task-loop-controller.ts`; `task-loop-controller.test.ts` | evidence refs lines 1871-1889; leak assertions lines 818-824 | Mapper no longer copies `record.evidenceRefs`; test proves request text, self-check summary, subagent text, plan template, run ids, and child session ids do not appear. |
| Adapter still delegates through Phase 11/9 path | file | `memory-runtime-integration.ts`; `memory-persistence.ts` | adapter lines 62-68; persistence lines 358-372 and 813-824 | Enabled episode writes call adapter `appendEpisode`, then persistence owner revalidates/sanitizes before SQLite write. |
| Raw retention rejected | file/test/scan | `memory-context.ts`; `memory-persistence.ts`; focused raw scan | denylist lines 97-109, 336-391, 1369-1425; persistence recursive rejection lines 859-889 | Raw scan matches are sanitizer denylist code and negative fixtures/assertions only. |
| Durable fact gates unchanged | file/test | `memory-context.ts`; focused tests | durable shape lines 570-584; current-valid lines 900-925; verification filter lines 1176-1195 | No Lane B code writes facts. Existing gates still require accepted status, `acceptedAt`, promotion evidence, source episodes, and evidence refs. |
| Provider ordering unchanged | file/test/scan | `provider-registry.ts`; `context-provider-registry.test.ts`; forbidden import scan | default registry path unchanged; test keeps default providers explicit | No provider/default registry import or registration was added. |

## Required Evidence Matrix

| Required Evidence | Path / Command | Result | Gap / Not Applicable Reason |
|---|---|---|---|
| Phase 13 scope only | Phase 13 task spec and README reviewed; code changed only TaskLoop mapper/test. | pass | none |
| Dual flag gate: shadow and persist both required | `task-loop-controller.ts:1814-1817`; disabled tests. | pass | none |
| No SQLite open/read/write when either required flag is false | Disabled TaskLoop test injects throwing `openDatabase`, expects `openCalls=0`; adapter/persistence disabled tests passed. | pass | none |
| `persist=true`, `shadow=false` does not write | Parameterized disabled TaskLoop test covers persist-only config and `appendEpisode` not called. | pass | none |
| TaskLoop terminal status/result/retry/approval parity when disabled | Disabled TaskLoop test checks complete phase/status/final summary/next action/evidence gate/checkpoint. | pass | none |
| Intended TaskLoop import/call-site proof | `rg` over TaskLoop/test found only intended adapter import/use at lines 40-43, 123-126, 322-326, 1828. | pass | none |
| No Gateway/Electron/renderer/shared/default registry import | `rg` over `openclaw_runtime/src/gateway electron shared src/lib provider-registry.ts runtime-core/index.ts` returned no adapter/persistence owner matches. | pass | `rg` exit 1 means no matches. |
| Sanitized episode-only write boundary | TaskLoop mapper lines 1838-1936; test lines 723-824; adapter/persistence sanitizer lines 62-68 and 813-824. | pass | none |
| No TaskLoop memory reads or provider hydration | Scan over TaskLoop for `appendFact(`, `invalidateFact(`, `loadStore(`, memory provider, provider hydration returned only test spy names and unrelated registry shadow text. | pass | none |
| Store owner and schema preserved | `memory-persistence.ts` owner/schema unchanged; no Lane B schema edits. | pass | none |
| Migration and idempotency preserved | Focused persistence/runtime integration tests passed. | pass | none |
| Retention and redaction preserved | Focused persistence tests passed; raw scan reviewed. | pass | none |
| Raw chat/raw trace rejection | `memory-context.ts` raw rejection reasons/patterns and recursive persistence rejection reviewed. | pass | none |
| No raw retention | TaskLoop episode test leak assertions and focused raw scans. | pass | Raw scan hits are expected sanitizer code or negative tests. |
| No durable fact/candidate/invalidation writes | TaskLoop writer port/test proves only `appendEpisode`; no TaskLoop `appendFact` or `invalidateFact` production calls. | pass | none |
| No service/exporter/database-service/listener | Service scan over touched files and focused memory files returned no matches. | pass | `rg` exit 1 means no matches. |
| Provider ordering unchanged | Forbidden import scan no matches; focused registry tests passed. | pass | none |
| Runtime Memory provider remains default-off/no-authority | `memory-context-provider.ts` reviewed; focused provider/registry tests passed. | pass | none |
| Source episode/evidence refs for durable fact claim | Existing durable fact fixtures/tests retain source episode/evidence refs. | pass | Lane B writes no durable facts. |
| Durable promotion gate unchanged | `isRuntimeMemoryTemporalFact()` lines 570-584; focused tests passed. | pass | none |
| Current-valid query exclusion unchanged | `isRuntimeMemoryFactValidAt` and `matchesVerification` lines 900-925 and 1176-1195; focused tests passed. | pass | none |
| Rollback proof | Disable either `runtime.memory.shadow` or `runtime.memory.persist`; TaskLoop returns before creating adapter/writer. | pass | none |
| Config help/docs sync plan | No user-visible config/help semantics changed in Lane B. | not-applicable | Existing flags remain default false. |
| Comms replay/compare requirement | `rtk.exe node.exe scripts/comms/replay.mjs`; `rtk.exe node.exe scripts/comms/compare.mjs`. | pass | Run because ambient worktree has communication-adjacent dirt. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on memory behavior | pass | `DEFAULT_RUNTIME_MEMORY_FEATURE_FLAGS` remains all false at `memory-context.ts:129-134`; TaskLoop requires both flags. |
| No Gateway/Electron/renderer/shared cutover | pass | Forbidden import scan returned no matches outside TaskLoop/test. |
| No provider-ordering cutover | pass | No provider registry code changed by Lane B; focused registry tests passed. |
| No raw chat-log/raw trace memory | pass | TaskLoop mapper stores no prompt/transcript/tool/stdout/stderr/raw trace context; raw scan matches are sanitizer/test negatives. |
| No unverified durable facts | pass | Lane B writes no facts/candidates/invalidations; durable fact gate tests passed. |
| No runtime authority | pass | Episode metadata marks no completion/verifier/security/retry/tool/runtime authority; writer failure test preserves terminal result. |
| No service/exporter/database-service/listener | pass | Focused service/exporter/listener scans returned no matches. |

## Tests And Commands

| Command | Result | Covers | Gap |
|---|---|---|---|
| `rtk.exe node.exe harness/src/cli.mjs context --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md` | pass | Phase 13 read order/context | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-13-runtime-memory-taskloop-shadow-persistence-pilot.md` | pass | Phase 13 spec validity | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-12-runtime-memory-cutover-readiness.md` | pass | Phase 12 prerequisite spec | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-11-runtime-memory-default-off-wiring.md` | pass | Phase 11 prerequisite spec | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-10-runtime-memory-persistence-integration.md` | pass | Phase 10 prerequisite spec | none |
| `rtk.exe node.exe harness/src/cli.mjs validate --spec harness/specs/tasks/phase-9-runtime-memory-persistence-foundation.md` | pass | Phase 9 prerequisite spec | none |
| `rtk.exe node.exe node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts` | pass, 55 tests | Focused TaskLoop mapper/gate/error-isolation proof | none |
| `rtk.exe node.exe node_modules/vitest/vitest.mjs run tests/unit/task-loop-controller.test.ts tests/unit/runtime-memory-context-contracts.test.ts tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-proposal-shadow.test.ts tests/unit/runtime-memory-context-provider.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-runtime-integration.test.ts tests/unit/runtime-feature-config-schema.test.ts tests/unit/context-provider-registry.test.ts` | pass, 9 files / 105 tests | TaskLoop, memory contracts/store/proposal/provider/persistence/adapter/config/registry | none |
| `rtk.exe node.exe node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Node typecheck | none |
| Renderer boundary scan over `src/pages src/components` | pass/no matches | No renderer IPC/Gateway/WebSocket bypass | `rg` exit 1 means no matches. |
| Intended TaskLoop import scan | pass/reviewed | Adapter import/call appears only in TaskLoop/test | none |
| Forbidden authority import scan | pass/no matches | No Gateway/Electron/shared/src/lib/default-registry adapter import | `rg` exit 1 means no matches. |
| Raw-retention scan over touched TaskLoop/test files | pass/reviewed | TaskLoop episode mapper has no raw retention; matches are trace shadow/test fixtures and security keyword heuristic | none |
| Raw-retention scan over memory source/tests | pass/reviewed | Sanitizer denylist and negative fixtures/assertions only | none |
| Service/exporter/database-service/listener scan | pass/no matches | No service/listener/exporter additions | `rg` exit 1 means no matches. |
| Persistence surface scan | pass/reviewed | Intended Phase 9/11 memory persistence surfaces only; broader gateway transcript hits are unrelated ambient code | none |
| `rtk.exe node.exe scripts/comms/replay.mjs` | pass | Comms replay | none |
| `rtk.exe node.exe scripts/comms/compare.mjs` | pass | Comms compare | none |

## Design Conflicts

| Conflict | Evidence | Proposed Resolution |
|---|---|---|
| The pre-existing TaskLoop episode mapper copied `record.evidenceRefs`, whose summaries can include plan/subagent/result text. | `task-loop-controller.ts` previously mapped `record.evidenceRefs.map(taskLoopEvidenceRefToRuntime)` into episode `evidenceRefs`; `evidenceFromResult()` builds summaries from plan/subagent evidence. | Resolved in Lane B by removing the broad copy and keeping only deterministic task-loop, trace, and task-ledger refs. |
| The worktree contains many unrelated dirty files, including communication-adjacent paths. | `git status -sb` showed broad ambient modifications before Lane B edits. | Do not revert unrelated work; run comms replay/compare and limit Lane B claims to touched mapper/test/submission surfaces. |

Status: accepted
