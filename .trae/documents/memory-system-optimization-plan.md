# Memory System Optimization Plan — LoCoMo Benchmark 43% → 62-67%

## Context

The runtime memory system scored **43.0%** on the LoCoMo 500-question benchmark (J Score, DeepSeek judge). Root-cause analysis (verified by runtime diagnostic tests, not just code reading) identified four layers of problems:

- **L1 Write errors**: `valid_at = Date.now()` (write time, not event time); entity graph table exists but write path never populates it; candidates invisible by default; `trimRows` hard-deletes oldest facts on every INSERT
- **L2 Retrieval not activated**: eval harness uses bare `searchWithEmbedding` which structurally bypasses `temporalMode`, `referenceTime`, `includeCandidates`; `temporalMode` never set to anything except default `"filter"` in any caller
- **L3 Extraction info loss**: relative time expressions ("yesterday", "last March") stored as raw text; no structured profile aggregation
- **L4 Capacity pressure**: production `maxFacts=512` with FIFO eviction — temporal facts lost under pressure

This plan implements the 3-phase optimization from `net use/mem.md` (Phase 4 deferred), targeting **62-67% J Score**. Scope: **eval harness first** (measurable via LoCoMo), production wiring noted as follow-up.

## Verified Code Architecture

| Component | Location | Current State |
|-----------|----------|---------------|
| AUDN write curation | `openclaw_runtime/src/runtime-core/memory-write-curation.ts` | Deterministic (no LLM), BM25+Jaccard |
| Self-edit write path | `memory-self-edit-tools.ts:264-265` | `valid_at: now` (Date.now()) |
| Entity graph | `memory-store.ts:630` (`appendRelation`) | NEVER called from write path, only `loadStore()` |
| Retrieval (eval) | `runtime-memory-locomo-full-500.test.ts:537` | Bare `searchWithEmbedding` — no temporal/candidate filtering |
| Retrieval (production) | `memory-context-provider.ts:503` | Dormant (`shadowOnly: true`), no `temporalMode` |
| `hybridSearchFactsWithEmbedding` | `memory-hybrid-retrieval.ts:309` | Full pipeline, accepts `HybridSearchQuery` — NOT used by eval |
| Store eviction | `memory-store.ts:173` | Default `"fifo"`, importance eviction dormant |
| Persistence eviction | `memory-persistence.ts:1599` (`trimRows`) | FIFO hard-delete on EVERY INSERT |
| LoCoMo data | `tests/fixtures/locomo/locomo10_raw.json` | Has `session_N_date_time` (e.g. "1:56 pm on 8 May, 2023") — real dates available! |

---

## Phase 0: Prerequisite Verification (Day 0, ~2h)

**Goal**: Confirm no blocking capacity issues.

- [ ] Verify `RUNTIME_MEMORY_STORE_DEFAULT_MAX_FACTS = 512` (confirmed above 200 threshold)
- [ ] Run existing `runtime-memory-importance-eviction.test.ts` and `runtime-memory-type-aware-eviction.test.ts` — confirm dormant importance eviction works when activated
- [ ] Run `runtime-memory-fact-survival-e2e.test.ts` — confirm 81.8% baseline survival rate

**Acceptance**: maxFacts ≥ 200 (it is 512); existing eviction tests pass; survival test passes.

---

## Phase 1: Wiring Fixes (Days 1-7, target: 43% → 55%)

### 1.1 Fix `valid_at` — use event time, not write time

**Problem**: `valid_at = Date.now()` makes temporal filtering meaningless. Eval test uses array index as timestamp.

**Files to modify**:

