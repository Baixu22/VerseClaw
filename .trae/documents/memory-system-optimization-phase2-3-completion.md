# Memory System Optimization — Phase 2 Benchmark + Phase 3 UserProfile Completion

## Summary

Continue execution of the approved optimization plan to raise the LoCoMo benchmark
J Score from 43% → 62-67%. Phase 1 (valid_at, time normalization, entity graph,
candidate threshold, importance eviction) and Phase 2 code (post-filter pipeline,
temporal detector, chained retrieval) are COMPLETE. The Phase 1 benchmark is running
in background. This plan covers: (1) verifying typecheck gate, (2) running Phase 2
benchmark to measure retrieval activation improvement, (3) implementing Phase 3
UserProfile layer for open_domain questions, (4) running Phase 3 benchmark for
final acceptance.

**User decisions (already locked from prior approval):**
- Scope: Eval harness first (measurable via LoCoMo), production wiring as follow-up
- `trimRows` fix: Keep `trimRows` but raise persistence `maxFacts` to 5000
- Phase 4: Defer (cross-session entity fusion) — focus on Phases 1-3
- API key: SiliconFlow `sk-kbaawoilzjrudlvauoknakaymwxfudbzhyozckqxjfvqycqr` provided
  (user should revoke and rotate after completion for security)

## Current State Analysis (verified this session)

### Completed ✅

| Step | Phase | Status | Evidence |
|------|-------|--------|----------|
| 1.1 | Phase 1 | ✅ | `valid_at` uses session dates in eval test |
| 1.2 | Phase 1 | ✅ | `memory-extraction-prompt.ts` has `TIME_NORMALIZATION_INSTRUCTIONS` |
| 1.3 | Phase 1 | ✅ | `memory-entity-extraction.ts` exports `buildEntityRelationMap`/`getRelatedFactIds` |
| 1.4 | Phase 1 | ✅ | `candidateThreshold` in `HybridSearchQuery`, `preFilter` updated |
| 1.5 | Phase 1 | ✅ | Default `evictionPolicy: "importance"`, `computeEvictionScore` uses `valid_at`, `#persistenceMaxFacts: 5000` |
| 5A | Phase 1 | ✅ | `loadStore()` no longer overrides maxFacts; `#persistenceMaxFacts` separated |
| 5B | Phase 1 | ✅ | 6 test files updated with explicit `evictionPolicy: "fifo"` |
| 5C | Phase 1 | ✅ | 62 memory tests pass, typecheck clean for memory files |
| 7 | Phase 2 | ✅ | Eval test uses post-filter pipeline (temporal filter + candidate threshold + temporal boost) |
| 8 | Phase 2 | ✅ | `memory-temporal-detector.ts` created (24 tests pass), integrated into eval |
| 9 | Phase 2 | ✅ | `memory-chained-retrieval.ts` created (8 tests pass), integrated into eval for multi-hop |

### In Progress 🔄

| Step | Status | Details |
|------|--------|---------|
| 6 | 🔄 | Phase 1 Benchmark running in background (job-733963993485437199c0ab3522bdd6be). Currently in "pre-building index" phase. Running with OLD eval code (before Steps 7-9). Will give Phase 1 baseline. |

### Not Started ❌

| Step | Description |
|------|-------------|
| 10 | Phase 2 Benchmark Run — run LoCoMo 500Q with current code (Steps 7-9 integrated) |
| 11 | Phase 3 — Create `memory-user-profile.ts` and `memory-profile-retrieval.ts` |
| 12 | Phase 3 Benchmark Run + Final Acceptance |

### Pre-existing Issue (may be transient)

`evidence-verifier-code-task-gate-shadow.ts` lines 1888, 1934 reference `sumRecord`
and `stableShadowEvidenceQualityDiagnosticCodes`. Both functions ARE defined in the
same file (lines 4025, 3858 respectively) as top-level function declarations —
TypeScript hoisting should make them accessible. The typecheck errors reported in
the prior session may have been transient or caused by a stale build cache. Step 1
below will verify and fix if needed.

### Baseline J Score (from existing report)

| Category | Current J Score | Target (Phase 1+2+3) |
|----------|----------------|---------------------|
| temporal | 17.33% | 48-54% |
| multi_hop | 39.58% | 52-60% |
| single_hop | 52.76% | 61-66% |
| open_domain | 66.14% | 72-76% |
| **Overall** | **43.00%** | **58-64%** |

