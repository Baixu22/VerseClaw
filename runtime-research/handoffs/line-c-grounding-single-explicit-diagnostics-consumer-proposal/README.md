# Line C Grounding Single Explicit Diagnostics-only Consumer Proposal

This handoff is the narrow next package after the accepted `line-c-grounding-explicit-diagnostics-consumer-readiness` docs-only readiness step.

## Verdict

Accepted as docs/proposal readiness only.

This package permits a later fresh task spec to request implementation of exactly one explicit diagnostics-only consumer. It does not authorize implementation now, broad formal runtime use, or any runtime integration.

## Current Accepted Surface

- Already allowed: runtime-core default-on diagnostics-only metadata helper for valid sanitized Line C grounding refs.
- Output remains local, bounded, metadata-only, summary-only, diagnostics-only, read-only, and non-authoritative.
- Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- Rollback remains `enabled: false` and `killSwitch: true`; both must return disabled/default-off parity.

## Proposed Single Consumer Boundary

Candidate consumer identity:

- `line-c.grounding.singleExplicitDiagnosticsOnlyConsumer`

Candidate implementation shape for a later fresh spec:

- One runtime-core local pure diagnostics report helper.
- Explicit callsite invocation only.
- Explicit consumer id required in input.
- Input limited to the already accepted sanitized `createGroundingShadowConsumerSummary` metadata summary, or an equivalently sanitized metadata-only summary produced by the same runtime-core boundary.
- Output limited to bounded diagnostics metadata, counters, skip reasons, rollback markers, and boundary markers.
- Output must retain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
- `enabled: false` and `killSwitch: true` must short-circuit to disabled/default-off parity.

## Not Approved

- Direct implementation in this package.
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

## Required Proof For Any Later Implementation Spec

1. Scope remains exactly one explicit diagnostics-only consumer.
2. Consumer id is explicit and fixed.
3. Invocation is explicit by callsite; no automatic registration or default provider path exists.
4. Output is metadata-only, summary-only, diagnostics-only, bounded, local, read-only, and non-authoritative.
5. Required markers remain `authority: "none"`, `rawRetained: false`, `includeRaw: false`, and `includeUntrusted: false`.
6. Prompt text, model messages, Gateway payloads, provider ordering, provider selection, TaskLoop behavior, and runtime decisions prove zero drift.
7. No raw retention, untrusted refs, persistence/cache/service/listener/exporter/database/sidecar, memory write, patch apply, workspace edit, symbol mutation, UI/API/transport change, or production rollout appears.
8. `enabled: false` and `killSwitch: true` both return disabled/default-off parity.

## Implementation Entry

Implementation is not allowed to start from this package. A later implementation request must create a fresh task spec, run harness context and validation, and prove every boundary again before any code changes.

## Formal Runtime-use Entry

Broader formal runtime use remains unapproved and retains the prior `needs_revision` verdict because prompt/model-message/provider/Gateway/TaskLoop/runtime-decision consumption would cross forbidden boundaries.

## Validation Notes

- `node harness/src/cli.mjs context --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md` passed.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md` failed because the current worktree contains unrelated dirty/untracked files outside this task's owned surface.
- `node harness/src/cli.mjs validate --spec harness/specs/tasks/line-c-grounding-single-explicit-diagnostics-consumer-proposal.md --no-diff` passed.

Status: accepted
