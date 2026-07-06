# Architecture Consultation Prompt for Fable

## Project Background Declaration (Important Preface)

This project is a **secondary development of an open-source project**, undertaken solely as a **personal development and learning endeavor**. It does not involve any commercial product, third-party domain knowledge, or protected content. What we are studying is an **engineering architecture problem of memory systems** — a generic software engineering topic that falls within publicly available academic research directions (LoCoMo benchmark, long-term conversational memory). All datasets (LoCoMo) are public academic benchmarks, and all referenced competitor scores (Mem0, Zep, LangMem, etc.) come from their publicly published papers.

We do not involve any sensitive, copyright-protected, or proprietary domain knowledge. The requested output is **generic architecture design advice** that does not target any specific product or service.

---

## I. What Our System Is

We are building a **long-term conversational memory system** as a personal learning project — a secondary development on top of an open-source AI agent framework. The system's core responsibility: extract structured facts from multi-turn dialogues, retrieve relevant facts based on user questions in subsequent sessions, and feed them as context to an LLM for answer generation.

### Evaluation Method

We use the public **LoCoMo benchmark** (10 long conversations × 1986 QAs, stratified sample of 500 questions for evaluation) to measure system quality. Metrics are **J Score** (LLM-as-Judge accuracy) and **Recall@5** (top-5 retrieval recall).

### Current Performance

| Category | Our J Score | Our Recall@5 | Top-tier J (estimated) | Gap |
|----------|------------|--------------|----------------------|-----|
| Overall | **56.20%** | 42.73% | 85-90% | ~30pp |
| temporal | 54.00% | 57.67% | ~88% | ~34pp |
| multi_hop | **42.71%** | **17.96%** | ~88% | **~45pp (largest gap)** |
| single_hop | 59.06% | 37.62% | ~88% | ~29pp |
| open_domain | 66.14% | 48.94% | ~85% | ~19pp |

### Position in the Leaderboard

| Rank | Model | J Score | Notes |
|------|-------|---------|-------|
| 1 | Backboard | 90.00% | Top-tier |
| 2 | Hindsight_Gemini3 | 89.61% | Top-tier |
| 3 | Hindsight_OSS120B | 85.67% | Top-tier |
| 5 | Memobase | 75.78% | First tier |
| 6 | Zep | 75.14% | First tier |
| 7 | Mem0_Graph | 68.44% | Upper-middle |
| 8 | Mem0 | 66.88% | Upper-middle |
| 9 | LangMem | 58.10% | Middle tier |
| **10** | **ours** | **56.20%** | **Our current position** |
| 11 | OpenAI_no_memory | 52.90% | No-memory baseline |

**Key judgment**: We have just surpassed the no-memory baseline, approaching LangMem, but still have an **11pp gap** to the first tier (Mem0 series at 67-68%) and a **27-34pp gap** to the top tier (Hindsight/Backboard at 85-90%).

---

## II. Our Current Architecture

### Retrieval Pipeline (Question → Answer)

```
User Question
  ↓
[1] Query Time Extractor — Parse time constraints from question text (absolute dates / relative time)
  ↓
[2] Temporal Mode Detector — Classify into filter / boost / strict temporal modes
  ↓
[3] Query Embedding — Qwen3-Embedding-8B (SiliconFlow API) generates query vector
  ↓
[4] Hybrid Search (dual-track parallel)
  ├─ Track A: Episodic Track (raw sentence-level)
  │   ├─ BM25 ranking (sentence-level)
  │   ├─ Vector ranking (sentence-level cosine)
  │   ├─ RRF fusion (k=60)
  │   ├─ Time filtering (based on query time constraint)
  │   └─ Contextualization (±2 sentence context expansion)
  └─ Track B: Semantic Track (structured fact-level)
      ├─ BM25 ranking (field-weighted: subject×3, predicate×2, objectSummary×1)
      ├─ Vector ranking (embedding cosine)
      ├─ Entity ranking (Jaccard similarity, proper noun/number sets)
      └─ RRF fusion (k=0, normalizeByPathCount=true, wBm25=0.5, wVector=1.0, wEntity=0.5)
  ↓
[5] Post-filter — temporal filter (exclude valid_at > referenceTime) + confidence threshold
  ↓
[6] Temporal Boost — boost mode: time-decay weighting (1 + 0.1 × exp(-Δt/30d))
  ↓
[7] Multi-hop Handling
  ├─ if multi_hop: Question Decomposition → independent sub-question retrieval → RRF merge
  └─ else: direct hybrid search results
  ↓
[8] Cross-Encoder Rerank — batch pair-wise LLM scoring (DeepSeek, 5 candidates per batch)
  ↓
[9] Context Assembly — Episodic context + Semantic facts + (open_domain: UserProfile)
  ↓
[10] Answer Generation — DeepSeek generates answer
  ↓
[11] LLM-as-Judge — DeepSeek judges answer correctness (J Score)
```

