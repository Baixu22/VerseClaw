---
id: repository-artifact-localization
title: Localize development history without removing source inputs
diffBase: d5541fd179f5cc9bf48727dd7fa3226be722e491
intent: Apply the 2026-10-02 repository artifact audit using verified external backups, exact index removals, migrated historical consumers, and retained product, security, compliance, and gate inputs.
touchedAreas:
  - .gitignore
  - .agent-workbench/task-forest/**
  - .codex-tools/task-forest/**
  - .parity-audit/**
  - .design-staging/verse-hero/**
  - AGENTS.md
  - WORKTREE.md
  - README*.md
  - artifacts/**
  - docs/**
  - harness/specs/**
  - hello-world/**
  - prototypes/**
  - reports/visual-tune/**
  - reports/ui-review/**
  - reports/assets/**
  - runtime-research/**
  - scripts/**
  - team/**
  - tests/unit/**
  - tests/fixtures/**
  - tests/e2e/rc10-operator-live.spec.ts
  - tests/integration/channel-startup.integration.test.ts
  - reports/frontend-render-fix-verification-20260811.md
  - package.json
ownedPaths:
  - .gitignore
  - .agent-workbench/task-forest/**
  - .codex-tools/task-forest/**
  - .parity-audit/**
  - .design-staging/verse-hero/**
  - AGENTS.md
  - WORKTREE.md
  - README*.md
  - artifacts/**
  - docs/**
  - harness/specs/**
  - hello-world/**
  - prototypes/**
  - reports/visual-tune/**
  - reports/ui-review/**
  - reports/assets/**
  - runtime-research/**
  - scripts/**
  - team/**
  - tests/unit/**
  - tests/fixtures/**
  - tests/e2e/rc10-operator-live.spec.ts
  - tests/integration/channel-startup.integration.test.ts
  - reports/frontend-render-fix-verification-20260811.md
  - package.json
expectedUserBehavior:
  - Local Task Forest history and session notes remain recoverable but no longer create source-control churn.
  - Default regression tests do not depend on a developer's private task graph or handoff notes.
  - Active drivers, fixtures, gate configuration, product locks, and acceptance provenance remain intact.
requiredProfiles:
  - fast
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - docs-sync
humanEvidence: not-required
requiredTests:
  - pnpm repo:artifacts:check
  - pnpm exec vitest run tests/unit/repository-artifact-retention.test.ts tests/unit/rc10-driver-entrypoint.test.ts
  - pnpm contract:check
  - pnpm harness validate --spec harness/specs/tasks/repository-artifact-localization.md
acceptance:
  - Every localized path has an external byte-verified backup, including all index stages for conflicts.
  - Exact index removal leaves unrelated staged files and unresolved product conflicts unchanged.
  - No blanket ignores remove product sources, regression tests, gate configuration, final evidence, or compliance inputs.
  - Local task history consumers use stable fixtures or explicit historical replay inputs.
  - Retired historical wording tests leave default discovery and active requiredTests references.
  - Validation runs in an isolated retained-source projection without ignored local artifact directories; pre-existing failures are reported, not hidden.
  - Historical acceptance results and hash manifests are not rewritten to claim acceptance of this change.
docs:
  required: true
  files:
    - docs/dev/repository-artifact-retention.md
    - docs/dev/Sustained-Development-Playbook.md
---

The source workspace was already in a merge with 57 unmerged paths and thousands
of staged changes when this task started. The task does not authorize resolving
unrelated product conflicts, committing the merge, publishing, deleting branches,
or rewriting history. Full-workspace Harness ownership validation may fail on
those pre-existing paths; preserve that result and separately validate the actual
cleanup diff in an isolated retained-source projection. Do not widen ownership to
product directories or suppress diff checking to obtain a green result.

The audit's 4,409 candidates are review inputs, not a deletion allowlist. Retain any
mixed-use candidate whose active consumer has not been safely migrated. Detailed
local archive manifests are recovery records, not a second progress/task system.
