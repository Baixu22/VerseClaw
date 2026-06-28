# Lane B AgentMap Cache And Performance Budget

## Scope

Implemented an explicit in-memory AgentMap extraction cache for readonly runtime-use readiness. The cache is caller-owned, discardable, bounded by entry count, and never writes disk or starts services. It only caches extracted tags; ranking, request handling, budget fitting, and rendering still run for each call.

## Implementation Evidence

- `openclaw_runtime/src/runtime-core/agent-map-cache.ts`
  - Added `createAgentMapCache()` with `readonly: true` and `discardable: true`.
  - Cache entries are keyed by normalized file path, inferred/provided language, content length, and `fnv1a-32` content hash.
  - Cached tags are defensively cloned on read and write.
  - Cache is bounded with LRU-style oldest-entry eviction via `maxEntries`.
- `openclaw_runtime/src/runtime-core/agent-map.ts`
  - Added optional `cache` support to `AgentMapTagExtractionInput` and `BuildBudgetedAgentMapInput`.
  - `extractAgentMapTagsFromSources()` honors explicit cache only when supplied.
  - `refreshPolicy: "force"` recomputes and updates the cache.
  - `refreshPolicy: "auto"` uses hits and computes misses.
  - `refreshPolicy: "cache_only"` returns only cache hits.
  - `buildBudgetedAgentMapResult()` still recomputes ranking, budget fit, and render from the current request and token budget.

## Cache And Budget Evidence

- Same input deterministic:
  - `tests/unit/runtime-agent-map-cache.test.ts`
  - `keeps identical cached inputs deterministic` compares two full `buildBudgetedAgentMapResult()` outputs using the same cache.
- Content change invalidates:
  - `tests/unit/runtime-agent-map-cache.test.ts`
  - `invalidates when the same path receives different content` reuses one path with different content and verifies the new symbol replaces the old result.
- Cache does not alter ranking:
  - `tests/unit/runtime-agent-map-cache.test.ts`
  - `does not change ranking results after cached extraction hits` compares uncached and cached rank signatures.
- Budget lowering is monotonic:
  - `tests/unit/runtime-agent-map-budget.test.ts`
  - Uses the same explicit cache across budgets `900`, `520`, and `320`; selected symbol counts and content lengths do not increase as budget decreases.
- Over-budget fitting does not truncate symbol blocks:
  - `tests/unit/runtime-agent-map-budget.test.ts`
  - Verifies `@@ symbol` and `@@ end` block counts match every included symbol after budget fitting.

## Boundary Evidence

- No renderer/Main, Gateway, provider transport, TaskLoop, or prompt assembly path was touched.
- No direct read/grep/find/ls behavior was replaced or wrapped.
- No mutation/apply/edit surface was added.
- No service, daemon, listener, HTTP server, WebSocket server, or external database was added.
- Docs-sync review: README files do not document AgentMap runtime-use readiness or this internal explicit cache surface, so no README translation update is required.
- Comms replay/compare were not required because no gateway events, runtime send/receive, channel delivery, or fallback transport paths were touched.

## Verification

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md`
- `pnpm --config.verify-deps-before-run=false harness run --spec harness/specs/tasks/phase-line-b-agentmap-runtime-use-readiness.md --dry-run`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-renderer.test.ts`
  - 3 files passed, 6 tests passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-contracts.test.ts tests/unit/runtime-agent-map-ranking.test.ts tests/unit/runtime-agent-map-renderer.test.ts tests/unit/runtime-agent-map-budget.test.ts tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-context-provider.test.ts tests/unit/context-provider-registry.test.ts`
  - 7 files passed, 24 tests passed.
- `pnpm --config.verify-deps-before-run=false run typecheck`
  - `typecheck:node` and `typecheck:web` passed.
- `rg -n 'createServer\(|listen\(|WebSocketServer|new WebSocket\(|daemon|listener|external database|sqlite|postgres|mysql|redis|@temporalio|express\(' openclaw_runtime/src/runtime-core/agent-map.ts openclaw_runtime/src/runtime-core/agent-map-cache.ts tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-budget.test.ts`
  - No matches.
- `rg -n 'rename|replaceBody|insertBefore|insertAfter|safeDelete|workspaceEdit|applyPatch|ast-grep.*apply|symbol.*apply' openclaw_runtime/src/runtime-core/agent-map.ts openclaw_runtime/src/runtime-core/agent-map-cache.ts tests/unit/runtime-agent-map-cache.test.ts tests/unit/runtime-agent-map-budget.test.ts`
  - No matches.

Status: accepted
