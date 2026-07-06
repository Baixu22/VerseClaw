# Line C Grounding Single Explicit Diagnostics-only Consumer Implementation Synthesis

The single explicit diagnostics-only grounding consumer implementation is complete.

## Decision

- Accepted for the single fixed consumer id `line-c.grounding.singleExplicitDiagnosticsOnlyConsumer`.
- The helper is runtime-core local, explicit-callsite only, bounded, diagnostics-only, metadata-only, summary-only, read-only, and non-authoritative.
- The helper may consume only sanitized `GroundingShadowConsumerSummary` input from the runtime-core grounding diagnostics boundary.
- The helper does not approve broad formal runtime use.
- The helper does not add any prompt/model-message/provider/Gateway/TaskLoop/runtime decision integration.

## Boundary Proof

- Consumer id is required; missing or wrong ids fail closed.
- Invocation is explicit; no provider, registry, Gateway, TaskLoop, UI/API, transport, service, listener, cache, persistence, memory write, mutation, or production rollout path was added.
- Valid sanitized summary input returns bounded report output with `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- `enabled: false` and `killSwitch: true` both restore disabled/default-off parity.
- Invalid and missing summary input fails closed.
- Source query metadata, source item metadata, and caller option metadata are dropped from the new report to prevent prompt/model-message/provider/Gateway/runtime-decision/raw/persistence/memory/mutation leakage.

## Validation Results

- `Get-Content -LiteralPath AGENTS.md` was provided in the prompt context; `Get-Content -LiteralPath C:\Users\27933\.codex\RTK.md` passed.
- `rtk git status --short --branch`, `rtk git diff --name-status`, and `rtk git diff --stat` failed because `rtk` is not available on the PowerShell PATH.
- `Get-Command rtk -All` failed because `rtk` is not available on the PowerShell PATH.
- `git status --short --branch` passed and showed branch `knowledge-ux-polish...origin/knowledge-ux-polish [ahead 8, behind 1]` with substantial unrelated dirty/untracked worktree state.
- `git diff --name-status` passed and showed unrelated tracked modifications before this task.
- `git diff --stat` passed and showed 37 tracked files changed before this task.
- Required prior Line C specs and handoff/synthesis files were read from the current worktree.
- Current runtime grounding code and tests were read from the current worktree.
- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md` passed and selected the gateway backend communication scenario, required rules, guides, and harness/openclaw-runtime layers.
- Selected context files and `openclaw_runtime/AGENTS.md` were read.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md` failed because unrelated dirty/untracked files outside this task's owned surface are present in the current worktree.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md --no-diff` passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts` first failed because source summary query/item metadata carried hostile forbidden-boundary values; the helper was tightened to drop source/options metadata, then the command passed: 1 file / 6 tests.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts` passed: 4 files / 18 tests.
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
