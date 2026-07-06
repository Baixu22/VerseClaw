# Phase 35 Runtime Memory Read Hydration Benefit Evaluation Design Deep Validation

## Scope

Phase 35 designs and implements an independent mock quantitative benefit evaluation for Runtime Memory read hydration. It builds on the Phase 34 limited production opt-in evidence and answers whether the existing guarded consumer shows a real benefit signal over baseline and naive memory arms, without any production cutover, default TaskLoop connection, user Runtime Memory DB read, prompt/context/model-message injection, or runtime/durable fact authority.

This phase is evaluation only. It adds no Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, default runtime feature switch, or user Runtime Memory DB read path. The consumer remains a pure function. No real model is called.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-35-runtime-memory-read-hydration-benefit-evaluation-design.md` | Fresh Phase 35 evaluation design spec with hard boundaries, dataset requirements, metrics, thresholds, and Phase 36 gates. |
| `tests/fixtures/runtime-memory-benefit-eval/generate.mjs` | Deterministic generator (no PRNG, no wall-clock) that produces the mock corpus, queries, scenarios, and expected-metrics JSON. |
| `tests/fixtures/runtime-memory-benefit-eval/facts.json` | 1460 mock memory facts covering 8 scenario categories and 10 label classes. |
| `tests/fixtures/runtime-memory-benefit-eval/queries.json` | 120 queries (100 memory-dependent, 20 memory-irrelevant) with expected and must-reject fact ids. |
| `tests/fixtures/runtime-memory-benefit-eval/scenarios.json` | 3 evaluation arms: baseline, naiveMemory, guardedMemory. |
| `tests/fixtures/runtime-memory-benefit-eval/expected-metrics.json` | Threshold gates, expected values, and corpus provenance. |
| `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` | Focused deterministic evaluator test with 7 it blocks covering corpus coverage, three-arm comparison, suppression detail, pure consumer latency, temp SQLite hydration latency, empty no-op safety, and pure function check. |
| `runtime-research/handoffs/phase-35-runtime-memory-read-hydration-benefit-evaluation-design/deep-validation.md` | This validation handoff. |

## Hard Boundaries Preserved

| Boundary | Status |
|---|---|
| No default runtime switch | Preserved — Phase 35 adds no default flag, no TaskLoop connection. |
| No Gateway route | Preserved — no Gateway code touched. |
| No Electron IPC route | Preserved — no IPC code touched. |
| No renderer UI | Preserved — no `src/pages` or `src/components` touched. |
| No host-api / api-client / shared contract | Preserved — no `src/lib`, `shared`, or contract files touched. |
| No user Runtime Memory DB read | Preserved — only controlled temp SQLite under `os.tmpdir()`. |
| No prompt/context/model-message injection | Preserved — evaluation results stay in test process. |
| No runtime authority / durable fact authority | Preserved — consumer is pure function, no writes. |
| No provider/tool ordering change | Preserved — no provider/tool code touched. |
| No sanitizer bypass | Preserved — consumer sentinel checks unchanged. |
| No real model call | Preserved — deterministic scoring only. |
| Consumer stays pure function | Preserved — `consumeRuntimeMemoryHydrationFacts` unchanged. |

## Dataset Structure And Annotation

### Corpus Provenance

| Field | Value |
|---|---|
| Corpus id | `phase35-benefit-evaluation-fixture` |
| Version | `2026-06-30.1` |
| Provenance | `controlled_fixture` |
| Sanitized | `true` |
| No user real data | `true` |
| Reproducible | `true` |
| Reference time | 1000 |
| Memory-dependent groups | 100 |
| Memory-irrelevant groups | 20 |
| Audit refs | Phase 35 task spec, focused unit test, generator script |

### Scale

| Dimension | Count |
|---|---:|
| Total facts | 1460 |
| Total queries | 120 |
| Memory-dependent queries | 100 |
| Memory-irrelevant queries | 20 |
| Scenarios (arms) | 3 |
| Scenario categories | 8 |
| Label classes | 10 |

### Scenario Categories

| Category | Subject | Predicates | Fact Count |
|---|---|---|---:|
| `repo_conventions` | `RepoPreference` | package_manager, test_runner, formatter, file_boundary | 185 |
| `user_preferences` | `UserPreference` | reply_language, response_style, forbidden_action | 185 |
| `project_architecture` | `BoundaryPolicy` | backend_entrypoint, gateway_proxy, runtime_helper | 185 |
| `task_history` | `TaskHistory` | previous_failed_approach, validated_file, tests_already_run | 185 |
| `negative_memory` | `TemporalPolicy` | expired_fact, invalidated_fact, future_valid_fact | 180 |
| `conflict_memory` | `ConflictSet` | package_strategy, test_strategy | 180 |
| `hazard_memory` | `HazardPolicy` | prompt_injection, raw_leak, secret_handling | 180 |
| `distractor_memory` | `DistractorPolicy` | near_miss_task, near_miss_subject, near_miss_predicate | 180 |

### Label Distribution

| Label | Count |
|---|---:|
| `useful` | 100 |
| `stale` | 120 |
| `invalid` | 120 |
| `future` | 120 |
| `candidate` | 120 |
| `rejected` | 120 |
| `conflict` | 200 |
| `prompt_injection` | 120 |
| `raw_leak` | 120 |
| `distractor` | 320 |

### Fact Schema

Each fact carries: `factId`, `taskId`, `subject`, `predicate`, `objectSummary`, `recordKind` (`"fact" | "candidate"`), `verificationStatus`, `valid_at`, `invalid_at` (optional), `expired_at` (optional), `reference_time`, `confidence`, `source`, `sourceEpisodeRefs`, `evidenceRefs`, `labels`, `scenarioId`, `category`, `groupId`, `memoryRelevant`.

### Memory-Dependent Family (13 facts per group)

| Label | recordKind | verificationStatus | confidence | Temporal | Notes |
|---|---|---|---:|---|---|
| `useful` | fact | verified | 0.97 | valid_at=100 | Expected winner |
| `stale` | fact | verified | 0.80 | expired_at=800 | Suppressed by expired_at guard |
| `invalid` | fact | verified | 0.78 | invalid_at=700 | Suppressed by invalid_at guard |
| `future` | fact | verified | 0.82 | valid_at=1500 | Suppressed by future_valid_at guard |
| `candidate` | candidate | candidate | 0.70 | valid_at=100 | Suppressed by record_kind guard |
| `rejected` | fact | rejected | 0.50 | valid_at=100 | Suppressed by verification_status guard |
| `conflict` | fact | verified | 0.70 | valid_at=100 | Conflict loser A |
| `conflict` | fact | verified | 0.60 | valid_at=100 | Conflict loser B |
| `prompt_injection` | fact | verified | 0.90 | valid_at=100 | Suppressed by prompt_injection_sentinel |
| `raw_leak` | fact | verified | 0.90 | valid_at=100 | Suppressed by raw_leak_sentinel |
| `distractor` | fact | verified | 0.90 | valid_at=100 | Different taskId |
| `distractor` | fact | verified | 0.90 | valid_at=100 | Different subject |
| `distractor` | fact | verified | 0.90 | valid_at=100 | Different predicate |

### Memory-Irrelevant Family (8 facts per group)

No `useful` winner and no verified-valid conflict facts. Contains stale, invalid, future, candidate, rejected, prompt_injection, raw_leak, and one distractor. Guarded returns `[]` for these groups.

### Query Schema

Each query carries: `queryId`, `taskId`, `subject`, `predicate`, `referenceTime` (1000), `tokenBudget` (512), `limit` (16), `expectedFactIds`, `mustRejectFactIds`, `scenarioId`, `category`, `memoryRelevant`.

### Evaluation Arms

| Arm | Description | Uses Memory | Guarded |
|---|---|---|---|
| `baseline` | No memory hydration. Returned facts always empty. | false | false |
| `naiveMemory` | Direct same-key match, sorted by confidence desc, sliced to limit. | true | false |
| `guardedMemory` | `consumeRuntimeMemoryHydrationFacts` result. | true | true |

## Metric Definitions

| Metric | Definition |
|---|---|
| `guardedRecallAtK` | Sum of guarded true positives / sum of expected facts across all queries. |
| `guardedPrecision` | Sum of guarded true positives / sum of guarded returned facts. |
| `naiveRecallAtK` | Same as guarded but for naive arm. |
| `naivePrecision` | Same as guarded but for naive arm. |
| `baselineRecallAtK` | Same as guarded but for baseline arm (always 0). |
| `staleInvalidSuppressionRate` | 1 − (guarded stale/invalid/future returned / matching stale/invalid/future candidates). |
| `candidateRejectedSuppressionRate` | 1 − (guarded candidate/rejected returned / matching candidate/rejected candidates). |
| `conflictSuppressionRate` | 1 − (guarded conflict losers returned / matching conflict candidates). |
| `taskSubjectPredicateIsolationRate` | 1 − (guarded distractor returned / guarded returned). |
| `rawLeakRate` | Guarded hazard returned / guarded returned. |
| `promptInjectionReturnRate` | Guarded hazard returned / guarded returned. |
| `wrongConflictWinnerRate` | Queries where guarded winner is not the expected winner / queries with conflict candidates. |
| `emptyNoOpSafetyRate` | Memory-irrelevant queries where guarded returns 0 facts and 0 violations / total memory-irrelevant queries. |
| `baselineTaskSuccessRate` | Baseline successes / total queries. |
| `naiveMemoryTaskSuccessRate` | Naive successes / total queries. |
| `guardedMemoryTaskSuccessRate` | Guarded successes / total queries. |
| `baselineMemoryDependentSuccessRate` | Baseline successes on memory-dependent queries / memory-dependent queries. |
| `guardedMemoryDependentSuccessRate` | Guarded successes on memory-dependent queries / memory-dependent queries. |
| `baselineMemoryIrrelevantSuccessRate` | Baseline successes on memory-irrelevant queries / memory-irrelevant queries. |
| `guardedMemoryIrrelevantSuccessRate` | Guarded successes on memory-irrelevant queries / memory-irrelevant queries. |
| `guardedVsBaselineLiftMemoryDependent` | `guardedMemoryDependentSuccessRate − baselineMemoryDependentSuccessRate`. |
| `guardedMemoryIrrelevantReductionVsBaseline` | `baselineMemoryIrrelevantSuccessRate − guardedMemoryIrrelevantSuccessRate`. |
| `guardedVsNaiveHazardReduction` | 1 − (guarded hazard rate / naive hazard rate). |
| `tokenOverheadP50` | 50th percentile of guarded `estimatedTokens` per query. |
| `tokenOverheadP95` | 95th percentile of guarded `estimatedTokens` per query. |
| `pureConsumerLatencyP50Ms` | 50th percentile of pure consumer latency per query. |
| `pureConsumerLatencyP95Ms` | 95th percentile of pure consumer latency per query. |

### Deterministic Scoring Rules

No real model is called. Scoring is deterministic:

- A query succeeds when all `expectedFactIds` are in accepted facts AND no `mustRejectFactIds` or hazard-label facts are in accepted facts.
- Baseline returns `[]` for all queries, so it fails all memory-dependent queries and succeeds on all memory-irrelevant queries (vacuously: no expected facts, no violations).
- Naive returns same-key facts sorted by confidence, including stale, invalid, conflict losers, hazard, and distractor facts. Naive always has violations on memory-dependent queries, so `naiveMemoryTaskSuccessRate = 0`.
- Guarded returns only the useful winner per conflict group, with all hazard/stale/invalid/candidate/rejected/distractor facts suppressed.

## Observed Metric Results

### Three-Arm Comparison

| Metric | Baseline | Naive | Guarded |
|---|---:|---:|---:|
| Recall@k | 0 | 1 | 1 |
| Precision | — | 0.0877 | 1 |
| Task success rate | 0.1667 | 0 | 1 |
| Memory-dependent success rate | 0 | 0 | 1 |
| Memory-irrelevant success rate | 1 | 0 | 1 |
| Returned hazard count | 0 | 240 | 0 |
| Returned unsafe label count | 0 | 1040 | 0 |
| Returned must-reject count | 0 | 1040 | 0 |

### Guarded Metrics

| Metric | Result | Threshold | Pass |
|---|---:|---|---|
| `guardedRecallAtK` | 1 | >= 0.95 | Yes |
| `guardedPrecision` | 1 | >= 0.98 | Yes |
| `staleInvalidSuppressionRate` | 1 | = 1 | Yes |
| `candidateRejectedSuppressionRate` | 1 | = 1 | Yes |
| `conflictSuppressionRate` | 1 | = 1 | Yes |
| `taskSubjectPredicateIsolationRate` | 1 | = 1 | Yes |
| `rawLeakRate` | 0 | = 0 | Yes |
| `promptInjectionReturnRate` | 0 | = 0 | Yes |
| `wrongConflictWinnerRate` | 0 | <= 0.02 | Yes |
| `emptyNoOpSafetyRate` | 1 | = 1 | Yes |
| `guardedVsBaselineLiftMemoryDependent` | 1 | >= 0.15 | Yes |
| `guardedMemoryIrrelevantReductionVsBaseline` | 0 | = 0 | Yes |
| `guardedVsNaiveHazardReduction` | 1 | > 0.9 | Yes |
| `pureConsumerLatencyP95Ms` | 0.289 | < 50 | Yes |
| temp SQLite hydration + consumer latency p95 | 155 ms (observed) | < 500 | Yes |

### Suppression Detail

The guarded arm suppresses all 13 rejection reasons in the consumer:

| Rejection Reason | Count (per memory-dependent query) |
|---|---|
| `expired_at_reference_time` | 1 (stale fact) |
| `invalidated_at_reference_time` | 1 (invalid fact) |
| `future_valid_at` | 1 (future fact) |
| `record_kind_not_fact` | 1 (candidate fact) |
| `verification_status_not_verified` | 1 (rejected fact) |
| `conflicting_fact` | 2 (conflict losers A and B) |
| `prompt_injection_sentinel` | 1 (injection fact) |
| `raw_leak_sentinel` | 1 (raw_leak fact) |
| `task_mismatch` | 1 (distractor_task fact) |
| `subject_mismatch` | 1 (distractor_subject fact) |
| `predicate_mismatch` | 1 (distractor_predicate fact) |

### Hazard Suppression

| Arm | Hazard Returned | Unsafe Returned | Must-Reject Returned |
|---|---:|---:|---:|
| Baseline | 0 | 0 | 0 |
| Naive | 240 | 1040 | 1040 |
| Guarded | 0 | 0 | 0 |

### Token And Latency Distribution

| Metric | P50 | P95 |
|---|---:|---:|
| Token overhead (estimated tokens) | 31 | 34 |
| Pure consumer latency (ms) | 0.110 | 0.289 |
| Temp SQLite hydration + consumer latency (ms) | — | 155 (observed max) |

## Decision And Injection Proof

Phase 35 adds no code to the default TaskLoop path, no code to prompt assembly, no code to context provider output, no code to model messages, no code to Gateway/provider transport, no code to checkpoints, transcripts, lifecycle events, traces, or durable memory writes.

The evaluation runs entirely within the test process. The `consumeRuntimeMemoryHydrationFacts` consumer is called unchanged. The optional temp SQLite path uses `createRuntimeMemoryPersistenceStore` over a controlled temporary DB under `os.tmpdir()`, seeded only with sanitized fixture data, and is torn down in `afterEach`.

The pure-function check proves that repeated calls to the consumer with the same inputs produce identical outputs (accepted facts, rejected facts, metrics).

## Conclusion: Benefit Signal

The Phase 35 evaluation proves a strong, deterministic benefit signal for Runtime Memory read hydration under the guarded consumer:

1. **Guarded recall@k = 1.0**: The guarded consumer retrieves all expected useful facts across 100 memory-dependent queries. No expected fact is lost to conflict suppression, temporal filtering, or budget exhaustion.

2. **Guarded precision = 1.0**: The guarded consumer returns zero false positives. Every returned fact is an expected useful fact. Naive precision is 0.0877 (only ~8.8% of returned facts are useful), proving the consumer's filtering is essential.

3. **Hazard suppression is total**: The guarded consumer returns 0 hazard facts, 0 unsafe-label facts, and 0 must-reject facts. Naive returns 240 hazard facts and 1040 unsafe-label facts. `guardedVsNaiveHazardReduction = 1.0`.

4. **Conflict winner selection is correct**: `wrongConflictWinnerRate = 0` across all conflict groups. The consumer's confidence-first, then valid_at, then reference_time, then lex-smallest-factId ordering consistently selects the expected useful winner (confidence 0.97) over conflict losers (0.70 and 0.60).

5. **Empty no-op safety is perfect**: `emptyNoOpSafetyRate = 1.0` on all 20 memory-irrelevant queries. The consumer returns `[]` with zero violations, proving it does not introduce noise when no useful memory exists.

6. **Memory-irrelevant scenarios are not harmed**: `guardedMemoryIrrelevantReductionVsBaseline = 0`. Guarded memory does not reduce success rate on memory-irrelevant scenarios compared to baseline.

7. **Lift over baseline is strong**: `guardedVsBaselineLiftMemoryDependent = 1.0` (from 0% baseline success to 100% guarded success on memory-dependent scenarios), far exceeding the 0.15 threshold.

8. **Latency is negligible**: Pure consumer latency p95 = 0.289 ms (threshold: 50 ms). Temp SQLite hydration + consumer latency p95 = 155 ms (threshold: 500 ms).

9. **Token overhead is bounded**: Token overhead p95 = 34 estimated tokens per query (budget: 512), leaving ample headroom.

**The guarded Runtime Memory read hydration consumer shows a real, measurable benefit signal over both baseline (no memory) and naive (unguarded memory) approaches on this controlled mock corpus.** The benefit is most pronounced in hazard suppression (100% reduction vs naive), precision (1.0 vs 0.0877), and memory-dependent task success (1.0 vs 0.0 for both baseline and naive).

Caveat: This is a controlled mock evaluation with deterministic scoring, not a real agent/LLM evaluation. The benefit signal is necessary but not sufficient evidence for production use. Real-world benefit depends on actual fact quality, corpus coverage, query distribution, and model utilization of hydrated context — all of which require the Phase 36 gates below.

## Phase 36 Hard Gates

Phase 36 may start only with a fresh task spec and all of these preconditions:

### Privacy Gate

- Explicit privacy review for any corpus beyond controlled fixtures.
- No raw transcript/chat/jsonl/trace/prompt/tool/env/secret material in accepted facts.
- Retention window, deletion owner, and deletion procedure defined.
- No user Runtime Memory DB reads until a fresh spec explicitly accepts that scope.
- Aggregate metrics only outside the diagnostics path.

### Security Gate

- Sanitizer boundary preserved: no `record_json`, no raw rows, no authority markers.
- Prompt-injection sentinel and raw-leak sentinel checks remain in the consumer.
- No hydration results entering prompt assembly, context provider output, model messages, Gateway/provider transport, checkpoints, transcripts, lifecycle events, traces, or durable writes.
- Conflict winner selection, temporal validity, record kind, verification status, task/subject/predicate isolation, token budget, and result limit guards preserved.

### Evaluation Gate

- Transition from mock deterministic scoring to real agent/LLM scenario evaluation requires a fresh spec.
- Real evaluation must include holdout sets, cross-model validation, and human review of sampled outputs.
- Real evaluation must prove that hydrated context actually improves task outcomes (not just that the consumer retrieves facts correctly).
- Real evaluation must measure and bound token overhead, latency overhead, and context window consumption on real workloads.

### Rollback Gate

- Single operator kill switch.
- Non-empty rollback owner and disable procedure.
- No migration required.
- No durable writes to undo.
- Rollback validation commands defined.

### Operator Gate

- Explicit operator opt-in, operator owner, approval ref, diagnostics-only scope, bounded participant/corpus scope, expiry, default-off attestation, and no-cutover attestation.
- Phase 36 cannot default-enable read hydration, connect the default TaskLoop path, add Gateway/IPC/renderer/host-api/api-client/shared contract surfaces, change provider/tool ordering, or create runtime/durable fact authority.

### Communication Path Gate

- Phase 36 does not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider ordering changes, or default runtime feature switches unless a future spec explicitly accepts that surface and runs its required validation.
- If Phase 36 touches communication paths (gateway events, runtime send/receive, delivery, fallback), it must run `pnpm run comms:replay` and `pnpm run comms:compare`.

### Docs Gate

- If Phase 36 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows, it must update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` in the same PR.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 35 changes only an internal harness task spec, mock fixtures, a focused unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 35 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, gateway events, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-35-runtime-memory-read-hydration-benefit-evaluation-design.md` | See validation log below. |
| `rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-35-runtime-memory-read-hydration-benefit-evaluation-design.md` | See validation log below. |
| `rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` | Passed, 1 file / 7 tests. |
| `rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts` | See validation log below. |
| `rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | See validation log below. |
| Phase 35 policy scan on spec/test/generator/handoff | Matches are prohibition/threshold text in spec/handoff. No route/API/UI additions. |
| Direct renderer/Gateway transport scan on `src/pages src/components src/lib shared electron` | No Phase 35 changes in those paths. |
| DB/write scan on Phase 35 test | Matches are the existing `createRuntimeMemoryPersistenceStore` call, `appendEpisode` / `appendFact` fixture setup, and `closeOpenClawStateDatabaseForTest` cleanup. No production write path added. |
| Phase 35 implementation scan for host-api/api-client/shared contract/IPC/Gateway/renderer patterns | No matches in touched files. |
| README docs-sync scan | No matches; no README update required. |
