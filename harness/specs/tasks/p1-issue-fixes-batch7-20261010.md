---
id: p1-issue-fixes-batch7-20261010
title: P1 issue batch 7 - remove unreferenced screenshot and brand assets
lifecycleStatus: completed
taskType: runtime-bridge
scenario: gateway-backend-communication
intent: Close P1 issues #79, #80 and #81 by removing confirmed unreferenced screenshot/brand assets while retaining the four icon-kit generator inputs.
expectedUserBehavior:
  - The source tree no longer ships 18+ MiB of unreferenced screenshot captures.
  - The logo kit keeps only the four images consumed by scripts/generate-icons.mjs.
  - Unreferenced brand exploration imagery is removed from src/assets.
touchedAreas:
  - .gitignore
  - resources/screenshot/**
  - resources/icons/clawx-logo-kit/**
  - src/assets/brand/**
  - scripts/repository-artifacts.json
  - harness/specs/tasks/p1-issue-fixes-batch7-20261010.md
  - docs/dev/p1-issue-fixes-batch7-20261010.md
requiredRules:
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node scripts/generate-icons.mjs
  - node scripts/check-repository-artifacts.mjs
  - pnpm run build:vite
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/p1-issue-fixes-batch7-20261010.md
acceptance:
  - Issue #79 - resources/screenshot is removed and no tracked source/build path references it.
  - Issue #80 - the logo kit retains only logo-dock-1024{,-dark}.png and logo-menubar-128{,-dark}.png; icon generation succeeds.
  - Issue #81 - src/assets/brand is removed as unreferenced source imagery.
  - Production build succeeds after removal and no product default or permission behavior changes.
docs:
  required: true
  paths:
    - docs/dev/p1-issue-fixes-batch7-20261010.md
---

# P1 issue batch 7

This batch removes source-tree asset bloat that had no runtime/import
references. It deliberately preserves the four logo-kit inputs used by the
icon generator and does not touch historical evidence archives, product
defaults, permissions, or worktrees.
