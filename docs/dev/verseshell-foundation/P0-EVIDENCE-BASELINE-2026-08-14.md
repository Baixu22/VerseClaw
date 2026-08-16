# VerseShell P0 Evidence Baseline

Date: 2026-08-14
Scope: `VS-P0-01` / Task Forest `TF-0058` startup repair verification
Status: `in_progress`; this is not a release, canary, source-bundle, or product-approval record.
Rollout decision: `default-off`; `liveReady=false`; `productApproved=false`; `defaultOn=false`.

## Purpose

This document records the corrected P0-01 evidence against the exact manifest-pinned VerseShell
1.0 source. It supersedes the earlier local `verseshell-runtime/` 0.3 snapshot narrative. That
excluded tree and any other dirty source directory are not accepted as a build input, a source of
record, or release evidence.

## Pinned Source And Patch Stack

| Item | Value |
|---|---|
| Source repository | `https://github.com/Baixu22/VerseShell.git` |
| Pinned commit | `c3983694407a9ddb23505e05fad4a9eae653b283` |
| UAS-05 patch SHA-256 | `cabfb192f6f9688156f5a3ab5a19307fcd1af3fb2ee2c59b2d494a557d417098` |
| P0 startup patch SHA-256 | `17214efd7bf09e009256eb149c84a84e8fe85afcd467968ac2a6e472fbdb5aba` |
| P0 startup patch surface | `src/cache.rs` only; 26 insertions, 8 deletions |

The patch order was rechecked in a fresh detached worktree:

1. Check out the exact pinned commit.
2. `git apply --check` and apply `resources/verseshell/patches/uas-05-process-lifecycle.patch`.
3. `git apply --check` and apply `resources/verseshell/patches/p0-runtime-startup.patch`.

Both checks and applications passed. The startup patch introduces `SystemSnapshot::empty_at`,
represents an empty system snapshot with `cpu_info == Value::Null`, and treats that state as
expired. `Default` no longer evaluates `Instant::now() - Duration::from_secs(3600)`. Its
deterministic regression proves this behavior without relying on host uptime.

## Startup And Rust Evidence

| Check | Result | Notes |
|---|---|---|
| `cargo test --locked --no-run -j 1` | PASS | All Rust test targets for the clean pinned source plus UAS-05/P0 patch stack compiled. `CARGO_INCREMENTAL=0` and one job avoided the earlier Windows pagefile/OOM failure. |
| `cargo test --locked -j 1` | BLOCKED | `tests/aci_bench_mock_acceptance.rs` exits 101 because the pinned commit does not contain `bench/aci/runners/run_suite.py` or `bench/aci/scorers/score.py`. |
| `cargo test --locked -j 1 -- --skip aci_bench_mock_meets_acceptance_gate` | PASS, non-substitute | All remaining unit, integration, ACI, lifecycle, reducer, and doc-test targets passed. This command is diagnostic evidence only; it does not satisfy the full `cargo test` acceptance gate. |
| JSON, non-agent source-built start | PASS | Independent `ae --serve --format json` process returned `runtime.handshake`, request id, version `1.0.0`, protocol, and catalog digest; exit 0. |
| JSON, agent source-built start | PASS | Same handshake and catalog identity; policy mode `agent_strict`; exit 0. |
| Compact, non-agent source-built start | PASS | Independent `ae --serve --compact` process returned the compact handshake identity; exit 0. |
| Compact, agent source-built start | PASS | Same compact response with `agent_strict`; exit 0. |

All four startup cells used a separate process, a single UTF-8 JSONL `runtime.handshake` request,
and EOF shutdown. Each observed the request id, `verseshell.jsonl/v1`, and catalog digest
`sha256:0685f5a168785c6e64eb084c01b8acbf76c5786ca00e7784be09608e9dd23ce7`.

## Repository Gates

| Check | Result | Notes |
|---|---|---|
| `node harness/src/cli.mjs context --spec harness/specs/tasks/verseshell-p0-runtime-startup.md` | PASS | Full scoped read list resolved. |
| `node harness/src/cli.mjs validate --spec ... --no-diff` | PASS | Structural specification validation passed. |
| Diff-aware Harness validation | BLOCKED by shared worktree | It reports many pre-existing unrelated changed paths outside P0-01 `touchedAreas`; no P0 task file is identified as the cause. |
| `pnpm verseshell:test` | Wrapper failed before tests | The package-manager dependency verification returned `fetch failed`. |
| Direct equivalents of `verseshell:test` | PASS | 8 Node bundle tests, 11 runtime-bundle Vitest tests, and 57 focused OpenClaw VerseShell tests passed. |
| `pnpm run typecheck` | PASS | Node and web projects passed. `tsconfig.test.json` remains observation-only and reported its existing 1,028 errors. |
| `pnpm run comms:replay` / `pnpm run comms:compare` | Wrapper failed before scripts | Both stopped with `fetch failed` in dependency verification. |
| `node scripts/comms/replay.mjs` / `node scripts/comms/compare.mjs` | PASS | Replay completed; compare passed all 44 metric rows. |
| README / README.zh-CN.md / README.ja-JP.md review | PASS, no edit | This patch changes no public behavior, protocol, configuration, or rollout state. |

