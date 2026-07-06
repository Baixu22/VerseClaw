# Fable Architecture Analysis — Long-Term Conversational Memory System

**Date:** 2026-07-02
**Scope:** Architecture-level consultation based on Phase 8.0 evaluation data (J = 56.20%, Recall@5 = 42.73%, 500-question stratified LoCoMo sample). No project files were read; all analysis derives from the data provided in the consultation prompt.
**Goal:** A credible path from 56.20% to 65–70% J under real constraints: solo developer, DeepSeek API, API embeddings (Qwen3-Embedding-8B), no local GPU, ~$0.50–3 per evaluation run.

---

## 1. Executive Summary

**Finding 1 — Your bottleneck has moved, and your instruments can't see it.**
Retrieval-side work carried you from 39.8% to 56.2%. But the category data now shows inversions that a retrieval-centric mental model cannot explain:

- **temporal** has your *best* recall (R@5 = 57.67%) and near-worst J (54.00%). Retrieval succeeds; the generator fails date arithmetic. This is a generation defect, not a retrieval defect — your own error analysis ("46% of temporal errors are LLM reasoning") already says so.
- **single_hop** has J = 59.06% but R@5 = 37.62%. J exceeding recall by 21pp means Recall@5, as currently defined, does not measure what the answer generator actually consumes. You are steering by a gauge that is disconnected from the engine.
- R@5 *fell* (44.76% → 42.73%) across the exact phases where J rose 16pp.

**Finding 2 — The weighted math contradicts the headline gap.**
LoCoMo's non-adversarial category distribution is approximately: single_hop 54.6%, temporal 20.8%, multi_hop 18.3%, open_domain 6.2% (841/321/282/96 of 1,540). Sanity check: these weights applied to your per-category J predict 55.4% overall vs. your observed 56.2% — consistent. Consequence:

- +8pp on single_hop ≈ **+4.4pp overall**
- +15pp on multi_hop ≈ **+2.7pp overall**
- +12pp on temporal ≈ **+2.5pp overall**
- +8pp on open_domain ≈ **+0.5pp overall**

multi_hop's 45pp gap is the scariest number on your dashboard and only the third most valuable fix. The highest-value work is single_hop recall and temporal generation — together ~75% of the question mass.

**Finding 3 — Three structural defects, one shared theme.**
Your system commits to answering every question from ≤K fine-grained fragments selected in a single pass. Questions that require *assembling* evidence (multi-hop chains, date arithmetic across sessions, aggregation) are structurally unanswerable in that regime at any parameter setting. The three defects (Section 2): (I) single-pass fragment retrieval with granularity inversion, (II) all synthesis deferred to read time — the write path never consolidates, (III) no error-attribution loop.

**Finding 4 — Calibrate the target honestly.**
Hindsight's own two entries differ by 3.94pp (85.67% → 89.61%) with the *same architecture* and different generator models. Generator model class alone is worth several points; top systems also tune answer formatting against the judge. On a DeepSeek-class generator, **65–70% is the realistic ceiling for this architecture generation — which is exactly your stated goal.** Do not benchmark your architecture against Gemini-3-powered systems; benchmark it against Mem0/LangMem-class systems built on commodity models.

**The two bets (Question 2):**

1. **Adaptive retrieval with confidence-gated escalation** (fragments → whole session → whole conversation, plus sequential self-ask for multi-hop): +6–9pp overall, ~1.5 weeks.
2. **Answer-layer overhaul + error-attribution harness** (per-category generation scaffolds, context-recall metric, fast dev slice): +4–6pp overall, ~1 week, and it cuts your iteration cycle from ~120 to ~25 minutes, compounding every later stage.

**Trajectory:** 56.2 → 60–63 (Stage 1) → 64–68 (Stage 2) → 66–71 (Stage 3). Gains overlap; the honest end-state estimate is **65–70**.

---

## 2. Architecture Shortcoming Diagnosis (Question 1)

Setting aside parameters, the system has three structural defects. They are ordered by how much of the 30pp gap they explain.

### Defect I — Single-pass fragment retrieval with granularity inversion

**What it is.** Everything is indexed at the finest granularity you have: sentences (episodic) and atomic facts (semantic). Context is assembled from ≤K such fragments chosen in one ranking pass. The only widening mechanism is ±2 sentences of contextualization — which cannot cross a session boundary, let alone bridge two sessions.

**Evidence from your own numbers.**