1. **`tests/unit/runtime-memory-locomo-full-500.test.ts`** (eval harness — PRIMARY):
   - `extractTurns` (lines 80-99): Parse `session_N_date_time` strings (e.g. "1:56 pm on 8 May, 2023") to epoch ms. Attach `sessionDate` to each turn.
   - `turnToFact` (lines 104-131): Change `valid_at: turnIndex` → `valid_at: sessionDate`; `reference_time: turnIndex` → `reference_time: sessionDate`
   - `makeFactFromExtracted` (lines 152-175): Accept `sessionDate` parameter, use it for `valid_at`/`reference_time`/`proposedAt`/`acceptedAt`
   - `extractFactsFromConversation` (lines 177-258): Track session date per chunk, pass to `makeFactFromExtracted`

2. **`openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts`** (production — FOLLOW-UP):
   - Add `sessionAnchorDate?: number` to `MemorySelfEditToolContext` (line 46-50)
   - Line 264-265: `valid_at: context.sessionAnchorDate ?? now`

3. **`openclaw_runtime/src/runtime-core/memory-background-consolidation.ts`** (production — FOLLOW-UP):
   - Lines 225-226: Preserve original `reference_time` from the fact being invalidated

**New helper** (shared date parsing):
- **`tests/unit/helpers/locomo-date-parser.ts`**: `parseLocomoDateTime(str): number` — parses "1:56 pm on 8 May, 2023" → epoch ms

**Tests**:
- Update `runtime-memory-self-edit.test.ts`: verify `sessionAnchorDate` used when provided
- Update `runtime-memory-architecture-diagnostic.test.ts`: Q2 assertion needs updating (production code now accepts sessionAnchorDate)

**Acceptance**: Facts from `session_1` (8 May 2023) have `valid_at` ≈ May 8 2023 epoch; facts from `session_5` (3 July 2023) have `valid_at` ≈ July 3 2023 epoch. No fact has `valid_at = Date.now()` or `valid_at = arrayIndex`.

**Dependencies**: None — foundational fix.

---

### 1.2 Relative time normalization in extraction prompt

**Problem**: Extraction prompt doesn't resolve "yesterday", "last March" to absolute dates. Session date not passed to LLM.

**Files to modify**:

1. **`tests/unit/runtime-memory-locomo-full-500.test.ts`** (eval harness):
   - System prompt (lines 199-206): Add time normalization instructions:
     ```
     "If the fact contains relative time expressions (yesterday, last month,
     three weeks ago), resolve them to absolute dates using the session date provided.
     Example: Session date: 8 May 2023, Input: 'went to the beach yesterday'
     Output: 'went to the beach on 7 May 2023'"
     ```
   - User prompt (lines 208-211): Include session date: `"This dialogue occurred on {sessionDate}."`

2. **New file `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts`** (shared utility):
   - `buildExtractionSystemPrompt(options: { sessionDate?: string }): string`
   - `buildExtractionUserPrompt(dialogue, options): string`
   - `parseExtractionResponse(content): ExtractedFact[]`
   - `type ExtractedFact = { subject, predicate, objectSummary, entities?: EntityTriplet[] }`

**Tests**:
- New `tests/unit/runtime-memory-extraction-prompt.test.ts`: verify prompt includes time normalization, parses JSON with entities

**Acceptance**: Extracted facts contain absolute dates, not relative expressions. Shared module importable from eval test.

**Dependencies**: Phase 1.1 (session date must be available).

---

### 1.3 Populate entity graph — connect write path to `appendRelation`

**Problem**: Entity graph table exists but write path never calls `appendRelation`. Multi-hop retrieval has no graph to traverse.

**Approach**: Deterministic entity extraction (no LLM). Use existing `extractEntities` regex patterns. Create fact-to-fact `related_to` relations between facts sharing entities.

**New files**:

1. **`openclaw_runtime/src/runtime-core/memory-entity-extraction.ts`**:
   - `type EntityTriplet = { subject: string; relation: string; object: string }`
   - `extractEntityRelations(text: string): EntityTriplet[]` — deterministic regex, extends `extractEntities` from `memory-hybrid-retrieval.ts:848-861`
   - `findFactsWithSharedEntities(newFact, existingFacts, triplets): string[]` — returns fact IDs sharing entities
   - Use `relationType: "related_to"` (fits existing `RuntimeMemoryRelationType`)

