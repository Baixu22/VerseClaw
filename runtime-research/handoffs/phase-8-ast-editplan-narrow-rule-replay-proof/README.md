# Phase 8 AST EditPlan Narrow-Rule Replay Proof

Status: accepted_phase_8_ast_editplan_narrow_rule_replay_proof

## Scope

This phase narrows AST P6 to a fixed replay proof over ten narrow-rule samples:

```text
ast-grep readonly candidate generation
  -> EditPlan IR
  -> Evidence Verifier readiness
  -> explicit apply gate readiness
  -> controlled apply dry-run
  -> controlled apply to test-owned temporary files
```

It is proof-only. It does not add runtime consumers, product surfaces, workspace scanning, broad workspace edits, symbol mutation, TaskLoop/Gateway/Main/renderer/host-api/api-client routes, provider transport changes, prompt/model-message insertion, persistence, services, default-on behavior, or task-completion authority.

## Implemented

- A fresh task spec for the narrowed P6 proof.
- A focused unit test covering ten fixed narrow-rule samples:
  - React prop rename, two samples.
  - API call migration, two samples.
  - import rewrite, two samples.
  - IPC route rename, two samples.
  - deprecated option removal, two samples.
- Replay checks for deterministic readonly candidate generation, source hash stability, preview diff hash stability, match range fingerprint stability, dry-run planned hash, real apply hash, and non-completion-evidence markers.
- Fail-closed checks for drift, overlap, unsupported operation, missing approval, and missing caller-owned temp target.

## Decision

P6 decision: `allow_more_narrow_evaluation`.

This means the existing AST helpers may remain available for future narrow-rule evaluation only. It does not reverse the deep-validation result that AST is not the current usable runtime pilot direction.

## Boundary

Allowed:

- fixed target-file inputs supplied by the test;
- in-memory readonly candidate generation;
- test-owned temporary file apply;
- diagnostics and replay evidence.

Rejected:

- repository-wide scan;
- workspace apply;
- symbol mutation;
- TaskLoop/Gateway/Main/renderer/host-api/api-client integration;
- provider transport or provider ordering changes;
- prompt/model-message insertion;
- persistence/cache/database/service/listener/daemon behavior;
- default-on behavior;
- production/runtime readiness claims;
- treating any AST output or apply result as task-completion evidence.

## Validation

- `pnpm --config.verify-deps-before-run=false harness context --spec harness/specs/tasks/phase-8-ast-editplan-narrow-rule-replay-proof.md`
- `pnpm --config.verify-deps-before-run=false harness validate --spec harness/specs/tasks/phase-8-ast-editplan-narrow-rule-replay-proof.md`
- `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/runtime-ast-edit-plan-narrow-rule-replay-proof.test.ts`
- `git diff --check`

## Next Phase

Do not proceed to broad AST runtime use.

Any future AST work should remain a narrower evaluation track unless a fresh accepted task spec proves false-positive rate, review time, cost envelope, and fail-closed behavior on a larger fixed allowlist. Runtime integration, production use, TaskLoop/Gateway/Main/renderer/host-api/api-client routes, provider transport, prompt/model-message insertion, persistence, services, default-on behavior, broader workspace apply, or task-completion authority remain blocked.
