# LoCoMo retrieval-only execution mode: design constraints

- Date: 2026-10-13
- Issue in scope: #136 (temporal retrieval under comparable conditions)
- `driven_by: agent`; actor: `codex`
- Status: **not implemented.** This record captures what the implementation must satisfy
  and the two shortcuts that were investigated and rejected, so the work is not redone
  and the number the mode reports is not fabricated.

## Why the mode is needed

#135, #136 and #138 are the remaining open issues. #135/#138 need a measured 500-question
report and therefore a model credential. #136's question -- when temporal retrieval looks
worse, did the gold evidence fail to reach memory or fail to reach the top-5 -- does not
need a model at all: it is a property of retrieval.

`tests/unit/helpers/locomo-retrieval-attribution.ts` (commit 185d715cd) already answers
that question deterministically from the gold turns, the extracted facts and the retrieved
top-5. What is missing is a way to *produce* those inputs without paying for generation and
judging. Today the only producer is the credentialed full run, because the suite is gated
on a model key.

There is also no real retrieval output on disk to analyse. The only retrieval caches found
are synthetic: `D:/ClawX-work/issue144-ab2/runs/*/dev-slice-cache.json`
(`version 34.0-audn-lifecycle-2026-07-06`) contains facts such as
`"mock fact 1 for conv-43 part 6"` and must not be used as evidence.

## The four LLM touchpoints the mode must bypass

All four are inside the 500-question suite or the helpers it calls:

| # | Touchpoint | Evidence |
| --- | --- | --- |
| 1 | Query classification/decomposition | `tests/unit/helpers/query-classifier.ts:242` `classifyQuery` calls `callLLMForDecompose` (`:231-238`) which calls `callDeepSeek` |
| 2 | Sequential self-ask | `tests/unit/runtime-memory-locomo-full-500.test.ts:2264` and `:2953` call `callTrackedDeepSeek` for sub-questions |
| 3 | Answer generation | the main generation call after context assembly |
| 4 | Frozen judge | `tests/unit/runtime-memory-locomo-full-500.test.ts:1435` `judgeAnswer` -> `callTrackedDeepSeek` |

Retrieval itself (embedding lookup, fusion, rerank) does not need any of them.

## Rejected shortcuts

**Stub `callTrackedDeepSeek` and let the pipeline run to completion.** This looks free and
is not. The escalation ladder and `finalAssembledContext` depend on the *generated answer*:
the pipeline detects an evidence-insufficient signal in the answer and re-assembles context
at L1/L2. A canned answer changes escalation, which changes `assembledContext`, which changes
the very `contextRecall` the diagnostic reports. It would fabricate the measurement.

**Early-return at a single "retrieval finished" point.** `assembleGeneratorContext` is
called at five sites (`runtime-memory-locomo-full-500.test.ts:2227`, `:2345`, `:2534`,
`:3314`, `:3363`) because escalation recomputes the context. A single early return measures
whichever stage that call site happens to be, while the artifact would be labelled as the
run's retrieval. The label has to match the stage.

## Design the implementation must follow

1. `RUNTIME_MEMORY_RETRIEVAL_ONLY=1` bypasses **only** the model-key gate in
   `describe.skipIf`. The local embedding gate stays: retrieval needs real embeddings and
   must never fall back to a synthetic provider.
2. Use the **heuristic-only** classifier branch (no LLM decomposition), never self-ask,
   never L1/L2 escalation, never generation, never judging. One stage, named honestly:
   L0 retrieval.
3. Assemble the context deterministically from the fused top-k hits and record `recall5`,
   `contextRecall` and `retrievedFactSummaries` on exactly that context, so the diagnostic
   and the recorded retrieval inputs come from one stage.
4. Write only `retrieval-diagnostic.json` and a `retrieval-only.json` marker in the run
   directory. Never write `locomo-full-500-report.json`, and never satisfy
   `scripts/check-locomo-evidence.mjs` -- the verifier must keep failing closed while no
   measured report exists.
5. The diagnostic must pass `assertRetrievalOnlyDisclosure`: no judge score, no baseline
   claim, and no temporal delta when either side is empty.
6. Run it against the real caches in
   `D:/ClawX-work/p0-local-embedding-20261010/judge10-seed` (facts 10/10 conversations,
   session summaries 10/10, embedding cache 1.59 GB). The four conversations missing from
   the observations cache (conv-47/48/49/50) do not block L0 fact retrieval.

## Acceptance criteria for the mode

- Runs to completion with **no** `RUNTIME_MEMORY_LLM_API_KEY`, `DEEPSEEK_API_KEY` or
  `SILICONFLOW_API_KEY`, and with no outbound request to any non-loopback host.
- Writes `retrieval-diagnostic.json` whose `summary.scope` is
  `retrieval-only-diagnostic` and whose `rows` cover every sampled question.
- `locomo-full-500-report.json` does not exist after the run, and
  `eval:runtime-memory:locomo:verify` still exits non-zero.
- A unit test fails if the mode ever writes the verified report path.
