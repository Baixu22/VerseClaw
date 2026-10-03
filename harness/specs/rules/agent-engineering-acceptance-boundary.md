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
gate manifest in a second temporary detached worktree and rerun every required gate, including
spec-declared `requiredTests` command lines. Those required-test gates execute in the role's
detached worktree, not the source checkout. Executor and Verifier identities must differ.

## R2: The task spec remains the gate authority

The manifest is derived from the selected Harness task spec, its required rules, and the
candidate changed paths. The acceptance runner may add mandatory cross-layer coverage for
runtime, renderer/Electron, communication, maturity, and release changes; it must not invent a
parallel task registry or allow a fast/cached profile to represent final acceptance.
Both roles must rederive the full ordered gate contracts, coverage, required profiles, and
source-input identities from the candidate, including `harness/src/profiles.mjs`. Recomputed
manifest digests cannot authorize omitted gates, command overrides, or changed test/timeout
budgets. Formal plans require a comparison base and its real diff; explicit changed paths alone
are diagnostic only. Abbreviated bootstrap fixtures are not full engineering acceptance.
If the candidate spec declares `diffBase`, the selected comparison base must resolve to that
commit; a new empty diff cannot remove required coverage.

## R3: Evidence and inputs fail closed

Formal acceptance rejects a dirty source tree, an old/mismatched commit or tree, missing or
changed spec/rule/lock inputs, skipped or omitted gates, non-zero exits, timeouts, a tampered log
digest, `NODE_TLS_REJECT_UNAUTHORIZED`, real-provider credentials, `--fix` in `args` or
`commandLine`, production effects, or a public-network/human-evidence declaration. Manifest
`requiredTests` must match the candidate task spec; mutating the in-memory list is not enough.
Ignored provision `--copy` inputs must lock `sha256` and `bytes` in the plan and be verified
before and after copy. Logs and reports must redact local paths and credential values before
persistence and hashing.

Every test gate declares a fixed `expectedSkips` budget in the manifest and records parsed
`passed`/`failed`/`skipped`/`total` counts. Countable required-test commands cannot omit that
expectation. Parsed counts sum every Vitest `Tests` summary segment; taking the largest single
count is not acceptance. Missing counts or any deviation from the fixed skip budget is `NO-GO`;
a historical skip cannot become an unbounded exemption. After every run, both the source
worktree and the disposable worktree must remain free of tracked or unexpected source mutations.
Segments containing no passed tests must still contribute failures and skips. Supported
Playwright and Node spec/TAP summaries must remain countable; contradictory reported totals
fail closed. Quoting a forbidden option or using its `=value` form does not exempt it.
Test-runner report validation must reparse both persisted log streams after checking their digests and
compare the parsed counts with the gate report. Rehashing logs, gate contracts, and the report
cannot authorize counts that hide failures, skips, or a missing summary.
The TF-0009 adapter instead revalidates its required controlled JSON artifact and derives counts
from its validated runs. Only the candidate-bound adapter kind may select this source; a report's
`source` label cannot exempt an ordinary test runner from log replay. Test filenames passed to
lint or diff commands do not make those commands test runners; package-manager test commands
must still require counts when directory, filter, or workspace options precede the script name.

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
- `pnpm harness validate --spec harness/specs/tasks/agent-engineering-acceptance-orchestrator.md`
- `git diff --check`
