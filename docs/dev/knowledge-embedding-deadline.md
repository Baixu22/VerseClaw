# Knowledge embedding total deadline (TF-0735)

## Problem

`knowledge-embedding-provider.ts` bounded each embedding HTTP request at 30s
but had no total-operation budget. With `MAX_BATCH_SIZE = 8`, a 100-text
operation issued 13 batches and could occupy `30s x 13 = 390s` before failing.
A batch loop that already exceeded its caller's budget also kept starting new
batches.

## Contract

- `DEFAULT_EMBEDDING_DEADLINE_MS = 120_000` — one budget for the whole
  embedding operation (query vector plus every document batch).
- Configurable with `KNOWLEDGE_EMBEDDING_DEADLINE_MS`; missing/invalid/<=0
  values fall back to the default. `Number.POSITIVE_INFINITY` is test-only.
- The 30s per-batch ceiling is retained but is clamped to the remaining total
  budget: `min(REQUEST_TIMEOUT_MS, remainingMs())`.
- The batch loop checks the remaining budget before every batch, so an expired
  budget never starts another request.
- `KnowledgeEmbeddingDeadlineError` (`code =
  KNOWLEDGE_EMBEDDING_DEADLINE_EXCEEDED`) carries `deadlineMs`,
  `completedBatches` and `totalBatches`.
- Partial vectors are never returned. If any batch fails, the promise rejects,
  `retrieveSourceSet` records `semanticLane.status = "error"` and ranking stays
  lexical — a partially-embedded corpus is never presented as a complete
  semantic ordering.
- `knowledge-api.ts` creates the provider with one
  `resolveEmbeddingDeadlineMs(process.env.KNOWLEDGE_EMBEDDING_DEADLINE_MS)`
  budget for the semantic answer path.

## Verification

`tests/unit/knowledge-embedding-deadline.test.ts` uses a fake clock:

- 100 texts / 13 batches at 30s each stops at 4 batches and at most 120s;
- a 60s budget stops after 2 batches and never starts a third;
- an `embedQuery` + batch sequence shares one budget;
- a later batch failure rejects instead of returning partial vectors;
- deadline parsing falls back to 120s for invalid values.

Static metrics: `EMB-1` 390000 -> 120000 ms; `EMB-2` 1 -> 0 batches started
after the deadline.

## Limitations

- Network timing is simulated by a fake clock; no live SiliconFlow request was
  made in this node.
- The provider is intentionally a single-operation budget: create a fresh
  provider instance per semantic answer/retrieval operation.