- single_hop R@5 = 37.62%. This is the *easy* category — one fact, directly asked. A 62% miss rate on the easy case indicates the index granularity, not the ranking, is wrong: conversational sentences embed poorly in isolation ("Yeah, I finally did it!" carries no retrievable semantics without its neighborhood), and atomic facts lose the phrasing the question will use.
- Your chain retrieval failed for an arithmetic reason, not a conceptual one: expansion hits scored `1/(60+rank)` ≈ 0.016 were merged into a ranking where the semantic track's RRF (k=0) gives top hits 0.33–1.0. Hop-2 candidates were *mathematically incapable* of surfacing. The lesson is not "graph traversal doesn't work"; it's "never merge hop-2 candidates into hop-1's ranking scale."
- Your question decomposition (+2.1pp only) failed for a structural reason: sub-questions were retrieved **in parallel**, but multi-hop sub-question 2 contains an unresolved reference whose value *is the answer to sub-question 1* ("Where does [the friend Caroline met at the support group] work?"). Parallel retrieval cannot resolve a dependency. Decomposition without sequential answer-substitution is decoration.

**Why top systems don't have this defect.** They retrieve coarser episodic units (whole messages, summaries, sessions) and/or iterate. And there is an uncomfortable benchmark fact worth internalizing: a full LoCoMo conversation is roughly 15–40k tokens (your data: 1,103–2,058 sentences per conversation). That fits in a commodity context window. The *worst-case fallback* — "just read the whole log" — is available, and with DeepSeek's prefix caching (the ~50 questions per conversation share an identical conversation prefix), it is cheap. A memory system that cannot degrade to reading the log is strictly worse than one that can. Several strong LoCoMo results are best understood as "dense summarization + large context + good generator," not exotic retrieval.

**Root cause.** Retrieval is treated as a *ranking problem over a fixed index* rather than a *decision process*: what granularity to read, whether one pass sufficed, whether to escalate. There is no feedback edge from "did the generator have enough evidence?" back into retrieval.

### Defect II — All synthesis is deferred to read time; the write path never consolidates

**What it is.** Extraction atomizes dialogue into facts, and that is where write-side intelligence ends. Deduplication is case-insensitive string matching. There is no entity resolution (Caroline = "she" = "my sister" across sessions), no composite-fact construction, no state update/invalidation ("moved to Seattle" should supersede "lives in Portland"). Every act of synthesis is pushed to read time — where you have a top-5 budget, a latency constraint, and a query that matches each fragment only weakly.

