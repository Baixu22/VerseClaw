---
lifecycleStatus: active
id: mainline-review-issues-233-240
title: Repair the eight confirmed mainline review issues
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Fix issues 233 through 240 with regression coverage for exported text, restore containment, workspace ownership, source startup, replay matching, usage dates, Cron history and provider authentication.
diffBase: 9a2a5280ddb3ccb4607ad8ccfe85d5e3292feb7c
touchedAreas:
  - electron/services/**
  - electron/utils/openclaw-auth.ts
  - src/lib/host-api-client.ts
  - src/pages/Models/**
  - tests/unit/**
  - tests/e2e/**
  - docs/modules/**
  - README*.md
  - harness/specs/tasks/mainline-review-issues-233-240.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/local-data-backup-restore.test.ts tests/unit/git-api.test.ts tests/unit/models-usage-history.test.ts tests/unit/knowledge-api.test.ts tests/unit/knowledge-source-sync.test.ts tests/unit/host-api-client-error-metadata.test.ts tests/unit/cron-api-run-log-replay.test.ts tests/unit/provider-runtime-sync-r4-file.test.ts
  - pnpm exec vitest run tests/unit/task-ledger-export.test.ts
  - pnpm exec playwright test tests/e2e/mainline-review-regressions.spec.ts
  - pnpm run typecheck
expectedUserBehavior:
  - Offline Task Ledger views show task and event content as literal text.
  - Backup preview and restore reject destinations redirected through symbolic links or junctions.
  - Git mutations execute in the workspace captured when the request begins.
  - A failed knowledge source does not prevent other configured sources from starting.
  - Daily usage remains separate across years and chart labels distinguish the years.
  - Host replay selects the exact payload before an explicitly payload-free fallback.
  - Cron details include the latest retained execution history using valid paginated requests.
  - Explicit no-auth updates replace previous provider request authentication in runtime configuration.
acceptance:
  - Task text, identifiers, edge endpoints and event payloads cannot become executable markup in any offline view.
  - Real filesystem regression rejects an existing destination junction and rechecks containment when applying a restore.
  - Asynchronous active-workspace switches cannot redirect validated Git operations to another repository.
  - Watcher and connector startup isolate failures per configured source and preserve recovery behavior.
  - Cross-year daily buckets remain chronological regardless of input order and same-day entries still aggregate.
  - Replay never treats a mismatched payload fixture as a generic fallback.
  - Cron requests satisfy the bundled schema, follow history pages and retain the supported legacy fallback behavior.
  - Updating query/header auth to none removes the previous request.auth override from both persisted runtime files and removes its derived headers and query parameters.
docs:
  required: true
  note: Review README variants and update the affected module contracts with verified behavior.
---

This task implements the owner's requested fixes for review index #241. Reproductions
and verification are agent-driven. Each issue remains open until its fix is available
on main; branch-only results are recorded as pending integration.
