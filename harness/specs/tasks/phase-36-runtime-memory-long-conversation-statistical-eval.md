---
id: phase-36-runtime-memory-long-conversation-statistical-eval
title: Phase 36 runtime memory long conversation statistical evaluation
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Design and implement a 30-turn long conversation A/B statistical significance evaluation for Runtime Memory read hydration building on the Phase 35 benefit signal, with no product cutover, no default TaskLoop connection, no user Runtime Memory DB reads, no prompt/context/model-message injection, no runtime/durable fact authority, no Gateway/IPC/renderer/host-api/api-client/shared contract surfaces, only controlled mock fixtures and temporary SQLite fixture DBs, deterministic scripted LLM responses (no real model calls), pure-function statistics, and per-arm isolated DBs that produce a real recall signal (baseline empty DB recall=0 vs treatment seeded DB recall>0).
ownedPaths:
  - harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md
  - openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts
  - tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts
  - tests/unit/runtime-memory-eval-statistics.test.ts
  - tests/unit/runtime-memory-eval-scripted-llm.test.ts
  - tests/unit/helpers/runtime-memory-eval-helpers.ts
  - tests/unit/helpers/runtime-memory-eval-report.ts
touchedAreas:
  - harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md
  - openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts
  - openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts
  - tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts
  - tests/unit/runtime-memory-eval-statistics.test.ts
  - tests/unit/runtime-memory-eval-scripted-llm.test.ts
  - tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts
  - tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts
  - tests/unit/helpers/runtime-memory-eval-helpers.ts
  - tests/unit/helpers/runtime-memory-eval-report.ts
  - package.json
expectedUserBehavior:
  - Default TaskLoop behavior remains unchanged; Phase 36 adds no default read hydration, no product UI, no Gateway route, no IPC route, no host-api/api-client/shared contract, no provider/tool ordering change, and no runtime cutover.
  - Phase 36 is a deterministic mock statistical evaluation only. It does not call real models, does not connect to the default TaskLoop, does not read user Runtime Memory DBs, and does not let hydration results enter prompt/context/model messages.
  - The evaluation corpus reuses the Phase 35 controlled sanitized reproducible fixtures. No new user data is introduced.
  - The evaluation runs a 30-turn × 4-queries-per-turn A/B driver with two arms (baseline empty DB, treatment seeded DB) over the existing pure-function `consumeRuntimeMemoryHydrationFacts` consumer and the existing `readRuntimeMemoryHydrationShadow` diagnostics path, unchanged.
  - The treatment arm uses `testResearchOnlyBreakthrough: true` only as an arm marker; it does not alter which facts are accepted/rejected. The recall signal comes from per-arm DB seeding (baseline empty → recall=0, treatment seeded → recall>0).
  - The scripted LLM driver returns deterministic canned responses per sessionKey+arm; responses are consumed to verify integration but do not influence hydration metrics.
  - Statistical analysis uses pure functions: mulberry32 deterministic RNG for bootstrap CI, paired t-test (one-sided, treatment > baseline), Cohen's d effect size, and minimum sample size estimation.
  - Natural variance is introduced by cycling ALL memoryRelevant queries (matching and non-matching) so the treatment arm produces a mix of recall=1 (matching) and recall=0 (non-matching), giving non-zero variance for Cohen's d.
  - Phase 36 produces a structured report (markdown + JSON shape) with per-metric baseline/treatment means, p50/p95, delta, paired t-test result, bootstrap CI, Cohen's d, minimum sample size, effect size label, and achieved conclusion.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - host-events-fallback-policy
  - gateway-readiness-policy
  - comms-regression
  - docs-sync
forbiddenPatterns:
  - default runtime switch, default TaskLoop read hydration, default shadow helper call, automatic memory/provider registration, runtime authority, durable fact authority, or production cutover
  - Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract changes, or direct Gateway HTTP/WebSocket renderer calls
  - hydration facts or evaluation results entering prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, next actions, checkpoints, transcripts, lifecycle events, traces, durable memory writes, provider ordering, or tool selection
  - consumer opening, reading, creating, migrating, or writing production SQLite databases, calling TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server
  - reading or writing user Runtime Memory databases; Phase 36 may use only controlled sanitized temporary fixture DBs under `os.tmpdir()` and only through the existing explicit diagnostics path
  - calling real LLM/provider/model endpoints, non-deterministic scoring, wall-clock-dependent assertions, or randomized fixtures that break reproducibility
  - bypassing sanitizer boundaries, returning raw SQLite rows, `record_json`, raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/traceparent/tracestate/baggage, or authority markers
  - accepting facts when `recordKind !== "fact"`, `verificationStatus !== "verified"`, `valid_at > referenceTime`, `invalid_at <= referenceTime`, `expired_at <= referenceTime`, subject/predicate/taskId mismatches, prompt-injection sentinel text, raw-leak sentinel text, conflict suppression, token budget exhaustion, or result limit exhaustion apply
  - using `testResearchOnlyBreakthrough` to alter which facts are accepted/rejected; it is an arm marker only and must not change consumer query results
