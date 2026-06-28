# lane-b-local-span-store-query: Local Span Store Query

## Scope Confirmation

- Lane: `lane-b-local-span-store-query`
- Output file: `runtime-research/handoffs/phase-6-trace-context-provider/submissions/lane-b-local-span-store-query.md`
- Lane-owned file only: yes
- Implementation paths touched:
  - `openclaw_runtime/src/runtime-core/trace-context-store.ts`
  - `openclaw_runtime/src/runtime-core/index.ts`
- Test paths touched:
  - `tests/unit/runtime-trace-context-store.test.ts`
- Commands run:
  - `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md`
  - `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts`
  - `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`
  - `rtk proxy <rg.exe> -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components`
  - `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/trace-context-store.ts tests/unit/runtime-trace-context-store.test.ts`
  - `rtk proxy <rg.exe> -n 'prompt|payload|checkpoint|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|authorization|password|baggage|tracestate|raw' openclaw_runtime/src/runtime-core/trace-context-store.ts`
  - `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit`
- Required reading completed: Phase 6 harness context and Lane A submission/contract reviewed.

## Executive Summary

- Added `RuntimeTraceSpanStore`, a bounded local in-memory store over the Lane A `RuntimeTraceSpan` contract.
- Appends validate and sanitize spans before storage, clone returned data, replace duplicate trace/span keys, and enforce both total-span and per-trace retention limits.
- Query support covers trace id, span id, parent span id, task id, tool name, file, symbol, status, and overlapping time range through the accepted Lane A query helper.
- Link queries return resume/evidence related spans without treating links as causal parentage.
- Added `summarizeTrace(traceId, tokenBudget, priorityQuery?)` with error, test, verifier, evidence-link, task/tool/file/symbol match, then sibling ordering.
- Kept Lane B local-only: no persistence, database, service, listener, exporter, UI, provider registration, TaskLoop wiring, Gateway/Main transport change, or prompt full-trace dump.

## Evidence Table

