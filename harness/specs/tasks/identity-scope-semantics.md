---
id: identity-scope-semantics
title: Identity and Scope Vocabulary (TF-0372)
scenario: identity-scope-compatibility
taskType: shared-contract
intent: Distinguish workspace, project, session, run and task identities through shared types and one compatibility boundary without migrating persisted data.
ownedPaths:
  - shared/types/identity-scope.ts
  - shared/product-semantics.ts
  - tests/unit/identity-scope.test.ts
  - docs/clawx-product-semantics.md
  - docs/clawx-design-overview.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/identity-scope-semantics.md
  - harness/specs/scenarios/identity-scope-compatibility.md
  - harness/specs/rules/identity-scope-boundary.md
  - harness/specs/fixtures/identity-scope/**
touchedAreas:
  - shared/types/identity-scope.ts
  - shared/product-semantics.ts
  - tests/unit/identity-scope.test.ts
  - docs/clawx-product-semantics.md
  - docs/clawx-design-overview.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/identity-scope-semantics.md
  - harness/specs/scenarios/identity-scope-compatibility.md
  - harness/specs/rules/identity-scope-boundary.md
  - harness/specs/fixtures/identity-scope/**
expectedUserBehavior:
  - Existing identifiers, wire payloads, storage and UI behavior remain unchanged.
  - New boundary consumers use distinct shared identity types and explicit scope.
requiredProfiles:
  - fast
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredTests:
  - pnpm contract:check
  - pnpm typecheck
  - pnpm exec vitest run tests/unit/identity-scope.test.ts tests/unit/product-semantics.test.ts
  - pnpm harness validate --spec harness/specs/tasks/identity-scope-semantics.md
  - git diff --check
acceptance:
  - The vocabulary lists owner, scope, lifecycle, permitted references and prohibited uses for WorkspaceId, ProjectId, SessionKey, RunId and TaskId.
  - Shared branded strings distinguish all five identities without changing their bytes or introducing a registry.
  - Compatibility mapping is centralized; session-only scope, ambiguous bare taskId and unscoped runId are rejected by executable tests, with compile-time misuse checked by typecheck.
  - Run lineage is explicit and never inferred from a session key.
  - contract:check and full typecheck pass and retained agent-driven receipts identify a clean source candidate.
  - No persistence migration, new Task/Run/Trace/Goal/Memory authority, full OS sandbox, product lock change or downstream node implementation is included.
docs:
  required: true
  files:
    - docs/clawx-product-semantics.md
    - docs/clawx-design-overview.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

TF-0372 establishes vocabulary and an opt-in shared boundary. It does not claim
that every old caller has migrated. Existing raw payload fields and the browser
resource-envelope fallback are documented compatibility debt. TF-0373 and later
nodes are outside this implementation.

Transport remains governed by `gateway-backend-communication`; adopting these
types in a renderer/Main/runtime route requires that scenario and comms gates.
This slice introduces no route or transport change.
