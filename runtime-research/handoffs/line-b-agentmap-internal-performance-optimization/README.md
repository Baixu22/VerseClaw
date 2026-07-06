# Line B AgentMap Internal Performance Optimization Handoff

Status: active_internal_performance_optimization_only

Default-on allowed: no.
Default cutover allowed: no.
Production-ready declaration allowed: no.
Runtime authority expansion allowed: no.
Persistent cache / sidecar / index allowed: no.

This handoff preserves the current AgentMap boundary and records the next
implementation plan for future multi-round optimization work.

## Objective

Continue optimizing AgentMap internal performance without changing runtime
behavior, public ranking semantics, extraction coverage, or component authority.

Primary target:

- Lower `synthetic-800` cold build and public full ranking cost.
- Keep warm cache build and render budget fitting comfortably below thresholds.
- Prove every optimization with semantic tests, cache lifecycle tests, and
  multi-round benchmark output.

Success thresholds:

- AgentMap unit tests pass.
- Focused performance/boundary tests pass.
- Typecheck passes.
- `synthetic-800` cold build remains at least 40 percent below original
  baseline ~358ms, or absolute <= 180ms when measured in a reliable benchmark
  environment.
- `synthetic-800` warm cache build <= 160ms.
- Render budget fitting <= 15ms.
- Public full ranking semantic output unchanged.
- Mentioned symbol remains rank 1 in covered scenarios.
- Budget never exceeds request budget.
- Generated paths remain filtered by default.

## Hard Boundaries

Do not:

- Enable default-on.
- Approve default cutover.
- Declare production-ready.
- Change default TaskLoop reviewer prompt.
- Change provider ordering.
- Register AgentMap as a default provider.
- Persist candidate, shadow, replay, ranked, or rendered prompt output.
- Add a service, listener, daemon, database, WebSocket, or HTTP server.
- Add renderer direct IPC or direct Gateway HTTP/WebSocket.
- Give AgentMap runtime/tool/security/approval/retry/completion/provider/model/
  Gateway/checkpoint/lifecycle authority.
- Add disk sidecar, disk index, or disk cache.
- Change public `rankAgentMapTags` complete ranking API.
- Change ranking reason semantics, reason order, score deltas, tie-break,
  global rank numbering, or metadata semantics.
- Change prompt-present file exclusion semantics.
- Change budget complete-symbol-block rules.
- Change generated path default filtering.
- Replace the TypeScript parser with a regex parser.
- Reduce extraction coverage for references, properties, methods, types,
  interfaces, or symbols to gain speed.
- Use brittle absolute timing assertions in CI.
- Land temporary benchmark files; benchmark scripts must use
  `pnpm --config.verify-deps-before-run=false exec tsx -` via stdin.

## Current Evaluation System

Focused tests now cover:

- Deterministic public ranking output.
- Exact mentioned symbol rank priority.
- Build path render equality against full-ranking baseline.
- Prompt-present-heavy bounded ranking alignment.
- Generated file filtering.
- Cache hit/miss accounting.
- Cache `clear()` lifecycle reset.
- Cache bounded entry count under corpus growth.
- Cached returned array structural isolation from caller mutation.
- Benchmark statistic helper using sample count, min, median, p75, max, IQR.
- AgentMap source boundary scan forbidding direct IPC, Gateway transport,
  WebSocket/server/listener, filesystem persistence, and database authority
  in AgentMap source files.

Required commands:

```powershell
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-agent-map-performance-optimization.test.ts tests/unit/runtime-agent-map-component-boundary-hardening.test.ts

$files = rg --files tests/unit | Where-Object { $_ -match 'runtime-agent-map.*\.test\.ts$' } | Sort-Object
pnpm --config.verify-deps-before-run=false exec vitest run @($files)

pnpm --config.verify-deps-before-run=false run typecheck
```

Closed validation entry point:

```powershell
pnpm --config.verify-deps-before-run=false run agent-map:validate
```

Strict CI-grade performance gate:

```powershell
pnpm --config.verify-deps-before-run=false run agent-map:validate:gate
```

The strict gate fails when the benchmark environment is not gate-eligible
(`processPollutionCount > 10`) or when reliable `synthetic-800` medians/IQR
exceed the recorded optimization targets. The normal validation entry still
runs the same tests, typecheck, and stdin-only benchmark, but reports polluted
benchmark timings as `informational` instead of claiming CI-grade performance.

Benchmark must be stdin-only:

```powershell
$script = @'
// benchmark body
'@
$script | pnpm --config.verify-deps-before-run=false exec tsx -
```

Benchmark output must include:

- Environment: Node version, platform, process pollution count.
- Reliability verdict: `gate-eligible` only if relevant Node/tsx/vitest/tsc
  process count <= 10; otherwise `informational`.
- Samples, min, median, p75, max, IQR.
- Fixture corpora: `fixture-electron-5`, `fixture-clawx-like-5`.
- Synthetic corpora: `synthetic-50`, `synthetic-200`, `synthetic-800`.
- `synthetic-800` cold build and warm cache build.
- Budget sweep: `64 / 128 / 256 / 512 / 1000 / 2000`.
- Cache stats before and after clear.
- Heap usage as non-gating risk signal.

## Latest Diagnostic Results

Reliable CI-grade performance verdict: no, environment polluted.

Observed process pollution:

- Relevant Node/tsx/vitest/tsc process count: 58 to 70.
- This exceeds the recommended gate threshold of <= 10.
- Performance timings from that environment are diagnostic only.

Multi-round full AgentMap tests:

- Round 1: 19 files / 85 tests passed.
- Round 2: 19 files / 85 tests passed.
- Round 3: 19 files / 85 tests passed.

Typecheck: passed.

Diagnostic benchmark, `synthetic-800`, polluted environment:

| Phase | Median | p75 | IQR | Notes |
|---|---:|---:|---:|---|
| parse-only probe | 73.1ms | 94.7ms | 24.3ms | TypeScript parse is a major cost. |
| public extraction | 188.2ms | 238.6ms | 69.2ms | Main current bottleneck and unstable. |
| public full ranking | 142.6ms | 177.0ms | 44.4ms | Second bottleneck; rich materialization likely. |
| definitions-only ranking probe | 141.9ms | 155.1ms | 42.4ms | References are not the main ranking cost. |
| no-signal ranking probe | 152.3ms | 188.4ms | 57.3ms | Mentions/active scoring are not the main cost. |
| render 32 | 2.7ms | 4.1ms | 2.2ms | Not a bottleneck. |
| warm cache build | 125.8ms | 139.2ms | 30.4ms | Ranking/render path remains material. |
| cold build | 283.5ms | 294.4ms | 19.4ms | Polluted environment inflated absolute timing. |

Cache lifecycle in diagnostic run:

- Before clear: `entryCount=800`, `hitCount=12000`, `missCount=800`.
- After clear: `entryCount=0`, `hitCount=0`, `missCount=0`.
- Structural leak not detected by cache lifecycle gates.

## Current Bottleneck Read

1. Extraction is the top optimization target.
   - TypeScript parse is significant but cannot be replaced.
   - Remaining extraction cost likely comes from tag construction:
     `rangeForNode`, `namePathForNode`, snippet/signature lookup,
     evidence/metadata object allocation, and reference tag construction.

2. Public full ranking remains the second target.
   - References are not the dominant ranking factor.
   - Active/mention scoring is not the dominant ranking factor.
   - Likely cost is per-definition facts + rich ranked output materialization.

3. Render is already low and should not be prioritized.

4. Cache lifecycle is acceptable; do not add persistence or global source caches.

## Recommended Next Code-Level Optimizations

### Priority 1: Single-pass reference tag construction

File: `openclaw_runtime/src/runtime-core/agent-map.ts`

Relevant functions:

- `collectAgentMapTagsFromParsedSource`
- `buildAgentMapReferenceTag`
- `rangeForNode`
- `lineForRange`