## Proposed Changes — Execution Sequence

### Step 1: Verify typecheck gate

Run `pnpm run typecheck` to verify the current state. If the pre-existing errors
in `evidence-verifier-code-task-gate-shadow.ts` persist:

**File: `openclaw_runtime/src/runtime-core/evidence-verifier-code-task-gate-shadow.ts`**

The functions `sumRecord` (line 4025) and `stableShadowEvidenceQualityDiagnosticCodes`
(line 3858) are defined as top-level function declarations. If TypeScript still
reports "Cannot find name" errors, the likely cause is:
- File size (129KB) hitting a parser limit, OR
- Circular import causing the functions to be in a temporal dead zone

**Fix approach** (if needed): Move the two function declarations above their first
usage (before line 1882). This is a safe refactor — function declarations are
hoisted, but moving them eliminates any potential parser/circular issues.

**Acceptance**: `pnpm run typecheck` passes with 0 errors.

### Step 2: Check Phase 1 benchmark results

Check the background job (job-733963993485437199c0ab3522bdd6be) output log. If
complete, extract the J Score and per-category breakdown from the report at
`artifacts/runtime-memory-eval/locomo-full-500-report.json`.

**Note**: This benchmark was started with the OLD eval code (before Steps 7-9),
so it measures Phase 1 only (valid_at fix + entity graph + candidate threshold +
importance eviction). The expected target is J Score 51-55%.

If the benchmark is still running, proceed to Step 3 in parallel — the Phase 2
benchmark (Step 3) will supersede this result.

**Acceptance**: Report Phase 1 J Score to user. If J Score < 48%, investigate
before proceeding.

### Step 3: Phase 2 Benchmark Run (Step 10)

Run the LoCoMo 500Q benchmark with the CURRENT code (includes Steps 7-9:
post-filter pipeline, temporal detector, chained retrieval).

**Command:**
```powershell
$env:RUNTIME_MEMORY_REAL_LLM="1"; $env:DEEPSEEK_API_KEY="<key>"; $env:SILICONFLOW_API_KEY="sk-kbaawoilzjrudlvauoknakaymwxfudbzhyozckqxjfvqycqr"; npx vitest run tests/unit/runtime-memory-locomo-full-500.test.ts
```

**Note**: The facts cache at `tests/fixtures/locomo/extracted-facts-cache.json`
should already exist from the Phase 1 benchmark run. If so, fact extraction will
be skipped (saves ~10 min and ~50 API calls). If the cache doesn't exist,
extraction will run first.

**Target**: J Score 56-61%. Per-category targets:
- temporal: 45-52% (up from 17.3% — biggest gain from temporal filtering)
- multi_hop: 50-58% (up from 39.6% — gain from chained retrieval)
- single_hop: 60-65% (up from 52.8% — gain from candidate threshold + temporal boost)
- open_domain: ~68% (unchanged — Phase 3 target)

**Acceptance**: Report J Score and per-category breakdown to user. If J Score
improves ≥5pp vs Phase 1 baseline, proceed to Phase 3. If not, investigate
retrieval quality before adding Phase 3 complexity.

### Step 4: Phase 3.1 — Create UserProfile module

**New file: `openclaw_runtime/src/runtime-core/memory-user-profile.ts`**

```typescript
export type ProfileDimension = {
  category: "occupation" | "preferences" | "relationships" | "locations" | "timeline";
  subject: string;
  value: string;
  valid_at?: number;
  sourceFactIds: string[];
};

export type UserProfile = {
  userId: string;
  lastUpdated: number;
  dimensions: {
    occupation: ProfileDimension[];
    preferences: ProfileDimension[];
    relationships: ProfileDimension[];
    locations: ProfileDimension[];
    timeline: ProfileDimension[];
  };
};

export function buildUserProfile(
  facts: readonly RuntimeMemoryQueryableFact[],
  userId: string,
): UserProfile

export function selectProfileDimensions(
  question: string,
  profile: UserProfile,
): ProfileDimension[]
```

