---
id: p2-issue-fixes-batch7-20261010
title: P2 issue batch 7 - repository layout, lifecycle metadata and runtime source gates
lifecycleStatus: active
taskType: repo-governance
intent: Close the open P2 repository-governance issues for task lifecycle metadata, documentation navigation, unused vendored assets, duplicated evidence, vendored runtime provenance, dead-code checks, and the upstream 500-line policy baseline.
touchedAreas:
  - harness/specs/**
  - scripts/**
  - tests/unit/**
  - docs/**
  - README*.md
  - packages/**
  - openclaw_runtime/**
  - .github/workflows/check.yml
  - .gitignore
  - package.json
  - pnpm-workspace.yaml
  - public/lobe-icons/**
  - src/pages/Chat/ChatInput.tsx
expectedUserBehavior:
  - A fresh checkout can identify current versus archived task specs and reach every current top-level developer document from docs/README.md.
  - Unreferenced lobe-icons assets are no longer shipped, and reviewed duplicate assets have explicit retention reasons.
  - The vendored runtime records its upstream identity, sync policy, tracked build-output reason, dead-code checks and a baseline for the upstream line-count rule.
requiredProfiles:
  - fast
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/harness-spec-lifecycle.test.ts tests/unit/docs-index.test.ts tests/unit/runtime-source-policy.test.ts
  - node scripts/check-spec-lifecycle.mjs
  - node scripts/check-duplicate-assets.mjs
  - node scripts/check-runtime-source-policy.mjs
  - pnpm --dir openclaw_runtime run check:import-cycles
  - pnpm --dir openclaw_runtime run check:deprecated-api-usage
  - pnpm --dir openclaw_runtime run deadcode:unused-files
  - pnpm --dir openclaw_runtime run check:loc:baseline
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - Issue #65 - every checked-in harness task spec declares lifecycleStatus active, completed or archived, and harness CI fails when the field is missing or invalid.
  - Issue #66 - docs/dev/repository-layout.md defines root ownership and evidence roots, packages/vtoken is classified as an intentional Python sidecar, and the former root design note is moved under docs/dev.
  - Issue #67 - openclaw_runtime/UPSTREAM.md records upstream URL, vendored version, npm compatibility-bundle role, local-fork policy and tracked build-output rationale; PRUNE-MANIFEST is explicitly historical and version-aligned.
  - Issue #71 - docs/README.md links every top-level docs markdown file and all four README locales link the documentation index.
  - Issue #72 - a duplicate-asset check covers tracked files over 100 KiB and records an explicit reason for every reviewed duplicate group.
  - Issue #82 - the unreferenced public/lobe-icons tree is removed from tracking and a hygiene test keeps it absent.
  - Issue #91 - runtime dead-code unused-file detection runs in CI and the historical prune manifest is superseded rather than presented as current.
  - Issue #94 - import-cycle and deprecated-API checks run in CI, and check:loc:baseline fails on new or grown files above the upstream 500-line limit.
docs:
  required: true
---

# P2 issue batch 7

This batch closes repository-governance issues without changing product
defaults, feature flags, permission defaults or release state. It adds
machine-readable lifecycle and provenance metadata plus fail-closed checks for
the classes of drift those issues reported. Evidence is agent-driven; no human
execution or human data is claimed.
