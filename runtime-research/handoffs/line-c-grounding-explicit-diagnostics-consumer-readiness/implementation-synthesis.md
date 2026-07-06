# Line C Grounding Explicit Diagnostics Consumer Readiness Synthesis

The narrow readiness package for one future explicit diagnostics-only grounding consumer is complete as documentation/spec work.

## Decision

- Accepted only as readiness documentation for a future single explicit diagnostics-only consumer proposal.
- No consumer implementation is approved.
- No formal runtime-use cutover is approved.
- Existing accepted default-on diagnostics-only metadata helper remains the only active allowed capability.
- Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Existing rollback remains `enabled: false` and `killSwitch: true`.

## Allowed Next Boundary

A future task may propose one explicit diagnostics-only consumer only if it starts from a fresh task spec and proves:

- Explicit callsite invocation and explicit consumer id.
- Metadata-only, summary-only, diagnostics-only, read-only, local-only, bounded, non-authoritative output.
- Zero prompt/model-message/Gateway payload/provider ordering/provider selection/TaskLoop/runtime-decision drift.
- No raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory write, patch apply, workspace edit, or symbol mutation.
- Rollback to disabled/default-off parity through `enabled: false` or `killSwitch: true`.

## Still Forbidden

- Broad formal runtime use.
- Runtime authority.
- Prompt/model-message/provider/Gateway/TaskLoop/runtime-decision integration.
- Completion/tool/security/approval/retry authority.
- Raw retention or untrusted refs.
- Persistence/cache/service/listener/exporter/database/sidecar.
- Memory promotion, fact acceptance, episode write, memory store write, or fact store write.
- Patch apply, workspace edit, symbol mutation, UI/API/transport changes, and production rollout beyond diagnostics metadata.

## Validation Results

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md` passed and selected the gateway backend communication scenario, required communication rules, harness guides, and harness layer.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md` failed because the current worktree contains unrelated dirty/untracked files outside this task's owned surface.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md --no-diff` passed.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-formal-runtime-use-readiness.md --no-diff` passed.
- `git diff --check -- harness/specs/tasks/line-c-grounding-explicit-diagnostics-consumer-readiness.md runtime-research/handoffs/line-c-grounding-explicit-diagnostics-consumer-readiness/README.md runtime-research/handoffs/line-c-grounding-explicit-diagnostics-consumer-readiness/implementation-synthesis.md runtime-research/agent-runtime-index.md` passed, with only the existing line-ending warning for `runtime-research/agent-runtime-index.md`.
- Boundary scan over the new spec, new handoff, synthesis, and runtime index found expected boundary declarations and historical index entries only; no runtime implementation path was introduced.
- Comms replay/compare are not required for this docs/spec-only readiness package because it does not touch Gateway events, runtime send/receive, delivery, fallback behavior, Main, host-api, api-client, renderer, or provider transport.

Status: accepted
