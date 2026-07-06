# Memory System Optimization — Resume Plan (Step 5 Fix → Phase 3)

## Summary

Resume execution of the approved optimization plan to raise the LoCoMo benchmark
J Score from 43% → 62-67%. Steps 1-4 (Phase 1.1-1.4) are complete. Step 5
(Phase 1.5 eviction fix) has code changes applied but **7 test files need fixes**
due to the `evictionPolicy` default change from `"fifo"` to `"importance"` and the
`loadStore()` maxFacts override. This plan fixes those test failures, then
continues with Steps 6-12 (benchmark runs + Phase 2 retrieval activation +
Phase 3 UserProfile layer).

**User decisions (already locked from prior approval):**
- Scope: Eval harness first (measurable via LoCoMo), production wiring as follow-up
- `trimRows` fix: Keep `trimRows` but raise persistence `maxFacts` to 5000
- Phase 4: Defer (cross-session entity fusion) — focus on Phases 1-3

## Current State Analysis (verified this session)

### Completed ✅
- **Phase 1.1** (valid_at fix): Eval test uses session dates for `valid_at`/`reference_time`/`proposedAt`/`acceptedAt`. Cache invalidated for fresh extraction.
- **Phase 1.2** (time normalization): `memory-extraction-prompt.ts` created with `buildExtractionSystemPrompt`/`buildExtractionUserPrompt`/`parseExtractionResponse`. Eval test uses shared builders. 11 tests pass.
- **Phase 1.3** (entity graph): `memory-entity-extraction.ts` created with `extractEntityTriplets`/`findFactsWithSharedEntities`/`buildEntityRelationMap`/`getRelatedFactIds`. Eval test builds `relationMapByConversation`. 13 tests pass.
- **Phase 1.4** (candidate threshold): `candidateThreshold` added to `HybridSearchQuery` in `memory-hybrid-retrieval.ts`. `preFilter` updated. 3 new tests pass.
- **Phase 1.5 code changes** (applied but tests failing):
  - `memory-store.ts:173` — default `evictionPolicy` changed to `"importance"`
  - `memory-store.ts:589-591` — `computeEvictionScore` uses `valid_at` as temporal anchor
  - `memory-persistence.ts:55` — `RUNTIME_MEMORY_PERSISTENCE_DEFAULT_MAX_FACTS = 5000`
  - `memory-persistence.ts:567-569` — persistence `maxFacts` default = 5000
  - `memory-persistence.ts:575` — `evictionPolicy` forwarded in `#storeOptions`
  - `memory-persistence.ts:690` — `loadStore()` forces `maxFacts: 512` (**BUG**: ignores user-specified maxFacts)
  - `memory-runtime-integration.ts:261-263` — `evictionPolicy` forwarded in `storeOptionsFrom`

### Blocking Issue: 7 Test Files Need Fixes

The default `evictionPolicy` change from `"fifo"` to `"importance"` breaks tests
that rely on FIFO default behavior. Additionally, the `loadStore()` maxFacts
override breaks the persistence test.

| # | Test File | Line | Issue | Fix |
|---|-----------|------|-------|-----|
| 1 | `runtime-memory-persistence.test.ts` | 291 | `loadStore()` forces `maxFacts: 512` instead of user-specified `maxFacts: 1` | Separate persistence trim limit from store maxFacts |
| 2 | `runtime-memory-store.test.ts` | 127 | `new RuntimeMemoryStore()` expects 512 facts, gets 435 (importance batch eviction to 85%) | Add `evictionPolicy: "fifo"` |
| 3 | `runtime-memory-importance-eviction.test.ts` | 60 | `new RuntimeMemoryStore({ maxFacts: 3 })` expects FIFO drop-oldest | Add `evictionPolicy: "fifo"` |
| 4 | `runtime-memory-long-term-accumulation.test.ts` | multiple | Stores without `evictionPolicy` expect FIFO (line 8 comment says "FIFO eviction") | Add `evictionPolicy: "fifo"` to affected stores |
| 5 | `runtime-memory-usage-tracking.test.ts` | 35,55,66,145,158 | Stores without `evictionPolicy` may break if eviction triggers | Add `evictionPolicy: "fifo"` to affected stores |
| 6 | `runtime-memory-fact-survival-e2e.test.ts` | 416,473,513,556 | Stores without `evictionPolicy` — need to verify if eviction triggers | Add `evictionPolicy: "fifo"` where FIFO behavior is expected |
| 7 | `runtime-memory-mvp-deep-test.test.ts` | 488 | `fifoStore` doesn't set `evictionPolicy` but variable name says "fifo" | Add `evictionPolicy: "fifo"` |

