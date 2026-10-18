---
lifecycleStatus: active
id: project-read-only-aggregation
title: Project Read-Only Aggregation (TF-0388)
type: task
scenarios:
  - identity-scope-compatibility
requiredRules:
  - identity-scope-boundary
  - docs-sync
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - shared/types/project.ts
  - tests/unit/project-projection.test.ts
  - harness/specs/tasks/project-read-only-aggregation.md
  - harness/specs/fixtures/tf0388-project-projection/**
---

# TF-0388 Project Read-Only Aggregation

## Objective

Project is a read-only, user-visible work container projected over an existing
Workspace. It carries master instruction, knowledge refs and session refs
without copying workspace data or claiming independent Project CRUD.

## Scope

- ProjectId stays distinct from WorkspaceId; the transitional 1:1 compatibility
  mapping is explicit via compatibilityMapped.
- Existing workspaces work without migration; no persistence is created.
- Master instruction and knowledge refs have explicit null/empty semantics.
- No shared permissions or real-time collaboration is added.

## Acceptance

- pnpm typecheck passes.
- pnpm exec vitest run tests/unit/project-projection.test.ts passes.
- An unmodified workspace projects successfully with empty optional refs.
- pnpm harness validate --spec harness/specs/tasks/project-read-only-aggregation.md passes.
- git diff --check passes.

## Notes

Read-only projection only. Receipts are agent-driven.
