---
lifecycleStatus: active
id: immutable-attempt-diff-apply
title: Immutable Attempt and Diff-First Apply (TF-0389)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/attempt.ts
  - tests/unit/attempt-apply.test.ts
  - harness/specs/tasks/immutable-attempt-diff-apply.md
  - harness/specs/fixtures/tf0389-attempt-apply/**
---

# TF-0389 Immutable Attempt and Diff-First Apply

## Objective

Represent an immutable attempt with session/worktree/evidence refs, a diff and
verification state. Apply is a separate explicit action that preflights first,
requires an approval ID for mutation, and preserves failures without pretending
success.

## Scope

- Attempt identity is immutable; no overwrite or silent replacement.
- Preflight always runs before apply and performs no mutation.
- Missing approval returns approval-required; failed verification or patch
  preflight blocks; apply errors return a preserved failure result.
- The adapter composes existing Git apply semantics; no auto merge, commit, PR,
  Best-of-N or new worktree system is added.

## Acceptance

- pnpm typecheck passes.
- pnpm exec vitest run tests/unit/attempt-apply.test.ts passes.
- Tests cover required approval, explicit apply, failed verification and failed
  preflight.
- pnpm harness validate --spec harness/specs/tasks/immutable-attempt-diff-apply.md passes.
- git diff --check passes.

## Notes

Contract/adapter only; existing Git apply and permission approval remain the
mutation authority. Receipts are agent-driven.