### Not Yet Started
- **Step 6**: Phase 1 Benchmark Run (requires API keys)
- **Step 7**: Phase 2.1 — eval test line 563 still uses `index.searchWithEmbedding()`, needs `hybridSearchFactsWithEmbedding`
- **Step 8**: Phase 2.2 — `memory-temporal-detector.ts` not created
- **Step 9**: Phase 2.3 — `memory-chained-retrieval.ts` not created
- **Step 10**: Phase 2 Benchmark Run
- **Step 11**: Phase 3 — `memory-user-profile.ts` and `memory-profile-retrieval.ts` not created
- **Step 12**: Phase 3 Benchmark Run + Final Acceptance

## Proposed Changes — Execution Sequence

### Step 5A: Fix persistence `loadStore()` maxFacts override (root cause fix)

**File: `openclaw_runtime/src/runtime-core/memory-persistence.ts`**

**Problem**: `#storeOptions.maxFacts` is set to 5000 (persistence default) for
`trimRows` SQL deletes. But `loadStore()` at line 690 forces `maxFacts: 512`,
which ignores user-specified `maxFacts`. The test at line 291 expects
`maxFacts: 1` (user-specified).

**Fix**: Separate the two concerns — persistence trim limit vs. in-memory store limit.

1. Add a new private field `#persistenceMaxFacts` to `RuntimeMemoryPersistenceStore`:
   ```typescript
   private readonly #persistenceMaxFacts: number;
   ```
2. In the constructor, set `#persistenceMaxFacts` from `options.maxFacts` with
   `RUNTIME_MEMORY_PERSISTENCE_DEFAULT_MAX_FACTS` (5000) fallback:
   ```typescript
   this.#persistenceMaxFacts = normalizeBound(
     options.maxFacts,
     RUNTIME_MEMORY_PERSISTENCE_DEFAULT_MAX_FACTS,
   );
   ```
3. Change `#storeOptions.maxFacts` to use `RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS`
   (512) fallback instead of 5000:
   ```typescript
   maxFacts: normalizeBound(
     options.maxFacts,
     RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS,
   ),
   ```
4. In `appendFact`/`appendEpisode`/`appendInvalidation`, pass a modified options
   object with `maxFacts: this.#persistenceMaxFacts` to `persistFact`/
   `persistEpisode`/`persistInvalidation`:
   ```typescript
   const persistOptions = { ...this.#storeOptions, maxFacts: this.#persistenceMaxFacts };
   // pass persistOptions instead of this.#storeOptions to persist functions
   ```
5. In `loadStore()`, remove the `maxFacts: RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS`
   override (line 690). Use `this.#storeOptions` directly:
   ```typescript
   const store = new RuntimeMemoryStore(this.#storeOptions);
   ```

**Acceptance**: `runtime-memory-persistence.test.ts:291` passes — `loadStore()`
returns a store with `maxFacts: 1` when user specified `maxFacts: 1`. `trimRows`
still uses 5000 as the safety-net trim limit.

### Step 5B: Fix tests relying on FIFO default

For each test file in the table above, add `evictionPolicy: "fifo"` to any
`new RuntimeMemoryStore(...)` call that:
- Does NOT already specify `evictionPolicy`, AND
- Either (a) inserts more facts than `maxFacts` (triggers eviction), OR
- (b) has a comment/variable name indicating FIFO behavior is expected

