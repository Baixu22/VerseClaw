---
id: p2-issue-fixes-batch1-20261010
title: P2 issue batch 1 - portable spec commands, snapshot, lock and doc-entry hygiene
taskType: repo-hygiene
intent: Close four open [P2] issues (#83, #73, #110, #145) with verified repository fixes and fail-closed guards.
touchedAreas:
  - harness/specs/**
  - harness/src/**
  - scripts/scan-pattern.mjs
  - scripts/scan-pattern.d.mts
  - scripts/repository-artifacts.json
  - tests/unit/**
  - tests/e2e/**
  - docs/multi-agent-orchestration/README.md
  - docs/dev/p2-issue-fixes-batch1-20261010.md
  - .gitignore
  - skills-lock.json
expectedUserBehavior:
  - Declared task-spec gates run from a clean checkout instead of an operator's machine.
  - No orphan Playwright baseline or dead skill lock claims to be valid evidence.
requiredProfiles:
  - fast
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/harness-spec-portability.test.ts tests/unit/scan-pattern.test.ts tests/unit/e2e-snapshot-ownership.test.ts tests/unit/skills-lock-integrity.test.ts tests/unit/docs-entry-references.test.ts
  - pnpm harness validate --spec harness/specs/tasks/p2-issue-fixes-batch1-20261010.md
  - pnpm docs:policy:validate
  - pnpm repo:artifacts:check
acceptance:
  - Issue #145 - no checked-in task spec declares a machine-specific user profile path, and pnpm harness validate fails closed on one in every spec family including --no-diff.
  - Issue #145 - pattern scans declared by specs run through the tracked scripts/scan-pattern.mjs, not an undeclared local ripgrep wrapper.
  - Issue #83 - the orphan tests/e2e/chat-work-context-bar.spec.ts-snapshots directory is removed and every remaining tests/e2e/*-snapshots directory is owned by a spec that captures a screenshot.
  - Issue #73 - skills-lock.json points at a tracked file whose sha256 equals computedHash, guarded by a unit test.
  - Issue #110 - docs/multi-agent-orchestration/README.md resolves every required entry to a tracked file; the local-only session handoff is labelled and allowlisted explicitly.
docs:
  required: false
---

# P2 issue batch 1

This task spec covers the first batch of open `[P2]` GitHub issues on the private
remote: portable spec commands (#145), orphan E2E snapshot directory (#83),
orphaned skills lock (#73), and the orchestration entry document's dead
references (#110).

Scope is repository hygiene plus fail-closed guards. No product default, feature
flag, product lock, packaged artifact, or release state changes. Each guard is a
tracked test or harness check so the fixed class of defect cannot silently
return. Evidence is agent-driven (`driven_by: agent`); nothing here claims
human execution.
