---
id: agent-engineering-acceptance-boundary
title: Agent Engineering Acceptance Boundary
type: ai-coding-rule
severity: error
---

# Rule: Agent Engineering Acceptance is engineering-only evidence

## R1: Independent verification is required

An implementation Agent may create a candidate and run the Executor suite, but it cannot set
`engineeringAcceptedByAgent=true`. A separately identified Verifier must recreate the declared
gate manifest in a second temporary detached worktree and rerun every required gate. Executor
and Verifier identities must differ.

## R2: The task spec remains the gate authority

The manifest is derived from the selected Harness task spec, its required rules, and the
candidate changed paths. The acceptance runner may add mandatory cross-layer coverage for
runtime, renderer/Electron, communication, maturity, and release changes; it must not invent a
parallel task registry or allow a fast/cached profile to represent final acceptance.

## R3: Evidence and inputs fail closed

Formal acceptance rejects a dirty source tree, an old/mismatched commit or tree, missing or
changed spec/rule/lock inputs, skipped or omitted gates, non-zero exits, timeouts, a tampered log
digest, `NODE_TLS_REJECT_UNAUTHORIZED`, real-provider credentials, `--fix`, production effects,
or a public-network/human-evidence declaration. Logs and reports must redact local paths and
credential values before persistence and hashing.

Every test gate declares a fixed `expectedSkips` budget in the manifest and records parsed
`passed`/`failed`/`skipped`/`total` counts. Missing counts or any deviation from the fixed skip
budget is `NO-GO`; a historical skip cannot become an unbounded exemption. After every run, both
the source worktree and the disposable worktree must remain free of tracked or unexpected source
mutations.

## R4: Output is isolated

Every run writes a unique output directory. A controlled adapter may run a legacy suite only in
its disposable detached worktree and must copy its resulting evidence into that run directory;
it must never overwrite the shared canonical evidence. TF-0009 remains an engineering-only
adapter: its report must retain `humanEquivalent=false`, `liveEvidence=false`,
`taskForest.canMarkDone=false`, and all product locks false.

## R5: Engineering success is not product or human completion

The final report records candidate identity, source and lock digests, every command/result/log
digest, environment fingerprint, coverage, safety snapshot, residual human evidence, and the
Verifier conclusion. If the task declares `humanEvidence: required`, a passing engineering
report still recommends `review_needed`. The runner must never modify Task Forest state, release
state, defaults, `liveReady`, `productApproved`, `defaultOn`, C1, SEKB confirmation policy, or
Browser private-network policy.

## Validation

- `pnpm acceptance:agent:plan --spec harness/specs/tasks/agent-engineering-acceptance-orchestrator.md`
- `pnpm exec vitest run tests/unit/agent-engineering-acceptance.test.ts`
- `pnpm harness validate --spec harness/specs/tasks/agent-engineering-acceptance-orchestrator.md --no-diff`
- `git diff --check`