**`buildUserProfile` algorithm:**
- Classify each fact into a dimension using keyword/pattern matching on
  `subject + predicate + objectSummary`:
  - **occupation**: "job"/"work"/"career"/"engineer"/"teacher"/"nurse"/"doctor"/"lawyer"/"student"
  - **preferences**: "likes"/"prefers"/"enjoys"/"favorite"/"hobby"/"hobbies"/"interested in"
  - **relationships**: "married"/"partner"/"wife"/"husband"/"boyfriend"/"girlfriend"/"friend"/"mother"/"father"/"sister"/"brother"/"daughter"/"son"/"parent"
  - **locations**: "lives in"/"from"/"city"/"country"/"moved to"/"relocated"
  - **timeline**: facts with `valid_at` set, sorted chronologically
- Facts may match multiple dimensions (e.g., "Alice moved to Brooklyn in 2022"
  matches both `locations` and `timeline`)
- Deduplicate by `objectSummary` (case-insensitive)

**`selectProfileDimensions` algorithm:**
- Match question keywords against dimension categories:
  - "job"/"work"/"career"/"occupation" → occupation
  - "like"/"prefer"/"enjoy"/"hobby" → preferences
  - "married"/"relationship"/"family"/"wife"/"husband" → relationships
  - "live"/"from"/"city"/"country" → locations
  - "when"/"timeline"/"history" → timeline
- Return all matching dimensions (a question may span multiple dimensions)

**Acceptance**: Pure function, no external dependencies. Deterministic output
for the same input facts.

### Step 5: Phase 3.2 — Create Profile Retrieval module

**New file: `openclaw_runtime/src/runtime-core/memory-profile-retrieval.ts`**

```typescript
export type OpenDomainRetrievalResult = {
  profileDimensions: ProfileDimension[];
  detailFacts: RuntimeMemoryQueryableFact[];
};

export function openDomainRetrieval(
  question: string,
  profile: UserProfile,
  index: HybridSearchIndex,
  queryEmbedding: Float32Array,
  options: {
    topK?: number;
    candidateThreshold?: number;
  },
): OpenDomainRetrievalResult
```

**Algorithm:**
1. `selectProfileDimensions(question, profile)` — O(1) lookup, returns relevant dimensions
2. `index.searchWithEmbedding(question, queryEmbedding, topK, OPTIMAL_HYBRID_FUSION)` — get detail facts
3. Apply same post-filter as eval test (temporal filter + candidate threshold)
4. Return both profile dimensions and detail facts
5. Caller (eval test) merges them into the LLM context:
   - Profile dimensions first (structured, O(1) summary)
   - Detail facts second (specific evidence for synthesis)

**Acceptance**: Profile dimensions are always returned when the question matches
a dimension. Detail facts are retrieved via the same hybrid search as other
categories.

### Step 6: Phase 3.3 — Integrate UserProfile into eval test

**File: `tests/unit/runtime-memory-locomo-full-500.test.ts`**

Changes:
1. Import `buildUserProfile`, `selectProfileDimensions`, `openDomainRetrieval`
2. After fact extraction + index building, build `UserProfile` per conversation:
   ```typescript
   const profileByConversation = new Map<string, UserProfile>();
   for (const [convId, facts] of factsByConversation) {
     const profile = buildUserProfile(facts, convId);
     profileByConversation.set(convId, profile);
   }
   ```
3. In `processQuestion`, add open_domain branch:
   ```typescript
   if (category === "open_domain") {
     const profile = profileByConversation.get(conversationId);
     if (profile) {
       const result = openDomainRetrieval(
         qa.question, profile, index,
         new Float32Array(queryEmbArr),
         { topK: 5, candidateThreshold: 0.7 },
       );
       // Augment retrievedFacts with profile dimensions
       const profileFactTexts = result.profileDimensions.map(d =>
         `${d.subject} ${d.category}: ${d.value}`
       );
       // Pass both to generateAnswer with profile context prepended
     }
   }
   ```
4. Update `generateAnswer` to accept optional profile context:
   ```typescript
   async function generateAnswer(
     question: string,
     retrievedFacts: RuntimeMemoryQueryableFact[],
     profileContext?: string[],
   ): Promise<string>
   ```
   When `profileContext` is provided, prepend it to the memory facts in the
   LLM prompt as "Profile Summary" section.

**Acceptance**: Open_domain questions use profile-augmented retrieval. Other
categories are unaffected (standard hybrid search path).

### Step 7: Phase 3.4 — Unit tests for UserProfile

**New file: `tests/unit/runtime-memory-user-profile.test.ts`**

