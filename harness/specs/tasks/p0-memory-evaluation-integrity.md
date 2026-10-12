---
id: p0-memory-evaluation-integrity
title: Repair P0 LoCoMo measurement and evidence integrity
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: origin/main
intent: Resolve GitHub issues 134 through 138 in the opt-in LoCoMo evaluator without changing product runtime defaults, rewriting historical evidence, or claiming model scores prove production readiness.
ownedPaths:
  - tests/unit/helpers/locomo-embedding-provider.ts
  - tests/unit/helpers/runtime-memory-context-recall.ts
  - tests/unit/helpers/locomo-pipeline.ts
  - tests/unit/helpers/locomo-report-comparator.ts
  - tests/unit/helpers/locomo-question-journal.ts
  - tests/unit/helpers/locomo-retrieval-attribution.ts
  - tests/unit/helpers/runtime-memory-locomo-report-schema.ts
  - tests/unit/helpers/runtime-memory-real-llm-client.ts
  - tests/unit/helpers/runtime-memory-judge-freeze.ts
  - tests/unit/runtime-memory-locomo-full-500.test.ts
touchedAreas:
  - tests/unit/**
  - tests/fixtures/runtime-memory-eval/**
  - scripts/check-locomo-evidence.mjs
  - scripts/check-locomo-evidence.d.mts
  - scripts/run-locomo-full-evaluation.mjs
  - artifacts/p0-memory-integrity-20261009/**
  - scripts/repository-artifacts.json
  - docs/dev/p0-memory-evaluation-integrity.md
  - docs/dev/p0-locomo-run-07-outcome-20261012.md
  - docs/dev/p0-locomo-retrieval-only-mode-20261013.md
  - harness/specs/tasks/p0-memory-evaluation-integrity.md
  - harness/specs/rules/locomo-evaluation-integrity.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - .gitignore
  - package.json
expectedUserBehavior:
  - LoCoMo evidence IDs are resolved to actual turns; empty or unresolved gold evidence cannot create a perfect recall score.
  - Reports disclose L0/L1/L2 counts and rates, all-question metrics and an explicitly selection-biased L0+L1 subset, and do not attribute L2 full-conversation answers to retrieved memory.
  - Category retrieval regressions, especially temporal, cannot be hidden by an improved judge score.
  - External published scores are references only and are never represented as judge-comparable rankings.
  - Historical fixtures without verifiable provenance are not measured baselines. Fresh reports include all question results, source and dataset digests, judge configuration, model request usage and agent attribution.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - locomo-evaluation-integrity
forbiddenPatterns:
  - changing runtime memory defaults, product locks, judge tolerances, or product cutover status
  - committing credentials, raw authentication headers, or user runtime databases
  - relabelling synthetic or unverifiable historical numbers as a real run
  - changing Git refs or deleting historical objects to hide corruption
requiredTests:
  - pnpm exec vitest run tests/unit/context-recall.test.ts tests/unit/locomo-pipeline.test.ts tests/unit/locomo-report-comparator.test.ts tests/unit/runtime-memory-locomo-report-schema.test.ts tests/unit/locomo-evidence-integrity.test.ts tests/unit/runtime-memory-real-llm-client.test.ts tests/unit/locomo-eval-config.test.ts tests/unit/locomo-judge-registry.test.ts tests/unit/locomo-embedding-provider.test.ts tests/unit/locomo-full-runner.test.ts tests/unit/locomo-question-journal.test.ts tests/unit/locomo-retrieval-attribution.test.ts
  - pnpm run typecheck:test
  - pnpm eval:runtime-memory:locomo:verify
riskNotes:
  - Real model evaluation is opt-in, agent-driven and uses the owner-provided resource; it is separate from deterministic unit tests and CI never silently treats a skip as a measured run.
  - Explicit local Qwen3 GGUF embeddings require pinned weight verification, a loopback-only endpoint, exact response identity and independent cache identity. Quantization/deployment are recorded; this is not a historical hosted-score reproduction.
  - A new model or retrieval configuration establishes a new reference only; it cannot reproduce or validate the unproven historical 0.752 or 0.452 claims.
  - Git issue 62 is diagnosed separately using immutable logs and non-destructive object recovery; unavailable objects remain an explicit gap unless the owner authorizes retiring corrupt refs.
docs:
  required: true
  reason: The full500 developer command now guarantees the full sample and fails on missing resources/evidence; all four README locales and the detailed repair record document this interface change.
acceptance:
  - Fixture-shaped turn IDs exercise context recall and L2 partition regressions in deterministic tests.
  - A J-score increase with a temporal retrieval drop is reported as a retrieval regression.
  - Final model evidence passes schema, per-question recomputation, completeness, source-freshness and digest checks; failure, skip or missing evidence is not a pass.
  - Each question binds to a unique live judge receipt whose request fingerprint and verdict match the retained question and score; a fresh full run cannot substitute cached judges or silently alter the frozen prompt.
  - The full-run command cannot silently truncate a run: its child budget is explicit, an invalid budget fails closed instead of falling back, and a resumed run records the source run directory, its source revision and the per-file digests of the intermediate caches it reused.
  - Each answered question is durable before the next batch starts: an interruption leaves a journal that the next segment resumes, and a question that failed or was never answered can never be written as a judged result.
  - A report assembled from a retained journal plus a fresh segment passes the same verifier as a single-shot run, including one live judge receipt per question, the widened logical-run receipt window, retained usage, and full judge coverage.
  - The judge phase runs under an explicit V8 heap budget with a fatal-error report, the budget is recorded in run-budget.json, and in-worker heap/RSS heartbeats land in progress-timeline.jsonl so a future kill leaves a curve instead of a gap.
  - Retrieval failures are attributed without any model call to extraction loss versus ranking loss, the temporal-vs-others pairing is reported only when both sides exist, and the diagnostic carries no judge score or baseline claim (enforced by assertRetrievalOnlyDisclosure, not just documented).
  - Read all final artifacts from disk, run scoped tests and type checks, and commit only this isolated repair set.
---

# Scope

These are evaluator and evidence repairs, not a Runtime Memory feature graduation.
The model resource is explicitly authorized by the owner. All automation is labelled
`driven_by: agent`; no real-human participation or verdict is claimed.

## Durability and resume

The 500-question run used to hold every judged answer in memory and write the report
only after the last question, so an interruption discarded all completed work (run-09
died at 60/500 with an empty reports directory). Each finished batch now appends to
`question-journal.jsonl` in the run directory:

- `succeeded` records a judged question row whose answer came back with a real receipt.
- `failed` records a question that produced no complete final answer; it stays pending
  and is never counted as a judged result.
- `receipts` records the run-level model receipts the batch produced, so a resumed
  segment can rebuild the report without re-calling the model.

The journal is progress state, not evidence. A resumed segment continues the same
logical run: retained and live receipts are merged, the run window is widened to the
earliest retained answer, and the finished report still has to pass
`scripts/check-locomo-evidence.mjs` unchanged. A partial answer set writes
`run-progress.json` and fails closed instead of emitting a report the verifier would
reject. `--resume-from` copies the journal along with the intermediate caches and
records its source revision and per-file digests.

## Judge-phase budget and heartbeats

judge-07's vitest worker was killed with no OOM event and no crash report while
llama-server kept running. Measured live objects totalled ~0.95 GB against Node's
4.19 GB default old-space limit, so the kill is not explained by the heap we can
account for -- but it also cannot be ruled out while Node keeps dying silently.

The full-run command now:

- sets `--max-old-space-size` (default 6144 MB, `--heap-mb` / `RUNTIME_MEMORY_FULL_HEAP_MB`
  to override, below 512 MB rejected rather than clamped) and `--report-on-fatal-error`
  on the child via `NODE_OPTIONS`;
- writes the resolved timeout and heap budget to `run-budget.json` in the run directory;
- points `process.report` at the run directory so a fatal OOM leaves
  `node-fatal-report.json` beside the other evidence;
- appends in-worker `progress-timeline.jsonl` heartbeats (rss, heapUsed, heapTotal,
  external, heapLimit) at start, after every batch, and every 60 s.

Raising the limit is a measurement change, not a fix: if the next run dies inside the
new limit, the report and the heartbeat curve say so, and the "unexplained external
kill" position can be narrowed or replaced with evidence.

## Retrieval-only diagnosis (#136)

The judge cannot answer #136's question: when temporal retrieval looks worse, was the
gold evidence never extracted into memory, or was it extracted and then ranked out of
the top-5? The existing error taxonomy needs a paid classifier call per failure and only
buckets failures the judge already found.

`locomo-retrieval-attribution.ts` is deterministic and model-free. For each question it
compares the gold turns against the conversation's whole extracted fact set and against
the retrieved top-5, then assigns exactly one bucket: `no_gold_evidence`,
`absent_from_memory`, `in_memory_but_not_top5`, or `retrieved_in_top5`. The summary pairs
temporal against the other categories in the same sample and reports the run's own
recall@5 rather than inventing a metric; it refuses to compute a temporal delta when
either side is empty.

Boundary: this is a diagnosis and never a score. The full run writes
`retrieval-diagnostic.json` beside the verified report (never inside it), and
`assertRetrievalOnlyDisclosure` fails closed if a judge-score or baseline claim is ever
attached to it. The mock-derived dev-slice caches on disk are not usable as evidence for
this analysis; it needs a real retrieval run.

`RUNTIME_MEMORY_RETRIEVAL_ONLY=1` (commit `d394368cf`) runs that diagnosis with no model
credential at all: heuristic-only classification, no self-ask, no L1/L2 escalation, no
generation, no judge; it writes `retrieval-diagnostic.json` plus `retrieval-only.json` and
never the measured report. The CLI strips every credential from the child so a model call
is impossible, and it fails if the report path exists.

First real run (dev slice, 150 questions, agent-driven): gold coverage in memory 0.8947
versus 0.4079 in the retrieved top-5; `absent_from_memory` 0/150, `in_memory_but_not_top5`
136/150, `retrieved_in_top5` 12/150; temporal top-5 coverage 0.4785 against 0.4152 for the
other categories. Retained under
`artifacts/p0-memory-integrity-20261009/retrieval-only-run-01/` with per-file sha256. That
is the dev slice at L0, not the 500-question sample and not the final assembled context.

Confirmed on the full 500-question sample through the CLI (121 s, retrievalOnlyVerified,
no report written), retained under
`artifacts/p0-memory-integrity-20261009/retrieval-only-run-04-full500/`: memory coverage
0.9007 versus 0.4078 in the top-5; absent_from_memory 0/500, in_memory_but_not_top5
446/500, retrieved_in_top5 50/500; temporal top-5 coverage 0.4344 against 0.3622
(single_hop), 0.4011 (multi_hop) and 0.4272 (open_domain), i.e. +0.0380 against the pooled
non-temporal questions. Extraction is not the bottleneck and temporal is not the worst
category on either sample.

Node CLI detail recorded while landing this: the report flag must be passed as a Node flag,
not through NODE_OPTIONS, and on Node v24.15.0 the spelling is --report-on-fatalerror
(the hyphenated form exits 9 with bad option).
