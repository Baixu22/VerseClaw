# Memory System Optimization — Continuation Plan (Phase 1.1 → Phase 3)

## Summary

Continue execution of the previously-approved optimization plan at
`c:\Users\27933\Desktop\clawx\ClawX\.trae\documents\memory-system-optimization-plan.md`
to raise the LoCoMo benchmark J Score from 43% → 62-67%.

The original plan (Phases 0-3, Phase 4 deferred) was approved. Phase 0 prerequisite
verification passed (20 tests, 81.8% survival rate). Phase 1.1 is ~30% complete.
This continuation plan captures exact current progress and the remaining execution
sequence so implementation can resume immediately without re-deciding scope.

**User decisions (already locked, from prior approval):**
- Scope: Eval harness first (measurable via LoCoMo), production wiring as follow-up
- `trimRows` fix: Keep `trimRows` but raise persistence `maxFacts` to 5000
- Phase 4: Defer (cross-session entity fusion) — focus on Phases 1-3

## Current State Analysis (verified this session)

### Phase 0 — DONE ✅
- `RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS = 512` (above 200 threshold)
- Importance/type-aware eviction tests pass
- Fact survival E2E test passes (81.8% baseline survival rate)

### Phase 1.1 — IN PROGRESS (~30% done)

**Done:**
- `tests/unit/helpers/locomo-date-parser.ts` — CREATED with `parseLocomoDateTime`,
  `extractSessionDates`, `diaIdToSessionIndex`, `getSessionDateForTurn`
- `tests/unit/runtime-memory-locomo-full-500.test.ts`:
  - Imports added for `extractSessionDates`, `getSessionDateForTurn`
  - `LocomoTurn` type includes `sessionDate: number`
  - `extractTurns` parses `session_N_date_time` and attaches `sessionDate` to each turn

**Not yet done (verified by grep this session):**
- `turnToFact` (lines 122-150): STILL uses `turnIndex` for `valid_at`/`reference_time`/
  `proposedAt`/`acceptedAt` — must switch to `turn.sessionDate`
- `makeFactFromExtracted` (lines 170-193): STILL uses `idx` for temporal fields —
  must accept `sessionDate` parameter
- `extractFactsFromConversation` (lines 195-276): No session date tracking per chunk —
  must thread session date through to `makeFactFromExtracted`
- `loadOrExtractFacts` (lines 278-341): Cache backward compat — old cache has no
  `sessionDate`; must re-derive from raw data by matching `factId` index to turns,
  OR invalidate/rebuild cache. **Decision: invalidate cache** (delete
  `extracted-facts-cache.json`) so fresh extraction captures session dates. Re-extraction
  costs ~$0.50 and ~20 min but produces correct temporal anchors.

### Production files — all in pre-fix state (verified by grep this session)
- `memory-self-edit-tools.ts:264-265`: `valid_at: now`, `reference_time: now`
- `memory-store.ts:32`: `RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS = 512`
- `memory-store.ts:173`: default `evictionPolicy` = `"fifo"` (importance dormant)
- `memory-persistence.ts:806,835,864`: `trimRows` called on every INSERT, no 5000 limit
- `memory-hybrid-retrieval.ts`: `HybridSearchQuery` has NO `candidateThreshold` field
- `memory-runtime-integration.ts`: write path does NOT call `appendRelation`
- Eval test line 555: uses `searchWithEmbedding` (NOT `hybridSearchFactsWithEmbedding`)

## Proposed Changes — Execution Sequence

### Step 1: Finish Phase 1.1 (valid_at fix in eval harness)

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**

1. `turnToFact`: Change signature to drop `turnIndex` for temporal fields. Use
   `turn.sessionDate` for `valid_at`, `reference_time`, `proposedAt`, `acceptedAt`.
   Keep `turnIndex` only for `factId` generation.
2. `makeFactFromExtracted`: Add `sessionDate: number` parameter. Use it for
   `valid_at`, `reference_time`, `proposedAt`, `acceptedAt`. Keep `idx` for `factId`.
3. `extractFactsFromConversation`: Each chunk already slices from `turns[]` which now
   carries `sessionDate`. Use the first turn's `sessionDate` in each chunk as the
   anchor date passed to `makeFactFromExtracted`. (Within a chunk, turns share a
   session, so one date is correct.)
