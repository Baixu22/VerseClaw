---
lifecycleStatus: active
id: execution-environment-fail-closed
title: Execution Environment Default Policy and Fail-Closed Boundary (TF-0381)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - electron/utils/sandbox-policy-resolver.ts
  - tests/unit/sandbox-explicit-strong-156.test.ts
  - harness/specs/tasks/execution-environment-fail-closed.md
  - harness/specs/fixtures/tf0381-execution-environment-fail-closed/**
---

# TF-0381 Execution Environment Default Policy and Fail-Closed Boundary

## Objective

Attach the TF-0380 execution-environment semantics to the existing sandbox
policy resolver and prove four execution-boundary cases: default policy,
container available, container unavailable, and Codex-native conflict.

## Scope

- Default policy-light resolution exposes a host backend with a policy guarantee.
- An available strong container exposes a container guarantee.
- An explicitly required but unavailable container raises the existing
  `SandboxStrengthUnavailableError`; it does not silently fall back to host.
- An explicit environment whose backend conflicts with the resolved backend is
  rejected with the same stable error family and a readable reason.
- Existing high-risk approval gating and product defaults remain in force.
- No complete OS sandbox or new sandbox provider is introduced.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm exec vitest run tests/unit/sandbox-explicit-strong-156.test.ts tests/unit/sandbox-high-risk-gate-p2-004.test.ts` passes.
- Default policy, container available, container unavailable and Codex-native
  conflict cases are covered.
- `pnpm harness validate --spec harness/specs/tasks/execution-environment-fail-closed.md` passes.
- `git diff --check` passes.
- No full OS sandbox dependency, product-lock change or all-command container
  migration is included.

## Notes

The resolver remains the existing execution boundary; this node adds the shared
environment projection and conflict guard. Receipts are agent-driven.
