---
lifecycleStatus: active
id: harness-codex-active-verification
title: Harness and Codex Active Verification Matrix
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Convert the S1-S11 capability claims from TF-0566 through TF-0569 into an executable verification matrix with evidence levels, negative cases, source freshness and a sealed agent-driven receipt.
touchedAreas:
  - harness/specs/tasks/harness-codex-active-verification.md
  - harness/specs/fixtures/harness-codex-active-verification/**
  - scripts/verify-harness-active-matrix.mjs
  - scripts/verify-harness-active-matrix.d.mts
  - scripts/build-harness-active-acceptance.mjs
  - tests/unit/harness-codex-active-verification.test.ts
  - docs/modules/harness-and-codex.md
expectedUserBehavior:
  - Every scenario states its command, input, expected result, negative case, product owner and readable artifact.
  - Evidence distinguishes source, runtime, effect, packaged, external-provider and not-run; a lower grade is never promoted.
  - Missing or changed evidence makes the affected scenario stale instead of green.
  - The matrix verifier cannot approve work, complete a task, land a candidate or replace an existing owner.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - contract-first-boundary
  - backend-communication-boundary
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/harness-codex-active-verification.md
  - pnpm exec vitest run tests/unit/harness-codex-active-verification.test.ts --maxWorkers=1
  - node scripts/verify-harness-active-matrix.mjs
  - pnpm run typecheck:test
  - pnpm run repo:artifacts:check
  - git diff --check
acceptance:
  - S1-S11 each have command, input, expected, negative, owner and readable artifact; unavailable or partial work is explicit.
  - The evidence inventory records SHA256, generated time, actor, runtime/package version, environment, exit code and failure reason without secrets or private content.
  - A full-matrix dry-run and at least one positive and negative smoke are executed; a green UI, document or search result cannot replace a runtime receipt.
  - Freshness/staleness is mechanically decided; changing a source or package input invalidates the affected evidence.
  - No product default, release lock or public state changes; the verdict covers only what this run observed.
docs:
  required: true
  files:
    - docs/modules/harness-and-codex.md
---

# TF-0570 Harness and Codex Active Verification Matrix

This node turns the scenarios frozen by TF-0565 into an executable definition. It evaluates evidence; it does not become a second executor, approval plane, task ledger or completion authority.

## Matrix contract

The checked-in matrix is `harness/specs/fixtures/harness-codex-active-verification/matrix.json`. Every row names the product owner, command, input, expected result, negative case, readable artifact, evidence grade and status. Grades are `source`, `runtime`, `effect`, `packaged`, `external-provider` and `not-run`.

The verifier `scripts/verify-harness-active-matrix.mjs` checks the matrix, its source ledger, every retained artifact and the sealed receipt. `scripts/build-harness-active-acceptance.mjs` writes that receipt only after the matrix and source identity are known.

## Freshness

A matrix receipt is fresh only when every readable artifact exists, its SHA256 is recorded, and no participating source is newer than the run that produced it. Missing files, changed bytes, invalid schemas and local/credential content fail closed. The detailed checked paths are retained in `acceptance.json`.

## Reproduce

Run `node scripts/verify-harness-active-matrix.mjs`. Run the required tests for focused failures. The verifier may read existing receipts and run no external model; this node never turns `partial` or `not-run` into a pass.

## Boundaries

- No product selector, scheduler, execution owner, task completion, approval or landing authority is added.
- No credential or private prompt is retained.
- All evidence is `driven_by: agent`; no real-human evidence is claimed.
- Windows x64 is the only observed runtime; other platforms and authenticated model quality remain outside this receipt.