4. `loadOrExtractFacts`: Delete `extracted-facts-cache.json` to force fresh extraction
   with correct dates. Update the cache-write path to also store `sessionDate` per
   fact so future loads are correct. On cache miss → extract fresh (already implemented).
5. Update all call sites of `turnToFact`/`makeFactFromExtracted` to pass `sessionDate`.

**Acceptance**: After this step, facts from `session_1` (8 May 2023) have
`valid_at` ≈ 1683523200000 (May 8 2023 UTC). No fact has `valid_at = arrayIndex`.
Run a quick sanity check (small extraction on 1 conversation) before full eval.

### Step 2: Phase 1.2 (relative time normalization in extraction prompt)

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- Update extraction system prompt (lines 216-224) to include time normalization
  instructions: resolve "yesterday"/"last March"/"three weeks ago" to absolute dates
  using the provided session date.
- Update user prompt (lines 226-229) to include: `"This dialogue occurred on {sessionDate ISO string}."`

**New file: `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts`**
- `buildExtractionSystemPrompt(options: { sessionDate?: number }): string`
- `buildExtractionUserPrompt(dialogue, sessionDate?): string`
- `parseExtractionResponse(content): ExtractedFact[]`
- Refactor eval test to use these shared builders (keeps eval + production aligned)

**Acceptance**: Extracted facts contain absolute dates, not relative expressions.

### Step 3: Phase 1.3 (entity graph population)

**New file: `openclaw_runtime/src/runtime-core/memory-entity-extraction.ts`**
- `extractEntityTriplets(text): EntityTriplet[]` — deterministic regex extending
  `extractEntities` from `memory-hybrid-retrieval.ts:848-861`
- `findFactsWithSharedEntities(newFact, existingFacts): string[]`

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- After extraction: build `Map<string, string[]>` (factId → related factIds) for
  Phase 2.3 chained retrieval. Store entity triplets in fact `metadata.entities`.

**Acceptance**: ≥1 relation per fact on average; facts sharing "Caroline" are linked.

### Step 4: Phase 1.4 (candidate visibility threshold)

**File: `openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts`**
- Add `candidateThreshold?: number` to `HybridSearchQuery` (lines 38-60)
- Update `preFilter` (lines 377-381): if `candidateThreshold` set and fact is a
  candidate with `confidence >= threshold`, include it.

**Acceptance**: `candidateThreshold: 0.7` includes high-confidence candidates.

### Step 5: Phase 1.5 (eviction fix)

**File: `openclaw_runtime/src/runtime-core/memory-store.ts`**
- `computeEvictionScore` (lines 583-606): use `valid_at` as temporal anchor for
  temporal facts (fallback `proposedAt` for non-temporal)
- Line 173: change default `evictionPolicy` from `"fifo"` to `"importance"`

**File: `openclaw_runtime/src/runtime-core/memory-persistence.ts`**
- Raise persistence `maxFacts` default to 5000 (so `trimRows` rarely fires;
  in-memory store handles real eviction at 512 with importance policy)

**File: `openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`**
- `storeOptionsFrom` (lines 248-262): forward `evictionPolicy`

**Test cleanup**: Run full suite; any test depending on FIFO default must explicitly
set `evictionPolicy: "fifo"`.

**Acceptance**: Default `evictionPolicy = "importance"`; `computeEvictionScore` uses
`valid_at`; persistence `maxFacts = 5000`; all tests pass.

### Step 6: Phase 1 Benchmark Run
Run LoCoMo 500Q benchmark. Target: 51-55% (up from 43%).

### Step 7: Phase 2.1 (eval harness uses full retrieval pipeline)

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- Line 555: replace `index.searchWithEmbedding(...)` with `hybridSearchFactsWithEmbedding`
  passing `temporalMode`, `referenceTime` (per-conversation session date),
  `candidateThreshold: 0.7`, `fusion: OPTIMAL_HYBRID_FUSION`
- Use per-conversation fact arrays so `referenceTime` matches the conversation timeline

**File: `tests/unit/runtime-memory-architecture-diagnostic.test.ts`**
- Q1 assertions: update to reflect eval now uses `hybridSearchFactsWithEmbedding`

**Acceptance**: J Score improves ≥5pp vs Phase 1 baseline.

### Step 8: Phase 2.2 (temporal query detector)

