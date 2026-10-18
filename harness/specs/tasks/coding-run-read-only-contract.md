---
lifecycleStatus: active
id: coding-run-read-only-contract
title: CodingRun Read-Only Aggregation Contract (TF-0376)
type: task
intent: Define a shared, read-only CodingRun association contract that links existing execution and task owners without adding persistence or a second state machine.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/coding-run.ts
  - shared/product-semantics.ts
  - tests/unit/coding-run.test.ts
  - harness/specs/tasks/coding-run-read-only-contract.md
  - harness/specs/fixtures/tf0376-coding-run-contract/**
---

# TF-0376 CodingRun Read-Only Aggregation Contract

## Objective

Freeze the association fields and failure vocabulary that later Chat and CI
projections can share. A CodingRun view links owner-supplied identities; it does
not become the owner of task status, run status, traces, permissions, attempts,
persistence or scheduling.

## Scope

- `CodingRunView` contains the stable `codingRunId` plus nullable or empty
  references for objective, acceptance contract, sessions, scope, execution run
  IDs, attempts, Task Ledger root, trace, permission envelope, context
  fingerprint and completion projection.
- `createCodingRunView` only normalizes owner-supplied values. It never resolves
  a workspace or ancestry from a session and never defaults a missing relation
  into a guessed value.
- `resolveCodingRun` returns `resolved`, `missing`, `unknown`, `multiple` or
  `conflict` explicitly.
- A session is an association only; it does not establish run lineage, scope or
  completion.
- Existing identifiers, host-api routes, wire formats, persistence, Gateway,
  Task Ledger, Task Loop and frozen defaults remain unchanged.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm contract:check` passes.
- `pnpm exec vitest run tests/unit/coding-run.test.ts` passes.
- Unit tests cover missing CodingRun, unknown relation, multiple run association
  and duplicate-ID conflict.
- The document and types state that CodingRun is not a state machine.
- `pnpm harness validate --spec harness/specs/tasks/coding-run-read-only-contract.md`
  passes.
- `git diff --check` passes.
- No persistence, host-api route, Runtime/plugin scheduling, Task Ledger/Task
  Loop state-machine or downstream TF-0377+ implementation is included.

## Notes

This node is bounded by TF-0375 and TF-0371. Receipts are agent-driven. The
contract is additive and in-memory; it does not claim that existing Chat or CI
surfaces already consume it.