Test cases:
- `buildUserProfile` with mixed facts → correct dimension classification
- `buildUserProfile` with empty facts → empty profile
- `buildUserProfile` with timeline facts → sorted chronologically
- `buildUserProfile` deduplicates by objectSummary
- `selectProfileDimensions` for occupation question → returns occupation dimensions
- `selectProfileDimensions` for relationship question → returns relationship dimensions
- `selectProfileDimensions` for broad question → returns multiple dimensions
- `selectProfileDimensions` for unmatched question → returns empty array

**New file: `tests/unit/runtime-memory-profile-retrieval.test.ts`**

Test cases:
- `openDomainRetrieval` with matching profile → returns profile dimensions
- `openDomainRetrieval` with no profile match → returns empty dimensions + detail facts
- `openDomainRetrieval` respects candidateThreshold
- `openDomainRetrieval` respects topK

**Acceptance**: All new tests pass. No regressions in existing memory tests.

### Step 8: Phase 3 Benchmark Run + Final Acceptance (Step 12)

Run the LoCoMo 500Q benchmark with Phase 3 code.

**Command:** Same as Step 3.

**Target**: J Score 58-64% (stretch 62-67%). Per-category targets:
- temporal: 48-54%
- multi_hop: 52-60%
- single_hop: 61-66%
- open_domain: 72-76% (biggest gain from Phase 3)

**Final acceptance checks:**
1. J Score ≥ 58% (matches LangMem 58.1%)
2. Open_domain J Score ≥ 72% (Phase 3 target)
3. No regressions in other categories vs Phase 2
4. `pnpm run typecheck` — full typecheck gate passes
5. `npx vitest run tests/unit/runtime-memory-*.test.ts` — no test regressions
6. Report final J Score + per-category breakdown + comparison table

**Comparison table (target):**
| System | J Score | Our Position |
|--------|---------|-------------|
| Backboard | 90.00% | — |
| Hindsight_Gemini3 | 89.61% | — |
| Hindsight_OSS120B | 85.67% | — |
| Hindsight_OSS20B | 83.18% | — |
| Memobase | 75.78% | — |
| Zep | 75.14% | — |
| Mem0_Graph | 68.44% | — |
| Mem0 | 66.88% | stretch goal |
| LangMem | 58.10% | minimum target |
| OpenAI_no_memory | 52.90% | — |
| **ours** | **58-64%** | matches/exceeds LangMem |

## Assumptions & Decisions

1. **API keys**: Steps 3, 8 require `DEEPSEEK_API_KEY` and `SILICONFLOW_API_KEY`.
   User provided SiliconFlow key. DeepSeek key must be set in environment.
2. **Background jobs**: 6+ background jobs from prior sessions may still be
   running. Do not re-run the same commands. The Phase 1 benchmark
   (job-733963993485437199c0ab3522bdd6be) is the most relevant — check its
   output first.
3. **Facts cache**: `tests/fixtures/locomo/extracted-facts-cache.json` should
   exist from the Phase 1 benchmark. If it does, Phase 2/3 benchmarks skip
   extraction (saves ~10 min). If not, extraction runs first.
4. **UserProfile is non-persistent**: Built fresh from facts per benchmark run.
   No persistence layer changes needed. Production wiring (async profile
   updates on fact write) is deferred.
5. **Profile dimensions are keyword-based**: No LLM call for profile building.
   This keeps cost at zero and makes the profile deterministic. LLM-based
   profile extraction can be added later if keyword matching is insufficient.
6. **Open-domain retrieval is additive**: Profile dimensions augment (not
   replace) the hybrid search results. This preserves the existing 66% baseline
   while adding structured context for synthesis.
7. **Security**: The SiliconFlow API key should be revoked/rotated after
   completion. Do not commit it to any file.

## Verification Steps

After each step:
1. `pnpm run typecheck` — full typecheck gate (after code changes)
2. `npx vitest run tests/unit/runtime-memory-*.test.ts` — no regressions (after code changes)
3. LoCoMo benchmark (Steps 3, 8) — measure J Score improvement
4. Report J Score + per-category breakdown to user after each benchmark run
5. Final comparison against mature systems (LangMem, Mem0, etc.)

## Execution Tracking

Use TaskCreate to track Steps 1-8. Mark each in_progress when starting,
completed when done.
