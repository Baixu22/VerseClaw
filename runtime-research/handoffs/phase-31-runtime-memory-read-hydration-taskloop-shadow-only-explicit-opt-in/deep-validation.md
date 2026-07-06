# Phase 31 Runtime Memory Read Hydration TaskLoop Shadow-only Explicit Opt-in Deep Validation

## Scope

Phase 31 adds an explicit TaskLoop test/research shadow-only seam for Runtime Memory read hydration diagnostics. The seam can read sanitized projections from a controlled temporary SQLite DB through the existing `readRuntimeMemoryHydrationShadow` helper and pass those projections to the Phase 28 guarded consumer.

This is not default TaskLoop read hydration, not a runtime cutover, not prompt/context/model-message injection, not provider/tool authority, not runtime authority, and not durable fact authority. It adds no Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider ordering change, default memory provider registration, or user-data read path.

## Implemented Artifacts

| Artifact | Purpose |
|---|---|
| `harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md` | Fresh Phase 31 task spec with explicit shadow-only boundaries and validation gates. |
| `openclaw_runtime/src/agents/task-loop-runtime-memory-read-hydration-shadow.ts` | Isolated TaskLoop test/research diagnostics helper. It requires `explicitOptIn: true` and `testResearchOnly: true` before it calls `readRuntimeMemoryHydrationShadow`; it returns readonly diagnostics and metrics only. |
| `openclaw_runtime/src/agents/task-loop-controller.ts` | Minimal optional dependency/report field. The default path does not provide the dependency and does not call the helper. The report is not passed into context pack construction, reviewer prompts, self-check inputs, checkpoints, or runtime memory writes. |
| `tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts` | Focused TaskLoop unit test covering default closed state, disabled opt-in, explicit temporary DB diagnostics, no prompt/context/checkpoint injection, decision parity, zero budget, zero limit, and empty DB no-op. |
| `runtime-research/handoffs/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in/deep-validation.md` | This validation handoff. |

## Implementation Boundary

Default TaskLoop execution remains unchanged. Without `deps.runtimeMemoryReadHydrationShadowOnly`, no diagnostics report is created and no read-hydration DB is opened.

When the dependency is present but `explicitOptIn !== true`, the helper returns `status: "skipped"` with `reason: "explicit_opt_in_required"` and does not call the read-hydration helper. When `testResearchOnly !== true`, it similarly skips with `reason: "test_research_gate_required"`.

Only after both gates are true does the helper call `readRuntimeMemoryHydrationShadow` with `readShadow: true`, then run `consumeRuntimeMemoryHydrationFacts` for the supplied explicit queries. The report authority declares diagnostics-only, readonly, shadow-only, no prompt/context/model-message authority, no TaskLoop decision authority, no tool selection authority, no provider ordering authority, no runtime authority, no durable fact authority, no checkpoint authority, no transcript authority, and no memory write authority.

The controller stores the report on the returned TaskLoop record only. It is not added to `TaskLoopContextPack`, not formatted into reviewer prompts, not passed to self-check model messages, not serialized into checkpoint metadata, not written to Runtime Memory, and not used to alter decisions or next actions.

## Focused Corpus

The Phase 31 test creates only temporary SQLite DBs under the OS temp directory and removes them in `afterEach`.

| Corpus class | Example |
|---|---|
| Useful verified fact | `fact_pkg_pnpm` |
| Expired fact | `fact_pkg_npm_expired` |
| Invalidated fact | `fact_pkg_deno_invalid` |
| Future-valid fact | `fact_pkg_bun_future` |
| Conflict fact | `fact_pkg_yarn_conflict` |
| Candidate/rejected facts | `fact_pkg_candidate_npm`, `fact_pkg_rejected_yarn` |
| Verification mismatch | `fact_pkg_human_approved` |
| Prompt-injection sentinel | `fact_pkg_injection` |
| Raw-leak sentinel | `fact_pkg_raw_leak` |
| Subject/predicate mismatch | `fact_other_subject`, `fact_other_predicate` |
| Boundary no-ops | `tokenBudget: 0`, `limit: 0`, and an empty migrated DB |

## Metrics And Thresholds

The explicit TaskLoop shadow-only path loaded 12 sanitized fact projections from the controlled DB and returned exactly `fact_pkg_pnpm` for the package-manager query.

| Metric | Result |
|---|---:|
| Guarded recall@k | 1 |
| Guarded precision | 1 |
| Stale/invalid suppression | 1 |
| Candidate/rejected suppression | 1 |
| Conflict suppression | 1 |
| Raw leak rate | 0 |
| Prompt injection return rate | 0 |
| Token overhead | Positive and bounded by explicit consumer result |
| Latency overhead | Asserted `>= 0` and `< 500 ms` |
| Default/disabled path no-op rate | 1 |
| TaskLoop decision delta count | 0 |
| Tool call delta count | 0 |
| Provider ordering delta count | 0 |
| Prompt/context/model-message injection count | 0 |
| Durable memory write count from read diagnostics | 0 |
| Runtime authority count | 0 |
| Threshold violations | 0 |