**Files to modify:**
1. `tests/unit/runtime-memory-store.test.ts` — line 127: add `evictionPolicy: "fifo"`
2. `tests/unit/runtime-memory-importance-eviction.test.ts` — line 60: add `evictionPolicy: "fifo"`
3. `tests/unit/runtime-memory-long-term-accumulation.test.ts` — all stores without `evictionPolicy` that trigger eviction: add `evictionPolicy: "fifo"`
4. `tests/unit/runtime-memory-usage-tracking.test.ts` — lines 35, 55, 66, 145, 158: verify if eviction triggers; if yes, add `evictionPolicy: "fifo"`
5. `tests/unit/runtime-memory-fact-survival-e2e.test.ts` — lines 416, 473, 513, 556: verify; add `evictionPolicy: "fifo"` where FIFO expected
6. `tests/unit/runtime-memory-mvp-deep-test.test.ts` — line 488 (`fifoStore`): add `evictionPolicy: "fifo"`

**Acceptance**: All 7 test files pass. Full memory test suite has 0 regressions.

### Step 5C: Verify Step 5 completion

Run the full memory test suite:
```bash
npx vitest run tests/unit/runtime-memory-store.test.ts tests/unit/runtime-memory-importance-eviction.test.ts tests/unit/runtime-memory-type-aware-eviction.test.ts tests/unit/runtime-memory-persistence.test.ts tests/unit/runtime-memory-long-term-accumulation.test.ts tests/unit/runtime-memory-usage-tracking.test.ts tests/unit/runtime-memory-fact-survival-e2e.test.ts tests/unit/runtime-memory-mvp-deep-test.test.ts tests/unit/runtime-memory-phase4-ablation-benefit.test.ts
```

Then run typecheck:
```bash
pnpm run typecheck
```

**Acceptance**: All tests pass, typecheck clean.

### Step 6: Phase 1 Benchmark Run

**Prerequisite**: User provides fresh `DEEPSEEK_API_KEY` and `SILICONFLOW_API_KEY`
(prior keys should be revoked for security).

Run the LoCoMo 500Q benchmark:
```powershell
$env:RUNTIME_MEMORY_REAL_LLM="1"; $env:DEEPSEEK_API_KEY="<key>"; $env:SILICONFLOW_API_KEY="<key>"; npx vitest run tests/unit/runtime-memory-locomo-full-500.test.ts
```

**Target**: J Score 51-55% (up from 43%). Per-category targets:
- temporal: 38-45% (up from 17.3%)
- multi_hop: 44-50% (up from 39.6%)
- single_hop: 55-60% (up from 52.8%)
- open_domain: ~67% (unchanged)

**Acceptance**: Report J Score and per-category breakdown to user before proceeding.

### Step 7: Phase 2.1 — Switch eval to full retrieval pipeline

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**

Replace the retrieval call at line 563:
```typescript
// Before:
const hits = index.searchWithEmbedding(queryEmbedding, topK);

// After:
const hits = hybridSearchFactsWithEmbedding(
  index,
  queryEmbedding,
  {
    query: question,
    topK,
    temporalMode: detectQueryTemporalMode(question),  // Step 8
    referenceTime: conversationSessionDate,
    includeCandidates: false,
    candidateThreshold: 0.7,
    fusion: OPTIMAL_HYBRID_FUSION,
  },
);
```

Key changes:
- Use `hybridSearchFactsWithEmbedding` instead of `index.searchWithEmbedding`
- Pass `temporalMode` and `referenceTime` per-conversation (use the conversation's
  session date as `referenceTime`)
- Pass `candidateThreshold: 0.7` to include high-confidence candidates
- Import `OPTIMAL_HYBRID_FUSION` from `memory-hybrid-retrieval.ts`
- Import `hybridSearchFactsWithEmbedding` (verify export exists)

Note: `detectQueryTemporalMode` is created in Step 8. For Step 7, use
`temporalMode: "boost"` as a placeholder, then switch to `detectQueryTemporalMode`
in Step 8.