### Write Pipeline (Dialogue → Facts)

```
Raw dialogue (multi-turn, each turn contains speaker/text/timestamp)
  ↓
[A] Chunking — Split by 30 turns per chunk
  ↓
[B] Fact Extraction (LLM call)
  ├─ System Prompt: structured schema constraints + few-shot examples + negative examples
  ├─ Output: [{subject, predicate, objectSummary}] JSON array
  └─ Time normalization: relative time → absolute dates (based on sessionDate)
  ↓
[C] Deduplication — objectSummary case-insensitive dedup
  ↓
[D] Storage
  ├─ Facts store (subject/predicate/objectSummary/valid_at/reference_time)
  ├─ Entity Relation Graph (buildEntityRelationMap, 9,393-35,753 relations per conversation)
  └─ Episodic Index (sentence-level BM25 + Vector, 1,103-2,058 sentences per conversation)
  ↓
[E] UserProfile construction (tried v1 replace / v2 augment, neither brought improvement)
```

### Data Scale

| Metric | Value |
|--------|-------|
| Number of conversations | 10 |
| Total turns | ~5,882 |
| Total facts (after extraction) | 2,403 |
| Total episodic sentences | ~16,000+ |
| Total entity relations | ~181,914 |
| Embedding dimensions | 4,096 (Qwen3-Embedding-8B) |
| LLM | DeepSeek (extraction/generation/judge), temp=0 |
| Extraction density | ~0.5-0.7 facts per turn |

---

## III. Optimizations We Have Implemented and Their Effects

| Phase | Improvement | J Score Change | Key Finding |
|-------|------------|----------------|-------------|
| Phase 4.2 | Baseline | 39.80% | — |
| Phase 5.0 | +P0 Dual-track memory (Episodic + Semantic) | +8.2pp → 48.00% | Raw sentence preservation avoided extraction information loss |
| Phase 6.0 | +P2 Temporal independent retrieval track | +1.2pp → 49.20% | temporal +7.99pp but Recall@5 regressed -5.5pp |
| Phase 6.1 | +P1 Justifier LLM list-wise reranking | ~0pp → ~49% | list-wise reranking almost ineffective |
| Phase 8.0 | +P3-A Cross-Encoder pair-wise + P3-B Question decomposition + re-extraction | **+7.0pp → 56.20%** | Achieved 55% target, but multi_hop still weakest |

### Details of Each Optimization

**Effective improvements**:
1. **Dual-track memory (P0)**: Episodic raw sentences + Semantic structured facts in parallel retrieval, +8.2pp (largest single improvement)
2. **Cross-Encoder pair-wise reranking (P3-A)**: Batch mode, 5 candidates per LLM call, more precise than list-wise Justifier
3. **Temporal independent retrieval track (P2)**: Extract time constraints from question text, filter episodic sentences
4. **Reduced chunk size (P3-B)**: 100→30, extraction density from 0.3→0.5-0.7 facts per turn
5. **Structured extraction prompt**: Schema constraints + few-shot + negative examples

**Ineffective or regressive improvements**:
1. **Justifier list-wise reranking (P1)**: Single LLM call to score all candidates, almost no improvement
2. **UserProfile layer (v1/v2)**: v1 replace caused open_domain to drop from 53.54%→47.24%, v2 augment also dropped to 51.18%
3. **MultiQuery query rewriting**: J regressed from 45.2% to 38.6% (introduced noise)
4. **Question decomposition (P3-B)**: multi_hop only +2.1pp (40.63%→42.71%), far below expectation

---

## IV. Known Architecture Defects

### Defect 1: Multi-hop Retrieval is Essentially Ineffective (Recall@5 = 17.96%)

**Symptom**: multi_hop is the worst-performing category across all types, with Recall@5 of only 17.96% (meaning 82% of multi-hop questions fail to find critical facts).

