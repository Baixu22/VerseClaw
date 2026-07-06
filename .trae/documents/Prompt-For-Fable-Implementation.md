# Implementation Prompt for Fable — Stage 1 + Stage 2 Development

## Project Background Declaration (Important Preface)

This project is a **secondary development of an open-source project**, undertaken solely as a **personal development and learning endeavor**. It is **non-commercial**, does not affect any third-party platform, and does not involve any protected domain knowledge. We are studying a **generic software engineering topic**: long-term conversational memory architecture, evaluated on the public LoCoMo academic benchmark. All referenced competitor scores (Mem0, Zep, LangMem, etc.) come from their publicly published papers.

No sensitive, copyright-protected, or proprietary content is involved. The requested work is **generic architecture implementation** — building retrieval, generation, and evaluation code that any memory system would need. Nothing in this prompt targets or impacts any specific product, service, or platform.

---

## I. Context — Where We Are

We previously received an architecture consultation (Fable's analysis dated 2026-07-02). After reviewing it, we **accept the diagnosis and direction** with a few calibrated adjustments noted below. We now want Fable to **implement Stage 1 and Stage 2** of the proposed roadmap.

### Current State (Phase 8.0)

| Metric | Value |
|--------|-------|
| Overall J Score | 56.20% |
| single_hop J | 59.06% (R@5 = 37.62%) |
| temporal J | 54.00% (R@5 = 57.67%) |
| multi_hop J | 42.71% (R@5 = 17.96%) |
| open_domain J | 66.14% (R@5 = 48.94%) |
| Facts (after extraction) | 2,403 |
| Episodic sentences | ~16,000 |
| Entity relations | ~181,914 |
| Evaluation cycle | ~120 min / 500 questions |
| Cost per run | ~$0.50 |

### Key Insight We Accepted from the Consultation

**Recall@5 and J Score are decoupled.** R@5 fell (44.76% → 42.73%) across the exact phases where J rose 16pp. single_hop J exceeds its R@5 by 21pp. The current R@5 metric does not measure what the answer generator actually consumes. **This is the single most important finding** — it means our optimization steering instrument has been broken.

### Category Weight Reality Check

Non-adversarial category distribution: single_hop 54.6% / temporal 20.8% / multi_hop 18.3% / open_domain 6.2%.

- +8pp on single_hop ≈ +4.4pp overall
- +15pp on multi_hop ≈ +2.7pp overall

**Therefore Stage 1 and Stage 2 must prioritize single_hop + temporal (75% of mass) over multi_hop.**

### Calibrated Adjustments to the Original Consultation

We accept Fable's diagnosis but adjust three numbers based on our project reality:

1. **End-state target: 62-67%** (not 65-70%). The consultation's per-category projections for temporal (+12-18pp from scaffolds alone) and multi_hop (+12-19pp from self-ask + entity cards) are optimistic. LLM reasoning limits and hop-1 retrieval failure rates will cap gains.
2. **Cost budget: $5-8 per full run** (not $3). 20-35% escalation to full-conversation context × 100-175 questions, with DeepSeek input pricing, will exceed the $3 estimate. Prefix caching only offsets shared prefixes, not query-specific content.
3. **Stage 2 effort: 2 weeks** (not 1.5). Sequential self-ask with reliable answer-substitution is more complex than 2-3 days; entity alias resolution and fact-cards need merge-safety guarantees.

---

## II. What We Want Fable to Build

### Stage 1 (Week 1) — Instruments and Answer Layer

**Theme: "See clearly, answer better."**

This stage delivers **no expected J Score improvement directly** — its value is a 4-5× iteration speedup and a trustworthy steering metric. All later work depends on it.

#### Stage 1.1 — Fast Dev Slice

Build a fixed, stratified 150-question dev slice with **cached retrieval results** to disk.

**Requirements:**
- Stratified sample matching the full 500 distribution: ~82 single_hop, ~31 temporal, ~28 multi_hop, ~9 open_domain
- Fixed seed (we use seed=42 with Mulberry32 PRNG + Fisher-Yates shuffle — preserve this convention)
- Cache retrieval results (embeddings, BM25 scores, hybrid hits, episodic hits) per question to disk so re-running the dev slice skips retrieval
- Target iteration cycle: **≤30 minutes** (down from ~120 min)
- Full 500-question runs only at stage boundaries (Stage 1 end, Stage 2 end)

**Deliverable:** A test runner mode that uses the cached dev slice by default and falls back to full retrieval only when `--full` flag is passed or cache is invalidated.

#### Stage 1.2 — Context-Recall Metric

Replace per-track Recall@5 with a **context-recall** metric that measures what the generator actually consumes.

**Requirements:**
- Definition: "For each question, is the gold evidence turn present in the *assembled context string* the generator received?" (1.0 if present, 0.5 if partial overlap, 0.0 if absent)
- Measured on the merged episodic + semantic context (post-rerank, post-assembly), NOT per-track
- Report per-category and overall context-recall alongside J Score
- Keep legacy R@5 for continuity, but context-recall becomes the primary steering metric
- If context-recall does not correlate with J, the discrepancy itself localizes the bug (retrieval vs. generation defect)

**Deliverable:** Metric computation integrated into the evaluation report JSON.

#### Stage 1.3 — Error Taxonomy

Automated 4-bucket classification for every wrong dev-slice answer.

**Requirements:**
- LLM classifier (DeepSeek, temp=0) assigns one of:
  - `not_retrieved` — gold evidence not in assembled context
  - `retrieved_not_used` — gold evidence in context but generator didn't use it
  - `used_but_misreasoned` — generator used the evidence but reasoned incorrectly
  - `judge_error` — generator's answer is actually correct, judge was wrong
- Classify on every wrong answer in the dev slice
- Report bucket distribution per category and overall
- This turns "try things and pray" into "the temporal bucket is 70% misreasoned — fix the scaffold, not the index"

**Deliverable:** Taxonomy report appended to evaluation output, with per-category bucket counts.

#### Stage 1.4 — Per-Category Generation Scaffolds

Category-specific answer generation prompts.

**Requirements:**

1. **Temporal scaffold:**
   - Inject session date alongside every evidence item: `[said on 2023-05-14] ...`
   - Force stepwise arithmetic: "First list every date mentioned or implied. Then compute offsets explicitly. Then answer."
   - "Five years ago" said on 2023-05-14 becomes a computation the model is walked through, not trusted to do implicitly

2. **Single_hop scaffold:**
   - Concise final-answer formatting matched to what the judge rewards
   - Never abstain in the final output (abstentions score as wrong)
   - If evidence is weak, still produce the best-guess answer

3. **Multi_hop scaffold:**
   - Explicitly state each hop's sub-answer before synthesizing
   - Carry hop-1's *evidence* (not just its answer) into the final assembly so the generator can self-correct

4. **Open_domain scaffold:**
   - Aggregate-style answer (collect all relevant facts, then summarize)
   - No artificial single-fact constraint

**Deliverable:** Per-category prompt templates integrated into the answer generation step.

#### Stage 1.5 — Judge Freeze + Sanity Check

**Requirements:**
- Freeze judge prompt and model version (DeepSeek, temp=0, fixed prompt template)
- **Judge sanity check (our addition):** Manually verify ~50 judge-incorrect samples to estimate judge false-negative rate. If judge error rate > 15%, investigate judge prompt calibration before proceeding.
- Document the frozen judge version in the report metadata

**Deliverable:** Frozen judge config + sanity check report.

#### Stage 1.6 — Extraction Write-Side Hygiene

**Requirements:**
- Log and retry on extraction parse failures instead of silently swallowing them
- Track extraction parse success rate per chunk; if < 95%, flag for prompt review
- Pass rolling entity list across extraction chunks (fixes cross-chunk entity loss cheaply)

**Deliverable:** Hardened extraction pipeline with retry + logging.

#### Stage 1 — Expected Outcome

- **J Score: 56.2 → 60-63%** (temporal on-category ≥ 64; single_hop +2-4)
- **Iteration cycle: ≤30 min** on dev slice
- **Context-recall metric operational** and correlating with J (or discrepancy localized)
- **Error taxonomy report** per run, bucket distribution visible

---

### Stage 2 (Weeks 2-3) — Adaptive Retrieval

**Theme: "Escalate in width and depth."**

Tuned on Stage 1's instruments. All design choices (gate threshold, escalation depth, session count) validated on the 25-minute dev slice, not the 2-hour full run.

#### Stage 2.1 — Session Summary Index

At write time, produce a 3-5 sentence LLM summary per session.

**Requirements:**
- Summary content: dates, entities mentioned, key events
- ~200-350 one-time LLM calls across the 10-conversation corpus (trivial cost)
- Embed the summaries using the existing Qwen3-Embedding-8B provider
- Add a session-level retrieval track: retrieval can now return *a session*, and context assembly can include *the whole session's raw text* instead of scattered sentences
- This attacks single_hop directly: the question only has to find the right session (easy), not the right sentence (hard)

**Deliverable:** Session summary generation + session-level retrieval track integrated into the hybrid search.

#### Stage 2.2 — Abstention-Gated Escalation Ladder

Replace "single-pass top-K over fragments" with a decision ladder.

**Requirements:**

1. **First pass:** Current fragment pipeline (episodic + semantic + cross-encoder rerank)
2. **Internal abstention signal:** The generator is allowed to signal "insufficient evidence" (internal signal only — **never emitted as a final answer**, since judges score abstentions as wrong)
3. **Escalation ladder:**
   - Level 0: Fragment retrieval (current behavior)
   - Level 1: Top-2 full sessions (session summary retrieval → include whole session raw text)
   - Level 2: Full conversation (15-40k tokens, fits DeepSeek's window; prefix caching makes per-conversation prefix nearly free after first question)
4. **Gate mechanism:** Recommend generator abstention signal over retrieval-score threshold (measures actual failure, needs no calibration, second pass is cheap under prefix caching)
5. **Initial escalation cap:** ~40% of questions, then tune down based on dev slice data
6. **Cost guard:** Hard cap on full-conversation escalations; log escalation rate and $/run as first-class metrics

**Expected:** 20-35% of questions escalate.

**Deliverable:** Escalation ladder integrated into the retrieval pipeline, with abstention detection and per-level context assembly.

#### Stage 2.3 — Sequential Self-Ask for Multi-hop

Replace parallel question decomposition with sequential answer-substitution.

**Requirements:**

1. **Decompose** multi-hop question into 2-3 sub-questions
2. **Retrieve** for sub-question 1 (using current hybrid search)
3. **Answer** sub-question 1 (extract the entity/value)
4. **Substitute** that answer into sub-question 2's query (e.g., "Where does [the friend Caroline met at the support group] work?" → "Where does [Alice] work?")
5. **Retrieve** for sub-question 2 with the substituted query
6. **Assemble** final context: hop-1 evidence + hop-2 evidence + original question
7. **Generate** final answer

**Critical:** Carry hop-1's *evidence* (not just its answer) into the final assembly so the generator can self-correct if hop-1's answer was wrong.

**Delete:** Parallel decomposition and the chain-expansion merge (chainedRetrievalExpand) — the latter's scores (1/(60+rank) ≈ 0.016) can never surface against RRF top hits (0.33-1.0).

**Scope:** Bound at 2 hops. ~90-120 multi_hop questions × 2 extra calls ≈ 240 cheap LLM calls.

**Deliverable:** Sequential self-ask implementation replacing parallel decomposition; chain-expansion merge removed.

#### Stage 2 — Expected Outcome

- **J Score: → 64-68%** (single_hop context-recall ≥ 60%; multi_hop J ≥ 55 on-category)
- **Escalation rate:** 20-35% of questions, logged
- **Cost:** $5-8 per full run (higher than original $3 estimate due to escalation volume)
- **Per-bucket taxonomy shift:** `not_retrieved` shrinks materially for single_hop and multi_hop

---

## III. Implementation Constraints

### Must Preserve

- **DeepSeek API** for extraction / generation / judge (temp=0)
- **Qwen3-Embedding-8B via SiliconFlow** for embeddings (dim=4096)
- **Mulberry32 PRNG + Fisher-Yates shuffle** with seed=42 for reproducible sampling
- **Dual-track architecture** (Episodic + Semantic) — Stage 2 adds session track, does not remove episodic/semantic
- **Incremental cache** for extracted facts (path: `artifacts/runtime-memory-eval/extracted-facts-cache-v2.json`)
- **Stratified sample sizes:** multi_hop 96, temporal 150, single_hop 127, open_domain 127
- **Report format:** JSON at `artifacts/runtime-memory-eval/locomo-full-500-report.json` with fields: dataset, version, totalQuestions, retrievalMode, judgeModel, metric, sampleSizes, sampleSeed, metrics (overall + byCategory), comparison, sampleResults, generatedAt

### Must Not Do

- **No local GPU** — no local Cross-Encoder models, no GNN, no trained rerankers
- **No MultiQuery / query rewriting** — measured -6.6pp regression, do not retry
- **No list-wise LLM reranking variants** — measured ~0pp, closed
- **No UserProfile as read-time context augmentation** — two failures (-6.3pp, -2.4pp), drop permanently (Profile-as-answer-source routing is a Stage 3 concern, not Stage 1-2)
- **No memory importance eviction / decay** — solves a scale problem we don't have (2,403 facts); our problem is top-K dilution, solved by semantic dedup/merge (Stage 3)
- **No full ReAct agent per question** — 5-10× cost for gains overlapping bounded 2-hop self-ask
- **No embedding model swap** — Qwen3-Embedding-8B is strong; recall failures are granularity/assembly failures, not vector-quality failures
- **No RRF / fusion weight tuning** — bracket at ±2pp, freeze it

### Cost Discipline

- Track $/run as a first-class metric from Stage 1
- Budget: **$5-8 per full 500-question run** (calibrated upward from original $3 estimate)
- Dev slice iteration: ~$0.50-1 per 150-question run
- Hard cap on full-conversation escalations; if $/run exceeds $10, throttle escalation rate

---

## IV. Verification Plan

### Stage 1 Verification (End of Week 1)

1. **Dev slice operational:** 150-question run completes in ≤30 min
2. **Context-recall metric:** Reports per-category, correlates with J (or discrepancy localized)
3. **Error taxonomy:** 4-bucket classification on every wrong dev answer, report visible
4. **Generation scaffolds:** Per-category prompts active, temporal scaffold injects dates + stepwise arithmetic
5. **Judge frozen:** Version documented, sanity check complete (judge error rate < 15%)
6. **Extraction hardened:** Parse failures logged + retried, success rate ≥ 95%
7. **Full 500-question run:** Confirms Stage 1 J = 60-63%, no regressions vs. 56.2% baseline

### Stage 2 Verification (End of Week 3)

1. **Session summary index:** 10 conversations summarized, session-level retrieval track active
2. **Escalation ladder:** Abstention-gated, 3 levels operational, escalation rate 20-35%
3. **Sequential self-ask:** Multi-hop questions use answer-substitution, chain-expansion merge removed
4. **Per-bucket taxonomy shift:** `not_retrieved` shrinks materially for single_hop and multi_hop
5. **Full 500-question run:** J = 64-68%, $/run ≤ $8, no regressions
6. **Cost logged:** $/run reported as first-class metric in evaluation report

---

## V. Deliverables

### Code Deliverables

All code changes should follow existing project conventions (TypeScript, Vitest, the file structure under `tests/unit/` and `openclaw_runtime/src/runtime-core/`). Specific files to create or modify:

1. **Dev slice + cache:** New helper for stratified 150-question sampling with retrieval result caching
2. **Context-recall metric:** New metric computation integrated into evaluation report
3. **Error taxonomy:** New LLM classifier + report generator
4. **Generation scaffolds:** Per-category prompt templates in the answer generation step
5. **Judge freeze + sanity check:** Frozen judge config + sanity check utility
6. **Extraction hardening:** Retry + logging in the extraction pipeline
7. **Session summary index:** New write-time summarization + session-level retrieval track
8. **Escalation ladder:** Abstention detection + 3-level context assembly
9. **Sequential self-ask:** Answer-substitution implementation replacing parallel decomposition

### Test Deliverables

- Unit tests for all new modules (Vitest, following existing patterns in `tests/unit/`)
- Typecheck passing (`pnpm run typecheck`)
- Full 500-question evaluation run at Stage 1 end and Stage 2 end

### Report Deliverables

Final evaluation report at `artifacts/runtime-memory-eval/locomo-full-500-report.json` with:
- Version: `9.0-stage1-instruments` (Stage 1 end) / `10.0-stage2-adaptive-retrieval` (Stage 2 end)
- All metrics: J Score (overall + per-category), context-recall (overall + per-category), legacy R@5, error taxonomy buckets, escalation rate, $/run
- Comparison table updated with new entry
- 20 sample results (5 per category) for manual inspection

---

## VI. Important Notes

- **Read the plan file first** when starting implementation: `c:\Users\27933\Desktop\clawx\ClawX\.trae\documents\Fable-Architecture-Analysis.md` (Fable's own diagnosis) — it contains the detailed reasoning behind these stages
- **The end-state target is 62-67%** (calibrated from Fable's original 65-70% projection). If Stage 2 reaches 64%+, that is success.
- **Instruments before surgery** — Stage 1 must complete before Stage 2 begins. Every Stage 2 design choice (gate threshold, escalation depth, session count) must be validated on the 25-minute dev slice.
- **Honest measurement** — If a stage underdelivers, report it honestly. A 60% J with trustworthy instruments is more valuable than a 65% J with broken steering.
- **Provenance preserved** — The raw conversation log remains ground truth; memory is an additive index over it. Never delete original facts during dedup/merge (Stage 3 concern, but principle holds from Stage 1).

---

## VII. Acceptance Criteria

| Criterion | Stage 1 | Stage 2 |
|-----------|---------|---------|
| J Score (overall) | 60-63% | 64-68% |
| temporal J | ≥ 64% | ≥ 66% |
| single_hop J | 61-63% | 66-70% |
| multi_hop J | ≥ 42% (no regression) | ≥ 55% |
| open_domain J | ≥ 66% (no regression) | ≥ 68% |
| Iteration cycle | ≤ 30 min (dev slice) | ≤ 30 min (dev slice) |
| Cost per full run | ~$0.50-1 | ≤ $8 |
| Context-recall operational | ✅ | ✅ |
| Error taxonomy operational | ✅ | ✅ |
| Escalation ladder operational | — | ✅ |
| Sequential self-ask operational | — | ✅ |
| Typecheck passing | ✅ | ✅ |
| Unit tests passing | ✅ | ✅ |

**If J < target but instruments are operational and taxonomy is trusted, that is acceptable** — we will use the instruments to diagnose and iterate. A trustworthy 60% is better than an untrustworthy 65%.

---

*This prompt was prepared by the project maintainer for implementation of architecture improvements on a personal learning project. All data derives from public LoCoMo benchmark evaluation results. The work involves generic memory system engineering (retrieval, generation, evaluation) with no commercial intent and no impact on any third-party platform.*

---

## Appendix A — Project Structure Reference

**Read this first to avoid guessing file locations.** All paths are absolute from the project root.

### Key Files to Modify

| Path | Purpose | What to Add |
|------|---------|-------------|
| `tests/unit/runtime-memory-locomo-full-500.test.ts` | Main 500-question evaluation test | Stage 1 dev slice, context-recall metric, error taxonomy, generation scaffolds, judge freeze; Stage 2 session track, escalation ladder, sequential self-ask. **This is the central integration point.** |
| `openclaw_runtime/src/runtime-core/memory-extraction-prompt.ts` | Fact extraction prompt builder | Stage 1.6 hardening (retry on parse failure, rolling entity list across chunks) |

### Helper Modules Directory: `tests/unit/helpers/`

**Existing helpers (read before modifying):**

| File | Exports | Reuse for |
|------|---------|-----------|
| `runtime-memory-real-llm-client.ts` | `callDeepSeek(system, user, options)`, `hasDeepSeekKey()`, `LlmResponse` type | All LLM calls (taxonomy classifier, generation scaffolds, abstention detection, self-ask, session summaries) |
| `siliconflow-embedding-provider.ts` | `createSiliconFlowEmbeddingProvider()`, `hasSiliconFlowKey()` | Session summary embeddings (Stage 2.1) |
| `episodic-memory.ts` | `EpisodicMemory` class, `formatEpisodicBlock()`, `buildDualTrackPrompt()`, `CONTEXT_WINDOW`, `IngestTurn` type | Session track should follow this pattern (parallel to Episodic + Semantic) |
| `justifier-rerank.ts` | `rerankWithJustifier()`, `applyRerank()`, `JustifierCandidate`, `JustifierResult` types | Reference for rerank interface design; cross-encoder follows the same `JustifierResult` shape |
| `cross-encoder-rerank.ts` | `rerankWithCrossEncoder()` | Pair-wise rerank, already integrated |
| `question-decomposer.ts` | `decomposeQuestion()` | **Delete** in Stage 2.3, replaced by sequential self-ask |
| `query-time-extractor.ts` | `extractQueryTimeConstraint()` | Temporal scaffold (Stage 1.4) — reference for date formatting |
| `locomo-date-parser.ts` | `parseLocomoDateTime()`, `extractSessionDates()` | Session summary generation (Stage 2.1) |

### Runtime Core Directory: `openclaw_runtime/src/runtime-core/`

**Existing modules (read before modifying):**

| File | Exports | Reuse for |
|------|---------|-----------|
| `memory-hybrid-retrieval.ts` | `HybridSearchIndex`, `buildHybridSearchIndex()`, `OPTIMAL_HYBRID_FUSION`, `HybridSearchHit` type | Session track should integrate with this; Stage 2.3 **remove** `chainedRetrievalExpand` usage |
| `memory-temporal-detector.ts` | `detectQueryTemporalMode()`, `isMultiHopQuestion()` | Sequential self-ask gate (Stage 2.3); escalation gate (Stage 2.2) |
| `memory-chained-retrieval.ts` | `chainedRetrievalExpand()` | **Delete usage** in Stage 2.3 (mathematically cannot surface, see diagnosis) |
| `memory-extraction-prompt.ts` | `buildExtractionSystemPrompt()`, `buildExtractionUserPrompt()`, `parseExtractionResponse()` | Stage 1.6 hardening |
| `memory-entity-extraction.ts` | `buildEntityRelationMap()` | Already used; do not modify |
| `memory-user-profile.ts` | `buildUserProfile()`, `selectProfileDimensions()`, `UserProfile` type | **Do not use** in Stage 1-2 (deprecated per diagnosis) |
| `memory-profile-retrieval.ts` | `buildProfileContextString()` | **Do not use** in Stage 1-2 |
| `memory-embedding-provider.ts` | `RuntimeEmbeddingProvider` interface | Session summary embedding |

### Cache and Artifact Paths

| Path | Purpose | Notes |
|------|---------|-------|
| `artifacts/runtime-memory-eval/locomo-full-500-report.json` | Final evaluation report | Overwrite on each full run |
| `artifacts/runtime-memory-eval/extracted-facts-cache-v2.json` | Fact extraction cache (incremental) | Preserve; Stage 1.6 adds retry but keeps this cache |
| `tests/fixtures/locomo/locomo10_raw.json` | Raw LoCoMo dataset (10 conversations) | Read-only input |
| `tests/fixtures/locomo/extracted-facts-cache.json` | Old cache (v1) | **Do not use**, already deprecated |

### New Files to Create

| Path | Purpose |
|------|---------|
| `tests/unit/helpers/dev-slice-cache.ts` | Stage 1.1 dev slice + retrieval result cache |
| `tests/unit/helpers/context-recall.ts` | Stage 1.2 context-recall metric |
| `tests/unit/helpers/error-taxonomy.ts` | Stage 1.3 4-bucket error classifier |
| `tests/unit/helpers/generation-scaffolds.ts` | Stage 1.4 per-category generation prompt templates |
| `tests/unit/helpers/judge-sanity-check.ts` | Stage 1.5 judge sanity check utility |
| `tests/unit/helpers/session-summary-index.ts` | Stage 2.1 session summary generation + retrieval track |
| `tests/unit/helpers/escalation-ladder.ts` | Stage 2.2 abstention-gated escalation |
| `tests/unit/helpers/sequential-self-ask.ts` | Stage 2.3 sequential answer-substitution self-ask |
| `tests/unit/dev-slice.test.ts` | Stage 1.1 unit tests for dev slice sampling + cache |
| `tests/unit/context-recall.test.ts` | Stage 1.2 unit tests for context-recall metric |
| `tests/unit/error-taxonomy.test.ts` | Stage 1.3 unit tests for 4-bucket classifier |
| `tests/unit/generation-scaffolds.test.ts` | Stage 1.4 unit tests for scaffold templates |
| `tests/unit/session-summary-index.test.ts` | Stage 2.1 unit tests |
| `tests/unit/escalation-ladder.test.ts` | Stage 2.2 unit tests |
| `tests/unit/sequential-self-ask.test.ts` | Stage 2.3 unit tests |

---

## Appendix B — Implementation Specs

### B.1 Dev Slice + Cache (Stage 1.1)

**Cache file path:** `artifacts/runtime-memory-eval/dev-slice-cache.json`

**Cache JSON schema:**
```json
{
  "version": "9.0-dev-slice",
  "sampleSeed": 42,
  "sampleSizes": { "single_hop": 82, "temporal": 31, "multi_hop": 28, "open_domain": 9 },
  "questions": [
    {
      "questionId": "conv-43_q0",
      "category": "temporal",
      "conversationId": "conv-43",
      "question": "...",
      "groundTruth": "...",
      "retrievalCache": {
        "queryEmbedding": [0.1, 0.2, ...],
        "hybridHits": [
          { "factId": "...", "rrfScore": 0.45, "bm25Rank": 1, "vectorRank": 2, "entityRank": null }
        ],
        "episodicHits": [
          { "sentence_id": "...", "rrfScore": 0.38, "turn_id": "...", "session_id": "..." }
        ],
        "episodicContext": "[...]",
        "profileContext": ""
      }
    }
  ]
}
```

**Runner logic:**
- Default: load cache → skip retrieval → run generation + judge + metrics only
- `--full` flag or cache miss: full retrieval → write cache → run generation
- Cache invalidation: bump `version` field when retrieval pipeline changes

### B.2 Context-Recall Metric (Stage 1.2)

**Precise definition:**

For each question, given:
- `assembledContext`: the final context string passed to the answer generator (episodic block + semantic facts + profile, post-rerank, post-assembly)
- `goldEvidence`: `qa.evidence[]` from the LoCoMo dataset (array of gold evidence strings)

```typescript
function computeContextRecall(
  assembledContext: string,
  goldEvidence: string[],
): number {
  if (goldEvidence.length === 0) return 1.0; // no gold evidence to find
  const contextLower = assembledContext.toLowerCase();
  let fullMatches = 0;
  let partialMatches = 0;
  for (const gold of goldEvidence) {
    const goldLower = gold.toLowerCase();
    const goldWords = goldLower.split(/\s+/).filter((w) => w.length > 3);
    if (goldWords.length === 0) continue;
    const matchedWords = goldWords.filter((w) => contextLower.includes(w));
    const matchRatio = matchedWords.length / goldWords.length;
    if (matchRatio >= 0.8) fullMatches += 1.0;
    else if (matchRatio >= 0.4) partialMatches += 0.5;
  }
  return (fullMatches + partialMatches) / goldEvidence.length;
}
```

**Report integration:** Add `context_recall` field at both `metrics.overall` and `metrics.byCategory[cat]` levels, alongside existing `j_score` and `recall_at_5`.

### B.3 Error Taxonomy Classifier (Stage 1.3)

**LLM classifier prompt (system):**
```
You are a failure-mode classifier for a memory-augmented QA system. Given a question, the assembled context, the generated answer, the gold answer, and the judge's verdict, classify the failure into exactly one bucket:

- not_retrieved: The gold evidence is NOT present in the assembled context. The generator could not have answered correctly because the information was never retrieved.
- retrieved_not_used: The gold evidence IS present in the assembled context, but the generator did not use it. The answer either ignores the relevant evidence or cites irrelevant parts.
- used_but_misreasoned: The generator used the correct evidence but reasoned incorrectly (e.g., wrong date arithmetic, wrong entity inference, wrong aggregation).
- judge_error: The generated answer is actually correct and matches the gold answer, but the judge marked it wrong. This is a judge false-negative.

Respond with ONLY a JSON object: {"bucket": "<one of the four>", "reason": "<one short sentence>"}
```

**User prompt template:**
```
Question: {question}

Assembled Context:
{assembledContext}

Generated Answer: {predictedAnswer}
Gold Answer: {groundTruth}
Judge Verdict: {judgeScore === 1 ? "correct" : "incorrect"}

Classify the failure bucket:
```

**Only run on wrong answers** (judgeScore === 0). Skip correct answers. Cost: ~1 LLM call per wrong dev-slice answer (~50-70 calls for 150-question dev slice at 60% accuracy).

**Report integration:** Add `errorTaxonomy` field to report:
```json
{
  "errorTaxonomy": {
    "overall": { "not_retrieved": 23, "retrieved_not_used": 12, "used_but_misreasoned": 18, "judge_error": 5 },
    "byCategory": {
      "temporal": { "not_retrieved": 4, "retrieved_not_used": 2, "used_but_misreasoned": 8, "judge_error": 1 }
    }
  }
}
```

### B.4 Per-Category Generation Scaffolds (Stage 1.4)

**Integration point:** Replace the current `generateDualTrackAnswer()` function with a category-aware version.

**Temporal scaffold (system prompt):**
```
You are answering a temporal question about a past conversation. Follow these steps EXACTLY:

1. LIST DATES: Extract every date mentioned in the context, both absolute (e.g., "2023-05-14") and relative (e.g., "five years ago", "last month").
2. COMPUTE OFFSETS: For each relative date, compute the absolute date using the session date shown in the evidence header. Show your work: "[evidence said on 2023-07-16] 'five years ago' → 2023 - 5 = 2018".
3. ANSWER: Provide the final answer as a single, concise value (year, date, or date range).

Never say "I don't know" or abstain. If uncertain, give your best estimate based on the available evidence.
```

**Single_hop scaffold (system prompt):**
```
You are answering a single-hop question about a specific fact from a past conversation. The answer should be a single, concise value directly extracted from the context.

Rules:
- Cite the source: "Based on [episodic/semantic] memory, ..."
- Provide only the answer value, no unnecessary elaboration.
- If evidence is weak or partial, still provide the best-guess answer. Never abstain.
- Format dates as the gold answer likely expects: "2018" not "the year 2018 CE".
```

**Multi_hop scaffold (system prompt):**
```
You are answering a multi-hop question that requires connecting information across multiple conversation turns or sessions.

Steps:
1. Identify each hop required to answer the question.
2. For each hop, state the sub-question and the sub-answer found in the context.
3. Synthesize the final answer by combining all sub-answers.

Example:
- Hop 1: "Who did Caroline meet at the support group?" → Alice
- Hop 2: "Where does Alice work?" → Acme Corp
- Final: Caroline met Alice at the support group, and Alice works at Acme Corp.

Provide a concise final answer. Never abstain.
```

**Open_domain scaffold (system prompt):**
```
You are answering an open-ended question about a person or topic from past conversations. Aggregate all relevant information from the context.

Rules:
- Collect ALL relevant facts from both episodic and semantic memory.
- Synthesize a coherent summary; do not just list facts.
- If specific details are missing, acknowledge what is known and provide the best overall answer.
- Never abstain.
```

### B.5 Judge Sanity Check (Stage 1.5)

**Judge freeze config:** Document in report metadata:
```json
{
  "judgeConfig": {
    "model": "deepseek-chat",
    "temperature": 0,
    "promptVersion": "frozen-v1-2026-07-02",
    "promptTemplate": "<exact text>"
  }
}
```

**Sanity check procedure:**
1. Sample 50 judge-incorrect answers from the dev slice
2. For each, manually compare `predictedAnswer` vs `groundTruth`
3. Classify as: `truly_wrong` (judge correct) or `actually_correct` (judge wrong)
4. Compute judge false-negative rate = `actually_correct / 50`
5. If rate > 15%, flag for judge prompt review

**Deliverable:** Sanity check report at `artifacts/runtime-memory-eval/judge-sanity-check.json` with per-sample classification.

### B.6 Extraction Hardening (Stage 1.6)

**Modify** `extractFactsFromConversation()` in `runtime-memory-locomo-full-500.test.ts`:

```typescript
// On parse failure (parseExtractionResponse returns [] or throws):
// - Log the chunk number, conversation ID, and raw response length
// - Retry once with a "Please respond with ONLY a JSON array" prefix
// - If retry also fails, skip chunk but track failure count

const MAX_PARSE_RETRIES = 1;
let parseAttempts = 0;
let facts: ExtractedFact[] = [];
while (parseAttempts <= MAX_PARSE_RETRIES) {
  try {
    const response = await callLLM(system, user, { temperature: 0, maxTokens: 4096 });
    facts = parseExtractionResponse(response.content);
    if (facts.length > 0 || parseAttempts === MAX_PARSE_RETRIES) break;
    // Empty result — retry with stricter prompt
    user = "Please respond with ONLY a JSON array. No markdown, no preamble.\n\n" + user;
  } catch (err) {
    console.log(`[Extraction] ${conversationId} chunk ${chunkNum} parse attempt ${parseAttempts + 1} failed: ${(err as Error).message}`);
  }
  parseAttempts++;
}
if (facts.length === 0) {
  parseFailures.push({ conversationId, chunkNum, totalChunks });
}

// Track success rate
const parseSuccessRate = 1 - (parseFailures.length / totalChunks);
if (parseSuccessRate < 0.95) {
  console.log(`[Extraction] WARNING: parse success rate ${parseSuccessRate * 100}% < 95%`);
}
```

**Rolling entity list across chunks:** Pass previously-extracted entity names into the next chunk's extraction prompt so the LLM can resolve pronouns and aliases. Accumulate `seenEntities: Set<string>` and prepend to the system prompt: "Previously mentioned entities: Alice, Bob, Caroline..."

### B.7 Session Summary Index (Stage 2.1)

**Session summary generation prompt (system):**
```
You are summarizing a conversation session for a memory system. Produce a 3-5 sentence summary covering:
1. The session date (if mentioned)
2. Key entities mentioned (people, places, organizations)
3. Important events, decisions, or facts shared

Keep it factual. No speculation.
```

**Session summary user prompt:**
```
Session date: {sessionDate}
Conversation:
{sessionText}
```

**Session summary storage:** Add a new `SessionSummaryIndex` class (parallel to `EpisodicMemory`):
```typescript
class SessionSummaryIndex {
  private summaries: Array<{
    conversationId: string;
    sessionId: string;
    sessionDate: number;
    summary: string;
    embedding: Float32Array;
  }>;

  async buildFromConversation(
    conversationId: string,
    turns: IngestTurn[],
    embeddingProvider: RuntimeEmbeddingProvider,
    callLLM: typeof callDeepSeek,
  ): Promise<void>;

  async search(
    query: string,
    queryEmbedding: Float32Array,
    topK: number,
  ): Promise<Array<{ conversationId: string; sessionId: string; summary: string; score: number }>>;
}
```

**Integration:** In `processQuestion()`, after episodic + semantic retrieval, also run session summary retrieval. If session-level retrieval score > threshold (tune on dev slice), include the whole session's raw text in the context assembly.

**Whole session raw text retrieval:** Store `turnsBySession: Map<string, LocomoTurn[]>` at index-build time. When a session is retrieved, look up its raw turns and include them in the context.

### B.8 Escalation Ladder (Stage 2.2)

**Abstention detection mechanism:**

After the generator produces an answer, check for an internal abstention signal. The generator is instructed to prefix its response with `[EVIDENCE_INSUFFICIENT]` if it cannot answer (this prefix is stripped before the final answer is submitted to the judge).

**Generator prompt addition (for Level 0):**
```
If the provided context does not contain enough information to answer the question, begin your response with "[EVIDENCE_INSUFFICIENT]" followed by your best-guess attempt. The prefix will be removed internally; the final answer must still be your best guess.
```

**Escalation logic:**
```typescript
async function processWithEscalation(item, conversationId): Promise<Result> {
  // Level 0: Fragment retrieval (current pipeline)
  let context = assembleFragmentContext(finalHits, episodicContext, profileContext);
  let answer = await generateAnswer(item.qa.question, context, category);

  if (!answer.startsWith("[EVIDENCE_INSUFFICIENT]")) {
    return { answer, escalationLevel: 0, context };
  }

  // Level 1: Top-2 full sessions
  const sessionHits = await sessionIndex.search(item.qa.question, queryEmbedding, 2);
  const sessionTexts = sessionHits.map(h => getWholeSessionText(h.conversationId, h.sessionId)).join("\n\n");
  context = sessionTexts + "\n\n" + context; // prepend sessions to existing fragments
  answer = await generateAnswer(item.qa.question, context, category);

  if (!answer.startsWith("[EVIDENCE_INSUFFICIENT]") || escalationCount >= MAX_ESCALATIONS) {
    return { answer, escalationLevel: 1, context };
  }

  // Level 2: Full conversation
  const fullConversation = getWholeConversationText(conversationId);
  context = fullConversation; // replace entirely with raw log
  answer = await generateAnswer(item.qa.question, context, category);

  return { answer, escalationLevel: 2, context };
}

const MAX_ESCALATIONS = Math.floor(sampled.length * 0.40); // cap at 40%
```

**Cost tracking:** Count LLM calls per escalation level. Log `escalationRate` and `costPerRun` in the report.

### B.9 Sequential Self-Ask (Stage 2.3)

**Decomposition prompt (system):**
```
You are decomposing a multi-hop question into 2 sequential sub-questions. The second sub-question may depend on the answer to the first.

Rules:
- Output exactly 2 sub-questions (or 1 if the question is actually single-hop).
- Sub-question 2 may contain a placeholder [ANSWER_TO_HOP_1] that will be replaced with the hop-1 answer.
- Output format: JSON array of strings. No preamble, no markdown.

Example:
Question: "Where does the friend Caroline met at the support group work?"
Output: ["Who did Caroline meet at the support group?", "Where does [ANSWER_TO_HOP_1] work?"]
```

**Hop-1 answer extraction:**
```typescript
async function answerSubQuestion(
  subQuestion: string,
  conversationId: string,
): Promise<{ answer: string; evidence: HybridSearchHit[] }> {
  const sqEmbArr = await withRetry(() => embeddingProvider.embedQuery(subQuestion));
  const sqHits = index.searchWithEmbedding(
    subQuestion,
    new Float32Array(sqEmbArr),
    5,
    OPTIMAL_HYBRID_FUSION,
  );
  const sqFacts = sqHits.map(h => h.fact);
  const sqAnswer = await callDeepSeek(
    "Answer the question with a single concise value (entity name, date, or short phrase). No preamble.",
    `Question: ${subQuestion}\nContext: ${sqFacts.map(f => f.objectSummary).join("; ")}`,
    { temperature: 0, maxTokens: 50 },
  );
  return { answer: sqAnswer.content.trim(), evidence: sqHits };
}
```

**Answer substitution + hop-2:**
```typescript
async function sequentialSelfAsk(question: string, conversationId: string): Promise<{
  finalContext: HybridSearchHit[];
}> {
  // 1. Decompose
  const subQuestions = await decomposeQuestion(question);
  if (subQuestions.length <= 1) {
    return { finalContext: [] }; // not actually multi-hop, fall back to normal retrieval
  }

  // 2. Hop 1: answer + collect evidence
  const hop1 = await answerSubQuestion(subQuestions[0], conversationId);

  // 3. Substitute hop-1 answer into hop-2 query
  const hop2Question = subQuestions[1].replace("[ANSWER_TO_HOP_1]", hop1.answer);

  // 4. Hop 2: retrieve with substituted query + collect evidence
  const hop2EmbArr = await withRetry(() => embeddingProvider.embedQuery(hop2Question));
  const hop2Hits = index.searchWithEmbedding(
    hop2Question,
    new Float32Array(hop2EmbArr),
    10,
    OPTIMAL_HYBRID_FUSION,
  );

  // 5. Merge evidence (deduplicate by factId)
  const seen = new Set<string>();
  const merged: HybridSearchHit[] = [];
  for (const hit of [...hop1.evidence, ...hop2Hits]) {
    if (!seen.has(hit.fact.factId)) {
      seen.add(hit.fact.factId);
      merged.push(hit);
    }
  }
  return { finalContext: merged.slice(0, 10) };
}
```

**Integration:** Replace the `decomposeQuestion` + parallel retrieval block in `processQuestion()`. **Delete** the `chainedRetrievalExpand` fallback (Stage 2.3 removes this entirely).

---

## Appendix C — Verification Commands

### Typecheck
```bash
pnpm run typecheck
```
Runs `tsc --noEmit` on both node and web projects. Must pass with zero errors.

### Unit Tests
```bash
pnpm test
```
Runs `vitest run` on all `tests/unit/**/*.test.ts` files. Skips LLM-requiring tests when `hasDeepSeekKey()` returns false (gated by `describe.skipIf(!hasDeepSeekKey())`).

**For specific new modules:**
```bash
pnpm exec vitest run tests/unit/dev-slice.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/context-recall.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/error-taxonomy.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/generation-scaffolds.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/session-summary-index.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/escalation-ladder.test.ts --reporter=verbose
pnpm exec vitest run tests/unit/sequential-self-ask.test.ts --reporter=verbose
```

### Dev Slice Evaluation (fast, ~25-30 min)
```bash
# No --full flag: uses cached retrieval results
$env:RUNTIME_MEMORY_REAL_LLM="1"
$env:DEEPSEEK_API_KEY="<key>"
$env:SILICONFLOW_API_KEY="<key>"
pnpm exec vitest run tests/unit/runtime-memory-locomo-full-500.test.ts --reporter=verbose
```

If dev slice cache does not exist, the first run will build it (full retrieval + cache write). Subsequent runs use the cache.

### Full 500-Question Evaluation (~120 min + LLM calls)
```bash
$env:RUNTIME_MEMORY_REAL_LLM="1"
$env:DEEPSEEK_API_KEY="<key>"
$env:SILICONFLOW_API_KEY="<key>"
# To force full retrieval (bypass dev slice cache):
$env:FULL_EVAL="1"
pnpm run eval:runtime-memory:locomo:full500
```

The `FULL_EVAL=1` env var bypasses the dev slice cache and runs full retrieval on all 500 questions.

### Judge Sanity Check
```bash
# Run after a dev slice evaluation to check judge false-negative rate
$env:RUNTIME_MEMORY_REAL_LLM="1"
$env:DEEPSEEK_API_KEY="<key>"
pnpm exec vitest run tests/unit/judge-sanity-check.test.ts --reporter=verbose
```
Outputs to `artifacts/runtime-memory-eval/judge-sanity-check.json`.

### Environment Variables Reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `RUNTIME_MEMORY_REAL_LLM` | Yes (`"1"`) | Gate for real LLM calls (vs. skipped tests) |
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API authentication |
| `SILICONFLOW_API_KEY` | Yes | SiliconFlow (Qwen3-Embedding-8B) authentication |
| `FULL_EVAL` | No (`"1"` to force) | Bypass dev slice cache, run full 500-question retrieval |
| `P3_RERANKER` | No (`"cross-encoder"` default) | Reranker choice: `cross-encoder` / `justifier` / `none` |
| `P3_MULTIHOP` | No (`"decompose"` default) | Multi-hop strategy: `decompose` / `chained` / `none` (Stage 2.3 changes default to `sequential-self-ask`) |

### Report Inspection

After each evaluation, inspect the report:
```bash
# Read the final report
# (use your editor or file reader — the report is at:)
# artifacts/runtime-memory-eval/locomo-full-500-report.json

# Check judge sanity check
# artifacts/runtime-memory-eval/judge-sanity-check.json
```

---

*This prompt was prepared by the project maintainer for implementation of architecture improvements on a personal learning project. All data derives from public LoCoMo benchmark evaluation results. The work involves generic memory system engineering (retrieval, generation, evaluation) with no commercial intent and no impact on any third-party platform.*
