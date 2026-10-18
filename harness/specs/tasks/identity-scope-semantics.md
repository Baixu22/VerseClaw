---
id: identity-scope-semantics
title: Identity and Scope Vocabulary (TF-0372)
scenario: identity-scope-compatibility
taskType: shared-contract
intent: Distinguish workspace, project, session, run and task identities through shared types and one compatibility boundary without migrating persisted data.
ownedPaths:
  - eslint.config.mjs
  - packages/versebrowser/src/collab/remote-policy.ts
  - packages/versebrowser/src/engine/driver-profile.ts
  - packages/versebrowser/src/engine/facade.ts
  - packages/versebrowser/src/engine/persistent-sessions.ts
  - packages/versebrowser/src/engine/playwright-host-api.ts
  - packages/versebrowser/src/engine/semantic-browser.ts
  - packages/versebrowser/src/engine/standalone.ts
  - packages/versebrowser/src/engine/upstream-control.ts
  - packages/versebrowser/src/engine/visual-browser.ts
  - packages/versebrowser/src/evidence/reader.ts
  - packages/versebrowser/src/openclaw/gateway/types.ts
  - packages/versebrowser/tests/agent-browser-m6-flight-pr.test.ts
  - packages/versebrowser/tests/argument-guard-and-pr-comment.test.ts
  - packages/versebrowser/tests/evidence-jail.test.ts
  - packages/versebrowser/tests/evidence-sinks-coverage.test.ts
  - packages/versebrowser/tests/mcp-shutdown-race.test.ts
  - packages/versebrowser/tests/network-detail.test.ts
  - packages/versebrowser/tests/network-wait.test.ts
  - packages/versebrowser/tests/persistent-sessions.test.ts
  - packages/versebrowser/tests/runtime-read.test.ts
  - packages/versebrowser/tests/semantic-browser.test.ts
  - packages/versebrowser/tests/snapshot-aria-state.test.ts
  - packages/versebrowser/tests/snapshot-diff.test.ts
  - packages/versebrowser/tests/unknown-session-verdict.test.ts
  - packages/versebrowser/tests/upstream-files.test.ts
  - packages/versebrowser/tests/upstream-pointer.test.ts
  - packages/versebrowser/tests/upstream-viewport.test.ts
  - tests/unit/versebrowser-n4-observation-loop.test.ts
  - packages/versebrowser/integration-patches.json
  - packages/versebrowser/patches/tf0372-lint__*.patch
  - .github/workflows/check.yml
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
  - eslint.config.mjs
  - packages/versebrowser/src/collab/remote-policy.ts
  - packages/versebrowser/src/engine/driver-profile.ts
  - packages/versebrowser/src/engine/facade.ts
  - packages/versebrowser/src/engine/persistent-sessions.ts
  - packages/versebrowser/src/engine/playwright-host-api.ts
  - packages/versebrowser/src/engine/semantic-browser.ts
  - packages/versebrowser/src/engine/standalone.ts
  - packages/versebrowser/src/engine/upstream-control.ts
  - packages/versebrowser/src/engine/visual-browser.ts
  - packages/versebrowser/src/evidence/reader.ts
  - packages/versebrowser/src/openclaw/gateway/types.ts
  - packages/versebrowser/tests/agent-browser-m6-flight-pr.test.ts
  - packages/versebrowser/tests/argument-guard-and-pr-comment.test.ts
  - packages/versebrowser/tests/evidence-jail.test.ts
  - packages/versebrowser/tests/evidence-sinks-coverage.test.ts
  - packages/versebrowser/tests/mcp-shutdown-race.test.ts
  - packages/versebrowser/tests/network-detail.test.ts
  - packages/versebrowser/tests/network-wait.test.ts
  - packages/versebrowser/tests/persistent-sessions.test.ts
  - packages/versebrowser/tests/runtime-read.test.ts
  - packages/versebrowser/tests/semantic-browser.test.ts
  - packages/versebrowser/tests/snapshot-aria-state.test.ts
  - packages/versebrowser/tests/snapshot-diff.test.ts
  - packages/versebrowser/tests/unknown-session-verdict.test.ts
  - packages/versebrowser/tests/upstream-files.test.ts
  - packages/versebrowser/tests/upstream-pointer.test.ts
  - packages/versebrowser/tests/upstream-viewport.test.ts
  - tests/unit/versebrowser-n4-observation-loop.test.ts
  - packages/versebrowser/integration-patches.json
  - packages/versebrowser/patches/tf0372-lint__*.patch
  - .github/workflows/check.yml
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

The independent hygiene prerequisite repairs literal PowerShell newline tokens in
`.github/workflows/check.yml`; those tokens made the existing CI YAML invalid.
It preserves the two existing intended hygiene commands and does not alter gates.

The full lint gate also exposed pre-existing imported-module lint failures. The
independent hygiene slice excludes generated module dist only, removes dead code,
adds typed test inputs, preserves sanitized error causes, and repairs the shadowed
download cleanup outcome. Frozen source hashes stay unchanged in import-manifest;
new integration patches carry before/after hashes and replay against the pinned
upstream commit. Existing browser regression suites and comms gates verify this
prerequisite; no permission/default or identity migration is included.