Plan:

- Remove the intermediate `referenceNodes` array.
- During AST traversal, build reference tags immediately when:
  - node is an identifier,
  - node is not a collected definition name,
  - `isReferenceIdentifier` returns true.
- Keep `definitionNameNodes` and `referenceIndex`.
- Preserve traversal order and tagId format.
- Preserve full reference coverage.

Expected benefit:

- Avoid retaining ~7200 reference nodes in synthetic-800.
- Avoid a second loop over references.
- Reduce allocation pressure and extraction wall time.

Semantic risks:

- Definition names must still be excluded from references.
- Reference tag order and index must remain stable.
- Existing ranking/extraction tests must pass.

Required proof:

- Full AgentMap tests.
- Focused performance tests.
- Public extraction tag count and rank signature unchanged.

### Priority 2: Skip prompt-present rich materialization in build path only

File: `openclaw_runtime/src/runtime-core/agent-map.ts`

Relevant functions:

- `rankPreparedAgentMapRankingInput`
- `rankAgentMapTagsForBudgetedRender`
- `materializeAgentMapRankedTag`

Plan:

- Add an internal-only option, for example
  `skipPromptPresentMaterializationAfterRank`.
- Score and rank prompt-present records normally.
- Preserve global rank numbering.
- Only skip `materializeAgentMapRankedTag` for prompt-present records in the
  budgeted build path.
- Public `rankAgentMapTags` must not use this option.

Expected benefit:

- Reduces build path rich object materialization when prompt-present files
  dominate the bounded window.

Semantic risks:

- Must not re-number filtered ranks.
- Must not alter public full ranking output.
- Prompt-present-heavy focused test must continue passing.

### Priority 3: Remove per-record `flatMap`/`slice` in reason materialization

File: `openclaw_runtime/src/runtime-core/agent-map.ts`

Relevant function:

- `materializeAgentMapRankingReasons`

Plan:

- Replace `activeReferences.slice(0, 5).flatMap(...)` with bounded nested loops.
- Preserve evidence ref order and max count behavior.
- Avoid creating temporary arrays in public full ranking.

Expected benefit:

- Reduces allocation in public full ranking.
- Low semantic risk if order and evidence content are preserved.

### Priority 4: Optimize `namePathForNode` for top-level definitions

File: `openclaw_runtime/src/runtime-core/agent-map.ts`

Relevant function:

- `namePathForNode`

Plan:

- Fast path top-level or module-block definitions to `[name]`.
- Only walk parents when the node can actually be nested.
- Preserve class/interface/function container behavior for methods/properties.

Expected benefit:

- Reduces parent walking for thousands of top-level definitions.

Semantic risks:

- Method/property name paths must remain unchanged.

## Evaluation Reliability Gates

Use these gates before claiming an optimization completed:

- Process pollution count <= 10 for CI-grade performance claims.
- If pollution > 10, report results as `informational` only.
- `synthetic-800` build IQR <= 25ms for stable performance verdict.
- `synthetic-800` public ranking IQR <= 15ms for stable performance verdict.
- `synthetic-800` extraction IQR <= 25ms for stable performance verdict.
- Heap usage is a risk signal only, not a hard pass/fail gate.
- Cache lifecycle tests are the hard memory safety gate.

## Final Report Template

Every next-round implementation report must include:

- default-on: `no`
- runtime authority changed: `no`
- persistent cache/sidecar added: `no`
- public ranking semantic drift: `none` or details
- extraction coverage reduced: `no`
- cache clear verified: `yes/no`
- cache bounded verified: `yes/no`
- benchmark reliability: `gate-eligible` or `informational`
- process pollution count
- tests:
  - focused performance/boundary tests
  - full AgentMap tests
  - typecheck
- benchmark table:
  - build median/p75/IQR
  - extraction median/p75/IQR
  - public full ranking median/p75/IQR
  - render median/p75/IQR
  - warm cache median/p75/IQR
- budget sweep result
- remaining bottlenecks
- next low-risk optimization proposal
