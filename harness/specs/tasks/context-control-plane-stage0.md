---
lifecycleStatus: archived
id: context-control-plane-stage0
title: Context Control Plane Stage 0 Authority And Artifact Freeze
taskType: shared-contract
intent: Freeze the five context control planes, six minimal artifact schemas, policy/grant/effect contracts, logical authority adapter mappings, the golden coding turn chain contract, and the Stage 1 task draft. Produce pure contract types with normalize/validate tests only. No production path, prompt, tool registration, provider path, flag, store, daemon, default value, or product lock changes enter this stage.
touchedAreas:
  - docs/dev/context-control-plane/**
  - harness/specs/tasks/context-control-plane-stage0.md
  - shared/types/context-control-plane/**
  - tests/unit/context-control-plane-stage0-contracts.test.ts
expectedUserBehavior:
  - Five Stage 0 deliverables and the harness task spec exist under docs/dev/context-control-plane/.
  - Six artifact schemas are machine-validatable through pure types and normalize/validate helpers.
  - Golden coding turn contract covers user input through identity, ContextRef, CompilationSnapshot, PromptPlan, RequestEnvelope, provider fetch, one real tool call, temporary minimal CapabilityGrant, Tool Guard, and EffectReceipt.
  - Stage 1 scope is documented but no runtime behavior is implemented or claimed.
  - No prompt, tool registration, provider path, store, daemon, flag, default value, or product lock changes.
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
humanEvidence: not-required
forbiddenPatterns:
  - modifying attempt.ts, get-reply-run.ts, role-spawn.ts, or any provider path
  - changing product locks, liveReady, productApproved, defaultOn, or human/live evidence counts
  - a new runtime, workflow engine, store, ledger, protocol, exporter, collector, daemon, service, port, or LLM router
  - a second permission database, second approval ledger, third durable memory writer, or fourth capability catalog
  - importing the stage 0 contract types from any production module
  - storing raw prompt, tool output, approval payload, credentials, cookies, or environment values in receipts
  - claiming Stage 1 runtime behavior from fixtures or synthetic results
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage0.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage0.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage0-contracts.test.ts --reporter=verbose
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - git diff --check -- docs/dev/context-control-plane harness/specs/tasks/context-control-plane-stage0.md shared/types/context-control-plane tests/unit/context-control-plane-stage0-contracts.test.ts
acceptance:
  - D1 authority matrix is present at docs/dev/context-control-plane/stage0/authority-matrix.md and states that no new truth source is added.
  - D2 artifact schema is present at docs/dev/context-control-plane/stage0/artifacts-schema.md and annotates every field with source/policy/owner/lifecycle/required-or-optional/version.
  - D3 adapter design is present at docs/dev/context-control-plane/stage0/authority-adapters.md and maps Identity, Policy, Grant, Effect, and Egress with version, rejection reasons, and gaps.
  - D4 golden path contract is present at docs/dev/context-control-plane/stage0/golden-path-contract.md with per-stage input, output, failure semantics, rollback semantics, and Stage 1 queryable fields.
  - D5 Stage 1 draft is present at docs/dev/context-control-plane/stage0/stage1-task-draft.md with acceptance criteria, test matrix, forbidden early work, and owner decision items.
  - Pure types and normalize/validate helpers live only under shared/types/context-control-plane/ and are not imported by production modules.
  - Contract tests prove all six schemas validate valid fixtures and reject payload/raw-content violations.
  - Harness context and validate pass; focused Vitest, contract:check, typecheck, lint:check, and git diff --check pass.
  - Product locks remain false; no production path changed.
docs:
  required: true
  files:
    - docs/dev/context-control-plane/stage0/authority-matrix.md
    - docs/dev/context-control-plane/stage0/artifacts-schema.md
    - docs/dev/context-control-plane/stage0/authority-adapters.md
    - docs/dev/context-control-plane/stage0/golden-path-contract.md
    - docs/dev/context-control-plane/stage0/stage1-task-draft.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
---

# Context Control Plane Stage 0

Stage 0 freezes the control-plane language before any runtime enforcement work. It only
adds documentation and pure contract types/validation tests.

## Deliverables

1. `docs/dev/context-control-plane/stage0/authority-matrix.md` — five-plane authority matrix.
2. `docs/dev/context-control-plane/stage0/artifacts-schema.md` — six minimal artifact schemas.
3. `docs/dev/context-control-plane/stage0/authority-adapters.md` — logical authority adapter design.
4. `docs/dev/context-control-plane/stage0/golden-path-contract.md` — golden coding turn chain contract.
5. `docs/dev/context-control-plane/stage0/stage1-task-draft.md` — Stage 1 task draft.
6. `shared/types/context-control-plane/` — pure types and normalize/validate helpers only.

## Non-Goals

- No Provider Guard runtime behavior, prompt migration, tool registration, provider path,
  store, daemon, flag, default value, or product-lock change.
- No Stage 1 claim from fixtures or synthetic evidence.
