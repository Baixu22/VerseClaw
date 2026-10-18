---
lifecycleStatus: active
id: capability-status-conflicts
title: MCP, Plugin and Skill Status/Conflict Explanation (TF-0385)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - openclaw_runtime/src/runtime-core/capability-publications.ts
  - shared/host-api/contract.ts
  - tests/unit/capability-conflicts.test.ts
  - harness/specs/tasks/capability-status-conflicts.md
  - harness/specs/fixtures/tf0385-capability-conflicts/**
---

# TF-0385 MCP, Plugin and Skill Status/Conflict Explanation

## Objective

Keep the existing capability publication registry as the single source of
truth, and add an explicit conflict result when more than one source
canonicalizes to the same capability identity. The existing publication UI
already renders each diagnostic code/message; no second registry is added.

## Scope

- MCP `connected` remains gated on a real initialize handshake; a config
  check or reachability probe never upgrades the status.
- Duplicate capability identities receive `conflicts` and a
  `capabilityConflict` warning diagnostic that names the other sources.
- Existing source, state, runtime and diagnostic fields remain the explanation
  surface consumed by the Agents publication UI.
- No plugin marketplace, new plugin runtime or parallel registry is added.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm exec vitest run tests/unit/capability-conflicts.test.ts tests/unit/capability-publication-view-model.test.ts tests/unit/runtime-capability-publications.test.ts tests/unit/mcp-api.test.ts` passes.
- Existing regression tests continue to prove MCP `connected` only follows a
  real handshake.
- The publication UI test suite passes and consumes the same diagnostic array.
- `pnpm harness validate --spec harness/specs/tasks/capability-status-conflicts.md` passes.
- `git diff --check` passes.

## Notes

The conflict result is a publication diagnostic, not a change to plugin
installation or marketplace behavior. Receipts are agent-driven.