**Files to modify**:

2. **`openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`** (production — FOLLOW-UP):
   - After `appendFact` succeeds (lines 131, 142, 164): extract entity relations, find shared-entity facts, call `persistRelation({ relationType: "related_to", confidence: 0.6 })`

3. **`tests/unit/runtime-memory-locomo-full-500.test.ts`** (eval harness — PRIMARY):
   - After fact extraction (around line 257): build entity relation map from extracted facts
   - Store as `Map<string, string[]>` (factId → related factIds) for Phase 2.3 chained retrieval
   - Add entity triplets to fact `metadata.entities` for retrieval-time boosting

**Tests**:
- New `tests/unit/runtime-memory-entity-extraction.test.ts`: test extraction with proper nouns, shared entities
- Update `tests/unit/runtime-memory-relations.test.ts`: add entity-derived `related_to` tests

**Acceptance**: After extracting facts mentioning "Caroline" and "support group", a `related_to` relation exists between them. Entity relation map has ≥1 relation per fact on average.

**Dependencies**: Phase 1.1 (facts need correct temporal context first).

---

### 1.4 Candidate visibility — confidence-based threshold

**Problem**: `includeCandidates` defaults to `false` — candidates silently invisible. No confidence-based filtering.

**Files to modify**:

1. **`openclaw_runtime/src/runtime-core/memory-hybrid-retrieval.ts`**:
   - `HybridSearchQuery` type (line 38-60): add `candidateThreshold?: number`
   - `preFilter` (lines 377-381): Change candidate filtering:
     ```typescript
     if (!isRuntimeMemoryAcceptedVerificationStatus(fact.verificationStatus)) {
       if (query.includeCandidates === true) {
         // include all candidates
       } else if (query.candidateThreshold !== undefined &&
                  fact.verificationStatus === "candidate" &&
                  typeof fact.confidence === "number" &&
                  fact.confidence >= query.candidateThreshold) {
         // include high-confidence candidates
       } else {
         continue;
       }
     }
     ```

**Tests**:
- Update `tests/unit/runtime-memory-temporal-query.test.ts`: add `candidateThreshold` tests
- New test verifying candidates with `confidence ≥ 0.7` included when `candidateThreshold: 0.7`

**Acceptance**: `candidateThreshold: 0.7` includes candidates with confidence ≥ 0.7. Default behavior unchanged when threshold not set.

**Dependencies**: None — independent.

---

### 1.5 Fix eviction — activate importance policy, use `valid_at`, raise persistence limit

**Problem**: Two FIFO eviction layers. Importance eviction exists but dormant. `computeEvictionScore` uses `acceptedAt` not `valid_at`.

**Files to modify**:

1. **`openclaw_runtime/src/runtime-core/memory-store.ts`**:
   - `computeEvictionScore` (lines 583-606): Use `valid_at` as temporal anchor instead of `acceptedAt`:
     ```typescript
     const temporalAnchor = isRuntimeMemoryTemporalFact(fact)
       ? fact.valid_at
       : fact.proposedAt ?? now;
     const ageMs = Math.max(0, now - temporalAnchor);
     ```
   - Constructor (line 173): Change default `evictionPolicy` from `"fifo"` to `"importance"`