featureFlags:
  - No default runtime feature flag is added by Phase 36.
  - Existing Runtime Memory defaults remain false by omission.
  - Phase 36 does not enable `runtime.memory.persist`, `runtime.memory.shadow`, `runtime.memory.provider`, `runtime.memory.proposeFacts`, read hydration, or limited production opt-in by default.
operatorGate:
  runtimeAssertions:
    - Phase 36 requires no live operator gate because it runs only deterministic mock fixtures in unit tests.
    - The evaluation must not be reachable from default TaskLoop, product runtime, Gateway, IPC, renderer, host-api, or api-client paths.
    - Any future expansion beyond mock fixtures requires a fresh spec with operator opt-in, approval, diagnostics-only scope, bounded participant/corpus scope, expiry, default-off attestation, and no-cutover attestation.
corpusGate:
  runtimeAssertions:
    - provenance is `controlled_fixture`
    - `sanitized === true`
    - `noUserRealData === true`
    - `reproducible === true`
    - non-empty audit refs that point to the Phase 35 spec, Phase 36 spec, focused unit tests, and helper modules
    - `sanitizerBoundaryPreserved === true`
    - corpus reuses Phase 35 fixtures (500-2000 mock facts, 8+ scenario categories, 100+ queries) without introducing new user data
privacyRetentionGate:
  runtimeAssertions:
    - no raw transcript/chat/jsonl/trace/prompt/tool/env/secret material in accepted facts
    - retention is bounded to the test process lifetime; temp SQLite DBs are removed in `afterAll`
    - aggregate metrics only outside the test process
    - `noUserRuntimeDbRead === true`
    - `noDurableFactAuthority === true`
    - `noRealModelCall === true`
rollbackGate:
  runtimeAssertions:
    - single removal path: delete the Phase 36 spec, long conversation test, statistics module, scripted LLM driver, multi-turn driver, eval helpers, report generator, and package.json script
    - non-empty rollback owner
    - no migration required
    - no durable writes to undo
    - non-empty rollback validation commands
metricsGate:
  runtimeAssertions:
    - paired t-test pValue < 0.05 (one-sided, treatment > baseline)
    - paired t-test meanDiff > 0
    - bootstrap CI lower bound exceeds baseline mean recall
    - Cohen's d > 0 (non-zero effect size)
    - minimum sample size <= 30 (observed effect detectable within 30 turns)
    - rawLeakRate = 0 in treatment across all turns
    - promptInjectionReturnRate = 0 in treatment across all turns
    - total 30-turn run duration < 60 seconds
    - structured report conclusion.significant === true
    - structured report conclusion.achieved === true
    - structured report conclusion.effectSizeLabel !== "negligible"
    - TaskLoop decision delta count 0
    - tool call delta count 0
    - provider ordering delta count 0
    - prompt/context/model-message injection count 0
    - checkpoint/transcript/lifecycle/trace injection count 0
    - durable memory write count from read diagnostics 0
    - threshold violations 0
rollback:
  - Remove `tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts`.
  - Remove `tests/unit/runtime-memory-eval-statistics.test.ts`.
  - Remove `tests/unit/runtime-memory-eval-scripted-llm.test.ts`.
  - Remove `tests/unit/helpers/runtime-memory-eval-helpers.ts`.
  - Remove `tests/unit/helpers/runtime-memory-eval-report.ts`.
  - Remove `openclaw_runtime/src/agents/runtime-memory-eval/` directory.
  - Remove the `eval:runtime-memory:long-conversation` script from `package.json`.
  - Revert `tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts` to its pre-helper-extraction form if the helpers module is removed.
  - Remove this Phase 36 spec.
  - Keep Phase 28-35 helper, consumer, controlled DB replay, TaskLoop explicit opt-in, controlled internal shadow pilot, readiness, limited production opt-in, and benefit evaluation behavior unchanged.
requiredTests:
  - pnpm exec vitest run tests/unit/runtime-memory-read-hydration-long-conversation-eval.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/runtime-memory-eval-statistics.test.ts tests/unit/runtime-memory-eval-scripted-llm.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/runtime-memory-read-hydration-benefit-evaluation.test.ts tests/unit/runtime-memory-read-hydration-test-research-breakthrough.test.ts --reporter=verbose
  - pnpm run eval:runtime-memory:long-conversation
  - cd openclaw_runtime && pnpm tsgo:core
  - pnpm harness validate --spec harness/specs/tasks/phase-36-runtime-memory-long-conversation-statistical-eval.md --no-diff
