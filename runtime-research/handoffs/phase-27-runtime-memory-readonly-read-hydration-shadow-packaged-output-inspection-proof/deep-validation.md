# Phase 27 Runtime Memory Read Hydration Shadow Deep Validation

## Scope

This is a post-hoc deep validation for Phase 27 after repairing the full runtime build blockers. The accepted Phase 27 scope remains proof-only: packaged output may contain the Runtime Memory readonly read-hydration shadow helper source, command source, and built helper artifact as inert developer/research diagnostics, but no packaged entrypoint or product runtime boundary may invoke them.

No Gateway route, Electron IPC route, renderer UI, host-api/api-client/shared contract, provider registry/default registration, TaskLoop memory read, prompt/context/model-message injection, automatic fact extraction/promotion, runtime authority, durable fact authority, service/listener/daemon, implicit database selection, or implicit `--persist` / `--read-shadow` / `--database` enablement is accepted by this validation.

## Build Blocker Repair

Two syntax-only repairs were required before full runtime build verification could run:

| File | Repair | Runtime Memory design impact |
|---|---:|---:|
| `openclaw_runtime/src/auto-reply/reply/get-reply.ts` | Removed a dangling partial destructuring line after the closing brace of `getReplyFromConfig`, which caused esbuild `Unexpected end of file` at EOF. | None |
| `openclaw_runtime/src/auto-reply/reply/get-reply-directives.ts` | Restored the malformed `resolvedFastMode` expression to resolve `opts.fastModeOverride`, then inline directive fast mode, then `resolveFastModeState(...).enabled`, leaving `resolvedPromptMode` as its own assignment. | None |

## Validation Results

| Check | Command | Result |
|---|---|---:|
| Harness context | `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs context --spec harness/specs/tasks/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof.md` | Passed |
| Full runtime build | `C:\Users\27933\.cherrystudio\bin\rtk.exe node scripts/build-openclaw-runtime.mjs` | Passed |
| Diff-aware Phase 27 validate | `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof.md` | Blocked by broad pre-existing dirty/untracked files and the necessary auto-reply build-blocker fixes being outside Phase 27 proof `touchedAreas` |
| Structural Phase 27 validate | `C:\Users\27933\.cherrystudio\bin\rtk.exe node harness/src/cli.mjs validate --spec harness/specs/tasks/phase-27-runtime-memory-readonly-read-hydration-shadow-packaged-output-inspection-proof.md --no-diff` | Passed |
| Focused Runtime Memory tests | `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/vitest/vitest.mjs run ...runtime-memory...` | Passed, 10 files / 67 tests |
| Node TypeScript check | `C:\Users\27933\.cherrystudio\bin\rtk.exe node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` | Passed |

## Quantitative Metrics

Scan scope: the Phase 27 packaged-output fixture surfaces, helper/resource files, packaged entrypoint fixture files, Electron main/preload/renderer entry surfaces, Gateway/TaskLoop/provider registry/host-api/api-client boundaries, package lifecycle scripts, release/build helper scripts, and hydration helper/command sources. Counts intentionally exclude unrelated Runtime Memory persistence implementation files that are not part of the read-hydration packaged-output proof surface.

| # | Metric | Count | Target | Result |
|---:|---|---:|---:|---|
| 1 | Packaged-output fixture hydration marker total | 10 | helper/resource only | Passed |
| 2 | Helper/resource file hits | 3 | 3 expected inert files | Passed |
| 3 | Packaged entrypoint hits | 0 | 0 | Passed |
| 4 | Electron main/preload/renderer hits | 0 | 0 | Passed |
| 5 | Gateway/TaskLoop/provider registry/host-api/api-client hits | 0 | 0 | Passed |
| 6 | Package/build/release lifecycle implicit `--persist` / `--read-shadow` / `--database` / `--db` hits | 0 | 0 | Passed |
| 7 | Allowed package script hit for `runtime:memory:hydrate-shadow` | 1 | 1 exact explicit developer command | Passed |
| 8 | SQLite default DB selection hits in hydration helper/resource surfaces | 0 | 0 | Passed |
| 9 | Mutation call hits in hydration helper/resource surfaces | 0 | 0 | Passed |
| 10 | Raw/secret/trace leak sentinel hits in hydration helper/resource surfaces | 0 | 0 | Passed |
| 10a | Authority phrase hits | 2 | only boundary/prohibition text | Passed |
| 11 | Full runtime build | 1 | passed | Passed |
| 12 | Focused tests passed | 67 | all focused tests | Passed |
| 13 | Typecheck | 1 | passed | Passed |

Hydration marker breakdown:

| Fixture file | Marker count | Interpretation |
|---|---:|---|
| `resources/openclaw-runtime/src/runtime-core/memory-read-hydration-shadow.ts` | 3 | Inert helper source resource |
| `resources/openclaw-runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs` | 6 | Inert command source resource |
| `resources/openclaw-runtime/dist/runtime-core/memory-read-hydration-shadow.js` | 1 | Inert built helper artifact |

Allowed package script:

```text
runtime:memory:hydrate-shadow = node openclaw_runtime/scripts/inspect-runtime-memory-hydration-shadow.mjs
```

This script does not include `--persist`, `--read-shadow`, `--database`, or `--db`; SQLite remains unreachable unless an operator explicitly supplies all required runtime flags and an explicit existing database path.

## Real Impact Judgment

Phase 27 does not have a decisive positive effect on real memory quality. That is the correct conservative conclusion because Phase 27 is default-off, proof-only, and has no runtime invocation path. It does not improve default memory recall, fact precision, stale fact suppression, prompt quality, or model context quality.

Phase 27's real value is safety and release-boundary confidence:

