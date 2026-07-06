# Phase 34 Runtime Memory Read Hydration Limited Production Opt-in Implementation Deep Validation

## Scope

Phase 34 implements the smallest runtime gate for Runtime Memory read hydration limited production opt-in. It is based on Phase 33 readiness evidence and remains limited to the existing explicit TaskLoop diagnostics-only shadow path.

This phase is not a default runtime switch, not a product cutover, not prompt/context/model-message injection, not runtime authority, and not durable fact authority. It adds no Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, default memory provider registration, or user Runtime Memory DB read path.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md` | Fresh Phase 34 implementation spec with runtime gate assertions and Phase 35 hard gates. |
| `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts` | Adds optional `limitedProductionOptIn` runtime assertions to the existing explicit shadow-only diagnostics helper. Missing gates skip before DB open. |
| `tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts` | Focused implementation test covering default closed TaskLoop path, missing gate fail-closed behavior, accepted diagnostics-only path, guarded metrics, zero injection/deltas, zero budget/limit, and empty no-op. |
| `runtime-research/handoffs/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation/deep-validation.md` | This validation handoff. |

## Runtime Gate

The new `limitedProductionOptIn` option is optional. If omitted, existing Phase 31/32 explicit test/research behavior remains unchanged. If present with `enabled: true`, the helper requires all Phase 34 gates before any SQLite read:

| Gate | Runtime assertion |
|---|---|
| Operator gate | Explicit opt-in, operator owner, approval ref, diagnostics-only scope, bounded participant scope, bounded corpus scope, expiry, default-off attestation, and no-cutover attestation. |
| Corpus gate | Approved provenance, sanitized status, no-user-real-data status, reproducibility, audit refs, and preserved sanitizer boundary. |
| Privacy/retention gate | No raw material, 1-30 day retention window, deletion owner, aggregate metrics only, no user Runtime Memory DB read, and no durable fact authority. |
| Rollback gate | Kill switch, rollback owner, disable procedure, no migration required, no durable writes to undo, and validation commands. |
| Metrics gate | Guarded recall/precision/suppression thresholds, raw leak 0, prompt injection 0, TaskLoop/tool/provider deltas 0, injection counts 0, durable write count 0, and threshold violations 0. |

Gate failure returns `status: "skipped"` with `reason: "limited_production_opt_in_gate_required"` and `limitedProductionOptIn.accepted: false`. The injected read-only DB opener is not called in failure tests.

## Controlled Corpus

The positive Phase 34 path uses a deterministic temporary SQLite fixture, not a user Runtime Memory DB.

| Field | Value |
|---|---|
| Corpus id | `phase34-limited-production-opt-in-implementation-fixture` |
| Version | `2026-06-30.1` |
| Provenance | `controlled_fixture` |
| Sanitized | `true` |
| No user real data | `true` |
| Reproducible | `true` |
| Audit refs | Phase 34 task spec and focused unit test |

The corpus includes useful verified facts plus stale/expired, invalidated, future-valid, candidate, rejected, verification-mismatch, conflicting, prompt-injection sentinel, raw-leak sentinel, task mismatch, subject mismatch, and predicate mismatch records.

## Metrics And Thresholds

The accepted limited production opt-in path loads 16 sanitized fact projections and runs 6 guarded queries.

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
| Default/missing-gate fail-closed rate | 1 |
| TaskLoop decision delta count | 0 |
| Tool call delta count | 0 |
| Provider ordering delta count | 0 |
| Prompt/context/model-message injection count | 0 |
| Checkpoint/transcript/lifecycle/trace injection count | 0 |
| Durable memory write count from read diagnostics | 0 |
| Runtime authority count | 0 |
| Threshold violations | 0 |

Zero token budget and zero result limit return no accepted facts. Empty controlled corpus hydration returns loaded diagnostics with zero projections, zero accepted facts, zero rejected facts, zero token overhead, and no threshold violations.

## Decision And Injection Proof

Default TaskLoop execution has no `runtimeMemoryReadHydrationShadowOnlyDiagnostics` field, opens no read-hydration DB, and has no consumer effect.

The accepted Phase 34 run is compared against a baseline TaskLoop run with the same fake orchestration/self-check inputs. Status, phase, final summary, next actions, evidence gate status, iteration count, and self-check decision remain identical.

The observed orchestration request shape is byte-for-byte identical between baseline and Phase 34 accepted runs, proving provider/tool ordering input did not change in the tested path.

The test scans reviewer prompts, checkpoints, lifecycle events, stored traces, observed orchestration requests, and iteration snapshots for controlled fact ids, useful fact text, prompt-injection sentinel text, raw-leak sentinel text, the diagnostics property name, and the corpus id. Prompt/context/model-message, checkpoint, transcript, lifecycle, and trace injection counts are all 0.

The injected runtime memory episode writer is not called, and report metrics keep durable memory write count at 0.

## Phase 35 Hard Gates

Phase 35 may start only with a fresh task spec and all of these preconditions:

- Keep read hydration default-off and require explicit operator opt-in.
- Keep limited production opt-in diagnostics-only and shadow-only; no runtime cutover.
- Define operator owner, approval refs, participant/corpus scope, expiry, renewal, and kill-switch operation for any broader corpus.
- Do not read user Runtime Memory DBs until a fresh spec explicitly accepts that scope with privacy/security review and controlled substitute tests.
- Keep diagnostics out of prompt assembly, context provider output, model messages, checkpoints, transcripts, lifecycle events, traces, provider/tool inputs, and durable memory writes.
- Preserve guard gates for record kind, verification status, temporal validity, task/subject/predicate match, prompt-injection sentinel, raw-leak sentinel, conflicts, token budget, and result limit.
- Preserve TaskLoop decision delta count 0, tool/provider ordering delta count 0, prompt/context/model-message/checkpoint/transcript/lifecycle/trace injection count 0, raw leak rate 0, prompt injection return rate 0, durable memory write count 0, and threshold violations 0.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider ordering changes, or default runtime feature switches unless a future spec explicitly accepts that surface and runs its required validation.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 34 changes only an internal harness task spec, an internal explicit diagnostics gate, a focused unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 34 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, gateway events, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 34 touched areas. The harness reported many changed files not covered by the Phase 34 touched areas or scenario owned paths. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-34-runtime-memory-read-hydration-limited-production-opt-in-implementation.md --no-diff` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts` | Passed, 1 file / 4 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-limited-production-opt-in-implementation.test.ts tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts` | Passed, 7 files / 78 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |
| Phase 34 policy scan on helper/test/spec/handoff | Matches are prohibition/threshold text in spec/handoff and metric labels in the helper. No route/API/UI additions. |
| Direct renderer/Gateway transport scan on `src/pages src/components src/lib shared electron` | Matches are existing Electron/preload/gateway/project-rules/i18n text outside Phase 34 touched files; Phase 34 added no renderer, Gateway, IPC, host-api, api-client, or shared contract surface. |
| DB/write scan on controller/helper/Phase 34 test | Matches are the existing explicit helper read call, test fixture setup `appendEpisode` / `appendFact`, and injected writer assertion that must not be called. No default TaskLoop read DB open or production write path was added. |
| Phase 34 implementation scan for host-api/api-client/shared contract/IPC/Gateway/renderer patterns | No matches in touched implementation/test files. |
| README docs-sync scan on `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` for Phase 34/read-hydration/limited-production opt-in terms | No matches; no README update required because there is no user-visible behavior change. |