**Current approaches and why they fail**:
- **Chain retrieval (chainedRetrievalExpand)**: Traverses the entity relation graph, but `expansionScore = 1/(60+rank)` produces flat low scores (~0.016), always ranking below initial hits (RRF scores 0.5-1.0), unable to surface
- **Question decomposition (P3-B)**: Splits multi-hop questions into 2-3 sub-questions for independent retrieval, but sub-question retrieval may still miss the bridging fact
- **Entity graph is dense but lacks bridging entities**: 2,403 facts + 181K relations, but cross-session bridging entities (intermediate entities connecting two hops) may still be missing

**Root cause**: The current architecture is "single-pass retrieval + post-processing", lacking true multi-hop reasoning capability. Top-tier models (Hindsight) may use iterative retrieval or graph neural networks.

### Defect 2: open_domain Lacks a Structured Profile Layer

**Symptom**: open_domain at 66.14%, ~19pp gap to top-tier ~85%.

**Current approaches and why they fail**:
- **UserProfile v1/v2 both failed**: v1 (Profile replacing retrieval) caused open_domain to drop 6.3pp; v2 (Profile augmenting retrieval) also dropped 2.4pp
- **Improper Profile dimension selection**: Current selectProfileDimensions uses keyword matching, may select wrong dimensions and introduce noise
- **Memobase's core advantage (77% open_domain)**: Structured Profile allows open-ended questions to be answered directly by aggregating fields, without retrieval

**Root cause**: Our Profile is "an add-on to retrieval", while Memobase's Profile is "the primary answer source". The architectural positioning is wrong.

### Defect 3: Fact Extraction Remains a Bottleneck

**Symptom**: Extraction density 0.5-0.7 facts per turn, still below the 1.0+ target.

**Current approaches and limitations**:
- **chunk=30 + structured prompt**: Already improved density from 0.3 to 0.5-0.7, but still 30-50% information loss
- **No schema validation**: parseExtractionResponse silently swallows parse failures, no quality feedback
- **No cross-chunk context**: Each chunk is extracted independently, may lose cross-chunk entity associations
- **Oversimplified deduplication**: Only deduplicates by objectSummary case-insensitive matching, no semantic dedup

**Root cause**: Single-pass extraction + simple dedup, lacking iterative extraction/merge/quality control.

### Defect 4: Recall@5 is Low (42.73%), Retrieval Precision Insufficient

**Symptom**: Recall@5 went from baseline 44.76% to current 42.73%, no significant improvement.

**Current approaches and limitations**:
- **Cross-Encoder reranking**: More precise than Justifier, but 2,403 facts contain significant noise, diluting critical fact rankings
- **Fixed RRF fusion parameters**: k=0, wBm25=0.5, wVector=1.0, wEntity=0.5 — one-size-fits-all for all questions
- **No fact importance eviction**: All facts stored equally, old/low-quality facts crowd out top-K positions

**Root cause**: Retrieval is "static and one-pass", lacking dynamic pruning, importance scoring, and context-aware retrieval strategies.

### Defect 5: No Cross-session Entity Fusion

**Symptom**: Facts about the same entity across different sessions are isolated.

**Example**:
```
Fact A (session 1): "Caroline attends a support group"
Fact B (session 3): "The support group meets every Thursday"
Fact C (session 5): "Caroline missed the support group this week"
```
Current: Three isolated facts; answering "When does Caroline's support group meet?" requires finding both A+B simultaneously
Should be: Fuse into Composite Fact "Caroline attends a support group that meets every Thursday"

**Root cause**: Lacks a fact merge/fusion mechanism, unable to synthesize composite knowledge from scattered information.

### Defect 6: Temporal Reasoning Relies on LLM Rather Than Systematic Time Reasoning

**Symptom**: temporal at 54%, ~34pp gap to top-tier 88%.

**Current approaches and limitations**:
- **Query Time Extractor**: Can parse absolute dates and relative time, but "five years ago" requires year calculation (involving leap years), limited precision
- **Time filtering**: Filters episodic sentences by timestamp, but cannot handle fuzzy time like "approximately", "around"
- **Remaining 46% errors**: Mainly LLM reasoning insufficiency (e.g., "if Alice said in 2023 'started surfing five years ago', then start year is 2018"), which is a reasoning problem, not a retrieval problem

**Root cause**: Time reasoning is entirely delegated to the LLM; the system layer lacks timeline construction and a reasoning engine.

---

## V. Directions We Tried That Failed (To Avoid Repeating Mistakes)