**Acceptance**: J Score improves ≥5pp vs Phase 1 baseline (Step 6).

### Step 8: Phase 2.2 — Temporal query detector

**New file: `openclaw_runtime/src/runtime-core/memory-temporal-detector.ts`**

```typescript
export function detectQueryTemporalMode(question: string): "filter" | "boost" | "strict"
export function isMultiHopQuestion(question: string): boolean
export function isOpenDomainQuestion(question: string): boolean
```

Patterns (from mem.md):
- **strict**: `/when did/`, `/what date/`, `/on what day/`, `/in \d{4}/`, `/before .* did/`, `/after .* did/`, `/at the time of/`
- **filter**: `/currently/`, `/now/`, `/still/`, `/anymore/`, `/recently/`, `/latest/`
- **boost** (default): time-aware weighting without filtering
- **multi_hop**: `/how long/`, `/how many .* since/`, `/what .* before .* after/`, `/compare/`, `/relationship between/`, `/both .* and/`

**New test file: `tests/unit/runtime-memory-temporal-detector.test.ts`**
- ≥20 test cases covering each pattern category
- Edge cases: empty string, no temporal cues, overlapping patterns

**Update Step 7**: Replace `temporalMode: "boost"` placeholder with
`detectQueryTemporalMode(question)` in the eval test.

**Acceptance**: ≥80% temporal questions → strict/boost; ≥70% multi_hop detected.

### Step 9: Phase 2.3 — Chained retrieval for multi_hop

**New file: `openclaw_runtime/src/runtime-core/memory-chained-retrieval.ts`**

```typescript
export async function chainedHybridSearch(
  index: HybridSearchIndex,
  queryEmbedding: number[],
  question: string,
  sessionDate: number,
  relationMap: Map<string, string[]>,
  options: { topK?: number; candidateThreshold?: number },
): Promise<RuntimeMemoryQueryableFact[]>
```

Algorithm:
1. Step 1: Standard `hybridSearchFactsWithEmbedding` with `temporalMode: "boost"`
2. If `isMultiHopQuestion(question)`:
   - Extract entity names from Step 1 results
   - Use `relationMap` to find related fact IDs (maxDepth: 2)
   - Retrieve related facts by ID from the index
   - RRF-fuse Step 1 + Step 2 results
3. Return top-K fused results

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- For multi_hop questions (category 3): use `chainedHybridSearch`
- Other categories: standard `hybridSearchFactsWithEmbedding`

**New test file: `tests/unit/runtime-memory-chained-retrieval.test.ts`**
- Test chained retrieval with mock relation maps
- Verify multi-hop questions trigger Step 2, single-hop questions don't

**Acceptance**: Multi_hop category score improves ≥5pp; single-hop unaffected.

### Step 10: Phase 2 Benchmark Run

Run LoCoMo 500Q benchmark (same command as Step 6).

**Target**: J Score 56-61%. Per-category targets:
- temporal: 45-52%
- multi_hop: 50-58%
- single_hop: 60-65%
- open_domain: ~68%

**Acceptance**: Report J Score and per-category breakdown to user.

### Step 11: Phase 3 — UserProfile layer for open_domain

**New file: `openclaw_runtime/src/runtime-core/memory-user-profile.ts`**

```typescript
export interface UserProfile {
  userId: string;
  lastUpdated: number;
  dimensions: {
    occupation: ProfileDimension[];
    preferences: ProfileDimension[];
    relationships: ProfileDimension[];
    locations: ProfileDimension[];
    timeline: TimelineEntry[];
  };
}

export function buildUserProfile(facts: RuntimeMemoryQueryableFact[], userId: string): UserProfile
export function selectProfileDimensions(question: string, profile: UserProfile): ProfileDimension[]
```

