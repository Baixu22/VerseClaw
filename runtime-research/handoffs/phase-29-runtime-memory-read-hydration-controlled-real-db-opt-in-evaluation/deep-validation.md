# Phase 29 Runtime Memory Read Hydration Controlled Real DB Opt-in Evaluation Deep Validation

## Scope

Phase 29 is an explicit controlled real DB opt-in evaluation only. It creates a test-owned temporary Runtime Memory SQLite DB, writes sanitized episodes/facts/candidates/invalidations through existing persistence helpers, reads sanitized projections through the existing read-hydration shadow helper, and evaluates baseline no memory, naive hydration, and the Phase 28 guarded consumer.

This is not a cutover, not default-on behavior, not runtime authority, and not durable fact authority. It adds no TaskLoop default path, Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, prompt/context/model-message injection, or user-data read/write path.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md` | Fresh Phase 29 task spec with controlled real DB opt-in boundaries. |
| `tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts` | Focused temporary SQLite DB evaluation using existing persistence helpers, the existing shadow helper, and the Phase 28 consumer. |
| `runtime-research/handoffs/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation/deep-validation.md` | This validation handoff. |

No production runtime helper was added or changed. The Phase 28 consumer remains a pure function over sanitized fact projections and an explicit query.

## Controlled DB Corpus

The test creates only a temporary DB under the OS temp directory and removes it after each test. It writes through `createRuntimeMemoryPersistenceStore` and reads through `readRuntimeMemoryHydrationShadow`.

| Corpus class | DB-backed examples |
|---|---|
| Useful verified facts | `fact_pkg_pnpm`, `fact_test_vitest`, `fact_locale_zh`, `fact_host_api` |
| Expired | `fact_pkg_npm_expired` |
| Invalidated | `fact_locale_invalid_en` plus persisted `invalidation_fact_locale_invalid_en` |
| Future-valid | `fact_pkg_bun_future`, `fact_locale_future_ja` |
| Candidate | `fact_host_api_candidate_wrong` |
| Rejected | `fact_host_api_rejected_wrong` |
| Verification-status mismatch | `fact_host_api_human_approved` |
| Conflict | `fact_pkg_yarn_conflict`, `fact_test_jest_conflict` |
| Task/subject/predicate mismatch | `fact_other_task`, `fact_other_subject`, `fact_other_predicate` |
| Prompt-injection sentinel | `fact_host_api_injection` |
| Raw-leak sentinel | `fact_host_api_raw_leak` using sanitized `record_json` sentinel text, not raw row data |
| Zero token budget | Explicit consumer query with `tokenBudget: 0` |
| Zero limit | Explicit consumer query with `limit: 0` |
| Empty no-op | Explicit consumer query over `[]` |

The shadow helper loaded 2 sanitized episode summaries and 18 sanitized fact projections from the controlled DB. It returned the existing readonly authority boundary: diagnostics-only, readonly, no prompt injection, no provider ordering, no runtime authority, and no durable fact authority.

## Quantitative Result

Metrics below are from the focused Phase 29 DB-backed evaluation run. Latency is environment-dependent; the test asserts it remains below 500 ms.

| Metric | Baseline no memory | Naive hydration | Guarded opt-in consumer |
|---|---:|---:|---:|
| recall@k | 0 | 1.0 | 1.0 |
| precision | 0 | 0.2667 | 1.0 |
| stale/invalid suppression | 1.0 | 0 | 1.0 |
| candidate/rejected suppression | 1.0 | 0 | 1.0 |
| conflict suppression | 1.0 | 0 | 1.0 |
| raw leak rate | 0 | 0.0667 | 0 |
| prompt injection return rate | 0 | 0.0667 | 0 |
| latency overhead | 0 ms | 6.0522 ms captured, asserted `< 500 ms` | 6.0522 ms captured, asserted `< 500 ms` |
| token overhead | 0 | 2647 | 121 |
| failure/no-op rate | 1.0 | 0 | 0 |

## Judgment

Baseline remains negative because it returns no memory effect: recall@k is 0 and every evaluation query is a no-op.

Naive hydration remains negative even against sanitized real DB projections. It retrieves the useful facts, so recall reaches 1.0, but it also returns expired, invalidated, future-valid, candidate, rejected, verification-status-mismatch, conflicting, prompt-injection sentinel, and raw-leak sentinel facts. Precision is only 0.2667, suppression rates for stale/invalid, candidate/rejected, and conflict classes are all 0, and raw/prompt sentinel return rates are nonzero.

The guarded Phase 28 consumer is positive on the controlled DB corpus. It returns exactly the four expected useful verified facts, reaches recall@k 1.0 and precision 1.0, suppresses stale/invalid, candidate/rejected, and conflict classes at 1.0, returns no raw leak or prompt-injection sentinel facts, and reduces token overhead from 2647 to 121.

This result supports only the next opt-in evaluation step. It does not approve default runtime read hydration, default TaskLoop reads, prompt/context/model-message insertion, runtime authority, or durable fact authority.

## Hard Gates Before Next Phase

- Keep Runtime Memory read hydration default-off and require explicit evaluation invocation.
- Keep user data sources out of evaluation; use only controlled test fixtures or separately approved sanitized evaluation corpora.
- Keep DB access in test setup or the existing readonly shadow helper; the consumer must stay pure and side-effect free.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider registration/order changes, or TaskLoop default memory reads.
- Do not place hydration output into default prompt assembly, context provider output, model messages, Gateway/provider transport payloads, checkpoints, transcripts, or runtime decisions.
- Preserve guards for record kind, verification status, temporal validity, task/subject/predicate match, prompt-injection sentinel, raw-leak sentinel, conflict suppression, token budget, and result limit.
- Preserve metrics for recall@k, precision, stale/invalid suppression, candidate/rejected suppression, conflict suppression, raw leak rate, prompt injection return rate, latency overhead, token overhead, and failure/no-op rate.
- Preserve non-authority: no durable fact authority, runtime authority, prompt authority, provider ordering authority, fact promotion, fact acceptance, episode write authority, invalidation acceptance, or memory store mutation authority.

## Default State

Runtime Memory read hydration remains default-off. Phase 29 adds no runtime feature flag, no product route, no UI, no TaskLoop integration, and no prompt/model-message path.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 29 changes only an internal harness task spec, a focused unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 29 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts` | Passed, 1 file / 2 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 29 touched areas. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-29-runtime-memory-read-hydration-controlled-real-db-opt-in-evaluation.md --no-diff` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts` | Passed, 3 files / 6 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |
| Consumer purity scan for DB writes, SQLite access, persistence helpers, and hydration helper calls in `memory-read-hydration-consumer.ts` | No matches |
| Renderer direct IPC/Gateway scan in `src/pages` and `src/components` | No matches |
| Phase 29 actual-call/import scan for host-api/api-client/Gateway/TaskLoop, direct IPC/fetch/WebSocket/server calls, model-message, prompt assembly, or context-item injection shapes | No matches |
| Service/listener/server/exporter scan in Phase 29 code surfaces | No matches |
| README docs-sync scan for runtime memory/read hydration references | Reviewed existing Knowledge, Mission Control, Dreams, and Gateway readiness memory text; no Phase 29 README update required |
| Trailing whitespace scan for the three Phase 29 files | No matches |

## Next Phase Entry

The next phase may proceed only through a fresh accepted task spec. Before any broader opt-in, it must define the exact controlled corpus source, keep defaults off, keep output readonly and bounded, preserve the Phase 28 guard gates, prove no prompt/context/model-message injection, and explicitly re-run docs/comms/boundary validation.
