# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-intelligence-passive-shadow.test.ts
```

If dirty worktree state unrelated to this slice blocks full harness validation, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-intelligence-passive-shadow.md --no-diff
```

## Unit Coverage

- Representative tool error.
- Test failure.
- Provider timeout.
- Gateway error.
- User interruption.
- Secret-like and workspace-path content does not survive the summary.
- Unknown signal produces stable `unknown` stage, kind, and recoverability.
- Every classifier output passes `validateFailureEvent`.
- No active TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, or tool-blocking consumer is introduced.

## Boundary Scan

The focused unit test scans active runtime roots for imports or references to `failure-intelligence-passive-shadow` and `classifyRuntimeFailurePassiveShadow`. Allowed references are the classifier file, the additive barrel export, docs, and tests.

## Promotion Criteria

Promote this phase to `ready_for_evidence_envelope_failure_summary` only when the required commands pass and no active consumer exists. Any desire to inject the event into prompts, evidence envelopes, replay reports, or scorecards requires a new follow-up spec.

