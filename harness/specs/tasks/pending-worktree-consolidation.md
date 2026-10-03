---
id: pending-worktree-consolidation
title: Consolidate still-valid repairs from preserved worktrees
taskType: runtime-bridge
scenario: gateway-backend-communication
diffBase: 6577ddf25b1e5f7dce5a58de8e5f17eab6195fbf
intent: Integrate pending acknowledgement, accessibility and acceptance-integrity repairs without restoring obsolete candidate restrictions or historical artifact state.
ownedPaths:
  - harness/specs/tasks/pending-worktree-consolidation.md
  - electron/services/dcs-flag-ack.ts
  - electron/services/dcs-prod-flags-api.ts
  - shared/host-api/host-action-timeouts.ts
  - src/components/layout/Sidebar.tsx
  - scripts/agent-engineering-acceptance.mjs
  - scripts/validate-runtime-authority-convergence.mjs
  - scripts/validate-runtime-authority-convergence.d.mts
  - scripts/rc10/driver.mjs
  - scripts/lib/rc10-evidence.mjs
  - scripts/lib/rc10-evidence.d.mts
  - scripts/verify-rc10-evidence.mjs
  - tests/unit/agent-engineering-acceptance.test.ts
  - tests/unit/dcs-flag-ack.test.ts
  - tests/unit/host-action-timeouts.test.ts
  - tests/unit/rc10-evidence.test.ts
  - tests/unit/rc10-driver-entrypoint.test.ts
  - tests/e2e/sidebar-settings-fakecoding.spec.ts
  - docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md
  - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
  - docs/dev/pending-worktree-consolidation.md
touchedAreas:
  - electron/services/dcs-flag-ack.ts
  - electron/services/dcs-prod-flags-api.ts
  - shared/host-api/host-action-timeouts.ts
  - src/components/layout/Sidebar.tsx
  - scripts/**
  - tests/**
  - docs/dev/**
  - harness/specs/tasks/pending-worktree-consolidation.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - repository-artifact-retention
expectedUserBehavior:
  - Transient startup and disconnect states retain acknowledgement polling.
  - DCS mutation host calls have time for restart and acknowledgement.
  - Sidebar settings remains accessible when collapsed and empty sessions use the recent-session view.
  - RC-09 rejects stale candidate inputs before execution gates.
  - RC-10 counts current-run source receipts and seals only final evidence bytes.
requiredTests:
  - pnpm exec vitest run tests/unit/dcs-flag-ack.test.ts tests/unit/host-action-timeouts.test.ts tests/unit/agent-engineering-acceptance.test.ts tests/unit/rc10-evidence.test.ts tests/unit/rc10-driver-entrypoint.test.ts
  - pnpm run typecheck
  - pnpm contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Preserved worktrees remain byte-for-byte unchanged; obsolete reports and mass-deletion fixtures stay archived.
  - Current H-01 through H-06 and OPERATOR-ALL scenario support is retained.
  - Integrity checks do not relabel historical evidence or grant acceptance.
  - Focused tests reject stale matrices, cross-run receipts, modified workload tests and post-seal mutation.
  - User-visible Sidebar changes retain Electron regression coverage.
docs:
  required: true
  files:
    - docs/dev/pending-worktree-consolidation.md
    - docs/dev/unified-agent-system/runtime-convergence/ACCEPTANCE.md
    - docs/dev/unified-agent-system/runtime-convergence/HUMAN-ACCEPTANCE.md
---

The owner selected still-valid source integration on 2026-10-03. Preserve obsolete
worktree material in the external recovery archive. Do not merge whole historical
trees over newer main, restore local-only task history to Git, or rerun historical
sealers against accepted artifacts. This task does not change frozen product flags.
