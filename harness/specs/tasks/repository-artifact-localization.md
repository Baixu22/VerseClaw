---
lifecycleStatus: archived
id: repository-artifact-localization
title: Localize development history without removing source inputs
diffBase: 2a82bb08d234d5ea9d8e8c165545ab980f6fefb9
intent: Keep only source, maintained documentation, fixed inputs and curated final evidence in a fresh clone; localize process history with verified recovery and enforce the boundary in CI.
touchedAreas:
  - .gitignore
  - .agent-workbench/task-forest/**
  - .codex-tools/task-forest/**
  - .parity-audit/**
  - .design-staging/**
  - .github/workflows/check.yml
  - AGENTS.md
  - WORKTREE.md
  - README*.md
  - artifacts/**
  - docs/**
  - harness/specs/**
  - hello-world/**
  - prototypes/**
  - reports/**
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
  - .design-staging/**
  - .github/workflows/check.yml
  - AGENTS.md
  - WORKTREE.md
  - README*.md
  - artifacts/**
  - docs/**
  - harness/specs/**
  - hello-world/**
  - prototypes/**
  - reports/**
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

The cleanup runs from the remote main baseline in an isolated worktree, preserving
unrelated work. No test files are retired in this follow-up. Historical process
paths remain recoverable from Git history and an external byte-verified archive;
temporary audit scripts and manifests are not new source artifacts.

Validation must use only retained files. Reusing installed dependencies is allowed
but is not a fresh install or a new product acceptance. Do not rewrite old
evidence identities or product locks to make this source cleanup pass.