**Evidence.** Your Defect 5 example is exactly this: "Caroline attends a support group" + "the group meets Thursdays" are three isolated rows, and answering requires both to independently win top-5 slots against 2,400 competitors. Your UserProfile failures (v1: −6.3pp, v2: −2.4pp) are the same defect in disguise: the profile was bolted onto *read time* as extra context — where it competes with retrieved facts as noise — instead of being a *write-time artifact that directly answers aggregate questions* (which is what makes Memobase's profile work: it is the answer source, routed to, not an augmentation).

**Why it matters.** Write time is where you have unlimited per-fact budget, full conversation context, and zero latency pressure. Zep's bi-temporal graph (entity resolution + edge invalidation) and Memobase's profile slots are both instances of the same principle: **do the synthesis once at write time; benefit on every query.** You currently do it never, so every query pays.

### Defect III — No error attribution; the steering metric doesn't track the target

**What it is.** You have one retrieval metric (R@5) and one outcome metric (J), and they are visibly decoupled: R@5 dropped while J rose 16pp; single_hop J exceeds its R@5 by 21pp; temporal R@5 exceeds its J. This means R@5 is likely measured against something (one track, strict gold matching) other than the assembled context the generator actually reads. There is no per-failure classification.

**Consequence.** Of your eight documented optimization attempts, three clearly worked, four failed or regressed, and each verdict cost a ~120-minute, ~$0.50 full run. You are doing architecture search by coin flip at 2 hours per flip. The absence of an attribution loop is the defect that makes every other defect expensive to fix — you cannot tell whether a wrong answer failed at retrieval, at context assembly, at reasoning, or at judging, so effort is allocated by intuition (which is how a project ends up attacking multi_hop — 18% of the mass — while single_hop recall sits at 38%).

### How these three produce the ~30pp gap to the top tier

A rough decomposition of the 56 → 86 distance:

| Component | Est. share | Defect |
|---|---|---|
| Evidence assembly failures (single_hop misses, multi-hop bridging) | 8–12pp | I, II |
| Temporal reasoning at generation (date arithmetic, no scaffold) | 5–7pp | III (generation layer untuned) |
| Answer formatting / judge alignment | 2–4pp | III |
| Generator model class (DeepSeek vs Gemini-3-tier) | 4–6pp | not fixable — accept it |
| Misallocated effort due to blind iteration | residual | III |

Note the fourth row: 4–6pp of the gap is not yours to close. Plan against 65–70, not 85.

---

## 3. Priority Investment Directions (Question 2)

If only two directions get serious investment, they are these — and deliberately **not** the two your defect list would suggest (multi_hop machinery and the Profile layer).

### Bet A — Adaptive retrieval: escalate in width and depth

Replace "single-pass top-K over fragments" with a decision ladder.

**Components:**

1. **Session-level track (escalation in width).** At write time, produce a 3–5 sentence LLM summary per session (dates, entities, events) — ~200–350 one-time calls across the corpus, trivial cost. Embed the summaries. At read time, retrieval can now return *a session*, and context assembly can include *the whole session's raw text* instead of scattered sentences. This attacks single_hop directly: the question only has to find the right session (easy), not the right sentence (hard).
2. **Confidence-gated escalation.** First pass: current fragment pipeline, but the generator is allowed to signal "insufficient evidence" (internal signal only — never emitted as a final answer, since judges score abstentions as wrong). On that signal: re-answer with top-2 full sessions; if still insufficient: full conversation (15–40k tokens, fits DeepSeek's window; prefix caching makes the per-conversation prefix nearly free after the first question). Expect 20–35% of questions to escalate.
3. **Sequential self-ask for multi_hop (escalation in depth).** Replace parallel decomposition: decompose → retrieve for hop 1 → *answer* hop 1 → substitute that answer into hop 2's query → retrieve → assemble. ~90–120 multi_hop questions × 2 extra calls ≈ 240 cheap calls. Delete the chain-expansion merge entirely (see Defect I — its scores can never surface).

**Expected effect:** single_hop +8–12 on-category, multi_hop +12–20, temporal +3–5 (better context), open_domain +2–4 → **+6–9pp overall.**
**Effort:** ~1.5 weeks. **ROI ≈ 4–6pp per person-week.**
**Cost impact:** ~$1–3 per full run with caching (measure it; cap escalation rate if it drifts).

### Bet B — Answer layer + error-attribution harness

Build the instruments, then tune the last mile they expose.

**Components:**

1. **Fast dev slice.** Fixed, stratified 150-question set with *cached retrieval results*. Iteration cycle: ~120 min → ~25 min. Confirm on the full 500 only at stage boundaries.
2. **Context-recall metric.** Redefine recall as "gold evidence turn present in the *assembled context* the generator received" — measured on the merged episodic+semantic context, not per-track. This is the metric that should correlate with J; if it doesn't, the discrepancy itself localizes the bug.
3. **Error taxonomy.** For every wrong dev-slice answer, an LLM classifier assigns one of four buckets: `not_retrieved` / `retrieved_not_used` / `used_but_misreasoned` / `judge_error`. This turns "try things and pray" into "the temporal bucket is 70% misreasoned — fix the scaffold, not the index."
4. **Per-category generation scaffolds.** Temporal: inject the session date alongside *every* evidence item ("[said on 2023-05-14] …"), and force stepwise arithmetic ("First list every date mentioned or implied. Then compute offsets explicitly. Then answer."). "Five years ago" said on 2023-05-14 becomes a computation the model is *walked through*, not trusted to do implicitly. All categories: concise final-answer formatting matched to what the judge rewards; never abstain in the final output.
5. **Freeze the judge** (prompt + model version) so scores are comparable across stages.

**Expected effect:** temporal +10–15 on-category, single_hop +2–4, overall **+4–6pp** — plus a 4–5× iteration speedup that multiplies every subsequent bet.
**Effort:** ~1 week. **ROI ≈ 4–6pp per person-week, plus compounding.**

### Why entity-card consolidation is deliberately third, not top-two

It is real (Defect II) and it is Stage 3 — but: its multi_hop gains overlap with Bet A's self-ask; its open_domain gains sit on 6.2% of the question mass in your already-best category; and its effort (entity resolution correctness, merge safety) is higher per point than either bet above. Right idea, wrong slot for a two-slot budget.

**Sequencing: B before A.** Instruments before surgery. Every Bet-A design choice (gate threshold, escalation depth, session count) should be validated on the 25-minute slice, not the 2-hour run.

---

## 4. Differentiation Strategy (Question 3)

**The honest part first.** A solo project on DeepSeek will not out-score funded teams running Gemini-3-class generators, and a LoCoMo rank is not a moat for *anyone* — the benchmark is saturating, judge/generator choices vary across papers, and scores within ±3pp are not meaningfully ordered. Also resist the assumption in your prompt that the top tier runs GNNs and heavy iterative reasoning: public detail is sparse, and the observable 3.94pp swing between Hindsight's two generator variants suggests much of the top-tier edge is model class plus disciplined engineering, not exotica. "Moat" is the wrong frame for a personal learning project. What you *can* build is distinctive, verifiable, and useful to others:

**1. The cost–accuracy frontier, published.**
Nobody on that leaderboard competes on J-per-dollar. "X% J at ≤$3 per 500-question run, commodity APIs only, no GPU, full pipeline reproducible" is a claim the GPU-backed systems literally cannot make, and it is the operating regime most real deployments live in. Publish the curve (J vs. $ per run, J vs. tokens per question) at each stage. This is differentiation by *constraint*, and it is verifiable — which your delivery requirements explicitly value.

**2. Provenance-first answers and an open error-attribution methodology.**
Every answer cites session/turn IDs. The attribution harness from Bet B — per-question failure classification into retrieval/assembly/reasoning/judge buckets — would be, to my knowledge, a genuinely uncommon public artifact for LoCoMo. Most systems report J and stop. An open "here is *where* memory systems fail, not just how often" analysis is a community contribution that outlives the leaderboard position, and it forces architectural honesty on your own project as a side effect.

**3. The escalation-ladder thesis as an architectural position.**
"Memory is an index over the raw log, not a replacement for it; when the index fails, degrade gracefully to reading the log." This contrasts cleanly with the extract-everything-into-a-graph school, generalizes beyond LoCoMo (production memory needs graceful degradation), and is defensible in writing. A system that *knows when its memory is insufficient* is more interesting than a system with 2pp more J.

**Moat verdict, stated plainly:** none of these is a commercial moat, and you should not represent them as one. They are portfolio, methodology, and community differentiation — the correct ambitions for the project as you have described it.

---

## 5. Three-Stage Evolution Roadmap (Question 4)

Gains below are per-stage estimates; they overlap and do not sum linearly. End-state estimate: **65–70**.

### Stage 1 (Week 1) — Instruments and the answer layer

*"See clearly, answer better."* This is Bet B.

**Core changes:**
- 150-question stratified dev slice, retrieval results cached to disk; full-500 runs only at stage boundaries.
- Context-recall metric over the assembled context (replaces per-track R@5 as the steering metric; keep R@5 only for continuity).
- Automated 4-bucket error taxonomy on every wrong dev answer.
- Per-category generation prompts: temporal date-arithmetic scaffold; session date injected next to every evidence item; concise judge-aligned final-answer format; no abstentions in final output.
- Freeze judge prompt and model version.
- Quick write-side hygiene (hours, not days): log and retry on extraction parse failures instead of silently swallowing them.

**Expected:** 56.2 → **60–63** (temporal on-category ≥ 64; single_hop +2–4).

**Key decisions:** dev-slice composition (stratified, fixed seed, published); exact context-recall definition (gold turn ∈ assembled context string).

**Risks & mitigations:** overfitting to the slice → confirm on full 500 at stage end, and never tune on the confirmation run; judge drift → frozen judge; scaffold verbosity inflating cost → cap reasoning tokens, only the final line is the answer.

**Verification:** taxonomy report exists and is trusted; temporal `used_but_misreasoned` bucket visibly shrinks; cycle time ≤ 30 min.

### Stage 2 (Weeks 2–3) — Adaptive retrieval

*"Escalate in width and depth."* This is Bet A, tuned on Stage 1's instruments.

**Core changes:**
- Session summary index (write-time LLM summaries with dates/entities/events); session-level retrieval returning whole-session raw text as context.
- Abstention-gated escalation ladder: fragments → top-2 sessions → full conversation. Internal abstention signal only.
- Sequential self-ask for multi_hop with answer substitution between hops; **remove** parallel decomposition and the chain-expansion merge.
- Log escalation rate and $ per run as first-class metrics.

**Expected:** → **64–68** (single_hop context-recall ≥ 60%; multi_hop J ≥ 55 on-category).

**Key decisions:** gate mechanism — recommend generator abstention over a retrieval-score threshold (it measures the actual failure, needs no calibration, and the second pass is cheap under prefix caching); initial escalation cap ~40% of questions, then tune down.

**Risks & mitigations:** cost creep → hard cap on full-conversation escalations, watch $/run on the dev slice; long-context distraction → escalate to top-2 sessions before full conversation, keep timestamps inline; self-ask hop-1 errors cascading → carry hop-1's *evidence* (not just its answer) into the final assembly so the generator can self-correct.

**Verification:** per-bucket taxonomy shift — `not_retrieved` shrinks materially for single_hop and multi_hop; escalation rate, $ per run ≤ $3, latency reported.

### Stage 3 (Weeks 4–5) — Write-time consolidation

*"Synthesize once, benefit every query."* Defect II, now attacked with instruments in hand.

**Core changes:**
- Per-conversation entity alias resolution (one LLM pass per conversation: canonical name ← aliases/pronouns/descriptions).
- Entity fact-cards assembled at write time (all facts about a canonical entity, capped ~300 tokens, dated); at read time, when a retrieved fact's subject matches a card, include the card. Multi-hop bridging becomes "find the entity, read its card."
- Semantic dedup/merge: embedding-cluster near-duplicates, LLM merges only same-subject non-contradictory facts, **provenance preserved, originals never deleted** — the raw log remains ground truth; memory is an additive index over it.
- Route aggregate/open-ended questions (you already have a question classifier for temporal modes; extend it) to user-card-as-answer-source + retrieval — the Memobase pattern, which is architecturally different from the failed v1/v2 augmentation.
- Rolling entity list passed across extraction chunks (fixes cross-chunk loss cheaply).

**Expected:** → **66–71** (open_domain ≥ 70; multi_hop +3–5 more; fact duplicate rate measurably down; extraction ≥ 0.9 facts/turn with ≥ 95% parse pass).

**Key decisions:** merge conservatism (when in doubt, don't merge — provenance makes conservatism cheap); card inclusion trigger (subject match on retrieved facts, not keyword match on the query — this is precisely where v1/v2 went wrong).

**Risks & mitigations:** wrong merges corrupting memory → additive-only design, provenance links, spot-check merged facts against source turns; card token bloat → hard cap + recency preference; this stage underdelivering → acceptable, Stages 1–2 already reach the 65 floor.

### Projected end-state, category-weighted

| Category | Weight | Now | Projected | Contribution |
|---|---|---|---|---|
| single_hop | 54.6% | 59.06 | 66–70 | +3.8–6.0 |
| temporal | 20.8% | 54.00 | 66–72 | +2.5–3.7 |
| multi_hop | 18.3% | 42.71 | 55–62 | +2.2–3.5 |
| open_domain | 6.2% | 66.14 | 70–75 | +0.2–0.5 |
| **Overall** | | **56.2** | **≈ 65–70** | |

---

## 6. Explicitly Abandoned Directions (Question 5)

Each verdict cites your own evidence or your constraints.

1. **GNNs, graph embeddings, locally-trained rerankers or embedders.** No GPU; and the top tier's edge is not demonstrably GNNs (see the Hindsight generator-swap delta). Weeks of infrastructure for speculative points. **Drop.**
2. **Further RRF/fusion parameter tuning.** Your eight-experiment history brackets parameter-level changes at roughly ±2pp; the +7–8pp jumps all came from architecture changes. The fusion layer also gets partially bypassed by the escalation ladder. **Freeze it.**
3. **MultiQuery / query-rewriting variants (HyDE, paraphrase expansion).** Already measured: −6.6pp. Rewrites amplify noise under top-heavy fusion. Sequential self-ask is the disciplined replacement. **Do not retry.**
4. **List-wise LLM reranking variants.** Already measured: ~0pp. Attention disperses across candidates; keep the pairwise cross-encoder. **Closed.**
5. **UserProfile v3 as context augmentation.** Two failures with the same shape (−6.3, −2.4). The pattern is only worth reviving as a *routed answer source* for aggregate questions (Stage 3) — never again as extra retrieval context. **Drop the augmentation form permanently.**
6. **Memory importance scoring / eviction / decay.** You have 2,403 facts — eviction solves a scale problem you do not have. Your actual problem (top-K dilution) is solved by semantic dedup/merge. Eviction is a production concern, not a benchmark lever. **Drop for this project phase.**
7. **Full agentic ReAct loops per question.** 5–10× cost per question for gains that overlap bounded 2-hop self-ask + escalation. At $0.50/run economics, unjustifiable. **Drop; keep self-ask bounded at 2 hops.**
8. **A symbolic temporal reasoning engine (interval algebra, timeline solver).** Your data says 46% of temporal errors are generation reasoning; the date-injection + forced-arithmetic scaffold captures most of that for two days of work. The engine is weeks of work for the residual. **Drop; revisit only if Stage 1's taxonomy shows a large surviving arithmetic bucket.**
9. **Embedding-model roulette.** Qwen3-Embedding-8B is strong; your recall failures are granularity and assembly failures, not vector-quality failures (a better embedder does not make "Yeah, I did it!" retrievable). Expected ±1–2pp. **Skip; at most a one-afternoon A/B late.**
10. **Chasing 85–90 on a DeepSeek generator.** Model class caps you; Hindsight's own 4pp generator swing proves the point. Set the target at 65–70 vs. commodity-model peers, and say so in your write-ups — it is the honest and more interesting comparison. **Reframe.**

---

## 7. Appendix: Architecture Decision Matrix

Expected ΔJ is **overall** (category-weighted), assuming implementation on top of the prior rows' state.

| Direction | Expected ΔJ (overall) | Effort | Risk | Verdict |
|---|---|---|---|---|
| Error-attribution harness + dev slice + context-recall | +0 directly; 4–5× iteration speed | 2–3 d | Low | **Do first** |
| Per-category generation scaffolds (temporal arithmetic, judge-aligned format, timestamps inline) | +4–6 | 2–3 d | Low | **Do (Stage 1)** |
| Session-level track + whole-session context | +3–5 | 3–4 d | Low–Med | **Do (Stage 2)** |
| Abstention-gated escalation (→ sessions → full conversation) | +2–4 | 2–3 d | Med (cost) | **Do (Stage 2)** |
| Sequential self-ask for multi_hop (replace parallel decomposition) | +1.5–3 | 2–3 d | Med | **Do (Stage 2)** |
| Entity alias resolution + entity fact-cards | +1.5–3 | 4–5 d | Med (merge errors) | **Do (Stage 3)** |
| Semantic dedup/merge with provenance | +0.5–1.5 | 2 d | Med | **Do (Stage 3)** |
| Profile-as-answer-source routing for aggregate questions | +0.3–0.8 | 2 d | Med | Do (Stage 3, small) |
| Extraction validation + retry; rolling entity context across chunks | +0.5–1 | 1 d | Low | Do (Stage 1/3, cheap) |
| RRF / fusion weight tuning | ±1 | ongoing sink | Low | **Freeze** |
| MultiQuery / query rewriting | negative (measured −6.6) | — | — | **Drop** |
| List-wise reranking variants | ~0 (measured) | — | — | **Drop** |
| GNN / trained rerankers / local models | unknown, likely +0–2 | weeks | High (no GPU) | **Drop** |
| Importance eviction / decay | ~0 at this scale | days | Low | **Drop** |
| Symbolic temporal engine | +0–1 after scaffolds | weeks | Med | **Drop** (revisit only on taxonomy evidence) |
| Embedding model swap | ±1–2 | 0.5 d | Low | Skip / late A/B |
| Full ReAct agent per question | +1–3 overlapping self-ask | days | High (cost) | **Drop** |

### Cost model note

Current: ~$0.50 per 500-question run. Projected with escalation + self-ask: roughly 1.3–2× LLM calls and 2–4× input tokens on escalated questions, heavily offset by DeepSeek prefix caching (per-conversation prefixes shared across ~50 questions). Budget expectation: **≤ $3 per full run**, ~$0.5–1 per 150-question dev iteration. Track $/run as a first-class metric from Stage 1 — it is also your differentiation story (Section 4).

---

*Prepared as a generic software-architecture consultation for a personal learning project. All figures derive from the public LoCoMo benchmark and the evaluation data supplied in the consultation prompt; competitor figures are as publicly reported by their authors and are not independently verified. Estimates marked as ranges are engineering judgments, not measurements — validate each on the Stage 1 dev slice before scaling investment.*