`buildUserProfile` aggregates facts into dimensions using keyword/pattern matching:
- **occupation**: facts containing "job"/"work"/"career"/"engineer"/"teacher" etc.
- **preferences**: facts containing "likes"/"prefers"/"enjoys"/"favorite"
- **relationships**: facts containing "married"/"partner"/"friend"/"mother"/"father"
- **locations**: facts containing "lives in"/"from"/"city"/"country"
- **timeline**: temporal facts sorted by `valid_at`

**New file: `openclaw_runtime/src/runtime-core/memory-profile-retrieval.ts`**

```typescript
export async function openDomainRetrieval(
  index: HybridSearchIndex,
  queryEmbedding: number[],
  question: string,
  profile: UserProfile,
  options: { topK?: number; candidateThreshold?: number },
): Promise<{ profileDimensions: ProfileDimension[]; detailFacts: RuntimeMemoryQueryableFact[] }>
```

Algorithm:
1. `selectProfileDimensions(question, profile)` — O(1) lookup
2. `hybridSearchFactsWithEmbedding` for detail facts (topK: 5)
3. Return both for the LLM context

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**
- After extraction: build `UserProfile` per conversation
- For open_domain questions (category 4): use `openDomainRetrieval`
- Augment LLM context with profile dimensions + detail facts

**New test files:**
- `tests/unit/runtime-memory-user-profile.test.ts` — dimension extraction, profile building
- `tests/unit/runtime-memory-profile-retrieval.test.ts` — open-domain retrieval flow

**Acceptance**: Open_domain category score improves ≥5pp; other categories unaffected.

### Step 12: Phase 3 Benchmark Run + Final Acceptance

Run LoCoMo 500Q benchmark (same command as Step 6).

**Target**: J Score 58-64% (stretch 62-67%). Per-category targets:
- temporal: 48-54%
- multi_hop: 52-60%
- single_hop: 61-66%
- open_domain: 72-76%

**Final acceptance checks:**
1. Re-run fact survival E2E test — target ≥85% (up from 81.8%)
2. Run `pnpm run typecheck` — full typecheck gate
3. Run `pnpm test -- --grep "runtime-memory"` — no regressions
4. Compare J Score against mature systems:
   - LangMem (58.1%) — should match or exceed after Phase 2
   - Mem0 (66.88%) — stretch goal after Phase 3

## Assumptions & Decisions

1. **API keys**: Steps 6, 10, 12 require `DEEPSEEK_API_KEY` and `SILICONFLOW_API_KEY`.
   User must provide fresh keys. Prior keys should be revoked.
2. **Background jobs**: 6 background jobs from prior sessions are still running.
   Do not re-run the same commands; let them complete or ignore.
3. **FIFO→importance default**: Tests relying on FIFO default get explicit
   `evictionPolicy: "fifo"`. This preserves test intent while making importance
   the production default.
4. **Persistence trim vs. store limit**: Step 5A separates `#persistenceMaxFacts`
   (5000, for SQL `trimRows`) from `#storeOptions.maxFacts` (512, for in-memory
   store). This fixes the `loadStore()` override bug without changing `trimRows`
   safety-net behavior.
5. **Phase 2.1 placeholder**: Step 7 uses `temporalMode: "boost"` as placeholder
   until Step 8 creates `detectQueryTemporalMode`. This lets us verify the
   retrieval pipeline switch works before adding temporal detection.
6. **Per-conversation retrieval**: Phase 2.1 uses per-conversation fact arrays
   so `referenceTime` matches the conversation timeline. This may require
   restructuring the eval test's retrieval loop.

## Verification Steps

After each step:
1. `pnpm run typecheck` — full typecheck gate
2. `npx vitest run tests/unit/runtime-memory-*.test.ts` — no regressions
3. LoCoMo benchmark (Steps 6, 10, 12) — measure J Score improvement
4. Fact survival E2E (after Step 5) — verify no regression from eviction change
5. Report J Score + per-category breakdown to user after each benchmark run

## Execution Tracking

Use TaskCreate to track Steps 5A, 5B, 5C, 6, 7, 8, 9, 10, 11, 12.
Mark each in_progress when starting, completed when done.
