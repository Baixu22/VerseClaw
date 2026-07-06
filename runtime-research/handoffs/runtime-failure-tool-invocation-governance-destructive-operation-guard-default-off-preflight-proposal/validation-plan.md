# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md
```

If full harness validation is blocked by unrelated dirty worktree state, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-tool-invocation-governance-destructive-operation-guard-default-off-preflight-proposal.md --no-diff
```

Vitest is not required for this phase because it is docs/spec only and adds no runtime code or test fixtures.

## Proposal Validation

- The task spec and handoff package are proposal/design only.
- The proposal is not active runtime readiness.
- Runtime behavior remains unchanged.
- `block` remains future candidate metadata only, not runtime behavior.
- The only future active owner boundary is mutation-capable tool invocation preflight owned by tool execution.
- The future flag is named `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` and is disabled unless explicitly set to boolean `true`.
- Flag-off rollback restores legacy tool behavior without migration, checkpoint cleanup, lifecycle cleanup, provider cleanup, Gateway cleanup, workspace cleanup, or user-facing state cleanup.
- Parent governance docs record the design semantics without approving active runtime readiness.

## False-Block Corpus

Any future implementation spec must keep these cases non-blocking:

- expected edit
- expected deletion
- normal completed repair
- completed test repair
- sanitized or inconclusive touched path
- legitimate fixture mutation
- slow test command
- known dev-server-like long-running metadata

The expected-deletion case must remain protected because deleted touched-path metadata or Phase 5 future candidate metadata can appear in correct behavior.

## Phase C Boundary / Import Scan Plan

Phase C must design and prove an import contract before implementation. The scan must:

- allow a future active guard consumer only in an accepted mutation-capable tool invocation preflight owner
- deny imports/references from TaskLoop, provider transport, Gateway payloads, prompt/model-message assembly, replay, scorecard, advisory generation, evidence proof, retry, approval, rollback, completion, checkpoint, lifecycle, Electron main/services, and renderer code
- deny checkpoint/lifecycle authority writes for replay reports, scorecards, governance reports, governance diagnostics, failure events, evidence envelopes, evidence proof reports, proposal reports, or active guard reports
- remain synthetic, fixture-owned, local/dev/test-only, bounded, and free of live provider/tool/workspace data

## Future Active Trigger Gate

A future active implementation spec must prove that any candidate block requires all of these signals:

- explicit default-off flag enabled
- mutation-capable tool invocation preflight owner
- deleted touched-path metadata
- failing `wrong_file_edit` or `unnecessary_edit` scorecard metadata
- Phase 5 finding with `futureActiveCandidate.action = "block"`
- `requiresAcceptedSpec = true`
- false-block corpus still passing

## Stop Conditions

Stop and write a narrower follow-up spec if design review finds any need to:

- implement active runtime behavior in Phase B
- read live providers
- execute real tool mutations
- modify the real workspace
- persist raw prompt/provider/tool/secret/env/workspace content
- change TaskLoop/provider/Gateway/prompt/retry/approval/rollback/completion/tool-blocking behavior
- use broad shell command pattern blocking
- allow deleted touched-path metadata alone to trigger active behavior
- add services, daemons, listeners, servers, databases, exporters, schedulers, or always-on sidecars
- treat governance reports, replay reports, scorecards, evidence proof output, evidence, failure events, or proposal docs as completion proof
