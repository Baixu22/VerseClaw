# Validation Plan

## Required Commands

```text
pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md
pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-failure-evidence-envelope-failure-summary.test.ts
```

If dirty worktree state unrelated to this slice blocks full harness validation, run:

```text
pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/runtime-failure-evidence-envelope-failure-summary.md --no-diff
```

## Unit Coverage

- Valid passive `FailureEvent` becomes a valid `EvidenceEnvelope`.
- Invalid `FailureEvent` is rejected before envelope output is accepted.
- `rawRetained: true` cannot pass.
- Authority cannot exceed `none`.
- Missing source, scope, provenance, or TTL is rejected.
- Expired TTL is rejected.
- Oversized payload budget is rejected.
- Secret-like, provider-payload-like, tool-args-like, env-dump-like, and workspace-path-like content does not survive the payload.
- Every accepted adapter output passes `validateEvidenceEnvelope`.
- No active TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, tool-blocking, checkpoint, or lifecycle consumer is introduced.

## Boundary Scan

The focused unit test scans active runtime roots for imports or references to `failure-evidence-envelope-summary` and `createFailureSummaryEvidenceEnvelope`. Allowed references are the adapter file, the additive barrel export, docs, and tests.

The focused unit test also scans checkpoint and lifecycle authority files for adapter references so this phase cannot silently write evidence into state authority paths.

## Promotion Criteria

Promote this phase to `ready_for_replay_or_prompt_slot_design` only when the required commands pass and no active consumer exists. Any desire to inject the envelope into prompts, replay reports, scorecards, TaskLoop summaries, or runtime decisions requires a new follow-up spec.
