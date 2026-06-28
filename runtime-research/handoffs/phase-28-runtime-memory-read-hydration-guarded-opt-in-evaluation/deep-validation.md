# Phase 28 Runtime Memory Read Hydration Guarded Opt-in Evaluation Deep Validation

## Scope

Phase 28 is an explicit opt-in consumer evaluation only. It adds a pure guarded consumer for sanitized Runtime Memory read-hydration shadow fact projections and a fixed mock corpus evaluation. It does not approve default runtime cutover, default TaskLoop memory reads, prompt/context/model-message injection, Gateway/Electron/renderer/host-api/api-client/shared contract changes, provider registration/order changes, durable fact authority, or runtime authority.

The consumer accepts only `RuntimeMemoryHydrationShadowFactProjection[]` plus an explicit query and returns `acceptedFacts`, `rejectedFacts`, and `metrics`. It does not read a database, write a database, call TaskLoop, call a provider, call Gateway, create a route, create IPC, or mutate memory state.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md` | Fresh Phase 28 task spec with explicit no-cutover/no-runtime-authority boundaries. |
| `openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts` | Pure guarded consumer over hydration fact projections. |
| `openclaw_runtime/src/runtime-core/index.ts` | Barrel export only; no registration or invocation path. |
| `tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts` | Fixed mock corpus comparing baseline, naive hydration, and guarded opt-in consumer. |
| `runtime-research/handoffs/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation/deep-validation.md` | This validation handoff. |

## Consumer Guards

The guarded consumer rejects any projection that trips one of these hard gates:

| Guard | Rejection reason |
|---|---|
| `recordKind !== "fact"` | `record_kind_not_fact` |
| `verificationStatus !== "verified"` | `verification_status_not_verified` |
| `valid_at > referenceTime` | `future_valid_at` |
| `invalid_at <= referenceTime` | `invalidated_at_reference_time` |
| `expired_at <= referenceTime` | `expired_at_reference_time` |
| `taskId` mismatch | `task_mismatch` |
| `subject` mismatch | `subject_mismatch` |
| `predicate` mismatch | `predicate_mismatch` |
| prompt-injection-like text | `prompt_injection_sentinel` |
| raw leak sentinel text | `raw_leak_sentinel` |
| lower-ranked same task/subject/predicate conflict | `conflicting_fact` |
| token budget exhaustion | `token_budget_exceeded` |
| explicit result limit exhaustion | `limit_exceeded` |

## Mock Corpus Coverage

The deterministic corpus uses direct hydration projection fixtures, not a database. It covers:

| Corpus class | Example |
|---|---|
| Useful project preference facts | `fact_pkg_pnpm`, `fact_test_vitest` |
| User language preference facts | `fact_locale_zh` |
| Backend boundary facts | `fact_host_api` |
| Expired facts | `fact_pkg_npm_expired` |
| Invalidated facts | `fact_locale_invalid_en` |
| Future-valid facts | `fact_locale_future_ja` |
| Candidate facts | `fact_host_api_candidate_wrong` |
| Rejected/non-verified facts | `fact_host_api_rejected_wrong` |
| Prompt-injection-like facts | `fact_host_api_injection` |
| Raw leak sentinel facts | `fact_host_api_raw_leak` |
| Conflicting facts | `fact_pkg_yarn_conflict`, `fact_test_jest_conflict` |
| Query mismatch facts | `fact_other_task`, `fact_other_subject`, `fact_other_predicate` |
| No-op and explicit boundary inputs | empty input, `tokenBudget: 0`, `limit: 0` |

## Quantitative Result

The fixed evaluation has four query intents: package manager preference, test runner preference, user reply language, and renderer backend boundary. Values are deterministic except latency, which is measured at runtime and asserted below 500 ms for the focused unit evaluation.

| Metric | Baseline no memory | Naive hydration | Guarded opt-in consumer |
|---|---:|---:|---:|
| recall@k | 0 | 1.0 | 1.0 |
| precision | 0 | 0.3077 | 1.0 |
| stale/invalid suppression rate | 1.0 | 0 | 1.0 |
| raw leak rate | 0 | 0.0769 | 0 |
| prompt injection return rate | 0 | 0.0769 | 0 |
| latency overhead | 0 | measured, asserted `< 500 ms` | measured, asserted `< 500 ms` |
| token overhead | 0 | highest returned payload cost | positive and lower than naive |
| failure/no-op rate | 1.0 | 0 | 0 |

## Judgment

Naive hydration remains negative on the mock corpus. It recovers useful facts, so recall reaches 1.0, but it also returns expired, invalidated, candidate, rejected, prompt-injection-like, raw-leak, and conflicting facts. The precision drop to 0.3077, stale/invalid suppression of 0, and nonzero prompt/raw return rates make naive prompt/context consumption unsafe.

The guarded opt-in consumer is positive on the mock corpus. It returns exactly the four expected useful facts, reaches recall@k 1.0 and precision 1.0, suppresses stale/invalid facts at 1.0, returns no raw leak or prompt-injection sentinel facts, has no no-op queries, and keeps token overhead below naive hydration.

This is still not approval for default runtime cutover. The result proves only that a guarded explicit consumer is worth evaluating next against a controlled real Runtime Memory DB corpus.

## Hard Gates Before Real Opt-in Evaluation

Any controlled real DB opt-in evaluation must keep these gates:

- Keep default Runtime Memory reads off and require explicit evaluation invocation.
- Keep the consumer pure over sanitized hydration projections; database access stays in the existing explicit read-hydration shadow helper.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider registration/order changes, or TaskLoop default memory reads.
- Do not place hydration output into default prompt assembly, context provider output, model messages, Gateway/provider transport payloads, checkpoints, or transcripts.
- Require `recordKind: "fact"`, `verificationStatus: "verified"`, valid temporal window, exact task/subject/predicate match, prompt-injection sentinel rejection, raw leak sentinel rejection, conflict suppression, token budget enforcement, and bounded result limits.
- Preserve metrics for recall@k, precision, stale/invalid suppression, raw leak rate, prompt injection return rate, latency overhead, token overhead, and failure/no-op rate.
- Preserve non-authority: no durable fact authority, runtime authority, prompt authority, provider ordering authority, fact promotion, fact acceptance, episode write, invalidation acceptance, or memory store mutation.

## Default State

Runtime Memory read hydration remains default-off. Phase 28 adds no runtime feature flag, no product route, no UI, no TaskLoop integration, and no prompt/model-message path.

## Docs Sync

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. A Runtime Memory/read-hydration scan found only existing Knowledge, Mission Control, Dreams, and Gateway readiness memory text. No README update is required because Phase 28 changes only internal runtime-core research helpers, focused unit tests, task spec, and handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 28 touched areas. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-28-runtime-memory-read-hydration-guarded-opt-in-evaluation.md --no-diff` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts` | Passed, 2 files / 4 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |
| `rg -n "Runtime Memory|runtime memory|read hydration|hydration|memory" README.md README.zh-CN.md README.ja-JP.md` | Reviewed; no Phase 28 README update required. |
| Boundary scan for DB writes, SQLite access, hydration helper calls, TaskLoop/provider/Gateway/IPC/host-api/api-client calls in `memory-read-hydration-consumer.ts` | No matches |
| Boundary scan for service/listener/server/exporter patterns in consumer/test/spec surfaces | Only Phase 28 spec prohibition text matched |

## Next Phase Entry

Controlled real DB opt-in evaluation may proceed as the next phase only through a fresh accepted task spec. It should use an explicit existing Runtime Memory DB, a fixed query corpus, the same baseline/naive/guarded comparison, and the hard gates above. It must remain default-off, readonly, bounded, non-authoritative, and outside default prompts/context/model messages.
