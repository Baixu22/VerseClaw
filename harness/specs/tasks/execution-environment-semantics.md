---
lifecycleStatus: active
id: execution-environment-semantics
title: ExecutionEnvironment and Guarantee Levels (TF-0380)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/execution-environment.ts
  - shared/execution-environment-semantics.md
  - tests/unit/execution-environment.test.ts
  - harness/specs/tasks/execution-environment-semantics.md
  - harness/specs/fixtures/tf0380-execution-environment/**
---

# TF-0380 ExecutionEnvironment and Guarantee Levels

## Objective

Define the shared execution vocabulary and mappings needed before policy or UI
changes. The contract distinguishes backend, guarantee, network, writable roots,
status and reason without turning backend names into guarantees.

## Scope

- Shared types cover `host`, `node`, `docker`, `ssh`, `verseshell` and
  `codex-native`, and guarantees cover `policy`, `process`, `container`,
  `vm` and `os`.
- Mapping from an existing `SandboxProviderStatus` consumes the owner-supplied
  `runtimeLevel`; it never upgrades a provider based on its name.
- Missing or invalid values fail closed instead of being guessed.
- The document states that complete OS sandboxing is a non-goal.
- Existing sandbox defaults, permission policy, approval behavior and runtime
  execution paths remain unchanged; TF-0381 owns those changes.

## Acceptance

- `pnpm typecheck` passes.
- Unit tests cover policy-light, windows-light, docker-strong, ssh-strong and
  codex-native mappings.
- `pnpm exec vitest run tests/unit/execution-environment.test.ts` passes.
- `pnpm harness validate --spec harness/specs/tasks/execution-environment-semantics.md` passes.
- `git diff --check` passes.
- No new container runtime, complete OS sandbox, default-policy change or
  downstream TF-0381 implementation is included.

## Notes

This node is semantic-only. Receipts are agent-driven; no real-human evidence
is claimed.
