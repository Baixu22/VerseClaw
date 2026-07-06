# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-limited-active-guard-design.md --no-diff
```

## Design Validation

- The task spec and handoff package are documentation/readiness only.
- Candidate scope is exactly `destructive_operation_guard`.
- `block` remains a future candidate metadata value, not runtime behavior.
- No active runtime consumer, import, TaskLoop wiring, provider wiring, Gateway wiring, prompt/model-message wiring, retry/approval/rollback/completion wiring, or tool-blocking path is added.
- Parent governance docs explicitly state that this phase does not approve active runtime readiness.

## Future Evidence Checks

A future active implementation spec must add focused tests and/or replay evidence for:

- Phase 5 advisory report trigger metadata for deleted touched-path summaries and risky edit scorecard metrics.
- Replay/scorecard provenance for every trigger and non-trigger.
- False-block cases for expected edits, normal repair, completed test repair, sanitized/inconclusive path metadata, and legitimate fixture mutation.
- Slow test and known dev-server protection so long-running commands cannot become destructive-operation blocks by pattern alone.
- Flag-disable rollback proof that restores legacy behavior without migration or state cleanup.

## Boundary Scan Plan

Any future active spec must scan active runtime roots for imports or references to the proposed active guard. Allowed references must be limited to the future accepted owner boundary plus tests and docs.

The owner boundary must be mutation-capable tool invocation preflight owned by tool execution. TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, retry, approval, rollback, completion, replay, scorecard, and advisory report generation must not own the active decision.

Future scans must also prove checkpoint and lifecycle authority files do not receive replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, or active guard reports.

## Stop Conditions

Stop and write a narrower follow-up spec if design review finds any need to:

- read live providers
- execute real tool mutations
- modify the real workspace
- persist raw prompt/provider/tool/secret/env/workspace content
- change TaskLoop/provider/Gateway/prompt/retry/approval/rollback/completion/tool-blocking behavior
- add services, daemons, listeners, servers, databases, exporters, schedulers, or always-on sidecars
- treat governance reports, replay reports, scorecards, evidence, or failure events as completion proof