The focused test also asserts the guarded rejection counts for stale/invalid, candidate/rejected, verification mismatch, conflict, prompt-injection sentinel, and raw-leak sentinel facts. Zero token budget and zero result limit both return no accepted facts. The empty migrated DB returns loaded diagnostics with zero projections, zero accepted facts, zero rejected facts, and zero token overhead.

## Decision And Injection Proof

The explicit diagnostic run is compared against a baseline TaskLoop run with the same fake orchestration/self-check inputs. Status, phase, final summary, next actions, evidence gate status, iteration count, and self-check decision remain identical.

The observed orchestration request shape is identical between baseline and explicit diagnostic runs, proving no provider/tool ordering input changed in the tested path.

The reviewer prompt and checkpoint payloads are serialized and checked for absence of `fact_pkg_pnpm`, useful fact text, prompt-injection sentinel text, raw-leak sentinel text, and `runtimeMemoryReadHydrationShadowOnlyDiagnostics`. Prompt/context/model-message injection count is therefore 0 in the focused proof.

## Default State

Runtime Memory read hydration remains default-off for TaskLoop. Phase 31 adds no runtime feature flag and no product route. The new controller dependency is not populated by normal runtime configuration, UI, Gateway, host-api, api-client, or shared contracts.

## Hard Gates Before Phase 32

- Keep read hydration default-off and require explicit invocation.
- Keep the `testResearchOnly` gate until a fresh Phase 32 task spec defines the controlled internal pilot corpus and operator boundary.
- Keep DB reads limited to temporary test DBs or a separately approved sanitized internal pilot corpus; no user real data source reads.
- Keep the consumer pure and side-effect free.
- Keep diagnostics out of prompt assembly, context provider output, model messages, checkpoints, transcripts, provider/tool inputs, and durable memory writes.
- Preserve exact guard gates for record kind, verification status, temporal validity, task/subject/predicate matching, prompt-injection sentinel, raw-leak sentinel, conflicts, token budget, and result limit.
- Preserve TaskLoop decision delta count 0, provider/tool ordering delta count 0, prompt/context/model-message injection count 0, raw leak rate 0, prompt injection return rate 0, and threshold violations 0.
- Do not add Gateway routes, Electron IPC routes, renderer UI, host-api/api-client/shared contracts, or default runtime feature switches.

## Docs And Comms Judgment

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`. No README update is required because Phase 31 changes only an internal task spec, an internal TaskLoop test/research diagnostic seam, a focused unit test, and research handoff documentation. It does not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

Comms replay/compare are not required because Phase 31 does not touch Main/Gateway/host-api/api-client/provider transport, channel delivery, runtime send/receive, gateway events, or fallback behavior.

## Validation

| Check | Result |
|---|---|
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts` | Passed, 1 file / 3 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run tests/unit/runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.test.ts tests/unit/runtime-memory-read-hydration-controlled-db-replay-regression.test.ts tests/unit/runtime-memory-read-hydration-controlled-real-db-evaluation.test.ts tests/unit/runtime-memory-read-hydration-consumer-evaluation.test.ts tests/unit/task-loop-controller.test.ts` | Passed, 5 files / 70 tests |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md` | Blocked by broad pre-existing dirty/untracked files outside Phase 31 touched areas. |
| `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-31-runtime-memory-read-hydration-taskloop-shadow-only-explicit-opt-in.md --no-diff` | Passed |
| Controller diff scan | `task-loop-controller.ts` adds only the helper import, optional report type field, optional dependency field, and an `if (deps.runtimeMemoryReadHydrationShadowOnly)` guarded call after context-pack construction. |
| Read-helper scan | `readRuntimeMemoryHydrationShadow` appears only in the isolated Phase 31 helper; the existing `appendEpisode` matches in `task-loop-controller.ts` are the pre-existing shadow persistence writer. |
| Renderer/Gateway direct-transport scan | Matches are existing Main/preload/gateway implementation and project-rule/i18n text outside Phase 31; no Phase 31 touched file adds a renderer/Gateway transport path. |
| README docs-sync scan | Existing memory/Knowledge/Mission Control/Gateway readiness references only; no Phase 31 README update required. |

## Next Phase Entry

Phase 32 controlled internal shadow pilot may proceed only through a fresh task spec. The preconditions are: define a sanitized internal corpus, keep explicit opt-in and non-authority boundaries, keep diagnostics out of prompts/context/model messages/checkpoints/transcripts, preserve all Phase 31 metrics and zero-delta gates, and rerun the comms/docs/boundary review for any newly touched surface.
