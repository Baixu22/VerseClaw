---
lifecycleStatus: active
id: instruction-precedence-explain
title: Unified Instruction Precedence and Explain (TF-0386)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/instruction-precedence.ts
  - shared/host-api/contract.ts
  - src/lib/host-api.ts
  - electron/services/project-rules-api.ts
  - tests/unit/instruction-precedence.test.ts
  - harness/specs/tasks/instruction-precedence-explain.md
  - harness/specs/fixtures/tf0386-instruction-precedence/**
---

# TF-0386 Unified Instruction Precedence and Explain

## Objective

Provide one read-only resolver for AGENTS.md, project rules, harness, skill, role
and turn overrides. Each layer exposes source, scope, precedence, trust, token
estimate and conflicts; the result is available through the existing
projectRules host-api boundary.

## Scope

- Shared precedence is explicit: turn override > harness > project rules >
  AGENTS > role > skill.
- The resolver reports duplicate rule lines as conflicts and names the winning
  layer; it does not rewrite or automatically edit any rule file.
- projectRules.explain injects the active workspace AGENTS.md and .clawx/rules
  content, while optional skill/role/turn inputs allow the caller to explain a
  composed context.
- Existing instruction file formats, persistence and project-rules snapshot are
  unchanged.
- No full prompt debugger or automatic rule writeback is introduced.

## Acceptance

- `pnpm typecheck` passes.
- `pnpm exec vitest run tests/unit/instruction-precedence.test.ts tests/unit/project-rules-api.test.ts` passes.
- Tests cover AGENTS.md + project rules + skill + role and a conflict resolved by
  turn override.
- `pnpm contract:check` passes.
- `pnpm harness validate --spec harness/specs/tasks/instruction-precedence-explain.md` passes.
- `git diff --check` passes.

## Notes

The explain result is a read-only projection. Receipts are agent-driven; no
real-human evidence is claimed.
