# Phase 32 Runtime Memory Read Hydration Controlled Internal Shadow Pilot Deep Validation

## Scope

Phase 32 extends the Phase 31 explicit TaskLoop test/research shadow-only seam with controlled internal shadow pilot corpus metadata. The pilot can run only when `explicitOptIn: true`, `testResearchOnly: true`, and accepted corpus metadata are present before any SQLite read.

This is not default TaskLoop read hydration, not a runtime cutover, not prompt/context/model-message injection, not provider/tool authority, not runtime authority, and not durable fact authority. It adds no Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, default memory provider registration, or user-data read path.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md` | Fresh Phase 32 task spec with controlled pilot boundaries and validation gates. |
| `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts` | Minimal extension of the Phase 31 helper. It validates controlled pilot corpus metadata and skips before DB open if provenance, sanitization, no-user-real-data, reproducibility, or audit refs are missing. |
| `tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts` | Focused pilot test covering default closed state, invalid corpus skip-before-open, valid controlled pilot metrics, no authority effects, zero budget/limit, and empty DB no-op. |
| `runtime-research/handoffs/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot/deep-validation.md` | This validation handoff. |

## Implementation Boundary

Default TaskLoop execution remains unchanged. Without `deps.runtimeMemoryReadHydrationShadowOnly`, no diagnostics report is created and no read-hydration DB is opened.

The Phase 31 gates remain mandatory. If `explicitOptIn !== true`, the helper returns `status: "skipped"` with `reason: "explicit_opt_in_required"`. If `testResearchOnly !== true`, it returns `reason: "test_research_gate_required"`.

Phase 32 adds only a controlled pilot metadata gate behind those existing gates. When `controlledInternalShadowPilot.enabled === true`, the helper requires:

- approved provenance: `controlled_fixture` or `sanitized_internal_sample`
- non-empty corpus id and version
- `sanitized: true`
- `noUserRealData: true`
- `reproducible: true`
- at least one safe audit ref
- no prompt-injection or raw-leak sentinel text in pilot metadata

Invalid pilot metadata returns `reason: "pilot_corpus_boundary_required"` and does not open SQLite. Valid pilot metadata is included only in the returned readonly diagnostics report.

## Controlled Corpus

The focused pilot test uses a deterministic fixture corpus, not a user Runtime Memory DB.

| Field | Value |
|---|---|
| Corpus id | `phase32-controlled-internal-shadow-pilot-fixture` |
| Version | `2026-06-30.1` |
| Provenance | `controlled_fixture` |
| Sanitized | `true` |
| No user real data | `true` |
| Reproducible | `true` |
| Audit refs | Phase 32 task spec and focused unit test |

The valid pilot DB is created under the OS temp directory, seeded through existing Runtime Memory persistence fixtures/helpers, read through `readRuntimeMemoryHydrationShadow`, and removed in `afterEach`. The invalid-corpus case injects an `openReadOnlyDatabase` function that would throw, and the test asserts it is never called.

## Metrics And Thresholds

The valid pilot path loaded 16 sanitized fact projections and ran 6 guarded queries.

| Metric | Result |
|---|---:|
| Guarded recall@k | 1 |
| Guarded precision | 1 |
| Stale/invalid suppression | 1 |
| Candidate/rejected suppression | 1 |
| Conflict suppression | 1 |
| Raw leak rate | 0 |
| Prompt injection return rate | 0 |
| Token overhead | Positive |
| Latency overhead | `>= 0` and `< 500 ms` |
| Default/invalid path no-op rate | 1 |
| TaskLoop decision delta count | 0 |
| Tool call delta count | 0 |
| Provider ordering delta count | 0 |
| Prompt/context/model-message injection count | 0 |
| Checkpoint/transcript/lifecycle/trace injection count | 0 by payload scan |
| Durable memory write count from read diagnostics | 0 |
| Runtime authority count | 0 |
| Threshold violations | 0 |

The corpus includes stale/expired, invalidated, future-valid, candidate, rejected, verification-mismatch, conflicting, prompt-injection sentinel, raw-leak sentinel, task mismatch, subject mismatch, and predicate mismatch records. The guarded consumer returns only expected verified current facts.

Zero token budget and zero result limit return no accepted facts. Empty migrated DB pilot hydration returns loaded diagnostics with zero projections, zero accepted facts, zero rejected facts, zero token overhead, and no threshold violations.

## Decision And Injection Proof

The explicit pilot run is compared against a baseline TaskLoop run with the same fake orchestration/self-check inputs. Status, phase, final summary, next actions, evidence gate status, iteration count, and self-check decision remain identical.

The observed orchestration request shape is byte-for-byte identical between baseline and pilot runs, proving no provider/tool ordering input changed in the tested path.

The test scans reviewer prompts, checkpoints, lifecycle events, stored traces, observed orchestration requests, and iteration snapshots for pilot fact ids, useful fact text, prompt-injection sentinel text, raw-leak sentinel text, the diagnostics property name, and the corpus id. None appear outside the diagnostics report.

The injected runtime memory episode writer is not called in the pilot test, and report metrics keep durable memory write count at 0. The helper does not call append/write/invalidation APIs.

## Default State

Runtime Memory read hydration remains default-off for TaskLoop. Phase 32 adds no runtime feature flag and no product route. The new controlled pilot metadata is reachable only through the existing optional TaskLoop dependency/test-research seam.

## Hard Gates Before Phase 33

- Keep read hydration default-off and require explicit invocation.
- Keep the `testResearchOnly` gate until a fresh Phase 33 spec defines the limited production opt-in operator boundary.
- Require accepted corpus provenance, sanitization, no-user-real-data, reproducibility, and audit refs before any pilot DB read.
- Keep DB reads limited to temporary fixture DBs or separately approved sanitized internal pilot corpora; no user real data source reads.
- Keep the consumer pure and side-effect free.
- Keep diagnostics out of prompt assembly, context provider output, model messages, checkpoints, transcripts, lifecycle events, traces, provider/tool inputs, and durable memory writes.
- Preserve guard gates for record kind, verification status, temporal validity, task/subject/predicate matching, prompt-injection sentinel, raw-leak sentinel, conflicts, token budget, and result limit.
- Preserve TaskLoop decision delta count 0, provider/tool ordering delta count 0, prompt/context/model-message injection count 0, checkpoint/transcript injection count 0, raw leak rate 0, prompt injection return rate 0, durable memory write count 0, and threshold violations 0.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, or default runtime feature switches.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 32 changes only an internal harness task spec, an internal TaskLoop test/research diagnostic seam, a focused unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 32 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, gateway events, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts` | Passed, 1 file / 3 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts` | First run hit an import-time local resolution error for `@openclaw/fs-safe/dist/path.js`; the file existed on disk, and the immediate retry passed, 6 files / 73 tests. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 32 touched areas. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-32-runtime-memory-read-hydration-controlled-internal-shadow-pilot.md --no-diff` | Passed |
| Direct transport scan on Phase 32 helper/test implementation | No implementation matches for direct IPC, Gateway HTTP, localhost Gateway, or renderer WebSocket patterns. |
| Phase 32 touched-file policy scan | Matches are policy/threshold text in spec/handoff plus metric labels in the helper; no route/API/UI additions. |
| DB/write scan on controller/helper/test | Matches are the existing explicit helper call, test setup `appendEpisode`/`appendFact`, injected writer assertion, and pre-existing TaskLoop shadow persistence writer. No default TaskLoop read-hydration DB open was added. |
| README docs-sync review | No README update required because there is no user-visible behavior change. |

## Next Phase Entry

Phase 33 limited production opt-in readiness can proceed only through a fresh task spec. Preconditions are: define the operator-controlled opt-in boundary, define approved sanitized corpus provenance/retention rules, keep default-off behavior, keep diagnostics readonly/non-authoritative, preserve all zero-injection and zero-delta gates, and rerun boundary, docs, comms, threshold, and TypeScript validation for any newly touched surface.
