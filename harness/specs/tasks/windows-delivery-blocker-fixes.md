---
lifecycleStatus: archived
id: windows-delivery-blocker-fixes
title: Repair Windows CLI dispatch, installer stalls and diagnose native worker exits
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e9c0fc12ccae04c5e69efd8c59ff4b8ecc696b7a
intent: Fix the three observed frozen-candidate blockers at their shared entry points and retain reproducible agent-driven evidence.
expectedUserBehavior:
  - CLI information queries terminate without loading Gateway or touching user state; unsupported commands fail explicitly.
  - Bundled Node satisfies runtime requirements and Windows fallback uses the delivered executable.
  - Non-elevated installation, replacement and removal finish without waiting for unauthorized Defender operations.
  - Native failures retain the actual worker identity and diagnostics, and never become a passing result through retry or cleanup.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - openclaw_runtime/src/entry.ts
  - resources/cli/**
  - scripts/**
  - tests/unit/windows-delivery-entry.test.ts
  - tests/unit/patch-nsis-extract.test.ts
  - tests/e2e/fixtures/electron.ts
  - playwright.config.ts
  - docs/dev/windows-delivery-blocker-fixes.md
  - harness/specs/tasks/windows-delivery-blocker-fixes.md
  - harness/specs/rules/windows-delivery-entry-boundary.md
  - artifacts/windows-delivery-blocker-fixes/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - .gitattributes
docs:
  required: true
  paths:
    - docs/dev/windows-delivery-blocker-fixes.md
requiredTests:
  - pnpm exec vitest run tests/unit/windows-delivery-entry.test.ts tests/unit/supply-chain-integrity-p6-003.test.ts
  - pnpm exec playwright test tests/e2e/skills-gateway-readiness.spec.ts tests/e2e/electron-worker-cleanup.spec.ts
acceptance:
  - Isolated real CLI probes cover version, help, unknown commands, native Node and Electron fallback; state fingerprints and process outcomes are retained.
  - Packaging rejects a Node executable older than the runtime engine requirement, including stale binaries left after changing the download manifest.
  - Non-admin install, replacement and uninstall use the current NSIS, preserve profiles and restore environment; launcher exit alone is insufficient.
  - Native diagnosis correlates worker PID, executable, time and failure artifacts; record unresolved cause if no reproducible cause is established.
  - Preserve the rejected candidate and original failures; no release or product-lock changes.
---

The user authorized all three fixes (TF-0260/0261/0262), processed sequentially.
All validation is driven_by: agent. Historical evidence is immutable. Development
checks do not replace a fresh frozen-candidate release acceptance cycle.