2. **`openclaw_runtime/src/runtime-core/memory-persistence.ts`**:
   - Constructor (lines 555-568): Pass `evictionPolicy` through to `#storeOptions`
   - **Raise persistence `maxFacts` limit**: Set persistence default to 5000 (vs store's 512). This means `trimRows` rarely fires; the in-memory store handles real eviction at 512 with importance policy.
   - `trimRows` (lines 1599-1623): Keep as safety net but with higher limit

3. **`openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`**:
   - `storeOptionsFrom` (lines 248-262): Forward `evictionPolicy` from options

**Tests**:
- Update `runtime-memory-importance-eviction.test.ts`: verify `valid_at` used in scoring
- Update `runtime-memory-type-aware-eviction.test.ts`: verify type weights still correct
- Update `runtime-memory-persistence.test.ts`: verify `evictionPolicy` forwarded, `trimRows` limit raised
- Run full test suite to catch any tests depending on FIFO default

**Acceptance**: Default `evictionPolicy = "importance"`. `computeEvictionScore` uses `valid_at`. Persistence `maxFacts = 5000`. Facts with high temporal recency + high confidence survive eviction. All existing tests pass (fix any that depend on FIFO default by explicitly setting `evictionPolicy: "fifo"`).

**Dependencies**: Phase 1.1 (`valid_at` must be correct for eviction scoring to work).

---

## Phase 2: Retrieval Activation (Days 8-12, target: 55% → 63%)

### 2.1 Eval harness uses `hybridSearchFactsWithEmbedding`

**Problem**: Eval uses `index.searchWithEmbedding()` (line 537) which bypasses `preFilter`, `temporalMode`, `includeCandidates`, `candidateThreshold`.

**Files to modify**:

1. **`tests/unit/runtime-memory-locomo-full-500.test.ts`**:
   - Lines 480-490: Keep pre-built indices for embedding cache, but switch search call
   - Lines 530-543: Replace `index.searchWithEmbedding(...)` with:
     ```typescript
     const hybridHits = await hybridSearchFactsWithEmbedding(
       conversationFacts,
       {
         queryText: qa.question,
         topK: 10,
         temporalMode: detectQueryTemporalMode(qa.question),
         referenceTime: sessionAnchorDate,
         candidateThreshold: 0.7,
         fusion: OPTIMAL_HYBRID_FUSION,
       },
       embeddingProvider,
     );
     ```
   - Use per-conversation fact arrays (not global) so `referenceTime` matches the conversation's timeline

2. **`tests/unit/runtime-memory-architecture-diagnostic.test.ts`**:
   - Q1 assertions (lines 57-79): Update — eval now uses `hybridSearchFactsWithEmbedding`, not `searchWithEmbedding`

**Performance note**: `hybridSearchFactsWithEmbedding` has an LRU cache (lines 246-267) keyed by candidate set. Since `preFilter` depends on `referenceTime`/`temporalMode`, cache hits require same query parameters. To maximize cache hits, group questions by conversation and reuse `referenceTime`.

**Acceptance**: Eval uses full retrieval pipeline with `temporalMode` + `referenceTime` + `candidateThreshold`. J Score improves ≥5pp vs Phase 1 baseline.

**Dependencies**: Phase 1.1 (correct `valid_at`), Phase 1.4 (`candidateThreshold` field).

---

### 2.2 Temporal query detector

**Problem**: No temporal query detection. `temporalMode` always defaults to `"filter"`.

**New file**: **`openclaw_runtime/src/runtime-core/memory-temporal-detector.ts`**

```typescript
export function detectQueryTemporalMode(question: string): "filter" | "boost" | "strict"
export function isMultiHopQuestion(question: string): boolean
export function isOpenDomainQuestion(question: string): boolean
```

Patterns (from mem.md, refined against LoCoMo categories):
- `"strict"`: "when did", "what date", "on what day", "in \d{4}", "before .* did", "after .* did", "at the time of"
- `"boost"`: "currently", "now", "still", "anymore", "recently", "latest", "how long"
- `"filter"`: default
- Multi-hop: "how long", "how many .* since", "compare", "relationship between", "both .* and"
- Open-domain: "tell me about", "what do you know", "describe", "summarize"

**Tests**:
- New `tests/unit/runtime-memory-temporal-detector.test.ts`: test against actual LoCoMo questions (categories 1-4). ≥80% temporal questions → `"strict"` or `"boost"`. ≥70% multi_hop → `isMultiHopQuestion = true`.

**Acceptance**: Correct classification on LoCoMo question set. No false positives on single_hop questions.

**Dependencies**: None — can develop in parallel with Phase 2.1.

---

### 2.3 Chained retrieval (multi_hop fix)

**Problem**: Multi-hop questions need connected facts. Entity graph (Phase 1.3) exists but retrieval doesn't use it.

**New file**: **`openclaw_runtime/src/runtime-core/memory-chained-retrieval.ts`**

```typescript
export async function chainedHybridSearch(
  facts: readonly RuntimeMemoryQueryableFact[],
  question: string,
  sessionDate: number,
  embeddingProvider: EmbeddingProviderOrNone,
  options: {
    topK?: number;
    relationMap?: Map<string, string[]>;  // factId → related factIds
  }
): Promise<HybridSearchHit[]>
```

Algorithm (from mem.md lines 182-213):
1. Step 1: Standard `hybridSearchFactsWithEmbedding` with `temporalMode: "boost"`
2. If `isMultiHopQuestion(question)`:
   - Extract entity names from Step 1 results
   - Find related facts via `relationMap`
   - Step 2: Retrieve related facts
   - RRF-fuse Step 1 + Step 2 results

**Files to modify**:

1. **`tests/unit/runtime-memory-locomo-full-500.test.ts`**:
   - Build `relationMap` from Phase 1.3 entity extraction
   - For multi_hop questions (category 3), use `chainedHybridSearch` instead of direct `hybridSearchFactsWithEmbedding`
   - For other categories, use standard retrieval

**Tests**:
- New `tests/unit/runtime-memory-chained-retrieval.test.ts`: synthetic facts + relations, verify multi-hop questions retrieve connected facts

**Acceptance**: Multi_hop category score improves ≥5pp. Single-hop unaffected.

**Dependencies**: Phase 1.3 (entity relation map), Phase 2.1 (base retrieval), Phase 2.2 (`isMultiHopQuestion`).

---

## Phase 3: open_domain Structuring (Days 13-20, target: 63% → 68%)

### UserProfile layer — aggregate facts into dimensions

**Problem**: No structured profile. Open-domain questions require synthesizing across many facts.

**New files**:

1. **`openclaw_runtime/src/runtime-core/memory-user-profile.ts`**:
   ```typescript
   type ProfileDimension = { key, value, confidence, sourceFactIds, lastUpdated }
   type UserProfile = {
     userId: string;
     dimensions: {
       occupation, preferences[], relationships[], locations[], timeline[]
     }
   }
   export function buildUserProfile(facts, userId): UserProfile
   export function selectProfileDimensions(question, profile): ProfileDimension[]
   ```

   Dimension categorization by predicate:
   - `occupation`/`works`/`job`/`career` → occupation
   - `likes`/`prefers`/`enjoys`/`hobby` → preferences
   - `married`/`friend`/`knows`/`met` → relationships
   - `lives`/`city`/`moved` → locations
   - Facts with `valid_at` → timeline

2. **`openclaw_runtime/src/runtime-core/memory-profile-retrieval.ts`**:
   ```typescript
   export async function openDomainRetrieval(
     question, facts, profile, embeddingProvider
   ): Promise<{ profileDimensions, detailFacts }>
   ```
   - Step 1: `selectProfileDimensions(question, profile)` — O(1) lookup
   - Step 2: `hybridSearchFactsWithEmbedding(facts, {queryText, topK: 5})` — detail facts
   - Step 3: Merge, dedup, prioritize profile data

**Files to modify**:

3. **`tests/unit/runtime-memory-locomo-full-500.test.ts`**:
   - After fact extraction: build `UserProfile` per conversation
   - For open_domain questions (category 4): use `openDomainRetrieval` instead of standard/chained retrieval
   - For other categories: use standard/chained retrieval

**Tests**:
- New `tests/unit/runtime-memory-user-profile.test.ts`: test dimension categorization
- New `tests/unit/runtime-memory-profile-retrieval.test.ts`: test open-domain retrieval

**Acceptance**: Open_domain category score improves ≥5pp. Other categories unaffected. Profile builds correctly from extracted facts.

**Dependencies**: Phase 1.1 (correct `valid_at` for timeline), Phase 2.1 (base retrieval), Phase 2.2 (question routing).

---

## Verification & Acceptance

### Per-Phase Benchmark Runs

After each phase, run the 500-question LoCoMo benchmark:
```powershell
$env:RUNTIME_MEMORY_REAL_LLM="1"; $env:DEEPSEEK_API_KEY="<key>"; $env:SILICONFLOW_API_KEY="<key>"
pnpm vitest run tests/unit/runtime-memory-locomo-full-500.test.ts --reporter=verbose
```

| Phase | Target J Score | Target by Category |
|-------|---------------|-------------------|
| Baseline | 43.0% | temporal 17.3%, multi_hop 39.6%, single_hop 52.8%, open_domain 66.1% |
| Phase 1 | 51-55% | temporal 38-45%, multi_hop 44-50% |
| Phase 1+2 | 56-61% | temporal 45-52%, multi_hop 50-58% |
| Phase 1+2+3 | 58-64% | open_domain 72-76% |

### Test Suite

After each phase, run:
```powershell
pnpm run typecheck
pnpm test -- --grep "runtime-memory"
```

### Fact Survival Test

After Phase 1, re-run:
```powershell
pnpm vitest run tests/unit/runtime-memory-fact-survival-e2e.test.ts --reporter=verbose
```
Target: survival rate ≥85% (up from 81.8% baseline).

### Architecture Diagnostic

After Phase 2, update and re-run:
```powershell
pnpm vitest run tests/unit/runtime-memory-architecture-diagnostic.test.ts --reporter=verbose
```
Q1-Q6 assertions should reflect the fixed architecture.

---

## Risk Mitigation

1. **Eviction default change**: Changing `evictionPolicy` default from `"fifo"` to `"importance"` may break tests depending on FIFO order. Mitigation: run full test suite, explicitly set `evictionPolicy: "fifo"` in tests that depend on FIFO.

2. **Eval performance**: Switching to `hybridSearchFactsWithEmbedding` may slow the 500Q eval. Mitigation: LRU cache (lines 246-267), group questions by conversation for cache reuse.

3. **Entity extraction false positives**: Deterministic regex may create spurious relations. Mitigation: start conservative, tune based on eval results.

4. **Session date parsing**: LoCoMo dates are in format "1:56 pm on 8 May, 2023". Mitigation: dedicated `locomo-date-parser.ts` helper with comprehensive test cases.

5. **Persistence limit increase**: Raising persistence `maxFacts` to 5000 increases DB size. Mitigation: still bounded, and periodic consolidation can prune.

---

## Execution Order

```
Day 0:     Phase 0 (prerequisite verification)
Day 1-2:   Phase 1.1 (valid_at fix) + Phase 1.2 (time normalization)
Day 3-4:   Phase 1.3 (entity graph) + Phase 1.4 (candidate threshold)
Day 5-7:   Phase 1.5 (eviction fix)
           → Run LoCoMo benchmark, verify 51-55%
Day 8-9:   Phase 2.1 (eval harness retrieval) + Phase 2.2 (temporal detector)
Day 10-12: Phase 2.3 (chained retrieval)
           → Run LoCoMo benchmark, verify 56-61%
Day 13-20: Phase 3 (UserProfile + profile retrieval)
           → Run LoCoMo benchmark, verify 58-64%
```

Phase 4 (cross-session entity fusion) deferred — revisit after Phase 3 results.