`git diff --check` must be rerun after the tracked documentation and spec work is finalized.

## Open P0 Gate: Missing Tracked Benchmark Inputs

The full Rust gate exposed a source-integrity defect unrelated to the cache repair:

- `tests/aci_bench_mock_acceptance.rs` is tracked at the pinned commit and requires two Python
  files under `bench/aci/`.
- `git ls-tree` and repository history at the pinned source do not contain either file.
- A separate local dirty tree at the same commit contains the files, but they are untracked and
  must not be copied into release or test evidence without a tracked patch and provenance.

This is a real clean-checkout failure. It must not be hidden by skipping the test or by treating
the dirty local tree as authoritative. The recommended owner is `VS-P0-02`, which already owns
the tracked source snapshot, ordered patch stack, reproducible reconstruction, and composite
provenance. That work must either restore the benchmark assets as a reviewed tracked patch or
replace the test with an equally meaningful hermetic gate, then rerun unskipped `cargo test`.

## Controlled Source-Input Recovery Experiment

A separate disposable worktree was checked out at the pinned commit, received the UAS-05 and P0
startup patches in order, and received only the following eight ignored source files from the
same-commit legacy tree. No binary, Cargo target directory, generated cache, or other dirty input
was copied.

| Relative path | Bytes | SHA-256 |
|---|---:|---|
| `bench/aci/runners/run_suite.py` | 27,489 | `2cbfab0553f40da8c86202697151a54b5c1e39adfc3120508dbc4343328f11b6` |
| `bench/aci/scorers/score.py` | 1,081 | `9ae6f43cd8b739192061259935ebad1ab32b7cc188cd29bfe2c75b421fafaaf9` |
| `bench/aci/fixtures/python_edit_and_retest/greet.py` | 41 | `3ab4a6cd647afe331b3f14443f8e612f820d5ac9aa50380f608306859defb964` |
| `bench/aci/fixtures/python_edit_and_retest/GOLDEN/greet.py` | 46 | `a55c14346b5c0e11da873793db175efd28d4840a330a5edba18d03d7d7310626` |
| `bench/aci/fixtures/python_edit_and_retest/tests/test_greet.py` | 84 | `b1a1f584dd86105d98bc0c55c94853f7b50be059193cb4b973a2fb791de84af3` |
| `bench/aci/fixtures/python_fix_pytest_fail/mathlib.py` | 32 | `4fb46b3507c096aece05e92b88ce528ab2ee3c2c42657ba218d09dfdf5c02418` |
| `bench/aci/fixtures/python_fix_pytest_fail/GOLDEN/mathlib.py` | 32 | `ba1a531f581d2e6094e978ed6f7aca7a8d92eeb62c6e7ad73ee692f7f18bc772` |
| `bench/aci/fixtures/python_fix_pytest_fail/tests/test_math.py` | 67 | `a8a48514048ab1e8543f3d7626fc9f40d322009f679deb1e441b38b0daecfe8f` |

`cargo test --locked -j 1` passed in that isolated worktree, including
`aci_bench_mock_meets_acceptance_gate`. This proves the failure is exactly a missing ignored
source-input problem. It is **not** release or P0 completion evidence: the eight files have not
yet been captured by a tracked patch, verified by a clean reconstruction tool, or included in
manifest provenance. P0-02 must reproduce this result from tracked inputs and must explicitly
exclude `__pycache__`, binaries, Cargo targets, and other generated files.

The experiment also found a separate optional-verification contract defect. The two Python task
definitions invoke `pytest -q`; on this Windows environment that entry point exits 2 during test
collection because the fixture root is not on `sys.path`. The same restored fixtures pass 2/2 via
`python -m pytest -q`. This does not block the Rust test or the mock benchmark acceptance result,
but P0-02 must make the optional Python verifier explicitly interpreter-bound and cross-platform,
or record it as unsupported rather than implying that optional verification is green.

## Current Boundary And Next Decision

`VS-P0-01` has proved the narrow cache/startup repair and source-built startup matrix, but it
cannot claim its current full Rust-test acceptance while the pinned source lacks benchmark test
inputs. No manifest, bundled `ae.exe`, typed protocol, catalog, model tool, configuration,
`STATUS.md`, feature flag, or rollout lock changed.

Before `TF-0058` can be closed and strict serial work can move to `TF-0059`, the Task Forest needs
a reviewed scope decision:

1. transfer the eight clean-source benchmark inputs and unskipped `cargo test` proof to
   `VS-P0-02` while keeping it as a P0 exit gate, or
2. expand `VS-P0-01` with a separate tracked benchmark-assets patch and rerun the full gate here.

The recommended option is 1 because it preserves the startup patch's one-file boundary and puts
all previously ignored source material under the existing reproducible-bundle owner. Until that
decision is approved, `TF-0058` remains active and no P0-02/P0-03 work is started.
