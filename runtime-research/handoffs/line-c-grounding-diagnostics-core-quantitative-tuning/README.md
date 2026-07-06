# Line C Grounding Diagnostics Core Quantitative Tuning

This handoff records the diagnostics-core quantitative tuning pass after the single explicit diagnostics-only consumer implementation.

## Verdict

Accepted.

The phase remains limited to the diagnostics-only grounding core. It does not approve broader formal runtime use.

## Scope

- Added a fresh task spec at `harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md`.
- Added a deterministic quantitative unit corpus at `tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts`.
- No production runtime-core code was changed by this phase.
- No UI, API, transport, Gateway, provider, TaskLoop, persistence, memory write, mutation, or production rollout surface was added.

## Quantitative Results

| Metric | Result |
|---|---:|
| Corpus size | 12 |
| Pass count | 12 |
| Fail count | 0 |
| Accepted sanitized summaries | 2 |
| Rejected invalid/missing/wrong-consumer summaries | 8 |
| Fail-closed rate | 1.0 |
| Leakage count | 0 |
| includeRaw false rate | 1.0 |
| includeUntrusted false rate | 1.0 |
| Authority marker completeness score | 1.0 |
| Metadata drop rate | 1.0 |
| Source metadata drop rate | 1.0 |
| Bounded item count | 2 |
| Bounded estimated token count | 8 |
| Boundedness pass rate | 1.0 |
| Untrusted exclusion rate | 1.0 |
| Rollback parity rate | 1.0 |
| Deterministic stability rate | 1.0 |
| Duplicate canonical input count | 1 |
| Omitted item count | 1 |

Performance/noise observation: the corpus repeats report generation 3 times with stable serialized output, keeps the maximum report item count at 2, keeps max estimated tokens at 8, and asserts max serialized report size stays under 4096 bytes.

## Optimization Recommendations

- keep: the single explicit diagnostics-only consumer id, source/query/item/options metadata dropping, and fail-closed disabled reports.
- tighten: keep this quantitative corpus in focused unit coverage before any wider proposal.
- remove: none.
- defer: formal runtime use; prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration; persistence, memory write, mutation, UI/API/transport, and production rollout.

## Validation

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md` passed.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md` failed because unrelated dirty/untracked worktree files outside this task's owned surface are present.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-diagnostics-core-quantitative-tuning.md --no-diff` passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts` passed: 1 file / 1 test.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts tests/unit/runtime-grounding-diagnostics-core-quantitative-tuning.test.ts` passed: 5 files / 19 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.

Comms replay/compare are not required because this phase did not touch Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, provider transport, or runtime communication paths.

## Still Forbidden

- Broad formal runtime use.
- Runtime authority.
- Prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration.
- Provider ordering or provider selection influence.
- Completion, tool, security, approval, or retry authority.
- Raw retention, untrusted refs, `includeRaw: true`, or `includeUntrusted: true`.
- Persistence, cache, database, sidecar, service, listener, exporter, daemon, or server.
- Memory promotion, fact acceptance, episode write, memory store write, or fact store write.
- Patch apply, workspace edit, symbol mutation, UI/API/transport changes, production rollout, or hidden default-on expansion.

Status: accepted
