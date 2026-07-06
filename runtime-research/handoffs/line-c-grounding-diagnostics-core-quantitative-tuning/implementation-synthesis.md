# Line C Grounding Diagnostics Core Quantitative Tuning Synthesis

The diagnostics-core quantitative tuning phase is complete.

## Decision

- Accepted for internal diagnostics-only quality proof.
- The phase adds quantitative unit coverage and documentation only.
- No production runtime-core code change was needed.
- The existing helper remains runtime-core local, explicit-callsite only, bounded, diagnostics-only, metadata-only, summary-only, read-only, and non-authoritative.
- Broader formal runtime use remains unapproved.

## Boundary Proof

- The quantitative corpus covers valid sanitized summaries, missing consumer id, wrong consumer id, missing summary, invalid summary shape, raw/includeRaw attempts, untrusted item attempts, invalid config, exhausted budget, explicit disable rollback, and kill-switch rollback.
- All accepted reports keep `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Invalid and missing inputs fail closed with disabled reports.
- `enabled: false` and `killSwitch: true` preserve rollback parity for items, accepted counts, token budget, and estimated tokens.
- Source query metadata, source item metadata, source option metadata, and caller option metadata are dropped from explicit reports.
- Hostile sentinels for raw/prompt/model-message/provider/Gateway/TaskLoop/runtime-decision/persistence/memory/mutation surfaces do not leak.
- Deterministic repeated runs produce stable serialized output.

## Quantitative Metrics

```text
corpus_size: 12
pass_count: 12
fail_count: 0
accepted_sanitized_summaries_count: 2
rejected_invalid_missing_wrong_consumer_summaries_count: 8
fail_closed_rate: 1.0
leakage_count: 0
rollback_parity_rate: 1.0
includeRaw_false_rate: 1.0
includeUntrusted_false_rate: 1.0
authority_marker_completeness_score: 1.0
metadata_drop_rate: 1.0
source_metadata_drop_rate: 1.0
bounded_item_count: 2
bounded_estimated_token_count: 8
boundedness_pass_rate: 1.0
untrusted_exclusion_rate: 1.0
deterministic_stability_rate: 1.0
duplicate_canonical_input_count: 1
omitted_item_count: 1
performance_noise_repeated_run_count: 3
performance_noise_max_report_item_count: 2
performance_noise_max_serialized_report_bytes: <=4096
performance_noise_diagnostics_only_noise_score: 1.0
```

## Optimization Recommendations

- keep: the single explicit diagnostics-only consumer id, source/query/item/options metadata dropping, and fail-closed disabled reports.
- tighten: keep this quantitative corpus in focused unit coverage before any wider proposal.
- remove: none.
- defer: formal runtime use; prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration; persistence, memory write, mutation, UI/API/transport, and production rollout.

## Validation Results

- `Get-Content -LiteralPath C:\Users\27933\.codex\RTK.md` passed; `rtk` itself was not available on the PowerShell PATH, so subsequent shell commands used PowerShell directly.
- `git status --short --branch` passed and showed branch `knowledge-ux-polish...origin/knowledge-ux-polish [ahead 8, behind 1]` with substantial unrelated dirty/untracked worktree state before this task.
- `git diff --name-status` passed and showed unrelated tracked modifications before this task.
- `git diff --stat` passed and showed 46 tracked files changed before this task.
- Required prior Line C specs, handoff/synthesis files, runtime grounding implementation files, and runtime grounding tests were read from the current worktree.
- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md` passed and selected the gateway backend communication scenario, required communication boundary rules, guides, and harness/openclaw-runtime layers.
- Selected context files and `openclaw_runtime/AGENTS.md` were read.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md` failed because unrelated dirty/untracked files outside this task's owned surface are present in the current worktree.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md --no-diff` passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts` passed: 1 file / 1 test.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts` passed: 5 files / 19 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.

## Comms And Docs

- Comms replay/compare are not required because no Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, provider transport, or runtime communication paths were touched.
- README.md, README.zh-CN.md, and README.ja-JP.md do not require updates because this is not a user-visible UI/API/settings/command flow change.

## Still Forbidden

- Broad formal runtime use.
- Runtime authority.
- Prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration.
- Provider ordering or provider selection influence.
- Completion/tool/security/approval/retry authority.
- Raw retention, untrusted refs, `includeRaw: true`, or `includeUntrusted: true`.
- Persistence/cache/service/listener/exporter/database/sidecar.
- Memory promotion, fact acceptance, episode write, memory store write, or fact store write.
- Patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, or hidden default-on expansion.

Status: accepted
