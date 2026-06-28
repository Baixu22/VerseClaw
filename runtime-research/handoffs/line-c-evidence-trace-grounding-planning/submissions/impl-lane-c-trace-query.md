# Line C Grounding Spine Impl Lane C Trace Query

## Scope

- Added readonly trace/source projection helpers in `openclaw_runtime/src/runtime-core/grounding.ts`:
  - `groundingRefsFromRuntimeTraceSpan()` at line 1066
  - `groundingRefsFromRuntimeTraceSourceRefs()` at line 1181
  - `findGroundingRefs()` at line 1223
  - `summarizeGroundingRefs()` at line 1240
  - `groundingQueryFromRuntimeTraceQuery()` at line 1287
  - `groundingQueryFromEventLogSearchQuery()` at line 1308
  - `rankGroundingRefs()` at line 1330
- Kept the implementation local and readonly. It derives sanitized `GroundingRef` records from trace spans, source refs, event-log query shapes, and existing evidence links without changing trace/event/checkpoint/verifier producers.
- Added bounded query normalization and summary output. `includeRaw: true` is normalized to `false` and reported through a bounded diagnostic on `GroundingResult.metadata`.
- Default query behavior excludes `trust: "untrusted"` refs. External trace context span events are projected only as untrusted, non-authoritative event refs.
- Source refs are represented as evidence/relevance anchors only with `sourceRefsAreEvidenceLinksOnly`, `sourceRefsAreRelevanceAnchorsOnly`, and `noVerifierAuthority` metadata. They do not replace verifier evidence.
- Filled missing local projection utility helpers used by existing event/checkpoint/verifier grounding projection functions so the full module typechecks without introducing persistence, services, listeners, collectors, or producer changes.

## Tests

- Added `tests/unit/runtime-grounding-query.test.ts`.
- Coverage starts at:
  - trace span to trace/source/evidence refs: line 18
  - trace/event-log query mapping: line 103
  - task/trace/span/file/symbol/status/evidence filtering: line 154
  - error/test/verifier/evidence-linked ranking: line 194
  - default untrusted exclusion and external trace context trust: line 224
  - `includeRaw` rejection/no raw retention: line 264
  - token budget truncation/omitted count: line 291
  - deterministic pagination/limit: line 303

## Validation

| Command | Result |
| --- | --- |
| `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-evidence-trace-grounding-spine.md` | pass |
| `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-contracts.test.ts tests/unit/runtime-grounding-query.test.ts tests/unit/runtime-trace-context-contracts.test.ts tests/unit/runtime-trace-context-store.test.ts tests/unit/runtime-trace-context-provider.test.ts tests/unit/runtime-event-log-store.test.ts` | pass, 6 files / 44 tests |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | pass |
| `rg -n "createServer\\(|listen\\(|WebSocketServer|new WebSocket\\(|OTLP|Collector|opentelemetry.*export|@opentelemetry/exporter|@temporalio|express\\(|daemon|listener|service|database|sqlite|postgres|mysql|redis|sidecar" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-query.test.ts` | no matches |
| `rg -n "writeFile|appendFile|createWriteStream|mkdir|\\.jsonl|\\.sqlite|sqlite|kysely|better-sqlite3|database|persist|cache|store|sidecar" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-query.test.ts` | no matches |
| `rg -n "applyPatch|workspaceEdit|rename|replaceBody|insertBefore|insertAfter|safeDelete|symbol.*apply|ast-grep.*apply|patch planner|patch apply" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-query.test.ts` | no matches |
| `rg -n "raw trace|trace dump|full trace|raw payload|full payload|full checkpoint|rawChat|raw chat|transcript import|jsonl import|full tool args|full tool output|toolArgs|toolOutput|stdout|stderr|process\\.env|complete env|secret|apiKey|api[-_]?key|authorization|password|traceparent|tracestate|baggage|includeRaw|rawRetained" openclaw_runtime/src/runtime-core/grounding.ts tests/unit/runtime-grounding-query.test.ts` | matches only expected `includeRaw` / `rawRetained` contract fields and tests |

Local notes:

- `rtk` was not available in this PowerShell session, so equivalent `node` and `rg` commands were used.
- `git` was not on PowerShell PATH; status/diff inspection used `C:\Program Files\Git\cmd\git.exe`.
- The worktree already contains many unrelated modified/untracked files. This lane touched `openclaw_runtime/src/runtime-core/grounding.ts`, `tests/unit/runtime-grounding-query.test.ts`, and this submission file.
- README.md, README.zh-CN.md, and README.ja-JP.md were reviewed for docs-sync. No update is required because this is an internal readonly helper slice with no user-visible UI, flow, or interface change.

Status: accepted
