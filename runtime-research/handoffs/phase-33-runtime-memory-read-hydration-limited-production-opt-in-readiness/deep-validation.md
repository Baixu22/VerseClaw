# Phase 33 Runtime Memory Read Hydration Limited Production Opt-in Readiness Deep Validation

## Scope

Phase 33 defines limited production opt-in readiness for Runtime Memory read hydration. It is readiness evidence only: no default TaskLoop read hydration, no product runtime cutover, no user Runtime Memory DB reads, no prompt/context/model-message injection, no provider/tool authority, no runtime authority, and no durable fact authority.

This phase adds no Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, default memory provider registration, or product feature flag.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md` | Fresh Phase 33 task spec defining operator, corpus, privacy/retention, rollback, and metrics gates required before Phase 34. |
| `tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts` | Focused readiness sentinel covering default-off TaskLoop behavior, fail-closed missing gates before DB access, valid readiness gates, Phase 32 controlled corpus metrics, zero injection, zero deltas, zero durable writes, zero budget/limit, and empty no-op. |
| `runtime-research/handoffs/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness/deep-validation.md` | This validation handoff. |

No production runtime code was changed for Phase 33.

## Readiness Gates

Phase 33 defines the hard gates required before a Phase 34 limited production opt-in implementation spec can be considered.

| Gate | Required Evidence |
|---|---|
| Operator gate | Named operator owner, approval ref, explicit per-run opt-in request, diagnostics-only/shadow-only scope, bounded scope, expiry window, default-off attestation, no-cutover attestation. |
| Corpus gate | Approved provenance, sanitized status, no-user-real-data readiness corpus, reproducible corpus version, audit refs, sanitizer boundary preserved. |
| Privacy/retention gate | No raw transcript/chat/jsonl/trace/prompt/tool/env/secret material, bounded retention, deletion owner, aggregate metrics only outside diagnostics, no user Runtime Memory DB read, no durable fact authority. |
| Rollback gate | Single operator kill switch, rollback owner, explicit disable procedure, no migration required, no durable writes to undo, rollback validation commands. |
| Metrics gate | Guarded recall@k 1, guarded precision 1, stale/invalid suppression 1, candidate/rejected suppression 1, conflict suppression 1, raw leak rate 0, prompt injection return rate 0, TaskLoop decision delta 0, tool/provider ordering delta 0, prompt/context/model-message/checkpoint/transcript/lifecycle/trace injection 0, durable memory write count 0, threshold violations 0. |

The focused test models these gates as a local readiness contract. Missing gates return `status: "blocked"` and do not execute the candidate TaskLoop path, so the injected DB opener is never called. Accepted gates allow only the already existing Phase 32 controlled internal shadow pilot path over a controlled temporary fixture DB.

## Controlled Corpus

The positive readiness path uses a deterministic temporary SQLite fixture, not a user Runtime Memory DB.

| Field | Value |
|---|---|
| Corpus id | `phase33-limited-production-opt-in-readiness-fixture` |
| Version | `2026-06-30.1` |
| Provenance | `controlled_fixture` |
| Sanitized | `true` |
| No user real data | `true` |
| Reproducible | `true` |
| Audit refs | Phase 33 task spec and focused unit test |

The corpus includes useful verified facts plus stale/expired, invalidated, future-valid, candidate, rejected, verification-mismatch, conflicting, prompt-injection sentinel, raw-leak sentinel, task mismatch, subject mismatch, and predicate mismatch records.

## Metrics And Thresholds

The valid readiness path loads 16 sanitized fact projections and runs 6 guarded queries through the existing Phase 32 TaskLoop shadow-only diagnostics seam.

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

The accepted readiness run is compared against a baseline TaskLoop run with the same fake orchestration/self-check inputs. Status, phase, final summary, next actions, evidence gate status, iteration count, and self-check decision remain identical.

The observed orchestration request shape is byte-for-byte identical between baseline and readiness runs, proving provider/tool ordering input did not change in the tested path.

The test scans reviewer prompts, checkpoints, lifecycle events, stored traces, observed orchestration requests, and iteration snapshots for controlled fact ids, useful fact text, prompt-injection sentinel text, raw-leak sentinel text, the diagnostics property name, and the corpus id. Prompt/context/model-message, checkpoint, transcript, lifecycle, and trace injection counts are all 0.

The injected runtime memory episode writer is not called, and report metrics keep durable memory write count at 0.

## Phase 34 Hard Gates

Phase 34 may start only with a fresh task spec and all of these preconditions:

- Keep read hydration default-off and require explicit operator opt-in.
- Keep limited production opt-in diagnostics-only and shadow-only; no runtime cutover.
- Define the operator owner, approval refs, participant/corpus scope, expiry, and renewal process.
- Define approved corpus provenance, sanitizer proof, reproducibility, audit refs, and privacy/retention policy.
- Do not read user Runtime Memory DBs until a fresh implementation spec explicitly accepts that scope with privacy/security review.
- Keep diagnostics out of prompt assembly, context provider output, model messages, checkpoints, transcripts, lifecycle events, traces, provider/tool inputs, and durable memory writes.
- Preserve guard gates for record kind, verification status, temporal validity, task/subject/predicate match, prompt-injection sentinel, raw-leak sentinel, conflicts, token budget, and result limit.
- Preserve TaskLoop decision delta count 0, tool/provider ordering delta count 0, prompt/context/model-message/checkpoint/transcript/lifecycle/trace injection count 0, raw leak rate 0, prompt injection return rate 0, durable memory write count 0, and threshold violations 0.
- Define rollback owner, kill switch, no-migration disable path, no durable writes to undo, and rollback validation commands.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, provider ordering changes, or default runtime feature switches unless a future spec explicitly accepts that surface and runs its required validation.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 33 changes only an internal harness task spec, a focused internal readiness unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 33 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, gateway events, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts` | Passed, 1 file / 3 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 33 touched areas. The harness reported many changed files not covered by the Phase 33 touched areas or scenario owned paths. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-33-runtime-memory-read-hydration-limited-production-opt-in-readiness.md --no-diff` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-limited-production-opt-in-readiness.test.ts tests/unit/runtime-memory-read-hydration-controlled-internal-shadow-pilot.test.ts tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts` | Passed, 6 files / 74 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Blocked by unrelated existing errors in `electron/services/mcp-api.ts`: unused `VERSE_CLAW_STORAGE_MCP_TOOLS`, unused `callClawxStorageTool`, and `string[] | undefined` not assignable to `SystemScanCategoryId[] | undefined`. Phase 33 touched no Electron service files. |
| Direct transport scan on Phase 33 touched files | No implementation matches. The only direct transport match is the literal validation-command text in the Phase 33 spec. |
| Import/API boundary scan on Phase 33 test | No imports from Electron, renderer, shared contracts, host-api, or api-client. The test imports only runtime/controller/test dependencies. |
| DB/write scan on Phase 33 touched files | Matches are fixture setup `appendEpisode` / `appendFact`, the injected `appendEpisode` writer that must not be called, and policy text in the spec. No production write path or default DB read was added. |
| Policy wording scan on Phase 33 spec/handoff/test | Matches are prohibition text and metric labels in spec/handoff only; no route/API/UI additions. |
| README docs-sync keyword scan on `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` | No Phase 33/read-hydration/limited-production opt-in matches; no README update required because there is no user-visible behavior change. |
| Phase 33 touched file status | Only new Phase 33 spec, handoff directory, and focused readiness test are in scope. |

Note: bare `rtk.exe` was not on the PowerShell PATH in this environment, so validation used the existing project/spec path `C:\Users\27933\.cherrystudio\bin\rtk.exe`.