acceptance:
  - Phase 36 starts only after AGENTS, Phase 35 task spec and deep validation, Phase 35 benefit evaluation, existing hydration shadow helper, Phase 28 consumer, and TaskLoop shadow helper are read.
  - Phase 36 creates a fresh task spec, multi-turn A/B driver, statistics module, scripted LLM driver, eval helpers, report generator, and focused long conversation unit test without extending Phase 35 into product runtime cutover or default TaskLoop connection.
  - The multi-turn driver splits per-arm DB paths (baseline empty, treatment seeded) so the recall signal is real and not dependent on `testResearchOnlyBreakthrough` altering consumer results.
  - The statistics module is pure-function with deterministic mulberry32 RNG and covers bootstrap CI, paired t-test, Cohen's d, and minimum sample size.
  - The long conversation test runs 30 turns × 4 queries per turn and asserts paired t-test significance, bootstrap CI exclusion of baseline mean, Cohen's d > 0, minimum sample size <= 30, zero hazard rates, and a structured report with significant achieved conclusion.
  - The scripted LLM driver returns deterministic canned responses and never calls real provider endpoints.
  - Default TaskLoop execution is unchanged; Phase 36 adds no default read hydration, no product UI, no Gateway/IPC/host-api/api-client/shared contract surface, and no provider/tool ordering change.
  - All existing Phase 28-35 tests pass with no regression after helper extraction and driver changes.
  - README sync review is recorded; README changes are required only if Phase 36 changes product behavior, UI, public runtime behavior, release-facing docs, or user workflows. Phase 36 is an internal evaluation tool and does not trigger doc sync.
docs:
  required: false
  rationale: Phase 36 is an internal evaluation tool with no user-visible behavior change. The harness task spec itself serves as the documentation. README sync is not triggered.
---

# Phase 36 Runtime Memory Long Conversation Statistical Evaluation

Phase 36 designs and implements a 30-turn long conversation A/B statistical significance evaluation for Runtime Memory read hydration. It builds on the Phase 35 benefit signal and answers the question: does the existing guarded consumer show a statistically significant recall improvement over a no-memory baseline across a realistic 30-turn conversation, with no production cutover, default TaskLoop connection, user Runtime Memory DB read, prompt/context/model-message injection, or runtime/durable fact authority?

This phase is evaluation only. It does not default-enable read hydration, does not connect the default TaskLoop path, does not read user Runtime Memory DBs, does not add Gateway/IPC/renderer/host-api/api-client/shared contract surfaces, does not change provider/tool ordering, and does not let evaluation results become runtime authority or durable fact authority.

## Hard Boundaries

- No default runtime switch. No default TaskLoop read hydration. No default shadow helper call.
- No Gateway route, Electron IPC route, renderer page/component/UI, host-api/api-client/shared contract, or direct Gateway HTTP/WebSocket renderer call.
- No hydration facts or evaluation results in prompt assembly, context provider output, model messages, Gateway/provider transport payloads, runtime decisions, next actions, checkpoints, transcripts, lifecycle events, traces, durable memory writes, provider ordering, or tool selection.
- No real LLM/provider/model endpoint calls. The scripted LLM driver returns canned responses deterministically.
- No reading or writing user Runtime Memory databases. Only controlled sanitized temporary fixture DBs under `os.tmpdir()` are permitted, and only through the existing explicit diagnostics path.
- No bypassing sanitizer boundaries, no raw SQLite rows, no `record_json`, no raw chat/transcript/jsonl/trace/prompt/payload/tool args/tool output/env/secret/traceparent/tracestate/baggage, no authority markers.
- The consumer remains a pure function. The evaluation must not open, read, create, migrate, or write production SQLite databases, and must not call TaskLoop, provider, Gateway, IPC, host-api, api-client, or any service/listener/daemon/server.
- `testResearchOnlyBreakthrough` must not alter which facts are accepted/rejected. It is an arm marker only; the recall signal comes from per-arm DB seeding.

## Architecture

### Multi-Turn Driver

`openclaw_runtime/src/agents/runtime-memory-eval/multi-turn-driver.ts` drives a 30-turn A/B evaluation:

- Splits `databasePath` into `baselineDatabasePath` (empty, migrate-only) and `treatmentDatabasePath` (seeded with 8 fact groups).
- Each turn runs both arms via `buildTaskLoopRuntimeMemoryReadHydrationShadowOnlyDiagnostics` with `explicitOptIn: true` and `testResearchOnly: true`.
- The treatment arm additionally sets `testResearchOnlyBreakthrough: true` as a marker; it does not change consumer query results.
- The scripted LLM driver is invoked per arm to verify integration; responses are not used by hydration metrics.
- Per-turn `ArmMetrics` (recallAtK, precision, latencyMs, tokenOverhead, rawLeakRate, promptInjectionReturnRate, acceptedFactCount, rejectedFactCount) are aggregated into baseline/treatment summaries with mean, p50, p95.