**New file: `openclaw_runtime/src/runtime-core/memory-temporal-detector.ts`**
- `detectQueryTemporalMode(question): "filter" | "boost" | "strict"`
- `isMultiHopQuestion(question): boolean`
- `isOpenDomainQuestion(question): boolean`
- Patterns per the detailed plan (strict: "when did"/"what date"/"before .* did";
  boost: "currently"/"now"/"still"; multi-hop: "how long"/"compare"; etc.)

**Acceptance**: ≥80% temporal questions → strict/boost; ≥70% multi_hop detected.

### Step 9: Phase 2.3 (chained retrieval for multi_hop)

**New file: `openclaw_runtime/src/runtime-core/memory-chained-retrieval.ts`**
- `chainedHybridSearch(facts, question, sessionDate, embeddingProvider, options)`
- Algorithm: Step 1 standard hybrid search with `temporalMode: "boost"`; if
  `isMultiHopQuestion`, Step 2 retrieves entity-related facts via `relationMap`,
  RRF-fuse Step 1 + Step 2.

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- For multi_hop questions (category 3): use `chainedHybridSearch`
- Other categories: standard retrieval

**Acceptance**: Multi_hop category score improves ≥5pp; single-hop unaffected.

### Step 10: Phase 2 Benchmark Run
Run LoCoMo 500Q benchmark. Target: 56-61%.

### Step 11: Phase 3 (UserProfile layer for open_domain)

**New file: `openclaw_runtime/src/runtime-core/memory-user-profile.ts`**
- `buildUserProfile(facts, userId): UserProfile` — aggregates facts into dimensions
  (occupation, preferences, relationships, locations, timeline)
- `selectProfileDimensions(question, profile): ProfileDimension[]`

**New file: `openclaw_runtime/src/runtime-core/memory-profile-retrieval.ts`**
- `openDomainRetrieval(question, facts, profile, embeddingProvider)` — Step 1 profile
  dimensions, Step 2 hybrid search detail facts, Step 3 merge

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- After extraction: build `UserProfile` per conversation
- For open_domain questions (category 4): use `openDomainRetrieval`

**Acceptance**: Open_domain category score improves ≥5pp; other categories unaffected.

### Step 12: Phase 3 Benchmark Run + Final Acceptance
Run LoCoMo 500Q benchmark. Target: 58-64% (stretch 62-67%).
Re-run fact survival E2E test (target ≥85%, up from 81.8%).

## Assumptions & Decisions

1. **Cache invalidation**: Delete `extracted-facts-cache.json` in Step 1 to force fresh
   extraction with session dates. Cost: ~$0.50 + ~20 min. Alternative (re-derive dates
   from factId index) is fragile because the cache loses chunk-to-session mapping.
2. **Env vars for benchmark**: Requires `RUNTIME_MEMORY_REAL_LLM=1`, `DEEPSEEK_API_KEY`,
   `SILICONFLOW_API_KEY` for the 500Q eval runs. User must provide fresh keys (prior
   keys should be revoked for security).
3. **Production wiring**: Steps 1-5 include production file changes (self-edit tools,
   store, persistence) marked as follow-up in the detailed plan. Per user decision
   "eval harness first", production changes are lower priority but Step 5 (eviction)
   touches production defaults — must verify no test regressions.
4. **Background jobs**: 6 background jobs from the prior session are still running
   (likely stale eval/benchmark runs). Do not re-run the same commands; let them
   complete or ignore their output.
5. **FIFO→importance default change risk**: May break tests assuming FIFO order. Mitigation:
   explicitly set `evictionPolicy: "fifo"` in affected tests during Step 5.

## Verification Steps

After each phase:
1. `pnpm run typecheck` — full typecheck gate
2. `pnpm test -- --grep "runtime-memory"` — no regressions in memory tests
3. LoCoMo benchmark (Steps 6, 10, 12) — measure J Score improvement
4. Fact survival E2E (after Phase 1) — target ≥85%
5. Architecture diagnostic (after Phase 2) — Q1-Q6 reflect fixed architecture

## Execution Tracking

Use TaskCreate to track Steps 1-12 as tasks. Mark each in_progress when starting,
completed when done. After each benchmark run (Steps 6, 10, 12), report J Score
and per-category breakdown to the user before proceeding.