| Attempt | Result | Lesson |
|---------|--------|--------|
| UserProfile v1 (replace retrieval) | open_domain -6.3pp | Profile cannot replace retrieval, only enhance it |
| UserProfile v2 (augment retrieval) | open_domain -2.4pp | Profile context acts as noise rather than primary answer |
| MultiQuery query rewriting | J -6.6pp (45.2%→38.6%) | Query rewriting introduces noise, dilutes top-K |
| Per-fact conditional fusion | Failed | Dual-path facts get double-weighted by RRF |
| Justifier list-wise reranking | ~0pp | Single LLM call scoring all candidates, attention dispersed |
| Chain retrieval maxDepth=2 | Ineffective | Score decay too fast + entity graph lacks bridging edges |

---

## VI. Our Resource Constraints

- **LLM API**: DeepSeek (cost-sensitive, ~$0.50 per evaluation run, ~347 LLM calls)
- **Embedding API**: SiliconFlow Qwen3-Embedding-8B (dim=4096)
- **No local GPU**: Cannot run local Cross-Encoder models or graph neural networks
- **Personal development**: Limited effort, need high-ROI improvements
- **Evaluation cycle**: ~120 minutes per full 500-question evaluation

---

## VII. Core Questions for Fable to Analyze

Based on the above context, please analyze and answer the following questions from an **engineering architecture mindset** (no need to read any files):

### Question 1: What Are the Fundamental Architectural Shortcomings?

Setting aside specific parameter tuning, from an architectural design perspective, what are the top 3 structural defects of our current system? Why do these defects cause a 30pp gap between us and top-tier models (85-90%)?

### Question 2: Which Direction Should We Bet On?

Considering:
- multi_hop is the largest gap (42.71%, Recall@5=17.96%)
- open_domain has a clear path (Profile layer) but previous attempts failed
- Resources are limited (personal development, no local GPU)

If you could only choose **2 directions** to invest in heavily, which two would you pick? Why? What is the estimated ROI (J Score improvement per unit of effort invested)?

### Question 3: How to Achieve Differentiation?

We cannot fully replicate the architecture of top-tier models (Backboard, Hindsight — they likely use GNN, iterative reasoning, and other resource-intensive approaches). As a personal development project, where can we create **unique and valuable differentiation**? Can these differentiation points form a competitive moat?

### Question 4: What Is the Next Architecture Evolution Roadmap?

Please provide a **3-stage evolution roadmap** (1-2 weeks of personal development per stage), specifying:
- Core changes per stage
- Expected J Score improvement range
- Key technical decision points
- Risks and mitigations

Goal: Progress from current 56.20% toward 65-70% (approaching Mem0 series).

### Question 5: Which Directions Should We Not Invest In?

Based on our failure experience and resource constraints, which seemingly reasonable but actually low-ROI directions should be **explicitly abandoned**? Please provide the reasoning basis.

---

## VIII. Delivery Requirements

### Delivery File

Please write the complete architecture analysis report to the following path:

**`c:\Users\27933\Desktop\clawx\ClawX\.trae\documents\Fable-Architecture-Analysis.md`**

### Delivery Content Structure

The report should contain the following sections:

1. **Executive Summary** (1 page) — Core findings and recommendations TL;DR
2. **Architecture Shortcoming Diagnosis** (answering Question 1) — 3 fundamental defects + root cause analysis
3. **Priority Investment Directions** (answering Question 2) — 2 focus areas + ROI estimation
4. **Differentiation Strategy** (answering Question 3) — Unique value points + competitive moat analysis
5. **3-Stage Evolution Roadmap** (answering Question 4) — Changes/expectations/risks per stage
6. **Explicitly Abandoned Directions** (answering Question 5) — List of directions not to invest in + reasoning
7. **Appendix: Architecture Decision Matrix** — Three-dimensional assessment table (ROI/risk/difficulty) for each improvement direction

### Important Notes

- **No need to read any project files** — Analyze based solely on the information provided in this prompt
- **Apply engineering mindset** — Think at the architecture level, not the parameter tuning level
- **Be honest** — If we cannot achieve differentiation in a certain direction, say so directly
- **Consider resource constraints** — All recommendations must be feasible under "personal development + no local GPU + DeepSeek API" constraints
- **Focus on verifiability** — Every recommendation should have clear verification metrics and evaluation methods

---

*This prompt was prepared by the project maintainer. All data comes from public LoCoMo benchmark evaluation results and is used solely for architecture improvement consultation of a personal learning project.*