### Scripted LLM Driver

`openclaw_runtime/src/agents/runtime-memory-eval/scripted-llm.ts` provides deterministic canned responses keyed by `sessionKey` + `arm`. It never calls real provider endpoints. Responses are consumed by the driver to verify integration but do not influence hydration metrics.

### Statistics Module

`openclaw_runtime/src/agents/runtime-memory-eval/statistics.ts` is a pure-function module with deterministic mulberry32 RNG:

- `mulberry32(seed)` — deterministic PRNG for bootstrap resampling.
- `mean`, `variance`, `stdDev`, `percentile` — basic descriptive statistics.
- `pairedTTest(baseline, treatment)` — one-sided paired t-test (treatment > baseline), returns `meanDiff`, `tStatistic`, `degreesOfFreedom`, `pValue`, `significant`.
- `bootstrapConfidenceInterval(samples, { seed, iterations, alpha })` — bootstrap CI with deterministic resampling.
- `cohensD(baseline, treatment)` — Cohen's d effect size with pooled standard deviation.
- `minimumSampleSize(effectSize, alpha, power)` — minimum sample size for desired power.

### Natural Variance Strategy

To produce non-zero variance for Cohen's d, the long conversation test cycles ALL `memoryRelevant` queries (those with `expectedFactIds.length > 0`), not just the 8 matching the seeded groups. This creates a mix of:

- Matching queries → recall = 1 in treatment (seeded DB contains expected facts).
- Non-matching queries → recall = 0 in treatment (seeded DB does not contain expected facts).

Both arms produce a mix of 0s and 1s across 30 turns, giving non-zero variance for paired t-test, bootstrap CI, and Cohen's d.

### Report Generator

`tests/unit/helpers/runtime-memory-eval-report.ts` is a pure-function module that produces a structured `LongConversationReport`:

- Per-metric baseline/treatment mean, p50, p95, delta.
- Statistics: paired t-test result, bootstrap CI, Cohen's d, minimum sample size.
- Conclusion: `significant` (paired t-test p < 0.05 and meanDiff > 0), `effectSizeLabel` (negligible/small/medium/large), `achieved` (significant + bootstrap CI lower > baseline mean + minimum sample size <= turn count).
- `formatReportAsMarkdown` produces a human-readable markdown table for handoff documents.

## Metrics And Thresholds

The long conversation test asserts:

| Metric | Threshold |
|---|---|
| paired t-test pValue | < 0.05 |
| paired t-test meanDiff | > 0 |
| paired t-test significant | true |
| bootstrap CI lower | > baseline mean recall |
| Cohen's d | > 0 |
| minimum sample size | <= 30 |
| rawLeakRate (treatment, all turns) | = 0 |
| promptInjectionReturnRate (treatment, all turns) | = 0 |
| total run duration | < 60 seconds |
| report conclusion.significant | true |
| report conclusion.achieved | true |
| report conclusion.effectSizeLabel | != "negligible" |

## Validation

Phase 36 must run all `requiredTests`. The long conversation test indirectly validates the report generator (it calls `generateLongConversationReport` and asserts key fields). The statistics module and scripted LLM driver each have their own focused unit tests.

## Phase 37 Hard Gates

Phase 37 may start only with a fresh task spec and all of these preconditions:

- Keep read hydration default-off and require explicit operator opt-in.
- Keep any limited production opt-in diagnostics-only and shadow-only; no runtime cutover.
- Define operator owner, approval refs, participant/corpus scope, expiry, renewal, and kill-switch operation for any broader corpus.
- Do not read user Runtime Memory DBs until a fresh spec explicitly accepts that scope with privacy/security review and controlled substitute tests.
- Keep diagnostics out of prompt assembly, context provider output, model messages, checkpoints, transcripts, lifecycle events, traces, provider/tool inputs, and durable memory writes.
- Preserve guard gates for record kind, verification status, temporal validity, task/subject/predicate match, prompt-injection sentinel, raw-leak sentinel, conflicts, token budget, and result limit.
- Preserve TaskLoop decision delta count 0, tool/provider ordering delta count 0, prompt/context/model-message/checkpoint/transcript/lifecycle/trace injection count 0, raw leak rate 0, prompt injection return rate 0, durable memory write count 0, and threshold violations 0.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider ordering changes, or default runtime feature switches unless a future spec explicitly accepts that surface and runs its required validation.
- Any transition from mock statistical evaluation to real agent/LLM scenarios requires a fresh spec that adds privacy review, security review, evaluation review, rollback review, and operator gate review on top of the Phase 36 evidence.