- It proves that helper/source/built artifacts can exist in packaged output without being called by packaged entrypoints or product runtime paths.
- It reduces the risk that a future packaging, release, or lifecycle change accidentally enables Runtime Memory read-hydration shadow.
- It creates a clean safety baseline before any later explicit opt-in runtime evaluation.

## Negative Gain Judgment

| Dimension | Judgment | Reason |
|---|---|---|
| Default runtime performance | No negative gain | No default runtime invocation exists, so no added latency, token cost, or database open occurs. |
| Security | Low/no new negative gain | Boundary scans show no product invocation, no implicit SQLite flags, no default DB selection, no mutation calls, and no raw/secret/trace leak sentinel hits. |
| Maintenance burden | Small increase | The proof adds tests and handoff documentation that future changes must keep aligned. |
| Real memory effect | No positive or negative effect | The feature remains default-off and is not executed by default runtime paths. |

If the project wants evidence of positive memory quality impact, that must be proven in a later explicit opt-in evaluation phase. Phase 27 must not be treated as evidence that memory quality improved.

## Opt-in Mock Memory Evaluation

A deterministic unit evaluation now covers the central follow-up question: if read hydration were explicitly enabled and consumed, would it help or hurt existing system behavior?

Test file:

```text
tests/unit/runtime-memory-read-hydration-shadow-opt-in-evaluation.test.ts
```

The test constructs a controlled existing Runtime Memory SQLite DB with three useful facts and four hazardous/non-useful facts:

- Useful facts: package manager preference, Chinese reply preference, and host-api backend boundary.
- Hazardous/non-useful facts: expired npm preference, invalidated English reply preference, candidate-only wrong backend boundary, and an instruction-override injection-like fact.

It evaluates three modes:

| Mode | Meaning | Verdict |
|---|---|---|
| Baseline no hydration | No memory facts available. | Negative/no memory effect |
| Naive hydration consumer | Reads hydration output by subject/predicate but does not filter temporal validity, candidates, or injection-like text. | Negative/risky |
| Guarded opt-in hydration consumer | Requires `recordKind=fact`, `verificationStatus=verified`, valid time window, no invalid/expired fact, no prompt-injection sentinel, and no raw leak sentinel. | Positive on this mock corpus |

Quantitative result:

| Metric | Baseline | Naive hydration | Guarded opt-in hydration |
|---|---:|---:|---:|
| recall@k | 0 | 1.0 | 1.0 |
| precision | 0 | 0.4286 | 1.0 |
| stale/invalid fact suppression rate | 1.0 by absence | 0 | 1.0 |
| prompt injection rate among returned facts | 0 | 0.1429 | 0 |
| raw leak rate | 0 | 0 | 0 |
| failure/no-op rate | 1.0 | 0 | 0 |
| latency overhead | 0 | measured and bounded below 500 ms | measured and bounded below 500 ms |
| token overhead | 0 | greater than guarded due to unsafe extra facts | positive but lower than naive |

Interpretation:

- If hydration output is naively enabled into prompt/context, the impact is negative despite recall improvement, because stale/invalid facts and injection-like facts can ride along with useful facts.
- If a future explicit opt-in consumer applies the required guards, mock memory effect becomes positive: recall and precision reach 1.0 on the fixed corpus, stale/invalid suppression reaches 1.0, and injection/raw leak rates are 0.
- This positive result is not approval for default runtime cutover. It proves only that a guarded opt-in consumer is worth evaluating next with a larger controlled corpus.

## Next Evaluation Design

Next phase should be an explicit opt-in Runtime Memory evaluation, not a default runtime cutover. It should use:

- A controlled existing Runtime Memory DB.
- A fixed query/task corpus.
- A baseline arm with no hydration.
- An explicit hydration shadow arm gated by `--persist --read-shadow --database <path>`.
- The same default-off/no-default-DB/no-runtime-authority boundary as Phase 27.

Required metrics:

| Metric | Purpose |
|---|---|
| `recall@k` | Measures whether useful facts are retrieved. |
| precision of retrieved facts | Measures whether retrieved facts are relevant. |
| stale/invalid fact suppression rate | Measures whether invalidated or expired facts stay out. |
| raw leak rate | Measures whether raw transcripts, traces, payloads, tool data, or secrets leak. |
| prompt injection rate | Measures whether retrieved facts can alter instructions or authority. |
| latency overhead | Measures database/read/projection cost. |
| token overhead | Measures prompt/context expansion if a later explicit consumer is tested. |
| failure/no-op rate | Measures skipped, missing DB, missing table, malformed JSON, and no-result outcomes. |

Suggested next-phase prompt:

```text
Design and run an opt-in Runtime Memory read-hydration evaluation using a controlled existing Runtime Memory DB and a fixed query/task corpus. Compare baseline no-hydration against explicit hydration shadow only when all three flags are present: --persist --read-shadow --database <path>. Keep default runtime behavior off, do not add Gateway/Electron/renderer/host-api/provider/TaskLoop cutover, do not inject hydration output into default prompts/model messages, and report recall@k, precision, stale/invalid suppression, raw leak rate, prompt injection rate, latency overhead, token overhead, and failure/no-op rate.
```

## Docs And Index Sync

README docs sync was reviewed for `README.md`, `README.zh-CN.md`, and `README.ja-JP.md`; a Runtime Memory/read-hydration scan found no existing README surface to update. No README update is required because this validation and the syntax-only build repairs do not change product behavior, UI, public runtime behavior, release-facing behavior, or user workflows.

This document should be linked from the Phase 27 synthesis and runtime index as a post-hoc validation artifact. It does not change the accepted Phase 27 boundary.
