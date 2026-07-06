# Phase 30 Runtime Memory Read Hydration Controlled DB Replay Regression Harness Deep Validation

## Scope

Phase 30 promotes the Phase 29 controlled temporary Runtime Memory SQLite DB proof into a focused replay regression harness. It creates multiple test-owned temporary SQLite DBs, writes sanitized episodes/facts/candidates/invalidations through existing persistence helpers, reads sanitized projections through the existing read-hydration shadow helper, and evaluates baseline no memory, naive hydration, and the Phase 28 guarded consumer.

This is not a cutover, not default-on behavior, not runtime authority, and not durable fact authority. It adds no TaskLoop default path, Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, prompt/context/model-message injection, or user-data read/write path.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md` | Fresh Phase 30 task spec with replay regression thresholds and boundaries. |
| `tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts` | Focused replay regression harness using multiple temporary DBs, existing persistence helpers, the existing shadow helper, and the Phase 28 consumer. |
| `runtime-research/handoffs/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness/deep-validation.md` | This validation handoff. |

No production runtime helper was added or changed. The Phase 28 consumer remains a pure function over sanitized fact projections and explicit queries.

## Replay Scenarios

Each replay scenario creates its own temporary DB and is cleaned up in `afterEach`.

| Scenario | Coverage |
|---|---|
| `phase_29_parity_hazard_replay` | Phase 29 parity corpus, expired facts, invalidated facts plus persisted invalidation rows, future-valid facts, candidate facts, rejected facts, human_approved/deterministic_rule verification mismatch, conflicts, task/subject/predicate mismatch, prompt-injection sentinel, raw-leak sentinel through sanitized fixture writes. |
| `task_isolation_multilingual_refs_replay` | Multi-task taskId isolation, subject/predicate mismatch, multilingual preference change, expired/future language preferences, conflict suppression, and large source/evidence refs truncated to 32 sanitized refs by projection. |
| `projection_limit_truncation_replay` | DB projection limit/truncation behavior with 6 persisted facts and 3 hydrated facts, preserving useful guarded recall while naive returns hazardous noise. |
| Empty migrated DB replay | Empty no-op behavior with schema present, zero hydrated episodes/facts, and no consumer side effects. |
| Explicit boundary queries | Zero token budget, zero result limit, and empty input no-op over real hydrated projections. |

## Thresholds

| Threshold | Required result |
|---|---|
| Guarded recall@k | `>= 1.0` on expected useful facts |
| Guarded precision | `>= 1.0` on fixed replay corpus |
| Guarded stale/invalid suppression | `>= 1.0` |
| Guarded candidate/rejected suppression | `>= 1.0` |
| Guarded conflict suppression | `>= 1.0` |
| Guarded raw leak rate | `0` |
| Guarded prompt injection return rate | `0` |
| Guarded failure/no-op rate | `0` for scenarios with expected facts |
| Guarded token overhead | Lower than naive token overhead on hazardous replay corpus and in aggregate |
| Latency overhead | `< 500 ms` per focused replay run |
| Baseline negative control | recall@k `0`, failure/no-op rate `1` where expected facts exist |
| Naive negative control | recall@k `1`, lower precision than guarded, nonzero hazardous return in hazard scenarios |

Guarded threshold violations fail the focused unit test directly through scenario and aggregate violation checks.

## Aggregate Metrics

The replay harness covers 3 expected-fact scenarios, 8 expected useful facts, and 1 empty migrated DB no-op scenario.

| Metric | Baseline no memory | Naive hydration | Guarded opt-in consumer |
|---|---:|---:|---:|
| recall@k | 0 | 1.0 | 1.0 |
| precision | 0 | 0.32 | 1.0 |
| stale/invalid suppression | 1.0 | 0 | 1.0 |
| candidate/rejected suppression | 1.0 | 0 | 1.0 |
| conflict suppression | 1.0 | 0 | 1.0 |
| raw leak rate | 0 | 0.04 | 0 |
| prompt injection return rate | 0 | 0.04 | 0 |
| latency overhead | 0 ms | measured per replay, asserted `< 500 ms` | measured per replay, asserted `< 500 ms` |
| token overhead | 0 | aggregate returned payload cost | positive and lower than naive |
| failure/no-op rate | 1.0 | 0 | 0 |
| scenario pass/fail count | n/a | n/a | 3 pass / 0 fail |
| aggregate pass/fail count | n/a | n/a | 1 aggregate pass / 0 aggregate fail |
| threshold violations | n/a | negative control preserved | 0 |

Projection-limit replay also asserts `factCount: 6`, `factsReturned: 3`, and `truncated: true`. Large source/evidence refs are projected as sanitized bounded arrays of 32 refs each.

## Negative Controls

Baseline remains negative because it returns no memory effect: recall@k is 0 and every expected-fact query is a no-op.

Naive hydration remains negative because it recovers useful facts but also returns expired, invalidated, future-valid, candidate, rejected, verification-status-mismatch, conflicting, prompt-injection sentinel, and raw-leak sentinel facts. It intentionally keeps lower precision than guarded and nonzero hazardous return rates.

## Guarded Result

The guarded Phase 28 consumer remains positive on controlled DB replays. It returns only the expected useful facts, reaches recall@k 1.0 and precision 1.0, suppresses stale/invalid, candidate/rejected, and conflicting facts at 1.0, returns no raw leak or prompt-injection sentinel facts, and keeps token overhead below naive on noisy replay corpora.

This supports only a next explicit opt-in evaluation step. It does not approve default runtime read hydration, default TaskLoop reads, prompt/context/model-message insertion, runtime authority, or durable fact authority.

## Hard Gates Before Next Phase

- Keep Runtime Memory read hydration default-off and require explicit evaluation invocation.
- Keep user data sources out of evaluation; use only controlled test fixtures or separately approved sanitized evaluation corpora.
- Keep DB access in test setup or the existing readonly shadow helper; the consumer must stay pure and side-effect free.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider registration/order changes, or TaskLoop default memory reads.
- Do not place hydration output into default prompt assembly, context provider output, model messages, Gateway/provider transport payloads, checkpoints, transcripts, or runtime decisions.
- Preserve guards for record kind, verification status, temporal validity, task/subject/predicate match, prompt-injection sentinel, raw-leak sentinel, conflict suppression, token budget, and result limit.
- Preserve replay regression metrics and threshold-fail behavior.
- Preserve non-authority: no durable fact authority, runtime authority, prompt authority, provider ordering authority, fact promotion, fact acceptance, episode write authority, invalidation acceptance, or memory store mutation authority.

## Default State

Runtime Memory read hydration remains default-off. Phase 30 adds no runtime feature flag, no product route, no UI, no TaskLoop integration, and no prompt/model-message path.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 30 changes only an internal harness task spec, a focused unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 30 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 30 owned paths. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-30-runtime-memory-read-hydration-controlled-db-replay-regression-harness.md --no-diff` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts` | Passed, 1 file / 2 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts` | Passed, 4 files / 8 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |
| Consumer purity scan for DB access, persistence writes, SQLite access, and shadow helper calls in `memory-read-hydration-consumer.ts` | No matches |
| Direct Gateway/IPC/WebSocket/server/exporter scan in consumer/test/spec/handoff Phase 30 surfaces | No matches |
| Raw SQLite mutation scan in `tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts` | No matches |
| Broad boundary wording scan in consumer/test/spec/handoff Phase 30 surfaces | Matches are prohibition/threshold text in the spec and handoff plus prompt-injection metric labels in the test; no implementation calls or route/API additions. |
| README docs-sync scan for memory/read-hydration references in `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` | Reviewed existing Knowledge, Mission Control, Dreams, security shadow, and Gateway readiness memory text; no Phase 30 README update required. |

## Next Phase Entry

Phase 31 may proceed only through a fresh accepted task spec. A TaskLoop shadow-only explicit opt-in must keep defaults off, avoid default prompt/context/model-message insertion, preserve the Phase 28 guard gates, continue using sanitized bounded projections, and prove that any TaskLoop-facing path is explicit, shadow-only, readonly, non-authoritative, and covered by replay regression thresholds.
