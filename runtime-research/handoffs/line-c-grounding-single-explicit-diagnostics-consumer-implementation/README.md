# Line C Grounding Single Explicit Diagnostics-only Consumer Implementation

This handoff records the implementation of exactly one explicit diagnostics-only Line C grounding consumer.

## Verdict

Accepted.

The implemented consumer may be used only through explicit runtime-core calls to `createSingleExplicitGroundingDiagnosticsConsumerReport` with consumer id `line-c.grounding.singleExplicitDiagnosticsOnlyConsumer` and an already sanitized `GroundingShadowConsumerSummary` input.

## Implemented Surface

- Added fixed id `GROUNDING_SINGLE_EXPLICIT_DIAGNOSTICS_CONSUMER_ID`.
- Added `createSingleExplicitGroundingDiagnosticsConsumerReport`.
- Added `isGroundingSingleExplicitDiagnosticsConsumerReport`.
- Input is limited to an existing sanitized grounding diagnostics summary from the runtime-core boundary.
- Output is bounded, local, metadata-only, summary-only, diagnostics-only, read-only, and non-authoritative.
- Output keeps `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Source query metadata, source item metadata, and caller option metadata are intentionally not retained by the explicit report.

## Rollback

- `enabled: false` returns disabled/default-off parity with no accepted items and zero token budget.
- `killSwitch: true` returns disabled/default-off parity with no accepted items and zero token budget.
- Missing consumer id, wrong consumer id, missing summary, invalid summary, invalid config, and exhausted budget fail closed.

## Still Forbidden

- Broad formal runtime use.
- Runtime authority.
- Prompt or model-message injection.
- Provider ordering or provider selection influence.
- Gateway request insertion or provider transport mutation.
- TaskLoop authority or runtime decision influence.
- Completion, tool, security, approval, or retry authority.
- Raw retention, untrusted refs, `includeRaw: true`, or `includeUntrusted: true`.
- Persistence, cache, database, sidecar, service, listener, exporter, daemon, or server.
- Memory promotion, fact acceptance, episode write, memory store write, or fact store write.
- Patch apply, workspace edit, symbol mutation, rename, replaceBody, insertBefore, insertAfter, or safeDelete.
- UI setting, public API, renderer IPC, host-api/api-client contract, Gateway route, provider registration, transport change, production rollout, or hidden default-on expansion.

## Validation Notes

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md` passed.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md` failed because unrelated dirty/untracked worktree files outside this task's owned surface are present.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-implementation.md --no-diff` passed.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts` passed: 1 file / 6 tests.
- `node node_modules/vitest/vitest.mjs run tests/unit/runtime-grounding-single-explicit-diagnostics-consumer.test.ts tests/unit/runtime-grounding-default-on-diagnostics.test.ts tests/unit/runtime-grounding-shadow-consumers.test.ts tests/unit/runtime-grounding-authority-effectiveness.test.ts` passed: 4 files / 18 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` passed.
- Comms replay/compare are not required because this implementation did not touch Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, provider transport, or runtime communication paths.

Status: accepted
