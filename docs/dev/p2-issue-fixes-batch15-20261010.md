# P2 issue fix: LoCoMo cached/fresh mirrored tails

Scope: issue #144. This record is agent-authored and does not claim a
reproducible end-to-end equivalence run; it documents why that oracle does not
exist and what was verified instead.

## Change

`tests/unit/runtime-memory-locomo-full-500.test.ts` carried two verbatim copies
of the same post-retrieval tail: the escalation ladder (L0/L1/L2), the reflect
agent integration, the frozen + unified judges, context recall, the error
taxonomy and the feedback-loop rewrite.

They are now a single `runSharedQuestionTail(item, questionId, queryPlan,
injection)` implementation. The two retrieval phases are unchanged and differ
only through the injected values:

| Injected value | cached path | fresh path |
|---|---|---|
| `episodicContext` / `assembledContext` / `retrievedFacts` | cached retrieval result | fresh index result |
| `queryEmbedding` | cached query vector | freshly embedded query |
| `selfAskHopAnswers` | cached multi-hop hop answers | computed the same way |
| `level1ReasoningHints` | hop answers | `[]` |
| `captureReRetrievedFacts` | `true` | `false` |
| `reflectRetrieveFactory` | full pipeline (RRF top-50 + cross-encoder + entity boost) | plain semantic top-10 |
| `captureRetrievalCache` | absent | dev-slice cache write |

`tests/unit/helpers/locomo-pipeline.ts` no longer says the merge is deferred.

## Why the end-to-end A/B is not the oracle

The issue proposed A/B verifying the two paths produce equivalent output. That
A/B was built and run twice per mode against a deterministic mock-LLM plus the
real disk-cached embeddings. It is not reproducible for reasons unrelated to
this merge:

- the reflect step's re-retrieval returns the same fact set in a different
  order across runs, which changes the generator prompt and therefore the
  answer text;
- the shared `EscalationBudget` / `ReflectBudget` objects are consumed in
  completion order, so concurrent batches allocate their capped escalations
  differently.

Measured: two runs of **identical, unmodified** code produced reports differing
in ~40 fields (`j_score`, `errorTaxonomy`, `escalation`, token totals), and
their mock request logs differed in 13 request hashes even at batch size 1.
A drifting oracle cannot prove equivalence, so the merge is verified by a
structural equivalence check instead.

## Verification

```text
node scripts/check-locomo-merge-equivalence.mjs
pnpm run typecheck:test
```

`check-locomo-merge-equivalence.mjs` asserts that exactly one shared tail
exists, both paths call it, every cached/fresh-specific behaviour is preserved,
and each previously mirrored construct now appears exactly once. Both the fresh
and cached modes were also executed end-to-end against the mock-LLM harness to
confirm the merged file still satisfies the evaluator (1 test passed each).