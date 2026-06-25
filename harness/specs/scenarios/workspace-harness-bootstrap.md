---
id: workspace-harness-bootstrap
title: Workspace Harness Bootstrap
type: workspace-bootstrap
ownedPaths:
  - electron/utils/verse-claw-harness-template.ts
  - electron/utils/openclaw-workspace.ts
  - electron/services/workspaces-api.ts
  - resources/workspace-harness/**
  - resources/context/AGENTS.clawx.md
  - tests/unit/strip-first-run.test.ts
  - tests/unit/agent-config.test.ts
  - tests/unit/workspaces-api.test.ts
requiredProfiles:
  - fast
requiredRules:
  - workspace-harness-single-source
  - docs-sync
---

Workspace harness bootstrap covers the Verse Claw-owned project specification and Task Ledger bridge skeleton that is seeded into active project workspaces and OpenClaw agent workspaces.

The bootstrap flow has two entry points:

- OpenClaw agent workspace provisioning calls `ensureVerse ClawIdentityFile`, which also seeds `.clawx/harness/`.
- Verse Claw active workspace profile creation or root-path migration calls the same harness seeder for the selected project directory.

The seeded files provide a Trellis-inspired structure without copying Trellis, creating `.trellis/`, or competing with Verse Claw's long-conversation state owners:

- `specs/rules/` for hard constraints.
- `specs/scenarios/` for cross-layer workflows.
- `specs/tasks/` for concrete work contracts.
- `specs/guides/` for process guidance.
- `specs/layers/` for path-based subsystem conventions.
- `workspace/task-index.md` for a Task Ledger mirror or bootstrap checklist across goals, scenarios, layers, status, risk, context, and validation.
- `workspace/context-packs.md` for focused reading-list recipes, not injected Context Pack truth.
- `workspace/decisions.md`, `workspace/risks.md`, and `workspace/validation.md` for readable mirrors or exports of Task Ledger/observability evidence.
- `workspace/` private journals for local notes ignored by default.

Task Ledger remains authoritative for long-running work state. ClawGraph remains authoritative for workflow execution state. Validation should cover both seeding routes and verify that existing user-edited harness files are not overwritten.