| Claim | Evidence Type | Path / Command | Symbol / Lines | Notes |
|---|---|---|---|---|
| Bounded in-memory store exists. | file | `openclaw_runtime/src/runtime-core/trace-context-store.ts` | `RuntimeTraceSpanStore` line 53 | Uses process memory only. |
| Append validates, sanitizes, clones, replaces duplicates, and enforces bounds. | file | `openclaw_runtime/src/runtime-core/trace-context-store.ts` | `append` line 75; `enforceTraceBound` line 176; `enforceTotalBound` line 190 | Test line 9 covers sanitization, rejection, cloning, and bounds. |
| Query supports trace/span/parent/task/tool/file/symbol/status/time. | file | `openclaw_runtime/src/runtime-core/trace-context-store.ts` | `query` line 100; `findTrace` line 104; `findSpan` line 108; `findChildren` line 112 | Test line 109 covers all requested query dimensions. |
| Resume/evidence links are queryable without becoming parentage. | file | `openclaw_runtime/src/runtime-core/trace-context-store.ts` | `findLinkedSpans` line 116 | Test line 170 proves linked spans and children are separate. |
| Summary priority follows Lane B order. | file | `openclaw_runtime/src/runtime-core/trace-context-store.ts` | `summarizeTrace` line 137; `rankStoreTraceSpans` line 238; `buildTraceSummary` line 300 | Test line 243 asserts error, test, verifier, evidence-link, match, sibling ordering. |
| Store export is available from runtime-core barrel. | file | `openclaw_runtime/src/runtime-core/index.ts` | line 13 | Adds `export * from "./trace-context-store.js";`. |
| Focused contract/store tests pass. | test | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts` | 2 files / 12 tests | Pass. |
| Node typecheck passes. | command | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | n/a | Pass. |
| Renderer bypass scan has no matches. | command | `rtk proxy <rg.exe> -n ... src/pages src/components` | n/a | Exit 1/no matches. |
| Lane B adds no service/listener/exporter patterns. | missing-after-search | `rtk proxy <rg.exe> -n ... openclaw_runtime/src/runtime-core/trace-context-store.ts tests/unit/runtime-trace-context-store.test.ts` | n/a | Exit 1/no matches. |
| Production store has no raw-retention terms. | missing-after-search | `rtk proxy <rg.exe> -n 'prompt|payload|checkpoint|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|authorization|password|baggage|tracestate|raw' openclaw_runtime/src/runtime-core/trace-context-store.ts` | n/a | Exit 1/no matches. |

## Implementation Summary

Current code:

- `openclaw_runtime/src/runtime-core/trace-context-store.ts` defines `RuntimeTraceSpanStore`, `createRuntimeTraceSpanStore`, retention stats, append results, link query types, and summary priority query types.
- `openclaw_runtime/src/runtime-core/index.ts` exports the store module.

Tests:

- `tests/unit/runtime-trace-context-store.test.ts` covers sanitized append, invalid-span rejection, clone isolation, total/per-trace bounds, query filters, link-vs-parent semantics, summary ranking, token budget, and clear behavior.

Feature flags:

- No new flag was added.
- The store is inert unless explicitly constructed by a future default-off shadow lane.
- Existing `runtime.traceContext.shadow`, `runtime.traceContext.provider`, and `runtime.traceContext.propagation` remain default false.

Harness/spec changes:

- No harness spec changes were needed; the Phase 6 task spec context/validate checks passed.

Docs/index changes:

- README translation updates are not required because this lane adds no user-visible UI, RPC, setup, or documented behavior.
- `agent-runtime-index.md` remains for Lane E/synthesis update after Phase 6 acceptance.

## Trace Contract Surface

| Surface | Contract / Adapter | Shadow / Readonly Boundary | Feature Flag | Evidence |
|---|---|---|---|---|
| Local store | `RuntimeTraceSpanStore` | in-memory only / local sanitized spans | none | `trace-context-store.ts` line 53 |
| Append API | `append`, `appendMany` | validates and sanitizes supplied spans; no recorder wiring | none | `trace-context-store.ts` lines 75, 96 |
| Query API | `query`, `findTrace`, `findSpan`, `findChildren` | readonly clones over stored spans | none | `trace-context-store.ts` lines 100-113 |
| Link query | `findLinkedSpans` | link relationship only; not parentage | none | `trace-context-store.ts` line 116 |
| Summary API | `summarizeTrace` | token-budgeted readonly summary, no full trace dump | none | `trace-context-store.ts` line 137 |
| Store factory | `createRuntimeTraceSpanStore` | explicit construction only | none | `trace-context-store.ts` line 232 |

## Legacy Behavior Preservation

| Legacy Path | Current Behavior | Preservation Evidence | Risk |
|---|---|---|---|
| TaskLoop completion | Legacy TaskLoop remains authoritative. | Lane B did not touch TaskLoop. | Low; future wiring needs flag-off parity. |
| tools.invoke | Existing Gateway/tool behavior remains authoritative. | Lane B did not touch Gateway/tool invocation paths. | Low. |
| approval waiting/retry/error mapping | Existing behavior remains unchanged. | Store has no approval/retry/error mapping integration. | Low. |
| event-log/checkpoint/resume | Existing Phase 4 behavior remains unchanged. | Store only records supplied sanitized spans in memory. | Low. |
| Evidence Verifier | Phase 5 warning-only behavior remains unchanged. | Store summaries are readonly context, not verifier authority. | Low. |

## Safety / Retention Audit

| Focus | Result | Evidence | Gap |
|---|---|---|---|
| No raw prompts/full payload persistence | pass | Store appends call `sanitizeRuntimeTraceSpan`; production raw-retention scan has no matches. | Future recording lanes must sanitize before append too. |
| No full trace dump exposed by default | pass | Store only exposes explicit snapshot/query APIs and budgeted summaries; no provider/UI/prompt wiring. | Future provider lane must not expose snapshots to prompts. |
| External traceparent sanitized/re-rooted/marked untrusted | pass | Store consumes Lane A spans only; Lane A sanitizer remains the propagation boundary helper. | Lane C must apply external sanitizer before any propagation append. |
| Token-budgeted summaries | pass | `summarizeTrace` enforces `tokenBudget`; tests cover large and tiny budgets. | Uses approximate character/token estimate. |
| Source refs do not replace verifier evidence | pass | Summary items carry separate `sourceRefs` and `evidenceRefs`; store has no verifier decision path. | Future verifier/trace integration must remain non-authoritative unless a fresh spec says otherwise. |

## Tests And Harness Evidence

| Check | Command / File | Result | Covers | Gap |
|---|---|---|---|---|
| Harness context | `rtk node harness/src/cli.mjs context --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Required read routing. | None. |
| Harness validate | `rtk node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-6-trace-context-provider.md` | pass | Task spec validity. | None. |
| Focused trace tests | `rtk node node_modules/vitest/vitest.mjs run tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts` | pass | Lane A contract plus Lane B store/query/summary behavior. | None. |
| Node typecheck | `rtk node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass | Runtime-core TypeScript surface. | None. |
| Renderer IPC/Gateway bypass scan | `rtk proxy <rg.exe> -n 'window\.electron\.ipcRenderer\.invoke|ipcRenderer\.invoke\(|127\.0\.0\.1:18789|localhost:18789|new WebSocket\(' src/pages src/components` | pass | Renderer boundary. | Exit 1/no matches. |
| Lane B service/exporter scan | `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src/runtime-core/trace-context-store.ts tests/unit/runtime-trace-context-store.test.ts` | pass | Lane B forbidden service/exporter additions. | Exit 1/no matches. |
| Production raw-retention scan | `rtk proxy <rg.exe> -n 'prompt|payload|checkpoint|toolArgs|toolOutput|stdout|stderr|process\.env|secret|apiKey|authorization|password|baggage|tracestate|raw' openclaw_runtime/src/runtime-core/trace-context-store.ts` | pass | Store production code avoids raw-retention terms. | Exit 1/no matches. |
| Required broad service/exporter scan | `rtk proxy <rg.exe> -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\(' openclaw_runtime/src electron shared tests/unit` | reviewed | Forbidden service/exporter additions. | Existing OAuth/Gateway/proxy/test-helper/config-help matches are outside Lane B. |
| Comms replay/compare | n/a | not-applicable | Main/Gateway paths. | Lane B did not change Main/Gateway communication paths. |

## Boundary Audit

| Boundary | Result | Evidence |
|---|---|---|
| No default-on trace recording/provider/export | pass | Store is explicit construction only; no provider registration or runtime wiring. |
| No observability platform/collector/exporter/database | pass | Lane B code/test forbidden-pattern scan has no matches; no dependencies/storage added. |
| No second runtime service/listener/Gateway/Temporal | pass | Lane B code/test forbidden-pattern scan has no service/listener/Gateway/Temporal matches. |
| No renderer direct IPC | pass | Renderer scan exit 1/no matches; renderer files not touched by Lane B. |
| No renderer direct Gateway HTTP/WS | pass | Renderer scan exit 1/no matches; renderer files not touched by Lane B. |
| No runtime authority/completion gate/security policy from trace provider | pass | Store summaries are readonly context data and do not affect runtime/verifier policy. |
| Comms replay/compare when Main/Gateway paths changed | not-applicable | Lane B did not change Main/Gateway communication paths. |
| UI changes have E2E | not-applicable | No UI changes. |

## Design Conflicts

| Conflict | Current Evidence | Design Target | Proposed Resolution |
|---|---|---|---|
| Lane A already has pure `summarizeRuntimeTrace`, while Lane B needs store-specific match priority without filtering siblings. | Lane B test line 243 asserts sibling-preserving priority order. | Store summary should rank matches but keep same-trace siblings. | Keep `summarizeTrace` on the store as the bounded store facade; Lane D can choose the store facade for provider summaries. |
| Store snapshot/query APIs can return many spans if callers ask directly. | `snapshot` and `query` are explicit APIs; no provider/prompt wiring exists. | No full trace dump by default. | Future provider lane must expose only `summarizeTrace`/budgeted context items to prompts. |

## Status

```text
Status: accepted
```

## Recommended Next Slice

```text
Slice: Lane C propagation recording shadow
New code path: default-off propagation/recording adapter around accepted store
Legacy path wrapped: Main/Gateway/runtime trace correlation only behind flags
Shadow / readonly boundary: local sanitized append only, no export
Feature flag: runtime.traceContext.shadow and runtime.traceContext.propagation remain default false
Tests: flag-off parity plus external traceparent sanitizer coverage
Harness: phase-6-trace-context-provider context/validate; comms replay/compare if Main/Gateway touched
Rollback: disable trace flags or omit store construction; TaskLoop/tools.invoke remain authoritative
Done when: default-off recording proves no behavior change with flags off
```

## Open Questions

| Question | Why It Matters | Who Can Decide | Blocking |
|---|---|---|---|
| Should Lane C append only task/tool/test/verifier summary spans or also checkpoint/resume spans? | Controls store volume and source-ref semantics before provider exposure. | maintainer/agent | no |

## Handoff Notes

- Lane B intentionally does not update `agent-runtime-index.md`; Lane E or synthesis should update it only after Phase 6 acceptance.
- Lane B intentionally does not touch TaskLoop, Gateway, renderer, provider registry, host-api, api-client, or communication paths.
- The broad service/exporter scan reports existing non-Lane-B runtime/electron/test-helper matches; the Lane B code/test scan has no forbidden service/exporter patterns.
